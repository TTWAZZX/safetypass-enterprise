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
const requested = process.env.USER360_PRODUCTION_FLAG;
if (!['true', 'false'].includes(requested)) throw new Error('USER360_PRODUCTION_FLAG must be true or false');
if (process.env.CONFIRM_PRODUCTION_PROJECT_REF !== linkedRef) throw new Error('CONFIRM_PRODUCTION_PROJECT_REF must match the linked project');
if (linkedRef !== env.SUPABASE_PROJECT_REF || linkedRef === env.SUPABASE_STAGING_PROJECT_REF) throw new Error('Safety guard: linked project identity mismatch');
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');

const poolerUrl = new URL((await readFile('supabase/.temp/pooler-url', 'utf8')).trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({ connectionString: poolerUrl.toString(), ssl: { rejectUnauthorized: false }, application_name: 'safetypass-user360-production-flag-change' });

try {
  await client.connect();
  await client.query('begin');
  const admin = (await client.query(`select u.id
    from public.users u join auth.users au on au.id=u.id
    where u.role='ADMIN' and u.is_active is true
    order by u.created_at nulls last, u.id limit 1 for update of u`)).rows[0];
  if (!admin) throw new Error('No active Auth-linked admin is available for an audited flag change');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [admin.id]);
  await client.query("select set_config('request.jwt.claims', jsonb_build_object('sub',$1::text,'role','authenticated')::text, true)", [admin.id]);
  const result = (await client.query('select public.admin_set_user360_feature_flag($1) as enabled', [requested === 'true'])).rows[0].enabled;
  const flag = (await client.query("select value from public.system_config where key='ADMIN_USER360_ENABLED'")).rows[0]?.value;
  const audit = (await client.query(`select count(*)::integer as count from public.audit_logs
    where actor_user_id=$1 and action='ADMIN_USER360_FEATURE_TOGGLED'
      and target='system_config:ADMIN_USER360_ENABLED'
      and created_at > now() - interval '2 minutes'
      and details !~ '(^|[^0-9])[0-9]{13}([^0-9]|$)'`, [admin.id])).rows[0].count;
  if (String(result) !== requested || flag !== requested || audit < 1) throw new Error('Audited User 360 feature flag change did not verify');
  await client.query('commit');
  console.log(JSON.stringify({ status: 'PASS_AUDITED_PRODUCTION_FLAG_CHANGE', projectRef: linkedRef, enabled: requested === 'true', auditRecorded: true }, null, 2));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
