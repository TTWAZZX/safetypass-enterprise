const MAX_EXCEL_FILE_SIZE = 10 * 1024 * 1024;

const getCellValue = (cell: { value: unknown; text: string }): unknown => {
  const value = cell.value;
  if (value instanceof Date || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value && typeof value === 'object' && 'result' in value) {
    return (value as { result?: unknown }).result ?? cell.text;
  }
  return cell.text;
};

export async function readFirstWorksheetRows(file: File): Promise<Record<string, unknown>[]> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('Only .xlsx files are supported');
  }
  if (file.size > MAX_EXCEL_FILE_SIZE) {
    throw new Error('Excel file is larger than 10 MB');
  }

  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headerRow = worksheet.getRow(1);
  const headers = headerRow.values as Array<string | undefined>;
  const rows: Record<string, unknown>[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = headers[columnNumber];
      if (!header) return;
      record[String(header)] = getCellValue(cell);
      hasValue = true;
    });
    if (hasValue) rows.push(record);
  });

  return rows;
}
