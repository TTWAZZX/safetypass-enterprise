import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import pg from 'pg';

const BOUNDARY = '20260804180000';
const BASELINE_PATH = resolve('supabase/baselines/20260804180000_public_schema.sql');
const MANIFEST_PATH = resolve('supabase/baselines/20260804180000_manifest.json');
const DEFAULT_ADMIN_URL = 'postgresql://supabase_admin:postgres@127.0.0.1:55435/postgres';
const adminUrl = new URL(process.env.STAGING_BOOTSTRAP_TEST_DATABASE_URL || DEFAULT_ADMIN_URL);
const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);

if (!allowedHosts.has(adminUrl.hostname)) {
  throw new Error('Safety guard: staging bootstrap validation accepts only a local disposable PostgreSQL host');
}
if (adminUrl.pathname !== '/postgres') {
  throw new Error('Safety guard: STAGING_BOOTSTRAP_TEST_DATABASE_URL must target the local postgres maintenance database');
}

const databaseName = `safetypass_staging_bootstrap_${process.pid}`;
if (!/^safetypass_staging_bootstrap_[0-9]+$/.test(databaseName)) throw new Error('Unsafe disposable database name');
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const unwrapTransaction = (sql) => sql.replace(/^\s*begin\s*;?/i, '').replace(/\s*commit\s*;?\s*$/i, '');

const migrations = (await readdir(resolve('supabase/migrations')))
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort();
const historical = migrations.filter((name) => name.slice(0, 14) <= BOUNDARY);
const forward = migrations.filter((name) => name.slice(0, 14) > BOUNDARY);
const expectedForward = [
  '20260809104500_admin_pin_reset.sql',
  '20260811183000_recover_staged_bootstrap_identity.sql',
  '20260811193000_harden_registration_completion.sql',
  '20260817103000_admin_user_role_management.sql',
  '20260818103000_admin_training_access_guards.sql',
  '20260818120000_admin_user360_foundation.sql',
  '20260818143000_admin_identity_privileged_workflow.sql',
];
assert(JSON.stringify(forward) === JSON.stringify(expectedForward), `Unexpected migrations after baseline boundary: ${forward.join(', ')}`);

const baseline = await readFile(BASELINE_PATH, 'utf8');
const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const baselineSha256 = createHash('sha256').update(baseline).digest('hex');
assert(manifest.boundaryVersion === BOUNDARY, 'Baseline manifest boundary does not match the runner');
assert(manifest.sha256 === baselineSha256, 'Baseline SHA-256 does not match its manifest');
assert(!/^-- Data for Name:/m.test(baseline) && !/^COPY public\..+ FROM stdin;/m.test(baseline), 'Schema baseline must not contain table data');
assert(!/\b[0-9]{13}\b/.test(baseline), 'Schema baseline contains a possible full national ID');
assert(!/(postgres(?:ql)?:\/\/|service[_-]?role[_-]?key|begin private key)/i.test(baseline), 'Schema baseline contains a possible secret');
assert(!/^\\/m.test(baseline), 'Schema baseline contains psql-only meta commands');

const setupSql = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create extension if not exists pgcrypto with schema extensions;
  create extension if not exists pg_trgm with schema extensions;
  create extension if not exists "uuid-ossp" with schema extensions;
  create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
  $$;
  create table auth.users (
    instance_id uuid,
    id uuid primary key,
    aud text,
    role text,
    email text,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    created_at timestamptz,
    updated_at timestamptz
  );
  create schema if not exists supabase_migrations;
  create table supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
  );
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

const tests = [
  'supabase/tests/admin_pin_reset_test.sql',
  'supabase/tests/staged_registration_flow_test.sql',
  'supabase/tests/admin_user_role_management_test.sql',
  'supabase/tests/admin_training_access_guards_test.sql',
  'supabase/tests/admin_user360_foundation_test.sql',
  'supabase/tests/admin_identity_privileged_workflow_test.sql',
];

const admin = new pg.Client({ connectionString: adminUrl.toString(), application_name: 'safetypass-staging-bootstrap-admin' });
let client;
try {
  await admin.connect();
  await admin.query(`create database ${quoteIdentifier(databaseName)}`);
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  client = new pg.Client({ connectionString: databaseUrl.toString(), application_name: 'safetypass-staging-bootstrap-validation' });
  await client.connect();
  await client.query(setupSql);
  const preexisting = await client.query("select count(*)::integer as count from information_schema.tables where table_schema='public' and table_name in ('users','vendors','questions')");
  assert(preexisting.rows[0].count === 0, 'Bootstrap target is not empty');
  await client.query(baseline);
  await client.query('set row_security = on; set check_function_bodies = on; set search_path = "$user", public, extensions;');

  for (const name of historical) {
    const version = name.slice(0, 14);
    const migrationName = basename(name, '.sql').slice(15);
    await client.query('insert into supabase_migrations.schema_migrations(version, statements, name) values ($1, $2, $3)', [version, [], migrationName]);
  }
  for (const name of forward) {
    const sql = await readFile(resolve('supabase/migrations', name), 'utf8');
    await client.query(unwrapTransaction(sql));
    await client.query('insert into supabase_migrations.schema_migrations(version, statements, name) values ($1, $2, $3)', [name.slice(0, 14), [sql], basename(name, '.sql').slice(15)]);
  }

  for (const path of tests) {
    try {
      await client.query('begin');
      await client.query(await readFile(resolve(path), 'utf8'));
      await client.query('rollback');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw new Error(`Staging bootstrap regression failed in ${path}: ${error.message}`, { cause: error });
    }
  }

  const state = await client.query(`select
    (select count(*)::integer from supabase_migrations.schema_migrations) as migration_count,
    (select max(version) from supabase_migrations.schema_migrations) as latest_version,
    (select value from public.system_config where key = 'ADMIN_USER360_ENABLED') as feature_flag,
    (select count(*)::integer from public.users u where u.is_active and not exists (
      select 1 from public.user_training_access a where a.user_id = u.id
    )) as active_without_program`);
  const result = state.rows[0];
  assert(result.migration_count === migrations.length, 'Migration ledger count does not match repository');
  assert(result.latest_version === forward.at(-1).slice(0, 14), 'Latest migration does not match repository');
  assert(result.feature_flag === 'false', 'ADMIN_USER360_ENABLED must remain false after bootstrap');
  assert(result.active_without_program === 0, 'Bootstrap left an active user without a Training Program');

  console.log(JSON.stringify({
    status: 'PASS_DISPOSABLE_STAGING_BOOTSTRAP',
    productionChanged: false,
    remoteStagingChanged: false,
    boundary: BOUNDARY,
    baselineSha256,
    historicalVersions: historical.length,
    forwardMigrations: forward,
    regressionTests: tests,
    featureFlag: result.feature_flag,
  }, null, 2));
} finally {
  if (client) await client.end().catch(() => undefined);
  if (admin._connected) {
    await admin.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}
