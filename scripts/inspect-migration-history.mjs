import { readFileSync } from 'node:fs';
import pg from 'pg';

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

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-migration-history-inspection',
});

try {
  await client.connect();
  const columns = await client.query(`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
    order by ordinal_position
  `);
  const versions = await client.query(`
    select version, name
    from supabase_migrations.schema_migrations
    order by version desc
    limit 5
  `);
  console.log(JSON.stringify({ columns: columns.rows, recentVersions: versions.rows }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
