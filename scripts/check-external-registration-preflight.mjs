import { existsSync, readFileSync } from 'node:fs';

const envPath = '.env.local';
const requiredFiles = [
  'supabase/migrations/20260802190000_external_registration_foundation.sql',
  'supabase/migrations/20260802193000_external_registration_email_admin.sql',
  'supabase/migrations/20260802200000_external_registration_submission.sql',
  'supabase/migrations/20260802210000_external_registration_admin_workflow.sql',
  'supabase/tests/external_registration_submission_test.sql',
  'supabase/tests/external_registration_admin_workflow_test.sql',
];

const rawEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const env = Object.fromEntries(rawEnv.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));

const missingFiles = requiredFiles.filter((file) => !existsSync(file));
const requiredEnv = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'GMAIL_APP_PASSWORD', 'MAIN_SYSTEM_LOGIN_URL'];
const missingEnv = requiredEnv.filter((key) => !env[key] || /YOUR-|PLACEHOLDER|CHANGE-ME/i.test(env[key]));
const featureValue = String(env.EXTERNAL_REGISTRATION_ENABLED || '').toLowerCase();
const senderSource = readFileSync('api/_externalRegistrationEmail.js', 'utf8');
const senderConfigured = senderSource.includes("EXTERNAL_REGISTRATION_SENDER = 'safetytsh@gmail.com'");
const brandConfigured = senderSource.includes("EXTERNAL_REGISTRATION_BRAND = 'TSH CTR GatePass'");

console.log('External Registration Phase 5 preflight');
console.log(`- migration/test files: ${missingFiles.length === 0 ? 'ready' : `missing ${missingFiles.join(', ')}`}`);
console.log(`- frontend Supabase + Gmail env: ${missingEnv.length === 0 ? 'configured' : `missing ${missingEnv.join(', ')}`}`);
console.log(`- sender: ${senderConfigured ? 'safetytsh@gmail.com' : 'not verified'}`);
console.log(`- email display name: ${brandConfigured ? 'TSH CTR GatePass' : 'not verified'}`);
console.log(`- main system login button URL: ${env.MAIN_SYSTEM_LOGIN_URL || 'not set'}`);
console.log(`- feature flag: ${featureValue === 'false' ? 'false (safe/closed)' : featureValue || 'not set'}`);
console.log(`- remote DB password: ${env.SUPABASE_DB_PASSWORD ? 'configured' : 'not configured (DB test cannot run yet)'}`);

if (missingFiles.length > 0 || missingEnv.length > 0 || !senderConfigured || !brandConfigured) process.exitCode = 1;
