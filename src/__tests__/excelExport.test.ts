import { describe, expect, it } from 'vitest';
import { createSupplierOutsourceWorkbook } from '../services/excelExport';

describe('Supplier & Outsource Excel export', () => {
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
