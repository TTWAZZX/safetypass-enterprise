import { readFileSync } from 'node:fs';
import pg from 'pg';

const databaseUrlValue = process.env.PHASE3_TEST_DATABASE_URL?.trim();
if (!databaseUrlValue) throw new Error('PHASE3_TEST_DATABASE_URL is required');

const databaseUrl = new URL(databaseUrlValue);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
  throw new Error('Phase 3 regression is restricted to a local isolated database');
}

const unwrapTransaction = (sql) => sql
  .replace(/^\s*begin\s*;\s*/i, '')
  .replace(/\s*(?:commit|rollback)\s*;\s*$/i, '');

const snapshotSql = `
  select jsonb_build_object(
    'users_count', (select count(*) from public.users),
    'users_digest', (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id::text), '')) from public.users t),
    'exam_count', (select count(*) from public.exam_history),
    'exam_digest', (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id::text), '')) from public.exam_history t),
    'permit_count', (select count(*) from public.work_permits),
    'permit_digest', (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id::text), '')) from public.work_permits t),
    'access_count', (select count(*) from public.user_training_access),
    'access_digest', (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.user_id::text, t.program_code), '')) from public.user_training_access t)
  ) as snapshot
`;

const migration = unwrapTransaction(readFileSync(
  'supabase/migrations/20260804170000_phase3_identity_lookup_boundary.sql',
  'utf8',
));
const regression = unwrapTransaction(readFileSync(
  'supabase/tests/phase3_identity_lookup_boundary_test.sql',
  'utf8',
));

const client = new pg.Client({
  connectionString: databaseUrl.toString(),
  ssl: false,
  application_name: 'safetypass-phase3-local-regression',
});

try {
  await client.connect();
  await client.query('begin');
  const before = (await client.query(snapshotSql)).rows[0].snapshot;
  await client.query(migration);
  const after = (await client.query(snapshotSql)).rows[0].snapshot;
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Phase 3 migration changed protected data');
  }
  await client.query(regression);
  await client.query('rollback');
  console.log(JSON.stringify({
    result: 'PASS_ROLLED_BACK',
    localOnly: true,
    protectedDataUnchanged: true,
    browserIdentityLookupBlocked: true,
    serverIdentityLookupPreserved: true,
    transactionalRegistrationPreserved: true,
    protectedUserFieldsPreserved: true,
  }));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
