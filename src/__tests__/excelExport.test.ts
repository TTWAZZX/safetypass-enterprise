import { describe, expect, it } from 'vitest';
import { createSupplierOutsourceWorkbook } from '../services/excelExport';

describe('Supplier & Outsource Excel export', () => {
  it('keeps the real ID card as text and formats dates as MM/DD/YYYY', async () => {
    const workbook = await createSupplierOutsourceWorkbook([{
      company: 'Supplier Company',
      name: 'Supplier User',
      participant_type: 'supplier',
      work_type: 'Driver',
      national_id: '0123456789012',
      test_date: '2026-08-04T09:30:00+07:00',
      expiration_date: '2027-08-04T23:59:59+07:00',
    }]);
    const worksheet = workbook.getWorksheet('Sheet1');

    expect(worksheet).toBeDefined();
    expect(worksheet!.getCell('F3').value).toBe('0123456789012');
    expect(worksheet!.getColumn(6).numFmt).toBe('@');
    expect(worksheet!.getCell('G3').value).toBeInstanceOf(Date);
    expect(worksheet!.getCell('H3').value).toBeInstanceOf(Date);
    expect(worksheet!.getColumn(7).numFmt).toBe('mm/dd/yyyy');
    expect(worksheet!.getColumn(8).numFmt).toBe('mm/dd/yyyy');
  });

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
