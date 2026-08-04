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

const env = parseEnv('.env.local');
const stagingRef = env.SUPABASE_STAGING_PROJECT_REF;
const stagingPassword = env.SUPABASE_STAGING_DB_PASSWORD;
if (!stagingRef || stagingRef === env.SUPABASE_PROJECT_REF) {
  throw new Error('Staging project ref is missing or points to production');
}
if (!stagingPassword) throw new Error('SUPABASE_STAGING_DB_PASSWORD is required');

const url = new URL(`postgresql://postgres.${stagingRef}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`);
url.password = stagingPassword;
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-staging-readiness-read-only',
});

try {
  await client.connect();
  await client.query('begin read only');
  const result = (await client.query(`
    select jsonb_build_object(
      'server_version', current_setting('server_version'),
      'public_table_count', (
        select count(*) from pg_tables where schemaname = 'public'
      ),
      'public_users_relation', to_regclass('public.users')::text,
      'auth_users_count', (select count(*) from auth.users),
      'migration_history_present', to_regclass('supabase_migrations.schema_migrations') is not null,
      'pin_v2_present', to_regclass('public.user_auth_security') is not null,
      'production_ref_is_different', $1::text <> $2::text
    ) as readiness
  `, [stagingRef, env.SUPABASE_PROJECT_REF])).rows[0].readiness;
  result.public_users_count = result.public_users_relation
    ? Number((await client.query('select count(*) from public.users')).rows[0].count)
    : null;
  result.latest_migration = result.migration_history_present
    ? (await client.query('select version from supabase_migrations.schema_migrations order by version desc limit 1')).rows[0]?.version || null
    : null;
  console.log(JSON.stringify({ mode: 'READ_ONLY', ...result }, null, 2));
  await client.query('rollback');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
