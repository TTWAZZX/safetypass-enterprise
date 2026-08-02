import { readFileSync } from 'node:fs';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

const allowedTests = new Set([
  'supabase/tests/staged_registration_flow_test.sql',
  'supabase/tests/external_registration_submission_test.sql',
  'supabase/tests/external_registration_admin_workflow_test.sql',
  'supabase/tests/external_registration_followup_test.sql',
]);
const testPath = process.argv[2]?.replaceAll('\\', '/');
if (!allowedTests.has(testPath)) throw new Error('Remote database test path is not allowed');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, ''),
      ];
    }),
);

if (!env.SUPABASE_DB_PASSWORD || /YOUR-PASSWORD|PLACEHOLDER|\[|\]/i.test(env.SUPABASE_DB_PASSWORD)) {
  const supabaseCommand = process.platform === 'win32' ? 'supabase.exe' : 'supabase';
  await execFileAsync(supabaseCommand, ['db', 'query', '--linked', '--file', testPath], {
    cwd: process.cwd(),
    maxBuffer: 4 * 1024 * 1024,
  });
  console.log('Remote registration database regression passed via linked Supabase CLI (transaction rolled back).');
  process.exit(0);
}

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-registration-regression',
});

try {
  await client.connect();
  await client.query(readFileSync(testPath, 'utf8'));
  console.log('Remote registration database regression passed (transaction rolled back).');
} finally {
  await client.end().catch(() => undefined);
}
