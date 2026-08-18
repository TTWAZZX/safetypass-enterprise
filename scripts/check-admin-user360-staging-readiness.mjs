import { readFileSync, readdirSync } from 'node:fs';
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

const requiredRelations = [
  'users', 'vendors', 'questions', 'exam_history', 'work_permits', 'audit_logs',
  'user_training_access', 'supplier_outsource_passes', 'system_config', 'user_auth_security',
];
const phaseVersions = ['20260818103000', '20260818120000', '20260818143000'];
const localVersions = readdirSync('supabase/migrations')
  .map((name) => name.match(/^(\d{14})_/))
  .filter(Boolean)
  .map((match) => match[1])
  .sort();

const env = parseEnv('.env.local');
const stagingRef = env.SUPABASE_STAGING_PROJECT_REF;
const productionRef = env.SUPABASE_PROJECT_REF;
const stagingPassword = env.SUPABASE_STAGING_DB_PASSWORD;
if (!stagingRef || !productionRef || stagingRef === productionRef) {
  throw new Error('Staging project ref is missing or points to production');
}
if (!stagingPassword) throw new Error('SUPABASE_STAGING_DB_PASSWORD is required');

const url = new URL(`postgresql://postgres.${stagingRef}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`);
url.password = stagingPassword;
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-admin-user360-staging-readiness-read-only',
});

const result = {
  generatedAt: new Date().toISOString(),
  mode: 'READ_ONLY_NO_DEPLOY_NO_MIGRATION',
  productionRefIsDifferent: true,
  requiredRelations: {},
  migrationHistory: {},
  schemaInventory: {},
  featureFlag: null,
  authIntegration: {
    localServiceRoleConfigured: Boolean(env.SUPABASE_STAGING_SERVICE_ROLE_KEY),
    localPinPepperConfigured: Boolean(env.AUTH_PIN_STAGING_PEPPER && env.AUTH_PIN_STAGING_PEPPER.length >= 32),
  },
  blockers: [],
};

try {
  await client.connect();
  await client.query('begin read only');

  for (const relation of requiredRelations) {
    result.requiredRelations[relation] = Boolean((await client.query(
      'select to_regclass($1)::text as relation', [`public.${relation}`],
    )).rows[0].relation);
  }

  const historyPresent = Boolean((await client.query(
    "select to_regclass('supabase_migrations.schema_migrations')::text as relation",
  )).rows[0].relation);
  const appliedVersions = historyPresent
    ? (await client.query('select version from supabase_migrations.schema_migrations order by version')).rows.map((row) => row.version)
    : [];
  result.migrationHistory = {
    present: historyPresent,
    appliedCount: appliedVersions.length,
    latestApplied: appliedVersions.at(-1) || null,
    phaseVersions: Object.fromEntries(phaseVersions.map((version) => [version, appliedVersions.includes(version)])),
    localVersionsMissingFromStaging: localVersions.filter((version) => !appliedVersions.includes(version)),
  };

  const schemaRows = (await client.query(`
    select schemaname, count(*)::integer as relation_count
    from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema')
    group by schemaname
    order by schemaname
  `)).rows;
  result.schemaInventory = {
    relationCounts: Object.fromEntries(schemaRows.map((row) => [row.schemaname, row.relation_count])),
    publicRelationNames: (await client.query(`
      select tablename from pg_tables where schemaname = 'public' order by tablename
    `)).rows.map((row) => row.tablename),
    authUsersWithoutSafetyPassProfiles: result.requiredRelations.users
      ? Number((await client.query(`
          select count(*) from auth.users a
          left join public.users u on u.id = a.id
          where u.id is null
        `)).rows[0].count)
      : Number((await client.query('select count(*) from auth.users')).rows[0].count),
  };

  if (result.requiredRelations.system_config) {
    result.featureFlag = (await client.query(
      "select value from public.system_config where key = 'ADMIN_USER360_ENABLED' limit 1",
    )).rows[0]?.value ?? null;
  }

  const missingRelations = Object.entries(result.requiredRelations)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  if (missingRelations.length > 0) {
    result.blockers.push(`Staging baseline is incomplete; missing public relations: ${missingRelations.join(', ')}`);
  }
  if (!historyPresent) result.blockers.push('Supabase migration history is missing');
  if (!result.requiredRelations.users) {
    result.blockers.push('Do not apply the Phase 0/1 migrations individually: their baseline public.users dependency is absent');
  }
  if (result.featureFlag !== null && result.featureFlag !== 'false') {
    result.blockers.push('ADMIN_USER360_ENABLED must remain false during staging bootstrap');
  }
  if (!result.authIntegration.localServiceRoleConfigured) {
    result.blockers.push('SUPABASE_STAGING_SERVICE_ROLE_KEY is not configured for Auth saga validation');
  }
  if (!result.authIntegration.localPinPepperConfigured) {
    result.blockers.push('AUTH_PIN_STAGING_PEPPER is not configured for Auth saga validation');
  }

  await client.query('rollback');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  result.blockers.push(`Staging readiness query failed: ${error.message}`);
} finally {
  await client.end().catch(() => undefined);
}

result.overall = result.blockers.length === 0 ? 'GO_FOR_CONTROLLED_STAGING_APPLY' : 'NO_GO';
console.log(JSON.stringify(result, null, 2));
if (result.overall !== 'GO_FOR_CONTROLLED_STAGING_APPLY') process.exitCode = 1;
