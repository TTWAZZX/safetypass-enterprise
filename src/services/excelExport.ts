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
