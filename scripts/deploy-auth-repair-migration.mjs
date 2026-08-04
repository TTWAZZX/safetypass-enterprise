import { readFileSync } from 'node:fs';
import pg from 'pg';

const version = '20260804093000';
const name = 'repair_orphaned_auth_accounts';
const migrationPath = `supabase/migrations/${version}_${name}.sql`;

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
    }),
);

if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-auth-repair-deployment',
});
const migration = readFileSync(migrationPath, 'utf8')
  .replace(/^\s*begin\s*;\s*/i, '')
  .replace(/\s*commit\s*;\s*$/i, '');

try {
  await client.connect();
  await client.query('begin');
  await client.query("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('safetypass-schema-migration'))");
  const existing = await client.query(
    'select 1 from supabase_migrations.schema_migrations where version = $1',
    [version],
  );
  if (existing.rowCount > 0) {
    await client.query('rollback');
    console.log(`Migration ${version} is already deployed.`);
    process.exit(0);
  }

  await client.query(migration);
  await client.query(
    'insert into supabase_migrations.schema_migrations(version, statements, name) values ($1, $2, $3)',
    [version, [migration], name],
  );
  await client.query('commit');
  console.log(`Migration ${version} deployed successfully.`);
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
