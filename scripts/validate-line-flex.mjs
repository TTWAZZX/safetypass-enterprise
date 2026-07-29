import fs from 'node:fs';
import { createLineMessageFixtures } from './line-message-fixtures.mjs';

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

const messages = Object.values(createLineMessageFixtures());

const response = await fetch('https://api.line.me/v2/bot/message/validate/push', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.LINE_ACCESS_TOKEN}`,
  },
  body: JSON.stringify({ messages }),
});

const responseText = await response.text();
if (!response.ok) {
  throw new Error(`LINE payload validation failed (${response.status}): ${responseText}`);
}

console.log(`LINE payload validation passed (${response.status}, ${messages.length} flows). No message was sent.`);
