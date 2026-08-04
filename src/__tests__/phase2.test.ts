import { describe, expect, it } from 'vitest';
import {
  createSupplierOutsourceAccessNoticeMessage,
  createSupplierOutsourcePassMessage,
} from '../../api/_lineMessages.js';
import { createSupplierOutsourceWorkbook, sanitizeExcelText } from '../services/excelExport';

describe('Supplier & Outsource Phase 2', () => {
  it('creates a LINE Flex message with supported URI buttons and Thai UTF-8 text', () => {
    const message = createSupplierOutsourcePassMessage({
      name: 'ผู้ใช้ทดสอบ',
      vendor: 'บริษัท ทดสอบ จำกัด',
      participantType: 'supplier',
      workType: 'Driver',
      score: 20,
      totalQuestions: 20,
      testDate: '2026-07-26T00:00:00.000Z',
      expiryDate: '2027-07-26T23:59:59.000Z',
      verificationToken: '123e4567-e89b-42d3-a456-426614174000',
    });
    const payload = JSON.stringify(message);
    expect(message.type).toBe('flex');
    expect(payload).toContain('Supplier & Outsource');
    expect(payload).toContain('ผู้ใช้ทดสอบ');
    expect(payload).toContain('/verify?supplier=123e4567-e89b-42d3-a456-426614174000');
    expect(payload).toContain('ดูบัตร Supplier & Outsource');
    expect(payload).toContain('เข้าสู่ระบบ / Login');
    expect(message.altText.length).toBeLessThanOrEqual(400);
    expect(payload).toContain('https://safetypass-enterprise.vercel.app');
    expect(payload).not.toMatch(/\?{3,}/);
    expect(payload).not.toContain('\uFFFD');
  });

  it('creates an informational LINE notice without an approval action', () => {
    const message = createSupplierOutsourceAccessNoticeMessage({
      name: 'ผู้ใช้ทดสอบ', vendor: 'บริษัท ทดสอบ จำกัด', participantType: 'outsource',
      workType: 'Trainee', accessStartDate: '2026-07-26', accessEndDate: '2027-07-26',
    });
    const payload = JSON.stringify(message);
    expect(payload).toContain('เพิ่มสิทธิ์แล้ว');
    expect(payload).toContain('ไม่ต้องอนุมัติ');
    expect(payload).toContain('เข้าสู่ระบบ / Login');
    expect(payload).not.toContain('อนุมัติสิทธิ์');
    expect(payload).not.toMatch(/\?{3,}/);
    expect(payload).not.toContain('\uFFFD');
  });

  it('prevents spreadsheet formulas while preserving ordinary values', () => {
    expect(sanitizeExcelText('=HYPERLINK("https://example.com")')).toBe('\'=HYPERLINK("https://example.com")');
    expect(sanitizeExcelText('+SUM(1,2)')).toBe("'+SUM(1,2)");
    expect(sanitizeExcelText('บริษัท ทดสอบ จำกัด')).toBe('บริษัท ทดสอบ จำกัด');
  });

  it('creates the Supplier Epass workbook with the sample column order', async () => {
    const workbook = await createSupplierOutsourceWorkbook([{
      company: 'บริษัท ทดสอบ จำกัด', name: 'ผู้ใช้ทดสอบ', participant_type: 'supplier',
      work_type: 'Driver', national_id: '1000000000001',
      test_date: '2026-07-26T00:00:00.000Z', expiration_date: '2027-07-26T00:00:00.000Z',
    }]);
    const sheet = workbook.getWorksheet('Sheet1');
    expect(sheet?.getRow(1).getCell(1).value).toBe(' Supplier Epass | Check Member');
    expect(sheet?.getRow(2).values).toEqual([
      undefined, 'No.', 'Company', 'Name', 'Type', 'Work Type', 'ID card', 'Test Date', 'Expiration Date',
    ]);
    expect(sheet?.getRow(3).getCell(6).value).toBe(1000000000001);
    expect(sheet?.getRow(3).getCell(6).numFmt).toBe('0');
    expect(sheet?.getRow(3).getCell(7).numFmt).toBe('mm-dd-yy');
    expect(sheet?.getRow(3).getCell(8).numFmt).toBe('mm-dd-yy');
    expect(sheet?.model.merges).toContain('A1:H1');
    expect(Array.from({ length: 8 }, (_, index) => sheet?.getColumn(index + 1).width)).toEqual([
      6, 54, 54, 12.15, 12.15, 17.55, 13.5, 20.25,
    ]);

    const serialized = await workbook.xlsx.writeBuffer();
    const { default: ExcelJS } = await import('exceljs');
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(serialized);
    const restoredSheet = restored.getWorksheet('Sheet1');
    expect(restoredSheet?.getRow(3).getCell(6).value).toBe(1000000000001);
    expect(restoredSheet?.getRow(3).getCell(6).numFmt).toBe('0');
    expect(restoredSheet?.getRow(3).getCell(7).value).toBeInstanceOf(Date);
    expect(restoredSheet?.getRow(3).getCell(7).numFmt).toBe('mm-dd-yy');
    expect(restoredSheet?.getRow(3).getCell(8).value).toBeInstanceOf(Date);
    expect(restoredSheet?.getRow(3).getCell(8).numFmt).toBe('mm-dd-yy');
  }, 15_000);
});
