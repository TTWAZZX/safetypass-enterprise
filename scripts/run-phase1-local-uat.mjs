import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';

import authLogin from '../api/auth-login.js';
import authSessionStatus from '../api/auth-session-status.js';
import setAuthPin from '../api/set-auth-pin.js';

const { Client } = pg;

const requiredEnv = [
  'LOCAL_UAT_SUPABASE_URL',
  'LOCAL_UAT_ANON_KEY',
  'LOCAL_UAT_SERVICE_ROLE_KEY',
  'LOCAL_UAT_DB_URL',
];

for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`Missing required local UAT variable: ${name}`);
}

const url = process.env.LOCAL_UAT_SUPABASE_URL.replace(/\/$/, '');
const anonKey = process.env.LOCAL_UAT_ANON_KEY;
const serviceKey = process.env.LOCAL_UAT_SERVICE_ROLE_KEY;
const dbUrl = process.env.LOCAL_UAT_DB_URL;
const pepper = 'local-uat-only-pepper-2026-08-04-not-for-production';

Object.assign(process.env, {
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  AUTH_PIN_PEPPER: pepper,
  AUTH_PIN_V2_ENFORCEMENT: 'false',
});

const fixtures = {
  active: { nationalId: '1111111111119', name: 'Local UAT Legacy User', role: 'USER', active: true },
  admin: { nationalId: '2222222222228', name: 'Local UAT Legacy Admin', role: 'ADMIN', active: true },
  suspended: { nationalId: '3333333333337', name: 'Local UAT Suspended User', role: 'USER', active: false },
  lockout: { nationalId: '4444444444446', name: 'Local UAT Lockout User', role: 'USER', active: true },
};

const legacyPin = (nationalId) => nationalId.slice(-4);
const legacyPassword = (nationalId) => `SafetyPass-${nationalId}-${legacyPin(nationalId)}`;
const fingerprint = (nationalId) => createHash('sha256').update(nationalId).digest('hex');

const authHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function createAuthUser(fixture) {
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      email: `${fixture.nationalId}@safetypass.com`,
      password: legacyPassword(fixture.nationalId),
      email_confirm: true,
      user_metadata: {
        password_scheme: 'pin-v1',
        must_change_pin: true,
      },
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Unable to create local Auth fixture (${response.status})`);
  const user = body?.user || body;
  if (!user?.id) throw new Error('Local Auth fixture did not return a user id');
  return user;
}

function makeRequest({ method, body, token, ip }) {
  const headers = { 'x-forwarded-for': ip || '127.0.0.1' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method, body, headers };
}

async function invoke(handler, request) {
  const response = {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(request, response);
  return response;
}

async function login(nationalId, pin, ip) {
  return invoke(authLogin, makeRequest({
    method: 'POST',
    body: { nationalId, pin },
    ip,
  }));
}

const client = new Client({ connectionString: dbUrl });
const scenarios = [];
const pass = (name) => scenarios.push({ name, status: 'PASS' });

try {
  await client.connect();

  for (const fixture of Object.values(fixtures)) {
    const authUser = await createAuthUser(fixture);
    fixture.userId = authUser.id;
    await client.query(
      `insert into public.users
        (id, national_id, name, role, pdpa_agreed, pdpa_agreed_at, is_active,
         national_id_hash, national_id_fingerprint)
       values ($1, $2, $3, $4, true, now(), $5, $6, $6)`,
      [authUser.id, fixture.nationalId, fixture.name, fixture.role, fixture.active, fingerprint(fixture.nationalId)],
    );
  }

  const baseline = await client.query(
    `select u.id, u.name, u.role, u.is_active, u.pdpa_agreed, s.pin_version
       from public.users u
       join public.user_auth_security s on s.user_id = u.id
      where u.id = any($1::uuid[])
      order by u.id`,
    [Object.values(fixtures).map((fixture) => fixture.userId)],
  );
  assert.equal(baseline.rowCount, 4);
  assert.ok(baseline.rows.every((row) => row.pin_version === 1));
  pass('Synthetic legacy profiles are preserved and initialized as PIN v1');

  let response = await login(fixtures.active.nationalId, legacyPin(fixtures.active.nationalId), '10.0.0.1');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requiresPinUpgrade, false);
  assert.ok(response.body.accessToken && response.body.refreshToken);
  pass('Legacy 4-digit PIN login remains available while enforcement is off');

  response = await login(fixtures.admin.nationalId, legacyPin(fixtures.admin.nationalId), '10.0.0.2');
  assert.equal(response.statusCode, 200);
  const adminRole = await client.query('select role from public.users where id = $1', [fixtures.admin.userId]);
  assert.equal(adminRole.rows[0].role, 'ADMIN');
  pass('Legacy admin login succeeds without changing the ADMIN role');

  process.env.AUTH_PIN_V2_ENFORCEMENT = 'true';
  response = await login(fixtures.active.nationalId, legacyPin(fixtures.active.nationalId), '10.0.0.3');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requiresPinUpgrade, true);
  const legacyAccessToken = response.body.accessToken;
  pass('Enforcement requests PIN upgrade without blocking the legacy login');

  response = await invoke(authSessionStatus, makeRequest({
    method: 'GET', token: legacyAccessToken, ip: '10.0.0.4',
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requiresPinUpgrade, true);
  pass('Existing legacy session is identified as requiring a PIN upgrade');

  response = await invoke(setAuthPin, makeRequest({
    method: 'POST',
    body: { nationalId: fixtures.active.nationalId, pin: '123456' },
    token: legacyAccessToken,
    ip: '10.0.0.5',
  }));
  assert.equal(response.statusCode, 400);
  pass('Weak 6-digit PIN is rejected');

  const upgradedPin = '246801';
  response = await invoke(setAuthPin, makeRequest({
    method: 'POST',
    body: { nationalId: fixtures.active.nationalId, pin: upgradedPin },
    token: legacyAccessToken,
    ip: '10.0.0.6',
  }));
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.accessToken && response.body.refreshToken);
  pass('Legacy account upgrades to a secure 6-digit PIN and receives a new session');

  response = await login(fixtures.active.nationalId, legacyPin(fixtures.active.nationalId), '10.0.0.7');
  assert.equal(response.statusCode, 401);
  response = await login(fixtures.active.nationalId, upgradedPin, '10.0.0.8');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requiresPinUpgrade, false);
  const upgradedAccessToken = response.body.accessToken;
  pass('Old PIN stops working while the new PIN logs in successfully');

  response = await invoke(authSessionStatus, makeRequest({
    method: 'GET', token: upgradedAccessToken, ip: '10.0.0.9',
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.requiresPinUpgrade, false);
  pass('Upgraded session is no longer marked for PIN migration');

  response = await login(fixtures.suspended.nationalId, legacyPin(fixtures.suspended.nationalId), '10.0.0.10');
  assert.equal(response.statusCode, 403);
  pass('Suspended account remains blocked');

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    response = await login(fixtures.lockout.nationalId, '0000', `10.0.1.${attempt}`);
    assert.equal(response.statusCode, 401);
  }
  response = await login(fixtures.lockout.nationalId, legacyPin(fixtures.lockout.nationalId), '10.0.1.6');
  assert.equal(response.statusCode, 429);
  const lockState = await client.query(
    'select failed_attempts, locked_until from public.user_auth_security where user_id = $1',
    [fixtures.lockout.userId],
  );
  assert.equal(lockState.rows[0].failed_attempts, 5);
  assert.ok(lockState.rows[0].locked_until);
  pass('Five invalid attempts create a persistent database lockout');

  const finalState = await client.query(
    `select u.id, u.name, u.role, u.is_active, u.pdpa_agreed, s.pin_version
       from public.users u
       join public.user_auth_security s on s.user_id = u.id
      where u.id = any($1::uuid[])
      order by u.id`,
    [Object.values(fixtures).map((fixture) => fixture.userId)],
  );
  assert.equal(finalState.rowCount, baseline.rowCount);
  for (const original of baseline.rows) {
    const current = finalState.rows.find((row) => row.id === original.id);
    assert.ok(current);
    assert.equal(current.name, original.name);
    assert.equal(current.role, original.role);
    assert.equal(current.is_active, original.is_active);
    assert.equal(current.pdpa_agreed, original.pdpa_agreed);
  }
  assert.equal(finalState.rows.find((row) => row.id === fixtures.active.userId).pin_version, 2);
  pass('PIN upgrade preserves profile identity, role, status, and consent fields');

  console.log(JSON.stringify({
    status: 'PASS',
    environment: 'local-docker-only',
    productionTouched: false,
    scenarioCount: scenarios.length,
    scenarios,
  }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
