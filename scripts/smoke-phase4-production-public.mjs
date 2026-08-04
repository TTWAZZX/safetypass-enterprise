import { chromium } from 'playwright';

const appUrl = 'https://safetypass-enterprise.vercel.app';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleErrors = [];
const serverErrors = [];

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 500) {
    serverErrors.push({ status: response.status(), url: response.url() });
  }
});

try {
  const response = await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  if (!response || response.status() !== 200) {
    throw new Error(`Production page returned ${response?.status() ?? 'no response'}`);
  }
  const form = page.locator('form');
  await form.waitFor({ state: 'visible', timeout: 20_000 });
  const inputs = form.locator('input');
  if (await inputs.count() < 2) throw new Error('Login form inputs are missing');
  await page.getByRole('button', { name: /^login$/i }).waitFor({ state: 'visible', timeout: 10_000 });
  if (serverErrors.length > 0) throw new Error(`Production returned HTTP 5xx: ${JSON.stringify(serverErrors)}`);
  if (consoleErrors.length > 0) throw new Error(`Production console errors: ${JSON.stringify(consoleErrors)}`);
  console.log(JSON.stringify({
    result: 'PASS_PUBLIC_NO_DATA_ACCESS',
    url: appUrl,
    httpStatus: response.status(),
    loginFormVisible: true,
    mobileViewport: true,
    consoleErrors: 0,
    serverErrors: 0,
    authenticatedDataAccessed: false,
    filesDownloaded: false,
  }, null, 2));
} finally {
  await browser.close();
}
