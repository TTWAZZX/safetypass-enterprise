import { readFileSync } from 'node:fs';
import pg from 'pg';

const parseEnv = (path) => Object.fromEntries(
  readFileSync(path, 'utf8')
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

const unwrapTransaction = (sql) => sql
  .replace(/^\s*begin\s*;\s*/i, '')
  .replace(/\s*commit\s*;\s*$/i, '')
  .replace(/\s*rollback\s*;\s*$/i, '');

const env = parseEnv('.env.local');
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-auth-repair-regression',
});

const migration = unwrapTransaction(readFileSync(
  'supabase/migrations/20260804093000_repair_orphaned_auth_accounts.sql',
  'utf8',
));
const regression = unwrapTransaction(readFileSync(
  'supabase/tests/auth_orphan_repair_test.sql',
  'utf8',
));

try {
  await client.connect();
  await client.query('begin');
  await client.query(migration);
  await client.query(regression);
  await client.query('rollback');
  console.log('Auth orphan repair migration regression passed (transaction rolled back).');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
