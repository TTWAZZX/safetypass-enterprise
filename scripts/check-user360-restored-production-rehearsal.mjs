import { readFile } from 'node:fs/promises';
import pg from 'pg';

const databaseUrl = new URL(process.env.USER360_RESTORE_DATABASE_URL || 'postgresql://supabase_admin:postgres@127.0.0.1:55437/safetypass_restore_verify');
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(databaseUrl.hostname)) {
  throw new Error('Safety guard: User 360 restored-production rehearsal accepts only a local database');
}
if (databaseUrl.pathname !== '/safetypass_restore_verify') {
  throw new Error('Safety guard: rehearsal must target the dedicated safetypass_restore_verify database');
}

const migrations = [
  'supabase/migrations/20260818103000_admin_training_access_guards.sql',
  'supabase/migrations/20260818120000_admin_user360_foundation.sql',
  'supabase/migrations/20260818143000_admin_identity_privileged_workflow.sql',
];
const tests = [
  'supabase/tests/admin_training_access_guards_test.sql',
  'supabase/tests/admin_user360_foundation_test.sql',
  'supabase/tests/admin_identity_privileged_workflow_test.sql',
];
const protectedTables = [
  'users', 'exam_history', 'exam_logs', 'work_permits',
  'supplier_outsource_passes', 'user_training_access', 'vendors', 'questions',
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

const client = new pg.Client({
  connectionString: databaseUrl.toString(),
  application_name: 'safetypass-user360-restored-production-rehearsal',
});

const inventory = async () => {
  const result = {};
  for (const table of protectedTables) {
    const relation = `public.${quoteIdentifier(table)}`;
    result[table] = (await client.query(`select
      count(*)::integer as row_count,
      md5(coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '')) as row_digest
      from ${relation} t`)).rows[0];
  }
  return result;
};

await client.connect();
try {
  const before = await inventory();
  const invariantBefore = (await client.query(`select count(*)::integer as count
    from public.users u
    where u.is_active is true
      and not exists (select 1 from public.user_training_access a where a.user_id = u.id)`)).rows[0].count;
  assert(invariantBefore === 0, `Production-shaped restore has ${invariantBefore} active users without a Training Program`);

  const legacyAuditBefore = (await client.query(`select count(*)::integer as count
    from public.audit_logs where admin_email ~ '^[0-9]{13}@'`)).rows[0].count;

  for (const path of migrations) await client.query(await readFile(path, 'utf8'));

  const after = await inventory();
  for (const table of protectedTables) {
    assert(JSON.stringify(before[table]) === JSON.stringify(after[table]), `${table} changed during User 360 migration rehearsal`);
  }
  const featureFlag = (await client.query("select value from public.system_config where key = 'ADMIN_USER360_ENABLED'")).rows[0]?.value;
  assert(featureFlag === 'false', 'ADMIN_USER360_ENABLED was not false after migration rehearsal');
  const fullIdAuditAfter = (await client.query(`select count(*)::integer as count
    from public.audit_logs
    where admin_email ~ '^[0-9]{13}@'
       or details ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)'`)).rows[0].count;
  assert(fullIdAuditAfter === 0, 'Full national ID remained in audit logs after migration rehearsal');

  for (const path of tests) await client.query(await readFile(path, 'utf8'));

  const postTest = await inventory();
  for (const table of protectedTables) {
    assert(JSON.stringify(after[table]) === JSON.stringify(postTest[table]), `${table} changed after rollback-based SQL regression`);
  }

  console.log(JSON.stringify({
    status: 'PASS_PRODUCTION_SHAPED_RESTORE_REHEARSAL',
    productionChanged: false,
    target: 'isolated-local-restore',
    protectedTables: Object.fromEntries(protectedTables.map((table) => [table, before[table].row_count])),
    activeUsersWithoutProgram: invariantBefore,
    legacyAuditEmailsRedacted: legacyAuditBefore,
    auditFullNationalIdsAfter: fullIdAuditAfter,
    featureFlag,
    migrations,
    regressionTests: tests,
  }, null, 2));
} finally {
  await client.end();
}
