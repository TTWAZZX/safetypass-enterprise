import { readFileSync } from 'node:fs';
import pg from 'pg';

const parseEnv = (path) => Object.fromEntries(readFileSync(path, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')];
  }));
const unwrap = (sql) => sql
  .replace(/^\s*begin\s*;\s*/i, '')
  .replace(/\s*(?:commit|rollback)\s*;\s*$/i, '');

const env = parseEnv('.env.local');
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');
const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-external-status-actions-regression',
});

try {
  await client.connect();
  await client.query('begin');
  await client.query(unwrap(readFileSync(
    'supabase/migrations/20260818190000_sanitize_legacy_audit_actor_labels.sql', 'utf8',
  )));
  await client.query(unwrap(readFileSync(
    'supabase/tests/external_registration_status_actions_test.sql', 'utf8',
  )));
  await client.query('rollback');
  console.log('External Registration status actions passed (transaction rolled back).');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
