import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const assetsDirectory = join('dist', 'assets');
const files = await readdir(assetsDirectory);
const jsFiles = files.filter((file) => file.endsWith('.js'));
const sizes = new Map();
for (const file of jsFiles) sizes.set(file, (await stat(join(assetsDirectory, file))).size);

const find = (prefix) => [...sizes.entries()].find(([file]) => file.startsWith(prefix));
const main = [...sizes.entries()].find(([file]) => /^index-[\w-]+\.js$/.test(file));
const excel = find('exceljs.min-');
const charts = find('DashboardCharts-');
const userPanel = find('UserPanel-');
const failures = [];

if (!main || main[1] > 450 * 1024) failures.push(`main bundle exceeds 450 KiB (${main?.[1] || 0} bytes)`);
if (!excel || excel[1] > 1000 * 1024) failures.push(`ExcelJS chunk is missing or exceeds 1000 KiB (${excel?.[1] || 0} bytes)`);
if (!charts || charts[1] > 430 * 1024) failures.push(`charts chunk is missing or exceeds 430 KiB (${charts?.[1] || 0} bytes)`);
if (!userPanel || userPanel[1] > 270 * 1024) failures.push(`UserPanel chunk is missing or exceeds 270 KiB (${userPanel?.[1] || 0} bytes)`);

const html = await readFile(join('dist', 'index.html'), 'utf8');
if (excel && html.includes(excel[0])) failures.push('ExcelJS must remain lazy-loaded and absent from index.html');
if (charts && html.includes(charts[0])) failures.push('Dashboard charts must remain lazy-loaded and absent from index.html');

if (failures.length > 0) {
  console.error('Bundle budget failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Bundle budget passed: main=${main[1]}B, UserPanel=${userPanel[1]}B, charts=${charts[1]}B, ExcelJS=${excel[1]}B.`);
