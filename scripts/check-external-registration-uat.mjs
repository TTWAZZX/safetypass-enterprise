import { readFile } from 'node:fs/promises';
import {
  renderExternalRegistrationAdminNotice,
  renderExternalRegistrationApplicantNotice,
  renderExternalRegistrationTestEmail,
} from '../api/_externalRegistrationEmail.js';

const productionUrl = 'https://safetypass-enterprise.vercel.app/external-registration';
const invalidEncodingPattern = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/u;

const checks = [];
const pass = (name) => checks.push({ name, ok: true });
const fail = (name, reason) => checks.push({ name, ok: false, reason });

const assert = (condition, name, reason) => {
  if (condition) pass(name);
  else fail(name, reason);
};

const source = async (file) => readFile(file, 'utf8');

const messages = [
  renderExternalRegistrationTestEmail('ผู้ทดสอบ'),
  renderExternalRegistrationAdminNotice({
    requestNo: 'EXT-2026-UAT-ADMIN',
    companyName: 'บริษัททดสอบ UAT จำกัด',
    applicantName: 'ผู้สมัคร ทดสอบ',
    types: 'Supplier, Outsource',
    email: 'tawun666956666956@gmail.com',
    phone: '0800000000',
    coordinators: 'ผู้ประสานงาน TSH',
  }),
  renderExternalRegistrationApplicantNotice({
    status: 'APPROVED',
    requestNo: 'EXT-2026-UAT-APPROVED',
    companyName: 'บริษัททดสอบ UAT จำกัด',
    applicantName: 'ผู้สมัคร ทดสอบ',
    types: 'Contractor',
    email: 'tawun666956666956@gmail.com',
    note: 'ผลการตรวจสอบจาก Admin',
  }),
  renderExternalRegistrationApplicantNotice({
    status: 'REJECTED',
    requestNo: 'EXT-2026-UAT-REJECTED',
    companyName: 'บริษัททดสอบ UAT จำกัด',
    applicantName: 'ผู้สมัคร ทดสอบ',
    types: 'Supplier',
    email: 'tawun666956666956@gmail.com',
    note: 'กรุณาแก้ไขข้อมูลบริษัท',
  }),
];

for (const [index, message] of messages.entries()) {
  assert(!invalidEncodingPattern.test(`${message.subject}\n${message.text}\n${message.html}`), `Email template ${index + 1} UTF-8`, 'พบอักขระเสียหาย');
  assert(message.html.includes('<meta charset="UTF-8">'), `Email template ${index + 1} charset`, 'ไม่มี UTF-8 metadata');
  assert(message.html.includes('https://safetypass-enterprise.vercel.app'), `Email template ${index + 1} main login button`, 'ไม่มี URL ระบบหลัก');
}

const submissionHandler = await source('api/send-external-registration-submission.js');
const resultHandler = await source('api/send-external-registration-result.js');
const publicPage = await source('src/components/ExternalRegistrationPage.tsx');
const adminPage = await source('src/components/ExternalRegistrationAdmin.tsx');

assert(submissionHandler.includes("req.method !== 'POST'") && submissionHandler.includes('isRateLimited'), 'Submission API safety contract', 'ต้องรับเฉพาะ POST และมี rate limit');
assert(submissionHandler.includes('record_external_registration_email_result'), 'Submission email outbox contract', 'ไม่มีการบันทึกผลส่ง Email');
assert(resultHandler.includes('requireAdminUser') && resultHandler.includes('isRateLimited'), 'Admin result API safety contract', 'ไม่มี admin guard หรือ rate limit');
assert(resultHandler.includes('admin_record_external_registration_email_result'), 'Admin retry outbox contract', 'ไม่มีการบันทึกผล retry Email');
assert(publicPage.includes('get_external_registration_feature_flag') && publicPage.includes('ไม่ใช้ OTP'), 'Applicant no-OTP contract', 'หน้า Applicant ไม่ตรงกับข้อกำหนด no OTP');
assert(publicPage.includes('Supplier E-Pass') && publicPage.includes('Contractor Online'), 'Target system mapping contract', 'mapping ระบบปลายทางไม่ครบ');
assert(adminPage.includes('สร้างบริษัทใหม่') && adminPage.includes('ส่ง Email ผลลัพธ์ซ้ำ'), 'Admin UAT contract', 'Admin workflow ไม่ครบ');
assert(adminPage.includes('role="dialog"') && adminPage.includes('รายละเอียดคำขอ'), 'Admin drawer UX contract', 'ไม่พบ Drawer รายละเอียดคำขอ');
assert(adminPage.includes('ConfirmationDialog') && adminPage.includes('ยืนยันอนุมัติและส่ง Email'), 'Admin confirmation UX contract', 'ไม่พบหน้าต่างยืนยันก่อนดำเนินการ');
assert(adminPage.includes('คลิกเพื่อเปิดรายละเอียดและดำเนินการ') && adminPage.includes('ไม่อนุมัติคำขอ'), 'Admin action clarity contract', 'คำแนะนำหรือปุ่มภาษาไทยไม่ครบ');

try {
  const response = await fetch(productionUrl, { headers: { 'cache-control': 'no-cache' } });
  const html = await response.text();
  assert(response.ok, 'Production route HTTP', `HTTP ${response.status}`);
  assert(html.includes('<meta charset="UTF-8"'), 'Production document UTF-8', 'ไม่พบ UTF-8 charset');
  assert(!invalidEncodingPattern.test(html), 'Production document encoding', 'พบอักขระเสียหายใน HTML ที่ deploy');
} catch (error) {
  fail('Production route reachable', error?.message || 'ไม่สามารถเชื่อมต่อ Production');
}

console.log('External Registration Phase 6 UAT read-only checks');
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} - ${check.name}${check.ok ? '' : `: ${check.reason}`}`);

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) process.exit(1);
console.log('Phase 6 UAT read-only checks passed.');
