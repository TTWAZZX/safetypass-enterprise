import { preview } from 'vite';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const port = 4178;
const server = await preview({
  preview: { host: '127.0.0.1', port, strictPort: true },
  logLevel: 'error',
});

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.keyboard.press('Tab');
  const firstFocusHref = await page.evaluate(() => document.activeElement?.getAttribute('href'));
  if (firstFocusHref !== '#main-content') {
    throw new Error(`Keyboard navigation check failed: first focus target was ${firstFocusHref || 'unknown'}.`);
  }
  await page.keyboard.press('Enter');
  const focusedId = await page.evaluate(() => document.activeElement?.id);
  if (focusedId !== 'main-content') {
    throw new Error(`Skip link check failed: focused ${focusedId || 'unknown'} instead of main-content.`);
  }

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  if (results.violations.length > 0) {
    for (const violation of results.violations) {
      console.error(`\n[${violation.impact || 'unknown'}] ${violation.id}: ${violation.help}`);
      for (const node of violation.nodes.slice(0, 5)) {
        console.error(`  ${node.target.join(' ')}`);
        console.error(`  ${node.failureSummary || ''}`);
      }
    }
    throw new Error(`Accessibility check failed with ${results.violations.length} violation group(s).`);
  }

  console.log('Accessibility check passed (WCAG A/AA, mobile login view).');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
