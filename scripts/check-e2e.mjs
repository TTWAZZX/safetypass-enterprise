import { preview } from 'vite';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import ExcelJSModule from 'exceljs';

const port = 4179;
const appUrl = `http://127.0.0.1:${port}`;
const userNationalId = '1339900567890';
const stagedNationalId = '1339900567891';
const unknownNationalId = '1339900567892';
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
      { text_th: 'คำตอบ ก', text_en: 'Choice A', is_correct: true },
      { text_th: 'คำตอบ ข', text_en: 'Choice B', is_correct: false },
      { text_th: 'คำตอบ ค', text_en: 'Choice C', is_correct: false },
      { text_th: 'คำตอบ ง', text_en: 'Choice D', is_correct: false },
    ],
    correct_choice_index: 0,
    image_url: null,
    is_active: true,
  }));
}

async function installMocks(page) {
  let currentRole = 'USER';
  let currentAuthEmail = `${userNationalId}@safetypass.com`;
  const authDiagnostics = { stagedPrepareRequests: 0, stagedSignupRequests: 0, stagedTokenRequests: 0 };
  let managedQuestions = examQuestions('INDUCTION');
  managedQuestions[7] = { ...managedQuestions[7], choices_json: managedQuestions[7].choices_json.slice(0, 3) };
  managedQuestions[9] = {
    ...managedQuestions[9],
    content_th: managedQuestions[8].content_th,
    content_en: managedQuestions[8].content_en,
  };
  const questionSnapshot = (question) => JSON.parse(JSON.stringify(question));
  const managedRevisions = new Map(managedQuestions.map((question, questionIndex) => [question.id, [
    {
      id: `51000000-0000-4000-8000-${String(questionIndex * 10 + 2).padStart(12, '0')}`,
      question_id: question.id,
      revision_no: 2,
      change_type: 'SAVE',
      note: null,
      changed_by: adminId,
      changed_by_name: 'ผู้ดูแลระบบทดสอบ',
      changed_at: '2026-07-29T02:00:00.000Z',
      snapshot: questionSnapshot(question),
    },
    {
      id: `51000000-0000-4000-8000-${String(questionIndex * 10 + 1).padStart(12, '0')}`,
      question_id: question.id,
      revision_no: 1,
      change_type: 'BASELINE',
      note: null,
      changed_by: null,
      changed_by_name: 'ระบบ',
      changed_at: '2026-07-29T01:00:00.000Z',
      snapshot: questionSnapshot({ ...question, is_active: false }),
    },
  ]]));
  const getManagedRevisions = (questionId) => {
    const revisions = managedRevisions.get(questionId) || [];
    const currentRevision = Math.max(0, ...revisions.map((revision) => revision.revision_no));
    return revisions
      .map((revision) => ({ ...revision, is_current: revision.revision_no === currentRevision }))
      .sort((left, right) => right.revision_no - left.revision_no);
  };
  await page.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/signup')) {
      const credentials = request.postDataJSON?.() || {};
      if (String(credentials.email || '').startsWith(stagedNationalId)) {
        authDiagnostics.stagedSignupRequests += 1;
      }
      const currentProfile = profile('USER');
      const accessToken = createAccessToken(currentProfile.id, 'USER');
      currentRole = 'USER';
      currentAuthEmail = credentials.email || `${currentProfile.national_id}@safetypass.com`;
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
          email: credentials.email || `${currentProfile.national_id}@safetypass.com`,
          app_metadata: { role: 'USER' },
          user_metadata: credentials.data || {},
          created_at: currentProfile.created_at,
        },
      });
    }
    if (url.pathname.endsWith('/token')) {
      const credentials = request.postDataJSON?.() || {};
      if (String(credentials.email || '').startsWith(stagedNationalId)) {
        authDiagnostics.stagedTokenRequests += 1;
      }
      currentRole = String(credentials.email || '').startsWith(adminNationalId) ? 'ADMIN' : 'USER';
      currentAuthEmail = credentials.email || `${profile(currentRole).national_id}@safetypass.com`;
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
          email: credentials.email || `${currentProfile.national_id}@safetypass.com`,
          app_metadata: { role: currentRole },
          user_metadata: { name: currentProfile.name },
          created_at: currentProfile.created_at,
        },
      });
    }
    if (url.pathname.endsWith('/logout')) return json(route, {});
    if (url.pathname.endsWith('/user')) {
      const currentProfile = profile(currentRole);
      return json(route, {
        id: currentProfile.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: currentAuthEmail,
        app_metadata: { role: currentRole },
        user_metadata: { name: currentProfile.name },
        created_at: currentProfile.created_at,
      });
    }
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
        check_user_exists: payload.search_id === stagedNationalId
          ? [{ user_exists: true, requires_registration: true, is_active: true }]
          : payload.search_id === unknownNationalId
            ? []
            : [{ user_exists: true, requires_registration: false, is_active: true }],
        get_my_staged_registration_profile: {
          name: 'ผู้ใช้ที่บริษัทเตรียมไว้',
          age: 42,
          nationality: 'ไทย (Thai)',
          vendor_id: vendorId,
          vendor: { id: vendorId, name: 'บริษัททดสอบ', status: 'APPROVED' },
        },
        get_my_decrypted_id: currentRole === 'ADMIN' ? adminNationalId : userNationalId,
        get_public_registration_vendors: [{ id: vendorId, name: 'บริษัททดสอบ', status: 'APPROVED' }],
        admin_get_vendor_duplicate_groups: [],
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
        submit_safety_exam: {
          score: payload.exam_type_param === 'SUPPLIER_OUTSOURCE' ? 20 : 10,
          passed: true,
          perQuestion: Object.fromEntries(examQuestions(payload.exam_type_param).map((question) => [question.id, true])),
          verificationToken: '123e4567-e89b-42d3-a456-426614174000',
          expiresAt: future,
        },
      };
      if (rpc === 'find_vendor_name_matches') {
        const searchName = String(payload.search_name_param || '').trim();
        if (searchName === 'บริษัททดสอบ') {
          return json(route, [{ id: vendorId, name: 'บริษัททดสอบ', status: 'APPROVED', match_type: 'EXACT', match_score: 1 }]);
        }
        if (searchName.includes('ทดสอบ')) {
          return json(route, [{ id: vendorId, name: 'บริษัททดสอบ', status: 'APPROVED', match_type: 'SIMILAR', match_score: 0.82 }]);
        }
        return json(route, []);
      }
      if (rpc === 'admin_save_vendor') {
        const name = String(payload.name_param || '').trim();
        if (name === 'บริษัททดสอบ') {
          return json(route, {
            saved: false, created: false, reason: 'EXACT',
            vendor: { id: vendorId, name: 'บริษัททดสอบ', status: 'APPROVED' }, matches: [],
          });
        }
        if (name.includes('ทดสอบ') && payload.allow_similar_param !== true) {
          return json(route, {
            saved: false, created: false, reason: 'SIMILAR', vendor: null,
            matches: [{ id: vendorId, name: 'บริษัททดสอบ', status: 'APPROVED', match_type: 'SIMILAR', match_score: 0.82 }],
          });
        }
        return json(route, {
          saved: true, created: !payload.vendor_id_param, reason: 'SAVED', matches: [],
          vendor: { id: payload.vendor_id_param || '20000000-0000-4000-8000-000000000002', name, status: payload.status_param },
        });
      }
      if (rpc === 'admin_get_directory_page') {
        if (payload.p_section === 'VENDORS') {
          return json(route, { rows: [{ id: vendorId, name: 'บริษัททดสอบ', status: 'APPROVED', created_at: '2026-07-29T00:00:00.000Z' }], total: 1, stats: null });
        }
        return json(route, {
          rows: [profile('USER')], total: 1,
          stats: { total_users: 1, active_users: 1, suspended_users: 0, certified_users: 1 },
        });
      }
      if (rpc === 'get_exam_questions') return json(route, examQuestions(payload.exam_type_param || 'INDUCTION'));
      if (rpc === 'admin_get_question_revisions') {
        return json(route, getManagedRevisions(payload.question_id_param));
      }
      if (rpc === 'admin_restore_question_revision') {
        const revisions = managedRevisions.get(payload.question_id_param) || [];
        const selectedRevision = revisions.find((revision) => revision.id === payload.revision_id_param);
        if (!selectedRevision) return json(route, { message: 'Revision not found' }, 404);
        managedQuestions = managedQuestions.map((question) => question.id === payload.question_id_param
          ? { ...question, ...questionSnapshot(selectedRevision.snapshot), id: question.id }
          : question);
        const restoredQuestion = managedQuestions.find((question) => question.id === payload.question_id_param);
        const nextRevision = Math.max(0, ...revisions.map((revision) => revision.revision_no)) + 1;
        revisions.push({
          id: `52000000-0000-4000-8000-${String(nextRevision).padStart(12, '0')}`,
          question_id: payload.question_id_param,
          revision_no: nextRevision,
          change_type: 'RESTORE',
          note: `Restored revision ${selectedRevision.revision_no}`,
          changed_by: adminId,
          changed_by_name: 'ผู้ดูแลระบบทดสอบ',
          changed_at: '2026-07-29T03:00:00.000Z',
          snapshot: questionSnapshot(restoredQuestion),
        });
        managedRevisions.set(payload.question_id_param, revisions);
        return json(route, payload.question_id_param);
      }
      if (rpc === 'admin_save_question') {
        const questionId = payload.question_id_param || '30000000-0000-4000-8000-000000999999';
        const previousQuestion = managedQuestions.find((question) => question.id === questionId);
        const savedQuestion = {
          id: questionId,
          type: payload.exam_type_param,
          pattern: payload.pattern_param,
          content_th: payload.content_th_param,
          content_en: payload.content_en_param,
          choices_json: payload.choices_json_param,
          correct_choice_index: payload.correct_choice_index_param,
          image_url: payload.image_url_param,
          is_active: payload.is_active_param,
          created_at: '2026-07-29T00:00:00.000Z',
        };
        const existingIndex = managedQuestions.findIndex((question) => question.id === questionId);
        if (existingIndex >= 0) managedQuestions = managedQuestions.map((question) => question.id === questionId ? { ...question, ...savedQuestion } : question);
        else managedQuestions = [savedQuestion, ...managedQuestions];
        const revisions = managedRevisions.get(questionId) || [];
        const nextRevision = Math.max(0, ...revisions.map((revision) => revision.revision_no)) + 1;
        const changeType = !previousQuestion
          ? 'CREATE'
          : previousQuestion.is_active !== true && savedQuestion.is_active === true
            ? 'PUBLISH'
            : previousQuestion.is_active === true && savedQuestion.is_active !== true
              ? 'UNPUBLISH'
              : 'SAVE';
        revisions.push({
          id: `53000000-0000-4000-8000-${String(nextRevision).padStart(12, '0')}`,
          question_id: questionId,
          revision_no: nextRevision,
          change_type: changeType,
          note: null,
          changed_by: adminId,
          changed_by_name: 'ผู้ดูแลระบบทดสอบ',
          changed_at: '2026-07-29T04:00:00.000Z',
          snapshot: questionSnapshot(savedQuestion),
        });
        managedRevisions.set(questionId, revisions);
        return json(route, questionId);
      }
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
    if (table === 'questions') return json(route, request.method() === 'GET' ? managedQuestions : []);
    if (table === 'audit_logs') return json(route, []);
    return json(route, []);
  });

  await page.route('**/api/notify-**', (route) => json(route, { success: true }));
  await page.route('**/api/prepare-staged-auth', (route) => {
    authDiagnostics.stagedPrepareRequests += 1;
    currentRole = 'USER';
    currentAuthEmail = `${stagedNationalId}@safetypass.com`;
    return json(route, {
      ok: true,
      accessToken: createAccessToken(userId, 'USER'),
      refreshToken: 'test-refresh-token',
    });
  });
  await page.route('https://api.line.me/**', (route) => json(route, {}));
  return authDiagnostics;
}

async function login(page, nationalId) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('form input').nth(0).fill(nationalId);
  await page.locator('form input').nth(1).fill(nationalId.slice(-4));
  await page.getByRole('button', { name: /^Login/i }).click();
}

async function assertA11y(page, label, scope) {
  let builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (scope) builder = builder.include(scope);
  const results = await builder.analyze();
  if (results.violations.length > 0) {
    const summary = results.violations.map((violation) => `${violation.id}(${violation.nodes.length})`).join(', ');
    const details = results.violations.flatMap((violation) => violation.nodes.slice(0, 20).map((node) =>
      `${violation.id} ${node.target.join(' ')}: ${(node.failureSummary || '').replace(/\s+/g, ' ').trim()}`
    )).join('\n');
    throw new Error(`${label} accessibility failed: ${summary}\n${details}`);
  }
}

async function assertDialogFitsViewport(page, selector, label) {
  const result = await page.locator(selector).evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const testX = rect.left + Math.min(rect.width / 2, 80);
    const testY = rect.top + Math.min(6, rect.height / 2);
    const topElement = document.elementFromPoint(testX, testY);
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      isTopmost: Boolean(topElement && dialog.contains(topElement)),
    };
  });
  const outsideViewport = result.top < 0 || result.left < 0
    || result.right > result.viewportWidth || result.bottom > result.viewportHeight;
  if (outsideViewport) throw new Error(`${label} is outside the viewport: ${JSON.stringify(result)}`);
  if (!result.isTopmost) throw new Error(`${label} is covered by another page element`);
}

const server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
let browser;
try {
  browser = await chromium.launch({ headless: true });

  const userContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const userPage = await userContext.newPage();
  const userAuthDiagnostics = await installMocks(userPage);
  userPage.on('dialog', (dialog) => dialog.accept());
  await userPage.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await userPage.getByRole('button', { name: 'ลงทะเบียน', exact: true }).click();
  await userPage.getByRole('heading', { name: 'Create Account', exact: false }).waitFor();
  const registrationIdInput = userPage.getByPlaceholder('เลขบัตรประจำตัวประชาชน 13 หลัก');
  const registrationNameInput = userPage.getByPlaceholder('Full Name (EN/TH)');
  const registrationAgeInput = userPage.locator('input[type="number"]').first();
  await registrationIdInput.fill(stagedNationalId);
  await userPage.getByText('พบข้อมูลที่บริษัทเตรียมไว้ เติมข้อมูลสำเร็จ', { exact: true }).waitFor();
  if (await registrationNameInput.inputValue() !== 'ผู้ใช้ที่บริษัทเตรียมไว้') throw new Error('Staged registration did not auto-fill the name');
  if (await registrationAgeInput.inputValue() !== '42') throw new Error('Staged registration did not auto-fill the age');
  if (await registrationNameInput.isEditable()) throw new Error('Staged administrator name is editable');
  if (userAuthDiagnostics.stagedPrepareRequests !== 1) throw new Error('Staged registration did not prepare its Auth identity exactly once');
  if (userAuthDiagnostics.stagedSignupRequests !== 0) throw new Error('Staged registration exposed client-side sign-up fallback');
  if (userAuthDiagnostics.stagedTokenRequests !== 0) throw new Error('Staged registration still exposed a client-side password probe');

  await registrationIdInput.fill('');
  if (await registrationNameInput.inputValue() !== '') throw new Error('Changing a staged identity retained the old name');
  await registrationIdInput.fill(unknownNationalId);
  await userPage.getByText('ไม่พบประวัติ กรุณากรอกข้อมูลเพื่อลงทะเบียนใหม่', { exact: true }).waitFor();

  await registrationIdInput.fill(userNationalId);
  await userPage.getByRole('heading', { name: 'Welcome Back', exact: false }).waitFor();
  if (await userPage.getByPlaceholder('13-digit National ID').inputValue() !== userNationalId) throw new Error('Registered identity was not transferred to login');
  await userPage.getByRole('button', { name: 'ลงทะเบียน', exact: true }).click();
  await userPage.getByRole('heading', { name: 'Create Account', exact: false }).waitFor();
  await registrationIdInput.fill('');
  const registrationVendorSelect = userPage.locator('select[required]').filter({ has: userPage.locator('option[value="OTHER"]') });
  await registrationVendorSelect.selectOption('OTHER');
  await userPage.locator('input[autocomplete="organization"]').fill('บริษัททดสอบ');
  await userPage.getByText('พบบริษัทนี้ในระบบแล้ว', { exact: true }).waitFor();
  await userPage.getByRole('button', { name: 'เลือกบริษัทนี้', exact: true }).click();
  if (await registrationVendorSelect.inputValue() !== vendorId) throw new Error('Registration did not reuse the existing vendor');
  await assertA11y(userPage, 'mobile registration vendor duplicate guard');
  await userPage.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await login(userPage, userNationalId);
  await userPage.getByRole('heading', { name: 'ผู้ใช้ทดสอบระบบ', exact: true }).waitFor();
  await userPage.getByText('Supplier & Outsource', { exact: true }).first().waitFor();
  await assertA11y(userPage, 'mobile user dashboard');

  await userPage.getByRole('button', { name: /สอบใหม่ \/ Retake/i }).click();
  await userPage.getByText('คู่มือความปลอดภัย', { exact: true }).waitFor();
  await userPage.locator('input[type="checkbox"]').check();
  await userPage.getByRole('button', { name: /เริ่มทำข้อสอบ/ }).click();
  await userPage.getByText(/^คำถามทดสอบ \d+$/, { exact: true }).first().waitFor();
  await userPage.getByText('คำตอบ ก', { exact: true }).first().click();
  await userPage.reload({ waitUntil: 'domcontentloaded' });
  await userPage.getByRole('button', { name: /สอบใหม่ \/ Retake/i }).click();
  await userPage.getByText('พบข้อสอบที่ยังทำไม่เสร็จ', { exact: true }).waitFor();
  await userPage.getByRole('button', { name: /กลับไปทำต่อ/ }).click();
  await userPage.getByText(/^คำถามทดสอบ \d+$/, { exact: true }).first().waitFor();
  await assertA11y(userPage, 'mobile resumed exam');
  await userContext.close();

  const adminContext = await browser.newContext({ viewport: { width: 1365, height: 900 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const adminPage = await adminContext.newPage();
  await installMocks(adminPage);
  adminPage.on('dialog', (dialog) => dialog.accept());
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
  await adminPage.getByRole('button', { name: /New Entry/i }).click();
  const vendorDialog = adminPage.getByRole('dialog', { name: 'เพิ่มบริษัทใหม่' });
  await vendorDialog.waitFor();
  await vendorDialog.getByLabel('ชื่อบริษัท').fill('บริษัททดสอบ');
  await vendorDialog.getByText('ไม่สามารถบันทึกชื่อซ้ำได้', { exact: true }).waitFor();
  if (await vendorDialog.getByRole('button', { name: 'เพิ่มบริษัท', exact: true }).isEnabled()) throw new Error('Exact duplicate vendor save button is enabled');
  await assertDialogFitsViewport(adminPage, '[aria-labelledby="vendor-dialog-title"]', 'Vendor duplicate modal');
  await assertA11y(adminPage, 'vendor duplicate modal', '[aria-labelledby="vendor-dialog-title"]');
  await vendorDialog.getByRole('button', { name: 'ปิด', exact: true }).click();

  await adminPage.getByRole('button', { name: /New Entry/i }).click();
  const similarVendorDialog = adminPage.getByRole('dialog', { name: 'เพิ่มบริษัทใหม่' });
  await similarVendorDialog.getByLabel('ชื่อบริษัท').fill('บริษัททดสอบ สาขาใหม่');
  await similarVendorDialog.getByText('พบชื่อใกล้เคียง กรุณาตรวจสอบ', { exact: true }).waitFor();
  if (await similarVendorDialog.getByRole('button', { name: 'เพิ่มบริษัท', exact: true }).isEnabled()) throw new Error('Similar vendor save button is enabled before confirmation');
  await similarVendorDialog.getByLabel(/ตรวจสอบแล้ว ยืนยันว่าเป็นคนละบริษัท/).check();
  if (!(await similarVendorDialog.getByRole('button', { name: 'เพิ่มบริษัท', exact: true }).isEnabled())) throw new Error('Similar vendor save button did not enable after confirmation');
  await similarVendorDialog.getByRole('button', { name: 'ปิด', exact: true }).click();

  await adminPage.getByRole('button', { name: /New Entry/i }).click();
  const uniqueVendorDialog = adminPage.getByRole('dialog', { name: 'เพิ่มบริษัทใหม่' });
  await uniqueVendorDialog.getByLabel('ชื่อบริษัท').fill('บริษัทใหม่เวนเดอร์');
  await uniqueVendorDialog.getByText('ไม่พบชื่อซ้ำหรือชื่อใกล้เคียง', { exact: true }).waitFor();
  await uniqueVendorDialog.getByRole('button', { name: 'เพิ่มบริษัท', exact: true }).click();
  await adminPage.getByText('เพิ่มบริษัทสำเร็จ', { exact: true }).waitFor();
  await adminPage.getByRole('button', { name: /^Personnel$/i }).click();
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
  await adminPage.getByText('Master Repository', { exact: true }).waitFor();
  await adminPage.getByText('เฉลย: ตัวเลือก 1 — คำตอบ ก', { exact: true }).first().waitFor();
  await adminPage.getByRole('button', { name: /ข้อมูลไม่ครบ\s*1/ }).click();
  await adminPage.getByText('แสดง 1 จาก 10 คำถาม', { exact: true }).waitFor();
  await adminPage.getByText('ดูจุดที่ต้องแก้ 1 จุด', { exact: true }).click();
  await adminPage.getByText('มีตัวเลือก 3/4', { exact: true }).waitFor();
  await adminPage.getByRole('button', { name: /ตัวกรอง/ }).click();
  await adminPage.getByLabel('รูปแบบคำถาม').selectOption('MULTIPLE_CHOICE');
  await adminPage.getByLabel('สถานะใช้งาน').selectOption('ACTIVE');
  await adminPage.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }).click();
  await adminPage.getByText('แสดง 10 จาก 10 คำถาม', { exact: true }).waitFor();
  await adminPage.getByRole('button', { name: /อาจซ้ำ\s*2/ }).click();
  await adminPage.getByText('แสดง 2 จาก 10 คำถาม', { exact: true }).waitFor();
  await adminPage.getByText('อาจซ้ำ 2 รายการ', { exact: true }).first().waitFor();
  await adminPage.locator('[aria-label="สรุปคุณภาพคำถาม"] button').first().click();
  await adminPage.getByRole('button', { name: 'ดูตัวเลือกและเฉลย' }).first().click();
  await adminPage.getByText('ตัวเลือกและเฉลย', { exact: true }).first().waitFor();
  await assertA11y(adminPage, 'desktop question manager');
  const firstQuestionCard = adminPage.locator('[id="question-card-30000000-0000-4000-8000-000000000001"]');
  await firstQuestionCard.getByRole('button', { name: /ดูประวัติคำถาม/ }).click();
  await adminPage.getByRole('dialog', { name: 'ประวัติและการกู้คืนคำถาม' }).waitFor();
  await adminPage.getByText('รุ่นที่ 2', { exact: true }).waitFor();
  await adminPage.getByText('รุ่นที่ 1', { exact: true }).waitFor();
  await adminPage.getByText('ข้อมูลตั้งต้น', { exact: true }).waitFor();
  await assertDialogFitsViewport(adminPage, '[aria-labelledby="question-history-title"]', 'Question history modal');
  await assertA11y(adminPage, 'question revision history');
  await adminPage.getByRole('button', { name: 'กู้คืนรุ่นนี้' }).click();
  await adminPage.getByText(/กู้คืน Q-000001 เป็นรุ่นที่ 1 สำเร็จ/).waitFor();
  await adminPage.getByText('กู้คืนข้อมูล', { exact: true }).waitFor();
  await adminPage.getByText('รุ่นที่ 3', { exact: true }).waitFor();
  await adminPage.getByRole('button', { name: 'ปิดประวัติคำถาม' }).click();
  await firstQuestionCard.getByRole('button', { name: 'เผยแพร่ Q-000001' }).click();
  await adminPage.getByText(/เผยแพร่ Q-000001 สำเร็จ/).waitFor();
  await adminPage.getByRole('button', { name: /แก้ไขคำถาม Q-/ }).first().click();
  await adminPage.getByRole('dialog', { name: 'Edit Question' }).waitFor();
  await adminPage.getByText('ข้อ 1 จาก 10', { exact: true }).waitFor();
  await assertDialogFitsViewport(adminPage, '#question-edit-dialog', 'Question edit modal');
  await assertA11y(adminPage, 'question edit modal', '#question-edit-dialog');
  await adminPage.getByRole('button', { name: /ข้อถัดไป/ }).first().click();
  await adminPage.locator('#question-content-th').waitFor();
  if (await adminPage.locator('#question-content-th').inputValue() !== 'คำถามทดสอบ 2') throw new Error('Question next navigation did not open question 2');
  await adminPage.getByRole('button', { name: /ข้อก่อนหน้า/ }).click();
  if (await adminPage.locator('#question-content-th').inputValue() !== 'คำถามทดสอบ 1') throw new Error('Question previous navigation did not return to question 1');
  await adminPage.getByRole('button', { name: /บันทึกและไปข้อถัดไป/ }).click();
  await adminPage.getByText(/บันทึก Q-\d{6} แล้ว กำลังเปิด Q-\d{6}/).waitFor();
  if (await adminPage.locator('#question-content-th').inputValue() !== 'คำถามทดสอบ 2') throw new Error('Save and continue did not open the next question');
  await adminPage.getByRole('button', { name: 'ปิดหน้าต่างแก้ไขคำถาม' }).click();
  await adminPage.getByText('บันทึกแล้ว • เมื่อสักครู่', { exact: true }).waitFor();
  await adminPage.getByRole('button', { name: /ทำสำเนาคำถาม Q-/ }).first().click();
  await adminPage.getByRole('dialog', { name: 'Edit Question' }).waitFor();
  if (!(await adminPage.locator('#question-content-th').inputValue()).endsWith('(สำเนา)')) throw new Error('Duplicated question is missing the copy suffix');
  await adminPage.getByText(/คำถามนี้ปิดใช้งานอยู่/).waitFor();
  await assertA11y(adminPage, 'duplicated question edit modal', '#question-edit-dialog');
  await adminPage.setViewportSize({ width: 390, height: 844 });
  await assertDialogFitsViewport(adminPage, '#question-edit-dialog', 'Mobile question edit modal');
  await adminPage.setViewportSize({ width: 1365, height: 900 });
  await adminPage.getByRole('button', { name: 'ปิดหน้าต่างแก้ไขคำถาม' }).click();
  await adminPage.getByRole('button', { name: 'Supplier & Outsource', exact: true }).click();
  await adminPage.getByText('Program Control & Reporting', { exact: true }).waitFor();
  await assertA11y(adminPage, 'desktop supplier manager');
  await adminPage.getByRole('button', { name: /^Settings$/i }).click();
  await adminPage.getByText('Threshold Settings', { exact: false }).waitFor();
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
