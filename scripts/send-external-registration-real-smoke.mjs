import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import {
  EXTERNAL_REGISTRATION_SENDER,
  EXTERNAL_REGISTRATION_BRAND,
  renderExternalRegistrationAdminNotice,
  renderExternalRegistrationApplicantNotice,
} from '../api/_externalRegistrationEmail.js';

if (!process.argv.includes('--confirm')) {
  throw new Error('Real email smoke test requires --confirm');
}

const envText = readFileSync('.env.local', 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const separator = trimmed.indexOf('=');
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!process.env[key]) process.env[key] = value;
}

const password = (process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD || '').replace(/\s/g, '');
if (!password) throw new Error('GMAIL_APP_PASSWORD is not configured');

const testData = {
  requestNo: 'EXT-2026-TEST001',
  companyName: 'Phase 5 QA Test Company Co., Ltd.',
  applicantName: 'ผู้สมัครทดสอบ Phase 5',
  applicantNameEnglish: 'Phase Five Tester',
  jobTitle: 'QA Tester',
  types: 'CONTRACTOR, SUPPLIER',
  email: 'tawun666956666956@gmail.com',
  phone: '0800000000',
  coordinators: 'TSH QA Coordinator',
};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EXTERNAL_REGISTRATION_SENDER, pass: password },
});

const adminMessage = renderExternalRegistrationAdminNotice(testData);
const applicantMessage = renderExternalRegistrationApplicantNotice({
  ...testData,
  status: 'SUBMITTED',
  note: 'นี่คือ Email ทดสอบ Phase 5 เท่านั้น ยังไม่มีการสร้างคำขอจริงในฐานข้อมูล',
});

for (const [recipient, message] of [
  ['sattaya_w@thaisummit-harness.co.th', adminMessage],
  ['tawun666956666956@gmail.com', applicantMessage],
]) {
  const result = await transporter.sendMail({
    from: `${EXTERNAL_REGISTRATION_BRAND} <${EXTERNAL_REGISTRATION_SENDER}>`,
    to: recipient,
    subject: `[Phase 5 TEST] ${message.subject}`,
    text: `[Phase 5 TEST]\n\n${message.text}`,
    html: message.html,
  });
  console.log(`Real test email sent to ${recipient} (${result.messageId})`);
}
