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
    'exam_count', (select count(*) from public.exam_history),
    'exam_digest', (select md5(coalesce(string_agg(row_to_json(e)::text, '|' order by e.id::text), '')) from public.exam_history e),
    'permit_count', (select count(*) from public.work_permits),
    'permit_digest', (select md5(coalesce(string_agg(row_to_json(w)::text, '|' order by w.id::text), '')) from public.work_permits w)
  ) as snapshot
`;

const readSecurityState = async (client) => {
  const relation = (await client.query(
    "select to_regclass('public.user_auth_security')::text as name",
  )).rows[0].name;
  if (!relation) return { present: false };
  const state = (await client.query(`
    select
      count(*)::integer as row_count,
      md5(coalesce(string_agg(row_to_json(s)::text, '|' order by s.user_id::text), '')) as row_digest
    from public.user_auth_security s
  `)).rows[0];
  return { present: true, ...state };
};

const env = parseEnv('.env.local');
const databaseUrlOverride = process.env.PIN_V2_TEST_DATABASE_URL?.trim();
if (!databaseUrlOverride && !env.SUPABASE_DB_PASSWORD) {
  throw new Error('SUPABASE_DB_PASSWORD is required when PIN_V2_TEST_DATABASE_URL is not set');
}

const poolerUrl = databaseUrlOverride
  ? new URL(databaseUrlOverride)
  : new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
if (!databaseUrlOverride) poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const isLocalDatabase = ['127.0.0.1', 'localhost'].includes(poolerUrl.hostname);
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
  application_name: 'safetypass-pin-v2-rollback-regression',
});

const migration = unwrapTransaction(readFileSync(
  'supabase/migrations/20260804120000_progressive_pin_v2.sql',
  'utf8',
));
const regression = unwrapTransaction(readFileSync(
  'supabase/tests/progressive_pin_v2_test.sql',
  'utf8',
));

try {
  await client.connect();
  const securityBefore = await readSecurityState(client);
  await client.query('begin');
  const before = (await client.query(snapshotSql)).rows[0].snapshot;
  await client.query(migration);
  const afterMigration = (await client.query(snapshotSql)).rows[0].snapshot;
  if (JSON.stringify(before) !== JSON.stringify(afterMigration)) {
    throw new Error(`Existing users or history changed during migration: ${JSON.stringify({ before, afterMigration })}`);
  }
  const securityAfterMigration = await readSecurityState(client);
  if (securityBefore.present) {
    if (JSON.stringify(securityBefore) !== JSON.stringify(securityAfterMigration)) {
      throw new Error('Existing PIN security state changed while rechecking the migration');
    }
  } else {
    const invalidBackfill = Number((await client.query(`
      select count(*)
      from public.user_auth_security
      where pin_version <> 1
    `)).rows[0].count);
    if (invalidBackfill !== 0) throw new Error('Fresh PIN v2 backfill did not preserve legacy compatibility');
  }
  await client.query(regression);
  await client.query('rollback');
  const afterRollback = (await client.query(snapshotSql)).rows[0].snapshot;
  const securityAfterRollback = await readSecurityState(client);
  if (JSON.stringify(before) !== JSON.stringify(afterRollback)
      || JSON.stringify(securityBefore) !== JSON.stringify(securityAfterRollback)) {
    throw new Error('Rollback did not restore the original schema and data snapshot');
  }
  console.log('PIN v2 migration regression passed; existing data matched and transaction rolled back.');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
