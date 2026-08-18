import { readFile } from 'node:fs/promises';
import pg from 'pg';

const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const env = parseEnv(await readFile('.env.local', 'utf8'));
const linkedRef = (await readFile('supabase/.temp/project-ref', 'utf8')).trim();
if (!env.SUPABASE_PROJECT_REF || linkedRef !== env.SUPABASE_PROJECT_REF) throw new Error('Safety guard: linked project is not SUPABASE_PROJECT_REF');
if (linkedRef === env.SUPABASE_STAGING_PROJECT_REF) throw new Error('Safety guard: linked project unexpectedly matches the unrelated staging ref');
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');

const poolerUrl = new URL((await readFile('supabase/.temp/pooler-url', 'utf8')).trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({ connectionString: poolerUrl.toString(), ssl: { rejectUnauthorized: false }, application_name: 'safetypass-user360-production-postmigration-readonly' });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expectedMigrations = ['20260818103000', '20260818120000', '20260818143000'];
const expectedFeatureFlag = process.env.EXPECTED_USER360_FLAG || 'false';
if (!['true', 'false'].includes(expectedFeatureFlag)) throw new Error('EXPECTED_USER360_FLAG must be true or false');
const backupMinimums = { users: 452, exam_history: 1087, exam_logs: 1087, work_permits: 386, supplier_outsource_passes: 1, user_training_access: 455 };

try {
  await client.connect();
  await client.query('begin read only');
  const migrations = (await client.query('select version from supabase_migrations.schema_migrations where version = any($1::text[]) order by version', [expectedMigrations])).rows.map((row) => row.version);
  assert(JSON.stringify(migrations) === JSON.stringify(expectedMigrations), 'Production migration ledger is incomplete');
  const state = (await client.query(`select jsonb_build_object(
    'users', (select count(*) from public.users),
    'exam_history', (select count(*) from public.exam_history),
    'exam_logs', (select count(*) from public.exam_logs),
    'work_permits', (select count(*) from public.work_permits),
    'supplier_outsource_passes', (select count(*) from public.supplier_outsource_passes),
    'user_training_access', (select count(*) from public.user_training_access),
    'active_without_program', (select count(*) from public.users u where u.is_active and not exists (select 1 from public.user_training_access a where a.user_id=u.id)),
    'orphan_exam_history', (select count(*) from public.exam_history h left join public.users u on u.id=h.user_id where u.id is null),
    'orphan_work_permits', (select count(*) from public.work_permits p left join public.users u on u.id=p.user_id where u.id is null),
    'orphan_digital_passes', (select count(*) from public.supplier_outsource_passes p left join public.users u on u.id=p.user_id where u.id is null),
    'full_id_audit', (select count(*) from public.audit_logs where admin_email ~ '^[0-9]{13}@' or details ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)'),
    'feature_flag', (select value from public.system_config where key='ADMIN_USER360_ENABLED'),
    'identity_operations', (select count(*) from public.admin_identity_operations),
    'identity_attempts', (select count(*) from public.admin_identity_access_attempts)
  ) as value`)).rows[0].value;
  for (const [name, minimum] of Object.entries(backupMinimums)) assert(Number(state[name]) >= minimum, `${name} fell below the verified backup baseline`);
  assert(Number(state.active_without_program) === 0, 'Active user without Training Program found');
  assert(Number(state.orphan_exam_history) === 0 && Number(state.orphan_work_permits) === 0 && Number(state.orphan_digital_passes) === 0, 'Linked history orphan found');
  assert(Number(state.full_id_audit) === 0, 'Full national ID found in audit logs');
  assert(state.feature_flag === expectedFeatureFlag, `User 360 feature flag must be ${expectedFeatureFlag}`);
  assert(Number(state.identity_operations) === 0 && Number(state.identity_attempts) === 0, 'Unexpected privileged identity runtime rows exist before rollout');
  const actors = (await client.query(`select
    (select u.id from public.users u join auth.users au on au.id=u.id where u.role='ADMIN' and u.is_active order by u.created_at nulls last limit 1) as admin_id,
    (select u.id from public.users u where u.role='USER' and u.is_active order by u.created_at nulls last limit 1) as target_id`)).rows[0];
  assert(actors.admin_id && actors.target_id, 'Production RPC smoke requires an active Auth-linked admin and active user');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actors.admin_id]);
  await client.query("select set_config('request.jwt.claims', jsonb_build_object('sub',$1::text,'role','authenticated')::text, true)", [actors.admin_id]);
  const rpcFlag = (await client.query('select public.admin_get_user360_feature_flag() as enabled')).rows[0].enabled;
  const detail = (await client.query('select public.admin_get_user360($1) as value', [actors.target_id])).rows[0].value;
  assert(String(rpcFlag) === expectedFeatureFlag, 'Authenticated feature flag RPC returned an unexpected value');
  assert(detail?.profile?.id && detail.profile.id === actors.target_id, 'Admin User 360 RPC did not return the selected profile');
  assert(!/[0-9]{13}/.test(detail.profile.masked_national_id || ''), 'Admin User 360 RPC exposed a full national ID');
  assert(Array.isArray(detail.programs) && detail.programs.length > 0, 'Active User 360 profile has no Training Program');
  await client.query('rollback');
  console.log(JSON.stringify({ status: 'PASS_PRODUCTION_POSTMIGRATION_READ_ONLY', projectRef: linkedRef, migrations, state, rpcSmoke: { authenticatedAdminRead: true, maskedIdentityOnly: true, activeUserProgramsPresent: true }, productionDataChangedByCheck: false }, null, 2));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
