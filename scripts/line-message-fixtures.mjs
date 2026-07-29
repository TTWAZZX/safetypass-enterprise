import {
  createInductionPassMessage,
  createNewVendorRequestMessage,
  createSupplierOutsourceAccessNoticeMessage,
  createSupplierOutsourcePassMessage,
  createWorkPermitPassMessage,
} from '../api/_lineMessages.js';

export function createLineMessageFixtures() {
  return {
    induction: createInductionPassMessage({
      name: 'ผู้ใช้ทดสอบ', vendor: 'บริษัททดสอบ', score: 10, totalQuestions: 10,
      expiryDate: '2027-07-29T23:59:59.000Z', nationalId: '1339900567890',
    }),
    workPermit: createWorkPermitPassMessage({
      permitNo: '2026070024', name: 'ผู้ใช้ทดสอบ', vendor: 'บริษัททดสอบ', score: 10, totalQuestions: 10,
    }),
    supplierPass: createSupplierOutsourcePassMessage({
      name: 'ผู้ใช้ทดสอบ', vendor: 'บริษัททดสอบ', participantType: 'supplier', workType: 'Driver',
      score: 20, totalQuestions: 20, testDate: '2026-07-29T00:00:00.000Z',
      expiryDate: '2027-07-29T23:59:59.000Z', verificationToken: '123e4567-e89b-42d3-a456-426614174000',
    }),
    supplierAccess: createSupplierOutsourceAccessNoticeMessage({
      name: 'ผู้ใช้ทดสอบ', vendor: 'บริษัททดสอบ', participantType: 'supplier', workType: 'Driver',
      accessStartDate: '2026-07-29', accessEndDate: '2027-07-29',
    }),
    vendorRequest: createNewVendorRequestMessage({
      vendorName: 'บริษัททดสอบ Production Assurance',
      timestamp: new Date('2026-07-29T12:00:00+07:00').toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
    }),
  };
}
