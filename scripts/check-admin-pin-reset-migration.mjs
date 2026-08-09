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

const unwrapTransaction = (sql) => sql
  .replace(/^\s*begin\s*;\s*/i, '')
  .replace(/\s*commit\s*;\s*$/i, '')
  .replace(/\s*rollback\s*;\s*$/i, '');

const snapshotSql = `
  select jsonb_build_object(
    'users_count', (select count(*) from public.users),
    'users_digest', (select md5(coalesce(string_agg(row_to_json(u)::text, '|' order by u.id::text), '')) from public.users u),
    'auth_security_count', (select count(*) from public.user_auth_security),
    'auth_security_digest', (select md5(coalesce(string_agg(concat_ws('|', s.user_id, s.pin_version, s.failed_attempts, s.last_failed_at, s.locked_until, s.pin_changed_at, s.created_at, s.updated_at), '|' order by s.user_id::text), '')) from public.user_auth_security s),
    'audit_count', (select count(*) from public.audit_logs),
    'audit_digest', (select md5(coalesce(string_agg(row_to_json(a)::text, '|' order by a.id::text), '')) from public.audit_logs a)
  ) as snapshot
`;

const env = parseEnv('.env.local');
const databaseUrlOverride = process.env.ADMIN_PIN_RESET_TEST_DATABASE_URL?.trim();
if (!databaseUrlOverride && !env.SUPABASE_DB_PASSWORD) {
  throw new Error('SUPABASE_DB_PASSWORD is required when ADMIN_PIN_RESET_TEST_DATABASE_URL is not set');
}

const poolerUrl = databaseUrlOverride
  ? new URL(databaseUrlOverride)
  : new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
if (!databaseUrlOverride) poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const isLocalDatabase = ['127.0.0.1', 'localhost'].includes(poolerUrl.hostname);
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
  application_name: 'safetypass-admin-pin-reset-rollback-regression',
});

const migration = unwrapTransaction(readFileSync(
  'supabase/migrations/20260809104500_admin_pin_reset.sql',
  'utf8',
));
const regression = unwrapTransaction(readFileSync(
  'supabase/tests/admin_pin_reset_test.sql',
  'utf8',
));

try {
  await client.connect();
  await client.query('begin');
  const before = (await client.query(snapshotSql)).rows[0].snapshot;
  await client.query(migration);
  const afterMigration = (await client.query(snapshotSql)).rows[0].snapshot;
  if (JSON.stringify(before) !== JSON.stringify(afterMigration)) {
    throw new Error('Existing users, PIN state, or audit history changed during migration');
  }
  await client.query(regression);
  await client.query('rollback');
  const afterRollback = (await client.query(snapshotSql)).rows[0].snapshot;
  if (JSON.stringify(before) !== JSON.stringify(afterRollback)) {
    throw new Error('Rollback did not restore the original data snapshot');
  }
  console.log('Admin PIN reset migration regression passed and transaction rolled back.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
