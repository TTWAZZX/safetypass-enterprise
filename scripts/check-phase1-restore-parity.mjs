import { readFileSync } from 'node:fs';
import pg from 'pg';

const parseEnv = (path) => Object.fromEntries(
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, ''),
      ];
    }),
);
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const expectedManagedExclusions = new Set(['auth.schema_migrations']);
const env = parseEnv('.env.local');
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');
if (!process.env.RESTORE_TEST_DATABASE_URL) throw new Error('RESTORE_TEST_DATABASE_URL is required');

const sourceUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
sourceUrl.password = env.SUPABASE_DB_PASSWORD;
const source = new pg.Client({
  connectionString: sourceUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-restore-parity-source-read-only',
});
const restored = new pg.Client({
  connectionString: process.env.RESTORE_TEST_DATABASE_URL,
  ssl: false,
  application_name: 'safetypass-restore-parity-target',
});

const inventory = async (client) => {
  const tables = (await client.query(`
    select schemaname as schema_name, tablename as table_name
    from pg_tables
    where schemaname in ('public', 'auth')
    order by schemaname, tablename
  `)).rows;
  const result = {};
  for (const { schema_name: schema, table_name: table } of tables) {
    const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const row = (await client.query(`
      select
        count(*)::integer as row_count,
        md5(coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '')) as row_digest
      from ${relation} t
    `)).rows[0];
    result[`${schema}.${table}`] = row;
  }
  return result;
};

try {
  await Promise.all([source.connect(), restored.connect()]);
  await source.query('begin read only');
  await restored.query('begin read only');
  const [sourceInventory, restoredInventory] = await Promise.all([
    inventory(source),
    inventory(restored),
  ]);
  const tableNames = [...new Set([
    ...Object.keys(sourceInventory),
    ...Object.keys(restoredInventory),
  ])].sort();
  const allMismatches = tableNames.filter((name) => (
    JSON.stringify(sourceInventory[name] || null) !== JSON.stringify(restoredInventory[name] || null)
  )).map((name) => ({
    table: name,
    source: sourceInventory[name] || null,
    restored: restoredInventory[name] || null,
  }));
  const expectedMismatches = allMismatches.filter(({ table }) => expectedManagedExclusions.has(table));
  const mismatches = allMismatches.filter(({ table }) => !expectedManagedExclusions.has(table));
  await Promise.all([source.query('rollback'), restored.query('rollback')]);
  console.log(JSON.stringify({
    result: mismatches.length === 0 ? 'PASS' : 'MISMATCH',
    tablesChecked: tableNames.length,
    exactMatches: tableNames.length - allMismatches.length,
    expectedPlatformManagedExclusions: expectedMismatches,
    mismatches,
  }, null, 2));
  if (mismatches.length > 0) process.exitCode = 1;
} catch (error) {
  await Promise.allSettled([source.query('rollback'), restored.query('rollback')]);
  throw error;
} finally {
  await Promise.allSettled([source.end(), restored.end()]);
}
