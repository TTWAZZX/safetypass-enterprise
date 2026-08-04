import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
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
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
if (['127.0.0.1', 'localhost'].includes(poolerUrl.hostname)) {
  throw new Error('This smoke test requires the linked remote Production database');
}

const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-phase4-production-smoke-rollback',
});
const countSql = `
  select
    (select count(*)::integer from public.users) as users,
    (select count(*)::integer from public.vendors) as vendors,
    (select count(*)::integer from public.exam_history) as exam_history,
    (select count(*)::integer from public.work_permits) as work_permits,
    (select count(*)::integer from public.user_training_access) as training_access,
    (select count(*)::integer from public.audit_logs) as audit_logs
`;

try {
  await client.connect();
  const before = (await client.query(countSql)).rows[0];
  await client.query('begin');
  await client.query("set local statement_timeout = '30s'");
  await client.query(readFileSync('supabase/tests/phase4_admin_integrity_audit_test.sql', 'utf8'));
  await client.query('rollback');
  const after = (await client.query(countSql)).rows[0];
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  console.log(JSON.stringify({
    result: unchanged ? 'PASS_ROLLED_BACK' : 'FAIL_COUNTS_CHANGED',
    reversibleArchiveVerified: true,
    linkedHistoryPreserved: true,
    databaseAuditVerified: true,
    productionCountsUnchanged: unchanged,
    before,
    after,
    personalValuesCaptured: false,
  }, null, 2));
  if (!unchanged) process.exitCode = 1;
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
