import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx']);
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules']);
const violations = [];

async function scanDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await scanDirectory(join(directory, entry.name));
      continue;
    }

    const file = join(directory, entry.name);
    if (!textExtensions.has(extname(file))) continue;

    const text = await readFile(file, 'utf8');
    const badCharacter = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.exec(text);
    if (badCharacter) {
      const line = text.slice(0, badCharacter.index).split('\n').length;
      violations.push(`${file}:${line} contains an invalid or replacement character`);
    }
  }
}

await scanDirectory('.');

if (violations.length > 0) {
  console.error('Text encoding check failed:');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Text encoding check passed.');
