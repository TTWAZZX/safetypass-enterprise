import { createLineMessageFixtures } from './line-message-fixtures.mjs';

const messages = Object.entries(createLineMessageFixtures());
const forbiddenText = new RegExp([
  '\\uFFFD',
  '\\?{4,}',
  '\\u00E0\\u00B8',
  '\\u00E0\\u00B9',
  '\\u00E2\\u20AC',
  '\\u00F0\\u0178',
].join('|'), 'u');

function visit(node, path) {
  if (typeof node === 'string') {
    if (forbiddenText.test(node)) throw new Error(`${path} contains corrupted text`);
    return;
  }
  if (Array.isArray(node)) return node.forEach((item, index) => visit(item, `${path}[${index}]`));
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) visit(value, `${path}.${key}`);
  }
}

for (const [name, message] of messages) {
  if (message.type !== 'flex' || !message.altText || message.altText.length > 400) {
    throw new Error(`${name} is not a valid LINE Flex message`);
  }
  if (message.contents?.type !== 'bubble') throw new Error(`${name} must use a bubble container`);
  visit(message, name);
}

console.log(`Offline LINE validation passed (${messages.length} message flows).`);
