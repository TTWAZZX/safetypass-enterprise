import { createHmac } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import authLoginHandler from '../api/auth-login.js';
import setAuthPinHandler from '../api/set-auth-pin.js';
import { createSecurePinPassword } from '../api/_pin.js';

const AUTH_URL = 'http://127.0.0.1:9999';
const REST_URL = 'http://127.0.0.1:9998';
const SUPABASE_URL = 'http://127.0.0.1:9997';
const APP_URL = 'http://127.0.0.1:4173';
const JWT_SECRET = 'local-user360-uat-jwt-secret-at-least-32-characters';
const PIN_PEPPER = 'local-user360-uat-pin-pepper-at-least-32-characters';
const ADMIN_PIN = '739251';
const nativeFetch = globalThis.fetch;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (role) => {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ aud: 'authenticated', exp: now + 86400, iat: now, iss: 'supabase', role });
  return `${header}.${payload}.${createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
};
const serviceKey = jwt('service_role');
const anonKey = jwt('anon');

process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_PUBLISHABLE_KEY = anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
process.env.AUTH_PIN_PEPPER = PIN_PEPPER;

globalThis.fetch = async (input, init = {}) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith(`${SUPABASE_URL}/auth/v1`)) url = `${AUTH_URL}${url.slice(`${SUPABASE_URL}/auth/v1`.length)}`;
  if (url.startsWith(`${SUPABASE_URL}/rest/v1`)) url = `${REST_URL}${url.slice(`${SUPABASE_URL}/rest/v1`.length)}`;
  return nativeFetch(url, init);
};

const assert = (condition, message) => { if (!condition) throw new Error(message); };
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
    user_metadata: { name, national_id: nationalId, password_scheme: 'pin-v2' },
  }),
});
const deleteAuthUser = async (id) => {
  const response = await nativeFetch(`${AUTH_URL}/admin/users/${id}`, { method: 'DELETE', headers: adminHeaders });
  if (!response.ok && response.status !== 404) throw new Error(`Unable to remove Auth fixture ${id}`);
};

const db = new pg.Client({
  host: '127.0.0.1', port: 55436, database: 'postgres', user: 'supabase_admin', password: 'postgres',
  application_name: 'safetypass-user360-real-browser-uat',
});
const suffix = String(Date.now()).slice(-8);
const nationalIds = { admin: `16${suffix}001`, target: `16${suffix}002`, corrected: `15${suffix}002` };
const fixtureName = `Browser UAT User ${suffix}`;
const createdAuthIds = [];
const createdPublicIds = [];
let previousFeatureFlag = 'false';

const upsertProfile = async (id, nationalId, name, role, program) => {
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
  await db.query(`insert into public.user_training_access(user_id, program_code, participant_type, work_type)
    values ($1, $2, case when $2 = 'SUPPLIER_OUTSOURCE' then 'supplier' end,
      case when $2 = 'SUPPLIER_OUTSOURCE' then 'Passenger' end)
    on conflict (user_id, program_code) do nothing`, [id, program]);
  await db.query('update public.users set is_active = true where id = $1', [id]);
  createdPublicIds.push(id);
};

const cleanupFixtures = async () => {
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
  await db.query(`insert into public.system_config(key, value)
    values ('ADMIN_USER360_ENABLED', $1)
    on conflict (key) do update set value = excluded.value`, [previousFeatureFlag]).catch(() => undefined);
};

const collectBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
};
const proxyServer = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': APP_URL,
        'Access-Control-Allow-Headers': request.headers['access-control-request-headers'] || 'authorization,apikey,content-type,x-client-info,x-supabase-api-version',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true',
      });
      return response.end();
    }
    const isAuth = request.url.startsWith('/auth/v1');
    const isRest = request.url.startsWith('/rest/v1');
    if (!isAuth && !isRest) { response.writeHead(404); return response.end(); }
    const prefix = isAuth ? '/auth/v1' : '/rest/v1';
    const target = `${isAuth ? AUTH_URL : REST_URL}${request.url.slice(prefix.length) || '/'}`;
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await collectBody(request);
    const upstream = await nativeFetch(target, { method: request.method, headers: request.headers, body });
    const headers = Object.fromEntries(upstream.headers.entries());
    headers['access-control-allow-origin'] = APP_URL;
    headers['access-control-expose-headers'] = 'content-range,content-disposition';
    response.writeHead(upstream.status, headers);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) { response.writeHead(502, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ message: error.message })); }
});

const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const sendApiResponse = async (handler, request, response) => {
  const bodyBuffer = await collectBody(request);
  let body = {};
  try { body = JSON.parse(bodyBuffer.toString('utf8') || '{}'); } catch { response.writeHead(400); return response.end(); }
  const apiResponse = {
    setHeader(name, value) { response.setHeader(name, value); },
    status(code) { response.statusCode = code; return this; },
    json(value) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); return this; },
    send(value) { response.end(value); return this; },
  };
  await handler({ method: request.method, body, headers: request.headers }, apiResponse);
};
const appServer = createServer(async (request, response) => {
  if (request.url === '/api/auth-login') return sendApiResponse(authLoginHandler, request, response);
  if (request.url === '/api/set-auth-pin') return sendApiResponse(setAuthPinHandler, request, response);
  const distRoot = resolve('dist');
  const pathname = decodeURIComponent(new URL(request.url, APP_URL).pathname);
  let filePath = normalize(join(distRoot, pathname === '/' ? 'index.html' : pathname));
  if (!filePath.startsWith(distRoot) || !existsSync(filePath) || !(await stat(filePath)).isFile()) filePath = join(distRoot, 'index.html');
  response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(filePath).pipe(response);
});

const listen = (server, port) => new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolveListen);
});
const close = (server) => new Promise((resolveClose) => server.close(() => resolveClose()));

let browser;
try {
  await db.connect();
  previousFeatureFlag = (await db.query("select value from public.system_config where key = 'ADMIN_USER360_ENABLED'")).rows[0]?.value || 'false';
  await db.query("update public.system_config set value = 'true' where key = 'ADMIN_USER360_ENABLED'");
  const adminAuth = await createAuthUser(nationalIds.admin, 'Browser UAT Admin', ADMIN_PIN);
  const targetAuth = await createAuthUser(nationalIds.target, fixtureName, '421395');
  createdAuthIds.push(adminAuth.id, targetAuth.id);
  await upsertProfile(adminAuth.id, nationalIds.admin, 'Browser UAT Admin', 'ADMIN', 'CONTRACTOR');
  await upsertProfile(targetAuth.id, nationalIds.target, fixtureName, 'USER', 'SUPPLIER_OUTSOURCE');
  await db.query(`insert into public.exam_history(user_id, exam_type, score, total_questions, status, created_at)
    values ($1, 'SUPPLIER_OUTSOURCE', 20, 20, 'PASSED', now())`, [targetAuth.id]);
  await db.query(`insert into public.work_permits(user_id, permit_no, expire_date, status)
    values ($1, 'REAL-BROWSER-UAT', now() + interval '1 day', 'ACTIVE')`, [targetAuth.id]);

  const npmCommand = process.env.npm_execpath
    ? { command: process.execPath, args: [process.env.npm_execpath, 'run', 'build', '--', '--mode', 'user360-uat'] }
    : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'build', '--', '--mode', 'user360-uat'] };
  const build = spawnSync(npmCommand.command, npmCommand.args, {
    cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe',
    env: {
      ...process.env, NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey, VITE_SUPABASE_ANON_KEY: anonKey,
    },
  });
  if (build.status !== 0) throw new Error(`UAT build failed: ${build.error?.message || build.stderr || build.stdout || 'unknown error'}`);
  await listen(proxyServer, 9997);
  await listen(appServer, 4173);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const browserErrors = [];
  const browserConsoleErrors = [];
  const failedResponses = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserConsoleErrors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('13-digit National ID').fill(nationalIds.admin);
  await page.locator('form input').nth(1).fill(ADMIN_PIN);
  await page.getByRole('button', { name: /^Login/i }).click();
  try {
    await page.getByText('Dashboard Analytics', { exact: false }).waitFor({ timeout: 30000 });
  } catch {
    const pageText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 700);
    throw new Error(`Browser login did not reach Admin dashboard; page=${pageText}; responses=${failedResponses.slice(-10).join(' | ')}; console=${browserConsoleErrors.slice(-5).join(' | ')}`);
  }
  await page.getByRole('button', { name: /Vendors & Users/i }).click();
  await page.getByText('User & Vendor Compliance', { exact: false }).waitFor();
  await page.getByRole('button', { name: /^Personnel$/i }).click();
  await page.getByPlaceholder('Search users...').fill(fixtureName);
  await page.getByText(fixtureName, { exact: true }).first().waitFor();
  await page.getByRole('button', { name: `แก้ไข ${fixtureName}` }).first().click();
  let dialog = page.getByRole('dialog', { name: 'User 360 Profile' });
  await dialog.waitFor();
  assert(!(await dialog.getByLabel('Contractor program').isChecked()), 'Initial Contractor program should be disabled');
  assert(await dialog.getByLabel('Supplier and Outsource program').isChecked(), 'Initial Supplier program should be enabled');
  await dialog.getByLabel('Contractor program').check();
  await dialog.getByLabel('เหตุผลการแก้ไข User 360').fill('Real browser assign both programs');
  await dialog.getByRole('button', { name: 'Save Protocol' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const programsAfterAdd = (await db.query('select program_code from public.user_training_access where user_id = $1 order by program_code', [targetAuth.id])).rows.map((row) => row.program_code);
  assert(programsAfterAdd.join(',') === 'CONTRACTOR,SUPPLIER_OUTSOURCE', 'Browser atomic update did not assign both programs');

  await page.getByRole('button', { name: `แก้ไข ${fixtureName}` }).first().click();
  dialog = page.getByRole('dialog', { name: 'User 360 Profile' });
  await dialog.getByLabel('Contractor program').uncheck();
  await dialog.getByLabel('เหตุผลการแก้ไข User 360').fill('Real browser active permit guard');
  await dialog.getByRole('button', { name: 'Save Protocol' }).click();
  await page.waitForTimeout(500);
  assert(await dialog.isVisible(), 'Active Work Permit did not keep the atomic dialog open');
  assert(Number((await db.query("select count(*) from public.user_training_access where user_id = $1 and program_code = 'CONTRACTOR'", [targetAuth.id])).rows[0].count) === 1, 'Active Work Permit guard removed Contractor');
  await dialog.getByLabel('Contractor program').check();

  await dialog.getByLabel(/Admin PIN/).fill(ADMIN_PIN);
  await dialog.getByRole('button', { name: /Verify PIN/ }).click();
  await dialog.getByText(/PIN verified/).waitFor();
  await dialog.getByLabel(/เหตุผลสำหรับการจัดการเลขบัตร/).fill('Real browser protected identity validation');
  await dialog.getByRole('button', { name: /Reveal 60 seconds/ }).click();
  await dialog.getByText(nationalIds.target, { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'ซ่อนเลขบัตรประชาชน' }).click();
  assert((await dialog.getByText(nationalIds.target, { exact: true }).count()) === 0, 'Full ID remained after browser hide');
  await dialog.getByLabel('ยืนยัน Full-ID Export').check();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /Full-ID Export/ }).click();
  const download = await downloadPromise;
  assert(download.suggestedFilename().startsWith('protected-identities-'), 'Protected export filename is invalid');
  await dialog.getByLabel('เลขบัตรประชาชนใหม่').fill(nationalIds.corrected);
  await dialog.getByLabel('ยืนยันแก้เลขบัตรประชาชน').check();
  await dialog.getByRole('button', { name: /Correct Identity/ }).click();
  const correctedMask = (await db.query('select public.mask_national_id($1) as value', [nationalIds.corrected])).rows[0].value;
  assert(correctedMask !== nationalIds.corrected && !/[0-9]{13}/.test(correctedMask), 'Database mask exposed a full national ID');
  try {
    await dialog.getByText(correctedMask, { exact: true }).waitFor({ timeout: 15_000 });
  } catch (error) {
    const correctionState = await db.query('select national_id from public.users where id = $1', [targetAuth.id]);
    const correctionAuth = await apiJson(`${AUTH_URL}/admin/users/${targetAuth.id}`, { headers: adminHeaders });
    throw new Error(`Corrected mask did not refresh in User 360. public=${correctionState.rows[0]?.national_id || 'missing'} auth=${correctionAuth.email || 'missing'} dialog=${JSON.stringify((await dialog.innerText()).slice(0, 2_000))}`, { cause: error });
  }
  assert((await dialog.getByText(nationalIds.corrected, { exact: true }).count()) === 0, 'Corrected full ID remained in browser DOM');

  const axe = await new AxeBuilder({ page }).include('[aria-labelledby="edit-profile-dialog-title"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert(axe.violations.length === 0, `Real browser User 360 accessibility failed: ${axe.violations.map((item) => item.id).join(',')}`);
  assert(browserErrors.length === 0, `Browser runtime errors: ${browserErrors.join(' | ')}`);
  const finalState = await db.query(`select u.national_id,
    (select count(*) from public.exam_history where user_id = u.id)::integer as exams,
    (select count(*) from public.work_permits where user_id = u.id)::integer as permits
    from public.users u where u.id = $1`, [targetAuth.id]);
  const finalAuth = await apiJson(`${AUTH_URL}/admin/users/${targetAuth.id}`, { headers: adminHeaders });
  assert(finalState.rows[0]?.national_id === nationalIds.corrected, 'Browser correction did not finalize public identity');
  assert(finalAuth.email === `${nationalIds.corrected}@safetypass.com`, 'Browser correction did not finalize Auth identity');
  assert(finalState.rows[0].exams === 1 && finalState.rows[0].permits === 1, 'Browser correction lost linked history');
  const piiAudit = await db.query(`select count(*)::integer as count from public.audit_logs
    where actor_user_id = $1 and (details ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)' or admin_email ~ '^[0-9]{13}@')`, [adminAuth.id]);
  assert(piiAudit.rows[0].count === 0, 'Browser workflow leaked full ID into audit logs');

  console.log(JSON.stringify({
    status: 'PASS_REAL_BROWSER_REAL_GOTRUE_POSTGREST', productionChanged: false, remoteStagingChanged: false,
    scenarios: { login: 'PASS', user360AtomicUpdate: 'PASS', activePermitGuard: 'PASS', reveal: 'PASS', export: 'PASS', correction: 'PASS', linkedHistory: 'PASS', accessibility: 'PASS', auditRedaction: 'PASS' },
  }, null, 2));
  await context.close();
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (appServer.listening) await close(appServer);
  if (proxyServer.listening) await close(proxyServer);
  await cleanupFixtures().catch((error) => console.error(`Cleanup warning: ${error.message}`));
  await db.end().catch(() => undefined);
  globalThis.fetch = nativeFetch;
}
