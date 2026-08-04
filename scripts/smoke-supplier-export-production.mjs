import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import pg from 'pg';

const appUrl = process.env.APP_URL || 'https://safetypass-enterprise.vercel.app';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
    }),
);

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-supplier-export-smoke',
});

let adminNationalId;
try {
  await client.connect();
  const result = await client.query(`
    select split_part(au.email, '@', 1) as national_id
    from public.users u
    join auth.users au on au.id = u.id
    where u.role = 'ADMIN'
      and coalesce(u.is_active, false)
      and au.email ~ '^[0-9]{13}@safetypass[.]com$'
    order by au.last_sign_in_at desc nulls last
    limit 1
  `);
  adminNationalId = result.rows[0]?.national_id;
} finally {
  await client.end().catch(() => undefined);
}

if (!/^\d{13}$/.test(adminNationalId || '')) {
  throw new Error('No active synthetic Admin identity is available for the production smoke test');
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ acceptDownloads: true });
const dialogMessages = [];
const reportResponseStatuses = [];
page.on('dialog', async (dialog) => {
  dialogMessages.push(dialog.message());
  await dialog.dismiss();
});
page.on('response', (response) => {
  if (response.url().includes('/rpc/admin_supplier_outsource_report')) {
    reportResponseStatuses.push(response.status());
  }
});

try {
  await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('form input').nth(0).fill(adminNationalId);
  await page.locator('form input').nth(1).fill(adminNationalId.slice(-4));
  await page.getByRole('button', { name: /^login$/i }).click();
  await page.getByRole('button', { name: /logout|ออกจากระบบ/i }).waitFor({ timeout: 30_000 });

  await page.getByRole('button', { name: /export data/i }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    .then((download) => ({ download, error: null }))
    .catch((error) => ({ download: null, error }));
  const exportOption = page.getByRole('menuitem', { name: /รายงาน Supplier & Outsource/i });
  await exportOption.waitFor({ state: 'visible', timeout: 10_000 }).catch(async (error) => {
    const buttonLabels = (await page.getByRole('menuitem').allTextContents())
      .map((label) => label.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    throw new Error(JSON.stringify({
      message: 'Supplier export menu option is not visible',
      buttonLabels,
    }, null, 2), { cause: error });
  });
  await exportOption.click({ timeout: 10_000 });
  const downloadResult = await downloadPromise;
  if (!downloadResult.download) {
    throw new Error(JSON.stringify({
      message: 'Supplier workbook was not downloaded',
      reportResponseStatuses,
      dialogMessages,
    }, null, 2), { cause: downloadResult.error });
  }
  const download = downloadResult.download;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Downloaded workbook path is unavailable');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(downloadPath);
  const worksheet = workbook.getWorksheet('Sheet1');
  if (!worksheet) throw new Error('Supplier export worksheet is missing');
  let dataRows = 0;
  let validIdRows = 0;
  let testDateRows = 0;
  let expirationDateRows = 0;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;
    const idCell = row.getCell(6);
    const idCard = String(idCell.value || '');
    if (!idCard && row.values.length === 0) return;
    dataRows += 1;
    if (typeof idCell.value === 'number' && /^\d{13}$/.test(idCard) && idCell.numFmt === '0') validIdRows += 1;
    if (row.getCell(7).value instanceof Date && row.getCell(7).numFmt === 'mm-dd-yy') testDateRows += 1;
    if (row.getCell(8).value instanceof Date && row.getCell(8).numFmt === 'mm-dd-yy') expirationDateRows += 1;
  });

  if (dataRows === 0 || validIdRows !== dataRows) {
    throw new Error(`Supplier export contains invalid ID card rows: ${validIdRows}/${dataRows}`);
  }

  console.log(JSON.stringify({
    downloadSucceeded: true,
    dataRows,
    validRealIdRows: validIdRows,
    idCellFormat: worksheet.getCell('F3').numFmt,
    testDateFormat: worksheet.getCell('G3').numFmt,
    expirationDateFormat: worksheet.getCell('H3').numFmt,
    testDateRows,
    expirationDateRows,
  }, null, 2));
} finally {
  await browser.close();
}
