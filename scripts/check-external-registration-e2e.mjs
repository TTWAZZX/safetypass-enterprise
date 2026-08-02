import { preview } from 'vite';
import { chromium } from 'playwright';

const port = 4181;
const appUrl = `http://127.0.0.1:${port}`;
const requestNo = 'EXT-2026-000321';
const trackingToken = 'phase5-browser-token';

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type, prefer, x-client-info',
    'access-control-allow-methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
  },
  body: JSON.stringify(body),
});

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const rpc = new URL(route.request().url()).pathname.split('/').pop();
    if (rpc === 'get_external_registration_feature_flag') return json(route, true);
    if (rpc === 'create_external_access_application') return json(route, {
      request_no: requestNo,
      tracking_token: trackingToken,
      status: 'SUBMITTED',
    });
    if (rpc === 'get_external_access_application_status') return json(route, {
      request_no: requestNo,
      company_name: 'Phase Five QA Company Co., Ltd.',
      company_resolution: 'UNRESOLVED',
      status: 'SUBMITTED',
      submitted_at: '2026-08-02T10:00:00.000Z',
      admin_note: null,
      rejection_reason: null,
      types: [{ type_code: 'CONTRACTOR', target_system: 'CONTRACTOR_ONLINE' }],
      coordinators: [{ name: 'TSH QA Coordinator', is_primary: true }],
    });
    return json(route, []);
  });
  await page.route('**/api/send-external-registration-submission', (route) => json(route, { success: true, sent: 1 }));

  await page.goto(`${appUrl}/external-registration`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'ลงทะเบียนใช้งาน Contractor Online / Supplier E-Pass' }).waitFor();

  const checkboxes = page.locator('input[type="checkbox"]');
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  const inputs = page.locator('input:not([type="checkbox"])');
  const values = [
    'Phase Five QA Company Co., Ltd.', 'ผู้สมัคร', 'ทดสอบระบบ', 'Phase', 'Five',
    'QA Manager', 'tawun666956666956@gmail.com', '0800000000', 'TSH QA Coordinator',
  ];
  for (let index = 0; index < values.length; index += 1) await inputs.nth(index).fill(values[index]);
  await checkboxes.nth(3).check();
  await page.getByRole('button', { name: 'ยืนยันและส่งคำขอ' }).click();
  await page.getByText(requestNo, { exact: true }).waitFor();
  await page.getByRole('link', { name: /ติดตามสถานะคำขอ/ }).click();
  await page.getByRole('heading', { name: requestNo }).waitFor();
  await page.getByText('รอตรวจสอบ', { exact: true }).waitFor();
  console.log('External Registration applicant E2E smoke passed (form, submission result and tracking status).');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
