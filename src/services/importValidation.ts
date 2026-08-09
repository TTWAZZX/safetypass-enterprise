import { processExcelDate } from '../utils/excelDates';

export type ImportIssueLevel = 'warning' | 'error';

export interface ImportIssue {
  level: ImportIssueLevel;
  message: string;
}

export interface PreparedUserImportRow {
  rowNumber: number;
  name: string;
  nationalId: string;
  vendorName: string;
  vendorId: string | null;
  role: string;
  age: number | null;
  nationality: string;
  inductionExpiry: string | null;
  issues: ImportIssue[];
}

export interface PreparedVendorImportRow {
  rowNumber: number;
  name: string;
  issues: ImportIssue[];
}

const normalizeNationalId = (value: unknown) => {
  let nationalId = String(value ?? '').trim();
  if (/[eE]\+/.test(nationalId)) nationalId = Number(nationalId).toLocaleString('fullwide', { useGrouping: false });
  return nationalId;
};

export const prepareUserImportRows = (
  rows: Record<string, unknown>[],
  vendors: Array<{ id: string; name: string }>,
): PreparedUserImportRow[] => rows.map((row, index) => {
  const name = String(row['Name'] || row['Full Name'] || '').trim();
  const nationalId = normalizeNationalId(row['National ID'] || row['ID Card']);
  const vendorName = String(row['Vendor'] || row['Company'] || '').trim();
  const vendor = vendors.find((item) => item.name.toLocaleLowerCase() === vendorName.toLocaleLowerCase());
  const rawExpiry = row['Induction Expiry'] || row['Expiry Date'];
  const inductionExpiry = processExcelDate(rawExpiry);
  const issues: ImportIssue[] = [];

  if (!name) issues.push({ level: 'error', message: 'ไม่พบชื่อ-นามสกุล' });
  if (!nationalId) issues.push({ level: 'error', message: 'ไม่พบเลขบัตรหรือ Passport' });
  if (vendorName && !vendor) issues.push({ level: 'warning', message: `ไม่พบบริษัท “${vendorName}” ระบบจะบันทึกเป็นไม่ระบุสังกัด` });
  if (rawExpiry && !inductionExpiry) issues.push({ level: 'warning', message: 'รูปแบบวันหมดอายุไม่ถูกต้อง ระบบจะไม่บันทึกวันที่นี้' });

  return {
    rowNumber: index + 2,
    name,
    nationalId,
    vendorName,
    vendorId: vendor?.id || null,
    role: String(row['Role'] || 'USER').trim(),
    age: row['Age'] ? Number(row['Age']) || null : null,
    nationality: String(row['Nationality'] || 'ไทย (Thai)').trim(),
    inductionExpiry,
    issues,
  };
});

export const prepareVendorImportRows = (rows: Record<string, unknown>[]): PreparedVendorImportRow[] => {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const name = String(row['Company Name'] || row['Vendor'] || row['Name'] || '').trim();
    const key = name.toLocaleLowerCase().replace(/\s+/g, '');
    const issues: ImportIssue[] = [];
    if (!name) issues.push({ level: 'error', message: 'ไม่พบชื่อบริษัท' });
    if (key && seen.has(key)) issues.push({ level: 'warning', message: 'ชื่อซ้ำภายในไฟล์ ระบบจะตรวจซ้ำอีกครั้งตอนบันทึก' });
    if (key) seen.add(key);
    return { rowNumber: index + 2, name, issues };
  });
};

export const getImportSummary = (rows: Array<{ issues: ImportIssue[] }>) => ({
  total: rows.length,
  ready: rows.filter((row) => !row.issues.some((issue) => issue.level === 'error')).length,
  warning: rows.filter((row) => row.issues.some((issue) => issue.level === 'warning') && !row.issues.some((issue) => issue.level === 'error')).length,
  error: rows.filter((row) => row.issues.some((issue) => issue.level === 'error')).length,
});

