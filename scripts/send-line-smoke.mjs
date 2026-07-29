import fs from 'node:fs';
import { markMessageAsTest } from '../api/_lineMessages.js';
import { createLineMessageFixtures } from './line-message-fixtures.mjs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator < 1) continue;
  let value = line.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[line.slice(0, separator).trim()] = value;
}

for (const required of ['LINE_ACCESS_TOKEN', 'LINE_GROUP_ID', 'ADMIN_LINE_USER_ID']) {
  if (!env[required]) throw new Error(`${required} is required in .env.local`);
}

const fixtures = createLineMessageFixtures();
const deliveries = [
  {
    label: 'group',
    to: env.LINE_GROUP_ID,
    messages: [fixtures.induction, fixtures.workPermit, fixtures.supplierPass].map(markMessageAsTest),
  },
  {
    label: 'admin LINE OA',
    to: env.ADMIN_LINE_USER_ID,
    messages: [fixtures.vendorRequest, fixtures.supplierAccess].map(markMessageAsTest),
  },
];

for (const delivery of deliveries) {
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_ACCESS_TOKEN}` },
    body: JSON.stringify({ to: delivery.to, messages: delivery.messages }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`LINE ${delivery.label} smoke failed (${response.status}): ${responseText}`);
  console.log(`LINE ${delivery.label} smoke passed (${delivery.messages.length} [TEST] messages).`);
}
