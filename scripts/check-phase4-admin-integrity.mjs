import { readFileSync } from 'node:fs';
import pg from 'pg';

const databaseUrlValue = process.env.PHASE4_TEST_DATABASE_URL?.trim();
if (!databaseUrlValue) throw new Error('PHASE4_TEST_DATABASE_URL is required');
const databaseUrl = new URL(databaseUrlValue);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
  throw new Error('Phase 4 regression is restricted to a local isolated database');
}

const unwrapTransaction = (sql) => sql
  .replace(/^\s*begin\s*;\s*/i, '')
  .replace(/\s*(?:commit|rollback)\s*;\s*$/i, '');

const snapshotSql = `select jsonb_build_object(
  'users', (select count(*) from public.users),
  'users_digest', (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id::text), '')) from public.users t),
  'vendors', (select count(*) from public.vendors),
  'vendors_digest', (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id::text), '')) from public.vendors t),
  'history', (select count(*) from public.exam_history),
  'history_digest', (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id::text), '')) from public.exam_history t),
  'permits', (select count(*) from public.work_permits),
  'permits_digest', (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id::text), '')) from public.work_permits t),
  'audit', (select count(*) from public.audit_logs),
  'audit_digest', (select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id::text), '')) from public.audit_logs t)
) as snapshot`;

const migration = unwrapTransaction(readFileSync(
  'supabase/migrations/20260804180000_phase4_admin_integrity_audit.sql', 'utf8',
));
const regression = unwrapTransaction(readFileSync(
  'supabase/tests/phase4_admin_integrity_audit_test.sql', 'utf8',
));
const client = new pg.Client({
  connectionString: databaseUrl.toString(), ssl: false,
  application_name: 'safetypass-phase4-local-regression',
});

try {
  await client.connect();
  await client.query('begin');
  const before = (await client.query(snapshotSql)).rows[0].snapshot;
  await client.query(migration);
  const after = (await client.query(snapshotSql)).rows[0].snapshot;
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Phase 4 migration changed protected data');
  }
  await client.query(regression);
  await client.query('rollback');
  console.log(JSON.stringify({
    result: 'PASS_ROLLED_BACK', localOnly: true, protectedDataUnchanged: true,
    directBrowserWritesBlocked: true, reversibleArchiveVerified: true,
    linkedHistoryPreserved: true, databaseAuditVerified: true,
  }));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
