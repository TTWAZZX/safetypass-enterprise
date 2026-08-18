import { createHmac } from 'node:crypto';
import pg from 'pg';
import { createSecurePinPassword } from '../api/_pin.js';

const AUTH_URL = 'http://127.0.0.1:9999';
const REST_URL = 'http://127.0.0.1:9998';
const ROUTER_URL = 'http://127.0.0.1:9997';
const JWT_SECRET = 'local-user360-uat-jwt-secret-at-least-32-characters';
const PIN_PEPPER = 'local-user360-uat-pin-pepper-at-least-32-characters';
const ADMIN_PIN = '739251';
const nativeFetch = globalThis.fetch;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (role, subject = undefined) => {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ aud: 'authenticated', exp: now + 3600, iat: now, iss: 'supabase', role, ...(subject ? { sub: subject } : {}) });
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};

const serviceKey = jwt('service_role');
const anonKey = jwt('anon');
process.env.SUPABASE_URL = ROUTER_URL;
process.env.SUPABASE_PUBLISHABLE_KEY = anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
process.env.AUTH_PIN_PEPPER = PIN_PEPPER;

const db = new pg.Client({
  host: '127.0.0.1', port: 55436, database: 'postgres', user: 'supabase_admin', password: 'postgres',
  application_name: 'safetypass-user360-local-auth-uat',
});

let failureMode = 'NONE';
let finalizeFailureUsed = false;
let recoveryOldEmail = '';
globalThis.fetch = async (input, init = {}) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith(`${ROUTER_URL}/auth/v1`)) url = `${AUTH_URL}${url.slice(`${ROUTER_URL}/auth/v1`.length)}`;
  if (url.startsWith(`${ROUTER_URL}/rest/v1`)) url = `${REST_URL}${url.slice(`${ROUTER_URL}/rest/v1`.length)}`;

  if (failureMode !== 'NONE' && !finalizeFailureUsed && url.includes('/rpc/service_finalize_national_id_correction')) {
    finalizeFailureUsed = true;
    return new Response(JSON.stringify({ message: 'Injected local UAT finalize failure' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  if (failureMode === 'RECOVERY_REQUIRED' && url.includes('/admin/users/') && init?.method === 'PUT') {
    const body = JSON.parse(String(init.body || '{}'));
    if (body.email === recoveryOldEmail) {
      return new Response(JSON.stringify({ message: 'Injected local UAT compensation failure' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
  return nativeFetch(url, init);
};

const { default: handler } = await import('../api/set-auth-pin.js');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const apiJson = async (url, init = {}) => {
  const response = await nativeFetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${body?.msg || body?.message || 'request failed'}`);
  return body;
};
const adminHeaders = { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
const createAuthUser = (nationalId, name, pin) => apiJson(`${AUTH_URL}/admin/users`, {
  method: 'POST', headers: adminHeaders,
  body: JSON.stringify({
    email: `${nationalId}@safetypass.com`, password: createSecurePinPassword(nationalId, pin, PIN_PEPPER),
    email_confirm: true, app_metadata: { role: 'authenticated' },
    user_metadata: { name, national_id: nationalId, role: 'USER', password_scheme: 'pin-v2' },
  }),
});
const getAuthUser = (id) => apiJson(`${AUTH_URL}/admin/users/${id}`, { headers: adminHeaders });
const deleteAuthUser = async (id) => {
  const response = await nativeFetch(`${AUTH_URL}/admin/users/${id}`, { method: 'DELETE', headers: adminHeaders });
  if (!response.ok && response.status !== 404) throw new Error(`Unable to remove Auth fixture ${id}`);
};
const signIn = (nationalId, pin) => apiJson(`${AUTH_URL}/token?grant_type=password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey },
  body: JSON.stringify({ email: `${nationalId}@safetypass.com`, password: createSecurePinPassword(nationalId, pin, PIN_PEPPER) }),
});
const invoke = async (accessToken, body, ip) => {
  let status = 0;
  let responseBody;
  const headers = new Map();
  const response = {
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    status(value) { status = value; return this; },
    json(value) { responseBody = value; return this; },
    send(value) { responseBody = value; return this; },
  };
  await handler({ method: 'POST', body, headers: { authorization: `Bearer ${accessToken}`, 'x-forwarded-for': ip } }, response);
  return { status, body: responseBody, headers };
};

const suffix = String(Date.now()).slice(-8);
const ids = {
  admin: `17${suffix}001`, successOld: `17${suffix}002`, successNew: `18${suffix}002`,
  rollbackOld: `17${suffix}003`, rollbackNew: `18${suffix}003`,
  recoveryOld: `17${suffix}004`, recoveryNew: `18${suffix}004`,
};
const createdAuthIds = [];
const createdPublicIds = [];

const upsertProfile = async (id, nationalId, name, role) => {
  await db.query("update auth.users set aud = 'authenticated', role = 'authenticated' where id = $1", [id]);
  await db.query(`
    insert into public.users(id, national_id, name, role, is_active, pdpa_agreed,
      national_id_hash, national_id_fingerprint, nationality, age)
    values ($1, $2, $3, $4, false, true,
      encode(extensions.digest($2, 'sha256'), 'hex'), encode(extensions.digest($2, 'sha256'), 'hex'), 'ไทย (Thai)', 35)
    on conflict (id) do update set national_id = excluded.national_id, name = excluded.name,
      role = excluded.role, is_active = false, national_id_hash = excluded.national_id_hash,
      national_id_fingerprint = excluded.national_id_fingerprint
  `, [id, nationalId, name, role]);
  await db.query(`insert into public.user_training_access(user_id, program_code)
    values ($1, 'CONTRACTOR') on conflict (user_id, program_code) do nothing`, [id]);
  await db.query('update public.users set is_active = true where id = $1', [id]);
  createdPublicIds.push(id);
};

const cleanup = async () => {
  if (createdPublicIds.length > 0) {
    await db.query('delete from public.audit_logs where actor_user_id = any($1::uuid[]) or target = any($2::text[])', [createdPublicIds, createdPublicIds.map((id) => `users:${id}`)]).catch(() => undefined);
    await db.query('delete from public.admin_identity_access_attempts where actor_user_id = any($1::uuid[]) or target_user_id = any($1::uuid[])', [createdPublicIds]).catch(() => undefined);
    await db.query('delete from public.admin_identity_operations where actor_user_id = any($1::uuid[]) or target_user_id = any($1::uuid[])', [createdPublicIds]).catch(() => undefined);
    await db.query('delete from public.work_permits where user_id = any($1::uuid[])', [createdPublicIds]).catch(() => undefined);
    await db.query('delete from public.exam_history where user_id = any($1::uuid[])', [createdPublicIds]).catch(() => undefined);
    await db.query('delete from public.supplier_outsource_passes where user_id = any($1::uuid[])', [createdPublicIds]).catch(() => undefined);
    await db.query('delete from public.user_auth_security where user_id = any($1::uuid[])', [createdPublicIds]).catch(() => undefined);
    await db.query('delete from public.user_training_access where user_id = any($1::uuid[])', [createdPublicIds]).catch(() => undefined);
    await db.query('delete from public.users where id = any($1::uuid[])', [createdPublicIds]).catch(() => undefined);
  }
  for (const id of createdAuthIds.reverse()) await deleteAuthUser(id).catch(() => undefined);
};

try {
  await db.connect();
  const adminAuth = await createAuthUser(ids.admin, 'Local Auth UAT Admin', ADMIN_PIN);
  const successAuth = await createAuthUser(ids.successOld, 'Local Auth UAT Success', '421395');
  const rollbackAuth = await createAuthUser(ids.rollbackOld, 'Local Auth UAT Rollback', '421396');
  const recoveryAuth = await createAuthUser(ids.recoveryOld, 'Local Auth UAT Recovery', '421397');
  createdAuthIds.push(adminAuth.id, successAuth.id, rollbackAuth.id, recoveryAuth.id);
  await upsertProfile(adminAuth.id, ids.admin, 'Local Auth UAT Admin', 'ADMIN');
  await upsertProfile(successAuth.id, ids.successOld, 'Local Auth UAT Success', 'USER');
  await upsertProfile(rollbackAuth.id, ids.rollbackOld, 'Local Auth UAT Rollback', 'USER');
  await upsertProfile(recoveryAuth.id, ids.recoveryOld, 'Local Auth UAT Recovery', 'USER');
  await db.query(`insert into public.exam_history(user_id, exam_type, score, total_questions, status, created_at)
    values ($1, 'INDUCTION', 10, 10, 'PASSED', now())`, [successAuth.id]);
  await db.query(`insert into public.work_permits(user_id, permit_no, expire_date, status)
    values ($1, 'LOCAL-AUTH-UAT', now() + interval '1 day', 'ACTIVE')`, [successAuth.id]);

  const session = await signIn(ids.admin, ADMIN_PIN);
  assert(typeof session.access_token === 'string', 'Admin could not sign in through real GoTrue');
  const tokenClaims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'));
  assert(tokenClaims.sub === adminAuth.id, 'Real GoTrue access token subject is inconsistent');
  const adminProbeResponse = await nativeFetch(`${REST_URL}/rpc/get_my_admin_status`, {
    method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, apikey: anonKey, 'Content-Type': 'application/json' }, body: '{}',
  });
  const adminProbeBody = await adminProbeResponse.text();
  assert(adminProbeResponse.ok && adminProbeBody === 'true', `PostgREST admin probe failed (${adminProbeResponse.status}: ${adminProbeBody.slice(0, 160)})`);
  const stepUp = await invoke(session.access_token, { action: 'admin-identity-step-up', pin: ADMIN_PIN }, '198.51.100.40');
  assert(stepUp.status === 200 && stepUp.body?.stepUpToken, `Real GoTrue step-up failed (${stepUp.status}: ${stepUp.body?.message || 'unknown'})`);
  const stepUpToken = stepUp.body.stepUpToken;

  const success = await invoke(session.access_token, {
    action: 'admin-correct-national-id', userId: successAuth.id, newNationalId: ids.successNew,
    reason: 'Local GoTrue success validation', stepUpToken,
  }, '198.51.100.41');
  assert(success.status === 200 && success.body?.status === 'COMPLETED', 'Real Auth correction did not complete');
  assert(!JSON.stringify(success.body).includes(ids.successNew), 'Correction response exposed the full ID');
  const successPublic = await db.query('select national_id from public.users where id = $1', [successAuth.id]);
  const successAuthAfter = await getAuthUser(successAuth.id);
  assert(successPublic.rows[0]?.national_id === ids.successNew, 'Public identity was not finalized');
  assert(successAuthAfter.email === `${ids.successNew}@safetypass.com`, 'Auth identity was not finalized');
  assert((await signIn(ids.successNew, ids.successNew.slice(-6))).access_token, 'Temporary PIN did not work in real GoTrue');
  const linked = await db.query(`select
    (select count(*) from public.exam_history where user_id = $1)::integer as exams,
    (select count(*) from public.work_permits where user_id = $1)::integer as permits`, [successAuth.id]);
  assert(linked.rows[0].exams === 1 && linked.rows[0].permits === 1, 'Linked history was not preserved');

  failureMode = 'ROLLBACK';
  finalizeFailureUsed = false;
  const rolledBack = await invoke(session.access_token, {
    action: 'admin-correct-national-id', userId: rollbackAuth.id, newNationalId: ids.rollbackNew,
    reason: 'Local GoTrue compensation validation', stepUpToken,
  }, '198.51.100.42');
  assert(rolledBack.status === 409 && rolledBack.body?.status === 'ROLLED_BACK', 'Auth compensation did not roll back');
  assert((await getAuthUser(rollbackAuth.id)).email === `${ids.rollbackOld}@safetypass.com`, 'Compensation did not restore the Auth email');
  assert((await db.query('select national_id from public.users where id = $1', [rollbackAuth.id])).rows[0]?.national_id === ids.rollbackOld, 'Rollback changed public identity');

  failureMode = 'RECOVERY_REQUIRED';
  finalizeFailureUsed = false;
  recoveryOldEmail = `${ids.recoveryOld}@safetypass.com`;
  const needsRecovery = await invoke(session.access_token, {
    action: 'admin-correct-national-id', userId: recoveryAuth.id, newNationalId: ids.recoveryNew,
    reason: 'Local GoTrue recovery validation', stepUpToken,
  }, '198.51.100.43');
  assert(needsRecovery.status === 503 && needsRecovery.body?.status === 'RECOVERY_REQUIRED', 'Recovery-required state was not created');
  failureMode = 'NONE';
  const recovered = await invoke(session.access_token, {
    action: 'admin-recover-national-id-correction', operationId: needsRecovery.body.operationId,
    reason: 'Resolve local GoTrue recovery operation', stepUpToken,
  }, '198.51.100.44');
  assert(recovered.status === 200 && recovered.body?.status === 'COMPLETED', 'Recovery operation did not complete');
  assert((await getAuthUser(recoveryAuth.id)).email === `${ids.recoveryNew}@safetypass.com`, 'Recovery Auth identity is inconsistent');
  assert((await db.query('select national_id from public.users where id = $1', [recoveryAuth.id])).rows[0]?.national_id === ids.recoveryNew, 'Recovery public identity is inconsistent');

  const piiAudit = await db.query(`select count(*)::integer as count from public.audit_logs
    where actor_user_id = $1 and (details ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)' or admin_email ~ '^[0-9]{13}@')`, [adminAuth.id]);
  assert(piiAudit.rows[0].count === 0, 'Full national ID leaked into audit logs');

  console.log(JSON.stringify({
    status: 'PASS_LOCAL_REAL_GOTRUE_AND_POSTGREST', productionChanged: false, remoteStagingChanged: false,
    scenarios: { stepUp: 'PASS', correction: 'PASS', compensationRollback: 'PASS', recovery: 'PASS', linkedHistory: 'PASS', auditRedaction: 'PASS' },
  }, null, 2));
} finally {
  failureMode = 'NONE';
  await cleanup().catch((error) => console.error(`Cleanup warning: ${error.message}`));
  await db.end().catch(() => undefined);
  globalThis.fetch = nativeFetch;
}
