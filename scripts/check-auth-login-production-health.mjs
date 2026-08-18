import { readFile } from 'node:fs/promises';
import pg from 'pg';

const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')];
  }));

const env = parseEnv(await readFile('.env.local', 'utf8'));
const linkedRef = (await readFile('supabase/.temp/project-ref', 'utf8')).trim();
if (!env.SUPABASE_PROJECT_REF || linkedRef !== env.SUPABASE_PROJECT_REF) {
  throw new Error('Safety guard: linked project is not SUPABASE_PROJECT_REF');
}
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');

const poolerUrl = new URL((await readFile('supabase/.temp/pooler-url', 'utf8')).trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-auth-login-production-health-readonly',
});

try {
  await client.connect();
  await client.query('begin read only');
  const result = await client.query(`
    with account_health as (
      select
        u.id,
        coalesce(s.pin_version, 1) as pin_version,
        coalesce(s.pin_reset_state, 'NONE') as pin_reset_state,
        s.locked_until,
        exists (select 1 from auth.users au where au.id = u.id) as auth_by_id,
        identity_auth.id as identity_auth_id
      from public.users u
      left join public.user_auth_security s on s.user_id = u.id
      left join lateral (
        select au.id
        from auth.users au
        where lower(au.email) = lower(u.national_id || '@safetypass.com')
        order by au.created_at desc
        limit 1
      ) identity_auth on true
      where u.role = 'USER'
        and u.is_active is true
        and u.pdpa_agreed is true
    )
    select jsonb_build_object(
      'active_registered_users', count(*),
      'legacy_pin_v1', count(*) filter (where pin_version = 1),
      'legacy_pin_v1_linked', count(*) filter (where pin_version = 1 and auth_by_id),
      'legacy_pin_v1_uuid_mismatch', count(*) filter (
        where pin_version = 1 and not auth_by_id and identity_auth_id is not null and identity_auth_id <> id
      ),
      'legacy_pin_v1_missing_auth', count(*) filter (
        where pin_version = 1 and not auth_by_id and identity_auth_id is null
      ),
      'all_uuid_mismatch', count(*) filter (
        where not auth_by_id and identity_auth_id is not null and identity_auth_id <> id
      ),
      'all_missing_auth', count(*) filter (where not auth_by_id and identity_auth_id is null),
      'reset_pending', count(*) filter (where pin_reset_state = 'PENDING'),
      'reset_active', count(*) filter (where pin_reset_state = 'ACTIVE'),
      'currently_locked', count(*) filter (where locked_until > now())
    ) as health
    from account_health
  `);
  await client.query('rollback');
  console.log(JSON.stringify({
    status: 'PASS_READ_ONLY',
    projectRef: linkedRef,
    health: result.rows[0].health,
    personalDataPrinted: false,
    productionDataChanged: false,
  }, null, 2));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
