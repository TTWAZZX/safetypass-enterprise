import fs from 'node:fs';
import {
  createSupplierOutsourceAccessNoticeMessage,
  createSupplierOutsourcePassMessage,
} from '../api/_lineMessages.js';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator < 1) continue;
  let value = line.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[line.slice(0, separator).trim()] = value;
}

if (!env.LINE_ACCESS_TOKEN) {
  throw new Error('LINE_ACCESS_TOKEN is required in .env.local');
}

const passMessage = createSupplierOutsourcePassMessage({
  name: 'ผู้ใช้ทดสอบ',
  vendor: 'บริษัททดสอบ',
  participantType: 'supplier',
  workType: 'Driver',
  score: 20,
  totalQuestions: 20,
  testDate: '2026-07-26T00:00:00.000Z',
  expiryDate: '2027-07-26T23:59:59.000Z',
  verificationToken: '123e4567-e89b-42d3-a456-426614174000',
});
const accessNotice = createSupplierOutsourceAccessNoticeMessage({
  name: 'ผู้ใช้ทดสอบ',
  vendor: 'บริษัททดสอบ',
  participantType: 'supplier',
  workType: 'Driver',
  accessStartDate: '2026-07-26',
  accessEndDate: '2027-07-26',
});

const response = await fetch('https://api.line.me/v2/bot/message/validate/push', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.LINE_ACCESS_TOKEN}`,
  },
  body: JSON.stringify({ messages: [passMessage, accessNotice] }),
});

const responseText = await response.text();
if (!response.ok) {
  throw new Error(`LINE payload validation failed (${response.status}): ${responseText}`);
}

console.log(`LINE payload validation passed (${response.status}). No message was sent.`);
