import { preview } from 'vite';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import ExcelJSModule from 'exceljs';

const port = 4179;
const appUrl = `http://127.0.0.1:${port}`;
const userNationalId = '1339900567890';
const adminNationalId = '1000000000001';
const userId = '10000000-0000-4000-8000-000000000001';
const adminId = '10000000-0000-4000-8000-000000000002';
const vendorId = '20000000-0000-4000-8000-000000000001';
const future = '2027-07-29T23:59:59.000Z';

const base64Url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const createAccessToken = (id, role) => `${base64Url({ alg: 'none', typ: 'JWT' })}.${base64Url({
  sub: id, role: 'authenticated', aud: 'authenticated', app_metadata: { role },
  exp: Math.floor(Date.now() / 1000) + 3600,
})}.test-signature`;

const json = (route, body, status = 200, headers = {}) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type, prefer, x-client-info',
    'access-control-allow-methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
    ...headers,
  },
  body: JSON.stringify(body),
});

function profile(role) {
  const admin = role === 'ADMIN';
  return {
    id: admin ? adminId : userId,
    national_id: admin ? adminNationalId : userNationalId,
    name: admin ? 'ผู้ดูแลระบบทดสอบ' : 'ผู้ใช้ทดสอบระบบ',
    vendor_id: vendorId,
    role,
    induction_expiry: future,
    created_at: '2026-07-29T00:00:00.000Z',
    age: 30,
    date_of_birth: '1996-01-01',
    nationality: 'ไทย (Thai)',
    pdpa_agreed: true,
    is_active: true,
    vendors: { id: vendorId, name: 'บริษัททดสอบ' },
  };
}

function examQuestions(type) {
  const total = type === 'SUPPLIER_OUTSOURCE' ? 20 : 10;
  return Array.from({ length: total }, (_, index) => ({
    id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    type,
    pattern: 'MULTIPLE_CHOICE',
    content_th: `คำถามทดสอบ ${index + 1}`,
    content_en: `Test question ${index + 1}`,
    choices_json: [
      { text_th: 'คำตอบ ก', text_en: 'Choice A' },
      { text_th: 'คำตอบ ข', text_en: 'Choice B' },
    ],
    image_url: null,
    is_active: true,
  }));
}

async function installMocks(page) {
  let currentRole = 'USER';
  await page.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/token')) {
      const credentials = request.postDataJSON?.() || {};
      currentRole = String(credentials.email || '').startsWith(adminNationalId) ? 'ADMIN' : 'USER';
      const currentProfile = profile(currentRole);
      const accessToken = createAccessToken(currentProfile.id, currentRole);
      return json(route, {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'test-refresh-token',
        user: {
          id: currentProfile.id,
          aud: 'authenticated',
          role: 'authenticated',
          email: `${currentProfile.national_id}@safetypass.com`,
          app_metadata: { role: currentRole },
          user_metadata: { name: currentProfile.name },
          created_at: currentProfile.created_at,
        },
      });
    }
    if (url.pathname.endsWith('/logout')) return json(route, {});
    return json(route, { id: currentRole === 'ADMIN' ? adminId : userId });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const rpcMatch = url.pathname.match(/\/rest\/v1\/rpc\/([^/]+)$/);
    if (rpcMatch) {
      const rpc = rpcMatch[1];
      const payload = request.postDataJSON?.() || {};
      const rpcResponses = {
        check_user_exists: [{ user_exists: true, requires_registration: false, is_active: true }],
        get_my_decrypted_id: currentRole === 'ADMIN' ? adminNationalId : userNationalId,
        get_public_registration_vendors: [{ id: vendorId, name: 'บริษัททดสอบ', status: 'APPROVED' }],
        get_public_support_links: [{ manual_url: 'https://example.com/manual', support_url: 'https://line.me/' }],
        get_public_feature_flags: [{ supplier_outsource_enabled: true }],
        get_runtime_system_settings: [
          { key: 'PASSING_SCORE_INDUCTION', value: '80' },
          { key: 'PASSING_SCORE_WORK_PERMIT', value: '80' },
          { key: 'PASSING_SCORE_SUPPLIER_OUTSOURCE', value: '80' },
        ],
        get_my_supplier_outsource_status: [{
          participant_type: 'supplier', work_type: 'Driver', access_start_date: '2026-07-29',
          access_end_date: '2027-07-29', passed_at: '2026-07-29T00:00:00.000Z', expires_at: future,
          last_score: 20, total_questions: 20, last_status: 'PASSED', last_test_at: '2026-07-29T00:00:00.000Z',
          verification_token: '123e4567-e89b-42d3-a456-426614174000',
        }],
        admin_get_dashboard_summary: {
          total: 3, passed: 2, failed: 1, suspended: 0,
          compliance: { noCert: 0, expired: 0, expiring: 1 },
          barData: [{ name: 'Induction', passed: 1, failed: 0 }, { name: 'Supplier & Outsource', passed: 1, failed: 1 }],
          trendData: [{ date: '2026-07-29', count: 3 }],
          vendorData: [{ name: 'บริษัททดสอบ', value: 3 }],
        },
        admin_get_exam_history_page: {
          rows: [{
            id: '40000000-0000-4000-8000-000000000001', user_id: userId,
            exam_type: 'INDUCTION', score: 10, total_questions: 10, status: 'PASSED',
            created_at: '2026-07-29T00:00:00.000Z',
            users: { ...profile('USER'), vendors: { name: 'บริษัททดสอบ' } },
          }],
          total: 1,
        },
        admin_get_exam_history: [{
          id: '40000000-0000-4000-8000-000000000001', user_id: userId,
          exam_type: 'INDUCTION', score: 10, total_questions: 10, status: 'PASSED',
          created_at: '2026-07-29T00:00:00.000Z',
          users: { ...profile('USER'), vendors: { name: 'บริษัททดสอบ' } },
        }],
        admin_supplier_outsource_report: [{
          user_id: userId, company: 'บริษัททดสอบ', name: 'ผู้ใช้ทดสอบระบบ', national_id: userNationalId,
          participant_type: 'supplier', work_type: 'Driver', access_start_date: '2026-07-29', access_end_date: '2027-07-29',
          passed_at: '2026-07-29T00:00:00.000Z', expires_at: future, last_score: 20, total_questions: 20,
          last_status: 'PASSED', last_test_at: '2026-07-29T00:00:00.000Z', verification_token: '123e4567-e89b-42d3-a456-426614174000',
          test_date: '2026-07-29T00:00:00.000Z', expiration_date: future, score: 20, result_status: 'PASSED',
        }],
        admin_get_supplier_outsource_launch_status: [{ enabled: true, active_question_count: 20 }],
        admin_list_users: [profile('USER')],
        admin_get_directory_page: {
          rows: [profile('USER')], total: 1,
          stats: { total_users: 1, active_users: 1, suspended_users: 0, certified_users: 1 },
        },
        submit_safety_exam: {
          score: payload.exam_type_param === 'SUPPLIER_OUTSOURCE' ? 20 : 10,
          passed: true,
          perQuestion: Object.fromEntries(examQuestions(payload.exam_type_param).map((question) => [question.id, true])),
          verificationToken: '123e4567-e89b-42d3-a456-426614174000',
          expiresAt: future,
        },
      };
      if (rpc === 'get_exam_questions') return json(route, examQuestions(payload.exam_type_param || 'INDUCTION'));
      if (Object.hasOwn(rpcResponses, rpc)) return json(route, rpcResponses[rpc]);
      return json(route, request.method() === 'POST' ? null : []);
    }

    const table = url.pathname.split('/').pop();
    const expectsObject = (request.headers().accept || '').includes('application/vnd.pgrst.object+json');
    if (request.method() === 'HEAD') {
      return route.fulfill({
        status: 200,
        headers: {
          'content-range': '0-0/1',
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, apikey, content-type, prefer, x-client-info',
        },
        body: '',
      });
    }
    if (table === 'users') {
      if (request.method() !== 'GET') return json(route, []);
      return json(route, expectsObject ? profile(currentRole) : [profile(currentRole)]);
    }
    if (table === 'vendors') return json(route, request.method() === 'GET' ? [{ id: vendorId, name: 'บริษัททดสอบ', status: 'APPROVED' }] : []);
    if (table === 'work_permits') {
      const permit = {
      id: '50000000-0000-4000-8000-000000000001', user_id: userId, permit_no: '2026070024',
      expire_date: future, status: 'ACTIVE', created_at: '2026-07-29T00:00:00.000Z',
      };
      return json(route, expectsObject ? permit : [permit]);
    }
    if (table === 'exam_history') return json(route, [
      { status: 'PASSED', exam_type: 'INDUCTION' },
      { status: 'PASSED', exam_type: 'SUPPLIER_OUTSOURCE' },
      { status: 'FAILED', exam_type: 'SUPPLIER_OUTSOURCE' },
    ]);
    if (table === 'questions') return json(route, []);
    if (table === 'audit_logs') return json(route, []);
    return json(route, []);
  });

  await page.route('**/api/notify-**', (route) => json(route, { success: true }));
  await page.route('https://api.line.me/**', (route) => json(route, {}));
}

async function login(page, nationalId) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('form input').nth(0).fill(nationalId);
  await page.locator('form input').nth(1).fill(nationalId.slice(-4));
  await page.getByRole('button', { name: /^Login/i }).click();
}

async function assertA11y(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  if (results.violations.length > 0) {
    const summary = results.violations.map((violation) => `${violation.id}(${violation.nodes.length})`).join(', ');
    const details = results.violations.flatMap((violation) => violation.nodes.slice(0, 20).map((node) =>
      `${violation.id} ${node.target.join(' ')}: ${(node.failureSummary || '').replace(/\s+/g, ' ').trim()}`
    )).join('\n');
    throw new Error(`${label} accessibility failed: ${summary}\n${details}`);
  }
}

const server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
let browser;
try {
  browser = await chromium.launch({ headless: true });

  const userContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const userPage = await userContext.newPage();
  await installMocks(userPage);
  userPage.on('dialog', (dialog) => dialog.accept());
  await login(userPage, userNationalId);
  await userPage.getByRole('heading', { name: 'ผู้ใช้ทดสอบระบบ', exact: true }).waitFor();
  await userPage.getByText('Supplier & Outsource', { exact: true }).first().waitFor();
  await assertA11y(userPage, 'mobile user dashboard');

  await userPage.getByRole('button', { name: /สอบใหม่ \/ Retake/i }).click();
  await userPage.getByText('คู่มือความปลอดภัย', { exact: true }).waitFor();
  await userPage.locator('input[type="checkbox"]').check();
  await userPage.getByRole('button', { name: /เริ่มทำข้อสอบ/ }).click();
  await userPage.getByText('คำถามทดสอบ 1', { exact: true }).waitFor();
  await userPage.getByText('คำตอบ ก', { exact: true }).first().click();
  await userPage.reload({ waitUntil: 'domcontentloaded' });
  await userPage.getByRole('button', { name: /สอบใหม่ \/ Retake/i }).click();
  await userPage.getByText('พบข้อสอบที่ยังทำไม่เสร็จ', { exact: true }).waitFor();
  await userPage.getByRole('button', { name: /กลับไปทำต่อ/ }).click();
  await userPage.getByText('คำถามทดสอบ 1', { exact: true }).waitFor();
  await assertA11y(userPage, 'mobile resumed exam');
  await userContext.close();

  const adminContext = await browser.newContext({ viewport: { width: 1365, height: 900 }, acceptDownloads: true });
  const adminPage = await adminContext.newPage();
  await installMocks(adminPage);
  await login(adminPage, adminNationalId);
  await adminPage.getByText('Dashboard Analytics', { exact: false }).waitFor();
  await assertA11y(adminPage, 'desktop admin dashboard');

  const downloadPromise = adminPage.waitForEvent('download');
  await adminPage.getByRole('button', { name: /Export Data/i }).click();
  await adminPage.getByRole('menuitem', { name: /รายงานผู้รับเหมาเดิม/ }).click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().endsWith('.xlsx')) throw new Error('Admin export did not produce an .xlsx file');

  await adminPage.getByRole('button', { name: /Vendors & Users/i }).click();
  await adminPage.getByText('User & Vendor Compliance', { exact: false }).waitFor();
  const workbook = new ExcelJSModule.Workbook();
  const sheet = workbook.addWorksheet('Users');
  sheet.addRow(['Name', 'National ID', 'Vendor', 'Role', 'Age', 'Nationality']);
  sheet.addRow(['ผู้ใช้ Import ทดสอบ', '1229900123456', 'บริษัททดสอบ', 'USER', 28, 'ไทย (Thai)']);
  const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await adminPage.locator('input[type="file"][accept=".xlsx"]').first().setInputFiles({
    name: 'production-assurance-users.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbookBuffer,
  });
  await adminPage.getByText(/นำเข้าพนักงานสำเร็จ 1 รายการ/).waitFor();
  await assertA11y(adminPage, 'desktop admin users');

  await adminPage.getByRole('button', { name: /^Questions$/i }).click();
  await adminPage.getByText('Assessment Manager', { exact: false }).waitFor();
  await assertA11y(adminPage, 'desktop question manager');
  await adminPage.getByRole('button', { name: /Supplier & Outsource/i }).click();
  await adminPage.getByText('Supplier & Outsource Program', { exact: false }).waitFor();
  await assertA11y(adminPage, 'desktop supplier manager');
  await adminPage.getByRole('button', { name: /^Settings$/i }).click();
  await adminPage.getByText('System Configuration', { exact: false }).waitFor();
  await assertA11y(adminPage, 'desktop settings');

  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage.getByRole('button', { name: /^Users$/i }).click();
  await adminPage.getByText('User & Vendor Compliance', { exact: false }).waitFor();
  const overflow = await adminPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) throw new Error(`Admin mobile view has ${overflow}px horizontal overflow`);
  await assertA11y(adminPage, 'mobile admin users');
  await adminContext.close();

  console.log('Production Assurance E2E passed (login, user, retake/resume, admin, import/export, mobile and accessibility).');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
