import { describe, expect, it } from 'vitest';
import { createSupplierOutsourceWorkbook, reportNationalIdNumbers } from '../services/excelExport';

describe('Supplier & Outsource Excel export', () => {
  it('rejects masked and fabricated zero-filled IDs before creating either type of workbook', () => {
    expect(() => reportNationalIdNumbers(['123••••••0123', '0000000000000'])).toThrow('พบ 2 รายการ');
  });

  it('preserves leading zeros from a complete ID stored by the system', async () => {
    const workbook = await createSupplierOutsourceWorkbook([{
      company: 'Supplier Company',
      name: 'Supplier User',
      participant_type: 'supplier',
      work_type: 'Driver',
      national_id: '0123456789012',
      test_date: null,
      expiration_date: null,
    }]);
    const cell = workbook.getWorksheet('Sheet1')!.getCell('F3');
    expect(cell.value).toBe(123456789012);
    expect(cell.numFmt).toBe('0000000000000');
  }, 15_000);

  it('exports date cells in DD/MM/YYYY format', async () => {
    const workbook = await createSupplierOutsourceWorkbook([{
      company: 'Supplier Company',
      name: 'Supplier User',
      participant_type: 'supplier',
      work_type: 'Driver',
      national_id: '1234567890123',
      test_date: '2026-08-04T09:30:00+07:00',
      expiration_date: '2027-08-04T23:59:59+07:00',
    }]);
    const worksheet = workbook.getWorksheet('Sheet1');

    expect(worksheet).toBeDefined();
    expect(worksheet!.getCell('F3').value).toBe(1234567890123);
    expect(worksheet!.getCell('F3').numFmt).toBe('0');
    expect(worksheet!.getCell('G3').value).toBeInstanceOf(Date);
    expect(worksheet!.getCell('H3').value).toBeInstanceOf(Date);
    expect(worksheet!.getCell('G3').numFmt).toBe('dd/mm/yyyy');
    expect(worksheet!.getCell('H3').numFmt).toBe('dd/mm/yyyy');
    expect(worksheet!.getCell('A1').alignment).toEqual({ horizontal: 'center' });
    expect(worksheet!.getRow(2).font).toMatchObject({ name: 'Calibri', size: 11, bold: true });
  }, 15_000);

  it('refuses to create a misleading export when an ID card is missing', async () => {
    await expect(createSupplierOutsourceWorkbook([{
      company: 'Supplier Company',
      name: 'Incomplete User',
      participant_type: 'supplier',
      work_type: 'Driver',
      national_id: 'PROTECTED',
      test_date: null,
      expiration_date: null,
    }])).rejects.toThrow('ไม่มีเลขบัตรประชาชนจริง 13 หลัก');
  });
});
