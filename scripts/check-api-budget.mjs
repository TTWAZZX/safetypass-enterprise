import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const API_DIRECTORY = 'api';
const API_LIMIT = 12;

const files = (await readdir(API_DIRECTORY))
  .filter((file) => file.endsWith('.js'))
  .sort();

const endpoints = files.filter((file) => !file.startsWith('_'));
const helpers = files.filter((file) => file.startsWith('_'));

if (endpoints.length > API_LIMIT) {
  console.error(`API budget failed: ${endpoints.length}/${API_LIMIT} deployable endpoints.`);
  endpoints.forEach((file) => console.error(`- ${join(API_DIRECTORY, file)}`));
  process.exit(1);
}

console.log(`API budget passed: ${endpoints.length}/${API_LIMIT} deployable endpoints (${helpers.length} private helpers excluded).`);

