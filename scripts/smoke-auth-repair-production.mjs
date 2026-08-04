import process from 'node:process';
import { chromium } from 'playwright';

const appUrl = process.env.APP_URL || 'https://safetypass-enterprise.vercel.app';
const nationalId = process.argv[2] || '';
if (!/^[0-9]{13}$/.test(nationalId)) {
  throw new Error('Usage: node scripts/smoke-auth-repair-production.mjs <13-digit-national-id>');
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const authTokenStatuses = [];
page.on('response', (response) => {
  if (response.url().includes('/auth/v1/token?grant_type=password')) {
    authTokenStatuses.push(response.status());
  }
});

const login = async () => {
  await page.locator('form input').nth(0).fill(nationalId);
  await page.locator('form input').nth(1).fill(nationalId.slice(-4));
  await page.getByRole('button', { name: /^login$/i }).click();
  try {
    await page.getByRole('button', { name: /logout|ออกจากระบบ/i }).waitFor({ timeout: 30_000 });
  } catch (error) {
    const formText = await page.locator('form').innerText().catch(() => 'login form not found');
    throw new Error(JSON.stringify({
      message: 'Login UI did not reach the authenticated state',
      url: page.url(),
      authTokenStatuses,
      formText: formText.slice(0, 1_500),
    }, null, 2), { cause: error });
  }
};

try {
  await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await login();
  const firstLoginStatuses = [...authTokenStatuses];

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /logout|ออกจากระบบ/i }).click();
  await page.getByRole('button', { name: /^login$/i }).waitFor({ timeout: 15_000 });
  authTokenStatuses.length = 0;
  await login();

  if (!authTokenStatuses.includes(200)) {
    throw new Error(`Repeat login did not receive a successful Auth token response: ${authTokenStatuses.join(',')}`);
  }

  console.log(JSON.stringify({
    productionPageLoaded: true,
    firstLoginCompleted: true,
    repairFallbackObserved: firstLoginStatuses.includes(400),
    repeatLoginCompleted: true,
    repeatLoginAuthStatuses: authTokenStatuses,
  }, null, 2));
} finally {
  await browser.close();
}
