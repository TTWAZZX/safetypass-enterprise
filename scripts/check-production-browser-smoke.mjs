import { chromium } from 'playwright';

const productionUrl = 'https://safetypass-enterprise.vercel.app';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const pageErrors = [];
  const serverErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
  const response = await page.goto(`${productionUrl}/?production_smoke=20260818`, { waitUntil: 'networkidle', timeout: 60_000 });
  if (response?.status() !== 200) throw new Error(`Production page returned ${response?.status()}`);
  await page.getByPlaceholder('13-digit National ID').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Login/i }).waitFor();
  if (pageErrors.length > 0) throw new Error(`Browser runtime errors: ${pageErrors.join(' | ')}`);
  if (serverErrors.length > 0) throw new Error(`Production 5xx responses: ${serverErrors.join(' | ')}`);

  const invalidLogin = await context.request.post(`${productionUrl}/api/auth-login`, {
    data: { nationalId: 'invalid', pin: '000000' },
  });
  if (invalidLogin.status() !== 400) throw new Error(`Invalid login contract returned ${invalidLogin.status()}`);
  const privateHelper = await context.request.get(`${productionUrl}/api/_auth`);
  const privateHelperType = privateHelper.headers()['content-type'] || '';
  const helperExcluded = privateHelper.status() === 404
    || (privateHelper.status() === 200 && privateHelperType.includes('text/html'));
  if (!helperExcluded) throw new Error(`Private API helper was deployed as an endpoint: ${privateHelper.status()} ${privateHelperType}`);
  const protectedIdentity = await context.request.post(`${productionUrl}/api/set-auth-pin`, {
    data: { action: 'admin-identity-step-up', pin: '000000' },
  });
  if (protectedIdentity.status() !== 401) throw new Error(`Protected identity endpoint returned ${protectedIdentity.status()} without authentication`);

  console.log(JSON.stringify({
    status: 'PASS_PRODUCTION_BROWSER_SMOKE',
    url: productionUrl,
    pageStatus: response.status(),
    invalidLoginStatus: invalidLogin.status(),
    privateHelperResult: privateHelper.status() === 404 ? 'NOT_FOUND' : 'SPA_HTML_FALLBACK',
    protectedIdentityUnauthenticatedStatus: protectedIdentity.status(),
    browserRuntimeErrors: 0,
    serverErrors: 0,
  }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
