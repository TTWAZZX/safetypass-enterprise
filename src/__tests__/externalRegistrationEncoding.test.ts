import { describe, expect, it } from 'vitest';
import {
  renderExternalRegistrationAdminNotice,
  renderExternalRegistrationApplicantNotice,
  renderExternalRegistrationTestEmail,
} from '../../api/_externalRegistrationEmail.js';

const hasInvalidEncoding = (value: string) => /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/u.test(value);

describe('External Registration Thai email encoding', () => {
  it('keeps all rendered email fields as valid UTF-8 text', () => {
    const messages = [
      renderExternalRegistrationTestEmail('ผู้ทดสอบ'),
      renderExternalRegistrationAdminNotice({
        requestNo: 'EXT-2026-000001',
        companyName: 'บริษัท ทดสอบ จำกัด',
        applicantName: 'ผู้สมัคร ทดสอบ',
        types: 'Supplier, Outsource',
        email: 'test@example.com',
        phone: '0812345678',
        coordinators: 'คุณผู้ประสานงาน TSH',
      }),
      renderExternalRegistrationApplicantNotice({
        status: 'APPROVED',
        requestNo: 'EXT-2026-000001',
        companyName: 'บริษัท ทดสอบ จำกัด',
        applicantName: 'ผู้สมัคร ทดสอบ',
        types: 'Supplier',
        email: 'test@example.com',
        note: 'ตรวจสอบข้อมูลเรียบร้อยแล้ว',
        trackingUrl: 'https://safetypass-enterprise.vercel.app/external-registration/status?request=EXT-2026-000001&token=test-token',
      }),
    ];

    for (const message of messages) {
      expect(hasInvalidEncoding(message.subject)).toBe(false);
      expect(hasInvalidEncoding(message.text)).toBe(false);
      expect(hasInvalidEncoding(message.html)).toBe(false);
      expect(message.html).toContain('<meta charset="UTF-8">');
      expect(message.html).toContain('charset=UTF-8');
    }

    expect(messages[2].html).toContain('ติดตามสถานะคำขอ');
    expect(messages[2].html).toContain('เข้าสู่ระบบหลัก TSH CTR GatePass');
    expect(messages[2].html).toContain('/external-registration/status');
  });
});
