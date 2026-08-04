import { readFileSync } from 'node:fs';
import pg from 'pg';

const expectedState = process.argv[2];
if (!['before', 'after'].includes(expectedState)) {
  throw new Error('Usage: node scripts/check-phase4-production-readonly.mjs <before|after>');
}

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
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: `safetypass-phase4-${expectedState}-readonly`,
});

const snapshotSql = `
  select 'users' as name, count(*)::integer as row_count,
    md5(coalesce(string_agg(id::text, '|' order by id::text), '')) as stable_digest
  from public.users
  union all
  select 'vendors', count(*)::integer,
    md5(coalesce(string_agg(id::text, '|' order by id::text), ''))
  from public.vendors
  union all
  select 'exam_history', count(*)::integer,
    md5(coalesce(string_agg(id::text || ':' || coalesce(user_id::text, ''), '|' order by id::text), ''))
  from public.exam_history
  union all
  select 'work_permits', count(*)::integer,
    md5(coalesce(string_agg(id::text || ':' || user_id::text, '|' order by id::text), ''))
  from public.work_permits
  union all
  select 'user_training_access', count(*)::integer,
    md5(coalesce(string_agg(user_id::text || ':' || program_code, '|' order by user_id::text, program_code), ''))
  from public.user_training_access
  union all
  select 'audit_logs', count(*)::integer,
    md5(coalesce(string_agg(id::text, '|' order by id::text), ''))
  from public.audit_logs
  order by name
`;

try {
  await client.connect();
  await client.query('begin read only');
  const snapshot = (await client.query(snapshotSql)).rows;
  const migrationApplied = (await client.query(`
    select exists (
      select 1 from supabase_migrations.schema_migrations
      where version = '20260804180000'
    ) as applied
  `)).rows[0].applied;
  const blockedLocks = Number((await client.query(`
    select count(*)::integer as count
    from pg_locks
    where granted = false
  `)).rows[0].count);

  let controls = null;
  if (migrationApplied) {
    controls = (await client.query(`
      select
        not has_table_privilege('anon', 'public.audit_logs', 'INSERT') as anon_cannot_forge_audit,
        not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT') as authenticated_cannot_forge_audit,
        not has_table_privilege('authenticated', 'public.vendors', 'UPDATE') as authenticated_cannot_update_vendor_directly,
        not has_table_privilege('authenticated', 'public.users', 'DELETE') as authenticated_cannot_delete_user_directly,
        has_function_privilege('authenticated', 'public.admin_archive_user(uuid)', 'EXECUTE') as admin_archive_user_rpc_available,
        has_function_privilege('authenticated', 'public.admin_archive_vendor(uuid)', 'EXECUTE') as admin_archive_vendor_rpc_available,
        not has_function_privilege('anon', 'public.admin_archive_user(uuid)', 'EXECUTE') as anonymous_archive_user_blocked,
        not has_function_privilege('anon', 'public.admin_archive_vendor(uuid)', 'EXECUTE') as anonymous_archive_vendor_blocked,
        exists (
          select 1 from pg_trigger
          where tgname = 'audit_admin_user_mutation' and tgenabled <> 'D'
        ) as user_audit_trigger_enabled,
        exists (
          select 1 from pg_trigger
          where tgname = 'audit_admin_vendor_mutation' and tgenabled <> 'D'
        ) as vendor_audit_trigger_enabled
    `)).rows[0];
  }

  await client.query('rollback');
  const stateMatches = expectedState === 'before' ? !migrationApplied : migrationApplied;
  const controlsPass = controls === null || Object.values(controls).every(Boolean);
  const result = {
    result: stateMatches && blockedLocks === 0 && controlsPass ? 'PASS_READ_ONLY' : 'FAIL',
    expectedState,
    migrationApplied,
    blockedLocks,
    snapshot,
    controls,
    personalValuesCaptured: false,
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.result !== 'PASS_READ_ONLY') process.exitCode = 1;
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
