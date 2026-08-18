export async function downloadWorkbook(
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | Date | null | undefined>>,
  fileName: string,
  columnWidths?: number[],
  columnFormats?: Record<number, string>,
) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(row));

  worksheet.getRow(1).font = { bold: true };
  columnWidths?.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
  if (columnFormats) {
    Object.entries(columnFormats).forEach(([columnNumber, format]) => {
      worksheet.getColumn(Number(columnNumber)).numFmt = format;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const sanitizeExcelText = (value: unknown): string => {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

export type SupplierOutsourceExcelRow = {
  company: string;
  name: string;
  participant_type: string;
  work_type: string;
  national_id: string | null;
  test_date: string | null;
  expiration_date: string | null;
};

const supplierExportNationalId = (value: string | null): number | null => {
  const nationalId = String(value || '').trim();
  return /^[1-9]\d{12}$/.test(nationalId) ? Number(nationalId) : null;
};

const supplierExportDate = (value: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

export async function createSupplierOutsourceWorkbook(rows: SupplierOutsourceExcelRow[]) {
  const missingNationalIds = rows.filter((row) => !supplierExportNationalId(row.national_id)).length;
  if (missingNationalIds > 0) {
    throw new Error(`พบ ${missingNationalIds} รายการที่ไม่มีเลขบัตรประชาชนจริง 13 หลัก กรุณาตรวจสอบข้อมูลก่อน Export`);
  }

  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  worksheet.mergeCells('A1:H1');
  worksheet.getCell('A1').value = ' Supplier Epass | Check Member';
  worksheet.getCell('A1').alignment = { horizontal: 'center' };
  worksheet.getCell('A1').font = { name: 'Calibri', size: 11 };
  worksheet.addRow(['No.', 'Company', 'Name', 'Type', 'Work Type', 'ID card', 'Test Date', 'Expiration Date']);
  worksheet.getRow(2).font = { name: 'Calibri', size: 11, bold: true };
  rows.forEach((row, index) => {
    const excelRow = worksheet.addRow([
      index + 1,
      sanitizeExcelText(row.company),
      sanitizeExcelText(row.name),
      sanitizeExcelText(row.participant_type),
      sanitizeExcelText(row.work_type),
      supplierExportNationalId(row.national_id),
      supplierExportDate(row.test_date),
      supplierExportDate(row.expiration_date),
    ]);
    excelRow.getCell(1).numFmt = '0';
    excelRow.getCell(6).numFmt = '0';
    excelRow.getCell(7).numFmt = 'dd/mm/yyyy';
    excelRow.getCell(8).numFmt = 'dd/mm/yyyy';
  });
  [6, 54, 54, 12.15, 12.15, 17.55, 13.5, 20.25].forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
  return workbook;
}

export async function downloadSupplierOutsourceWorkbook(rows: SupplierOutsourceExcelRow[]) {
  const workbook = await createSupplierOutsourceWorkbook(rows);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Supplier Epass  Check Member.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
