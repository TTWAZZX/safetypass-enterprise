import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import pg from 'pg';

const targetVersions = ['20260804110000', '20260804120000'];
const expectedPreviousVersion = '20260804093000';
const migrationPaths = [
  'supabase/migrations/20260804110000_archive_duplicate_auth_profiles.sql',
  'supabase/migrations/20260804120000_progressive_pin_v2.sql',
];
const hostedEvidencePath = 'docs/phase1-vercel-production-env-evidence.json';
const backupEvidencePath = 'docs/phase1-backup-restore-evidence.json';

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

const commandExists = (name) => (process.env.PATH || '')
  .split(delimiter)
  .filter(Boolean)
  .some((directory) => existsSync(join(directory, process.platform === 'win32' ? `${name}.exe` : name)));

const env = parseEnv('.env.local');
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-phase1-rollout-readiness',
});

const targetMigrations = migrationPaths.map((path, index) => ({
  version: targetVersions[index],
  path,
  sha256: createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex'),
}));
const hostedEvidence = existsSync(hostedEvidencePath)
  ? JSON.parse(readFileSync(hostedEvidencePath, 'utf8'))
  : null;
const requiredHostedVariables = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'AUTH_PIN_PEPPER',
  'AUTH_PIN_V2_ENFORCEMENT',
];
const hostedEvidenceValid = Boolean(
  hostedEvidence
  && hostedEvidence.valuesCaptured === false
  && requiredHostedVariables.every((name) => (
    Array.isArray(hostedEvidence.variables?.[name])
    && hostedEvidence.variables[name].includes('Production')
  )),
);
const backupEvidence = existsSync(backupEvidencePath)
  ? JSON.parse(readFileSync(backupEvidencePath, 'utf8'))
  : null;
const backupEvidenceValid = Boolean(
  backupEvidence
  && backupEvidence.storageEncryption?.directoryEncryptedAttributeVerified === true
  && backupEvidence.storageEncryption?.everyBackupFileEncryptedAttributeVerified === true
  && Array.isArray(backupEvidence.files)
  && backupEvidence.files.length === 3
  && backupEvidence.files.every((file) => file.bytes > 0 && /^[A-F0-9]{64}$/.test(file.sha256))
  && backupEvidence.restore?.roles === 'PASS'
  && backupEvidence.restore?.schema === 'PASS'
  && backupEvidence.restore?.data === 'PASS'
  && backupEvidence.restore?.unexpectedMismatches === 0
  && backupEvidence.restore?.migrationChain === 'PASS_ROLLED_BACK'
  && backupEvidence.productionChanged === false
  && backupEvidence.deploymentTriggered === false
);
const localMigrationVersions = readdirSync('supabase/migrations')
  .map((name) => name.match(/^(\d{14})_/))
  .filter(Boolean)
  .map((match) => match[1])
  .sort();

const result = {
  generatedAt: new Date().toISOString(),
  mode: 'READ_ONLY_NO_DEPLOY',
  targetMigrations,
  secrets: {
    hostedEnvironment: hostedEvidenceValid
      ? `VERIFIED_NAME_AND_SCOPE_ONLY_AT_${hostedEvidence.verifiedAt}`
      : 'UNVERIFIED_REQUIRES_VERCEL_DASHBOARD_EVIDENCE',
    localServiceRolePresent: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    localPinPepperPresent: Boolean(env.AUTH_PIN_PEPPER && env.AUTH_PIN_PEPPER.length >= 32),
    localEnforcementConfigured: ['true', 'false'].includes(env.AUTH_PIN_V2_ENFORCEMENT),
  },
  backup: {
    pgDumpAvailable: commandExists('pg_dump'),
    pgRestoreAvailable: commandExists('pg_restore'),
    dockerAvailable: commandExists('docker'),
    pinnedSupabaseCliAvailable: existsSync(join('node_modules', '.bin', 'supabase.cmd')),
    encryptedBackupEvidence: backupEvidenceValid
      ? `VERIFIED_AT_${backupEvidence.createdAt}`
      : 'UNVERIFIED_REQUIRES_BACKUP_RECORD',
    restoreDrillEvidence: backupEvidenceValid
      ? `VERIFIED_AT_${backupEvidence.restoreVerifiedAt}`
      : 'UNVERIFIED_REQUIRES_RESTORE_TEST_RECORD',
  },
  database: {},
  blockers: [],
};

try {
  await client.connect();
  await client.query('begin read only');

  const appliedRows = (await client.query(`
    select version, name
    from supabase_migrations.schema_migrations
    order by version
  `)).rows;
  const appliedVersions = appliedRows.map((row) => row.version);
  const latest = appliedRows.at(-1) || null;
  const pendingLocalVersions = localMigrationVersions.filter((version) => !appliedVersions.includes(version));

  const inventory = (await client.query(`
    select jsonb_build_object(
      'database_size_bytes', pg_database_size(current_database()),
      'server_version', current_setting('server_version'),
      'users', (select count(*) from public.users),
      'auth_users', (select count(*) from auth.users),
      'exam_history', (select count(*) from public.exam_history),
      'work_permits', (select count(*) from public.work_permits),
      'vendors', (select count(*) from public.vendors),
      'questions', (select count(*) from public.questions),
      'missing_fingerprints', (select count(*) from public.users where national_id_fingerprint is null and is_active = true),
      'duplicate_fingerprints', (
        select count(*) from (
          select national_id_fingerprint from public.users
          where national_id_fingerprint is not null
          group by national_id_fingerprint having count(*) > 1
        ) duplicate_groups
      ),
      'user_id_digest', (select md5(coalesce(string_agg(id::text, '|' order by id::text), '')) from public.users),
      'exam_link_digest', (select md5(coalesce(string_agg(id::text || ':' || user_id::text, '|' order by id::text), '')) from public.exam_history),
      'permit_link_digest', (select md5(coalesce(string_agg(id::text || ':' || user_id::text, '|' order by id::text), '')) from public.work_permits)
    ) as inventory
  `)).rows[0].inventory;

  const rls = (await client.query(`
    select c.relname as table_name, c.relrowsecurity as enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any($1::text[])
    order by c.relname
  `, [['users', 'exam_history', 'work_permits', 'vendors', 'questions']])).rows;

  const targetRelation = (await client.query(
    "select to_regclass('public.user_auth_security')::text as name",
  )).rows[0].name;
  const archiveColumnPresent = (await client.query(`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
        and column_name = 'identity_archived_at'
    ) as present
  `)).rows[0].present;
  const duplicateSummary = (await client.query(`
    with duplicate_groups as (
      select national_id_fingerprint
      from public.users
      where national_id_fingerprint is not null
      group by national_id_fingerprint
      having count(*) > 1
    ), profile_rows as (
      select
        u.national_id_fingerprint,
        u.is_active,
        u.pdpa_agreed,
        (a.id is not null) as auth_linked,
        row_number() over (
          partition by u.national_id_fingerprint
          order by coalesce(u.pdpa_agreed, false) desc, u.created_at desc
        ) as login_context_rank,
        (select count(*) from public.exam_history e where e.user_id = u.id) as exam_count,
        (select count(*) from public.work_permits w where w.user_id = u.id) as permit_count
      from public.users u
      join duplicate_groups d using (national_id_fingerprint)
      left join auth.users a on a.id = u.id
    ), summarized as (
      select
        national_id_fingerprint,
        count(*) as row_count,
        count(*) filter (where is_active = true) as active_count,
        count(*) filter (where pdpa_agreed = true) as registered_count,
        count(*) filter (where auth_linked) as auth_linked_count,
        bool_or(auth_linked and login_context_rank = 1) as selected_profile_auth_linked,
        sum(exam_count) as exam_count,
        sum(exam_count) filter (where auth_linked) as auth_linked_exam_count,
        sum(permit_count) as permit_count,
        sum(permit_count) filter (where auth_linked) as auth_linked_permit_count
      from profile_rows
      group by national_id_fingerprint
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'row_count', row_count,
      'active_count', active_count,
      'registered_count', registered_count,
      'auth_linked_count', auth_linked_count,
      'selected_profile_auth_linked', selected_profile_auth_linked,
      'exam_count', exam_count,
      'auth_linked_exam_count', auth_linked_exam_count,
      'permit_count', permit_count,
      'auth_linked_permit_count', auth_linked_permit_count
    ) order by row_count desc), '[]'::jsonb) as summary
    from summarized
  `)).rows[0].summary;
  const blockedLocks = Number((await client.query(`
    select count(*) as count from pg_locks where granted = false
  `)).rows[0].count);

  result.database = {
    latestAppliedMigration: latest,
    targetAlreadyApplied: targetVersions.some((version) => appliedVersions.includes(version)),
    pendingLocalVersions,
    targetRelationPresent: Boolean(targetRelation),
    archiveColumnPresent,
    blockedLocks,
    rls,
    inventory,
    duplicateSummary,
  };

  if (latest?.version !== expectedPreviousVersion) {
    result.blockers.push(`Expected previous migration ${expectedPreviousVersion}, found ${latest?.version || 'none'}`);
  }
  if (targetVersions.some((version) => appliedVersions.includes(version)) || targetRelation || archiveColumnPresent) {
    result.blockers.push('A Phase 1 migration or target schema object is already present; investigate before rollout');
  }
  if (JSON.stringify(pendingLocalVersions) !== JSON.stringify(targetVersions)) {
    result.blockers.push(`Unexpected pending migration set: ${pendingLocalVersions.join(', ') || 'none'}`);
  }
  if (rls.length !== 5 || rls.some((row) => row.enabled !== true)) {
    result.blockers.push('RLS is missing or disabled on one or more critical tables');
  }
  if (blockedLocks > 0) result.blockers.push(`Database currently has ${blockedLocks} waiting lock(s)`);
  if (duplicateSummary.some((group) => Number(group.auth_linked_count) !== 1
    || Number(group.exam_count) !== Number(group.auth_linked_exam_count || 0)
    || Number(group.permit_count) !== Number(group.auth_linked_permit_count || 0))) {
    result.blockers.push('At least one duplicate identity group is unsafe for the reviewed archive migration');
  }

  await client.query('rollback');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  result.blockers.push(`Database readiness query failed: ${error.message}`);
} finally {
  await client.end().catch(() => undefined);
}

if (!(result.backup.pgDumpAvailable && result.backup.pgRestoreAvailable)
  && !(result.backup.dockerAvailable && result.backup.pinnedSupabaseCliAvailable)) {
  result.blockers.push('Neither native PostgreSQL backup tools nor Supabase CLI with Docker are available');
}
if (!hostedEvidenceValid) {
  result.blockers.push('Hosted secret names and scopes have not been verified in Vercel');
}
if (!backupEvidenceValid) {
  result.blockers.push('A restorable pre-rollout backup and restore-drill evidence have not been supplied');
}
result.overall = result.blockers.length === 0 ? 'GO' : 'NO_GO';

console.log(JSON.stringify(result, null, 2));
if (result.overall !== 'GO') process.exitCode = 1;
