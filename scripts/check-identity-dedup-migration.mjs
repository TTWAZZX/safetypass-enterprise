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
  .replace(/\s*commit\s*;\s*$/i, '');

const digest = (table, orderBy = 'id::text') => `(
  select md5(coalesce(string_agg(row_to_json(t)::text, '|' order by ${orderBy}), ''))
  from ${table} t
)`;

const snapshotSql = `
  select jsonb_build_object(
    'users_count', (select count(*) from public.users),
    'users_digest', ${digest('public.users')},
    'exam_count', (select count(*) from public.exam_history),
    'exam_digest', ${digest('public.exam_history')},
    'logs_count', (select count(*) from public.exam_logs),
    'logs_digest', ${digest('public.exam_logs')},
    'permit_count', (select count(*) from public.work_permits),
    'permit_digest', ${digest('public.work_permits')},
    'pass_count', (select count(*) from public.supplier_outsource_passes),
    'pass_digest', ${digest('public.supplier_outsource_passes')},
    'training_count', (select count(*) from public.user_training_access),
    'training_digest', ${digest('public.user_training_access', 'user_id::text, program_code')},
    'audit_count', (select count(*) from public.audit_logs),
    'audit_digest', ${digest('public.audit_logs')},
    'duplicate_groups', (
      select count(*) from (
        select 1 from public.users
        where national_id_fingerprint is not null
        group by national_id_fingerprint having count(*) > 1
      ) groups
    ),
    'duplicate_profiles', (
      with groups as (
        select national_id_fingerprint from public.users
        where national_id_fingerprint is not null
        group by national_id_fingerprint having count(*) > 1
      )
      select count(*) from public.users u join groups g using (national_id_fingerprint)
      where not exists (select 1 from auth.users au where au.id = u.id)
    )
  ) as snapshot
`;

const env = parseEnv('.env.local');
const databaseUrlOverride = process.env.IDENTITY_DEDUP_TEST_DATABASE_URL?.trim();
if (!databaseUrlOverride && !env.SUPABASE_DB_PASSWORD) {
  throw new Error('SUPABASE_DB_PASSWORD is required when IDENTITY_DEDUP_TEST_DATABASE_URL is not set');
}
const databaseUrl = databaseUrlOverride
  ? new URL(databaseUrlOverride)
  : new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
if (!databaseUrlOverride) databaseUrl.password = env.SUPABASE_DB_PASSWORD;
const isLocalDatabase = ['127.0.0.1', 'localhost'].includes(databaseUrl.hostname);

const client = new pg.Client({
  connectionString: databaseUrl.toString(),
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
  application_name: 'safetypass-identity-dedup-rollback-regression',
});
const migration = unwrapTransaction(readFileSync(
  'supabase/migrations/20260804110000_archive_duplicate_auth_profiles.sql',
  'utf8',
));
const pinMigration = unwrapTransaction(readFileSync(
  'supabase/migrations/20260804120000_progressive_pin_v2.sql',
  'utf8',
));
const pinRegression = readFileSync('supabase/tests/progressive_pin_v2_test.sql', 'utf8');

try {
  await client.connect();
  await client.query('begin');
  const initial = (await client.query(snapshotSql)).rows[0].snapshot;
  if (isLocalDatabase) {
    const localDuplicateGroups = Number((await client.query(`
      select count(*) from (
        select 1 from public.users
        where national_id_fingerprint is not null
        group by national_id_fingerprint having count(*) > 1
      ) groups
    `)).rows[0].count);
    if (localDuplicateGroups === 0) {
      await client.query(`
        insert into auth.users(
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000',
          '87777777-7777-4777-8777-777777777771',
          'authenticated', 'authenticated', '1777777777777@safetypass.com',
          'local-test-password-hash', now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now()
        );

        insert into public.users(
          id, national_id, name, role, pdpa_agreed, pdpa_agreed_at, is_active,
          national_id_hash, national_id_fingerprint
        ) values
        (
          '87777777-7777-4777-8777-777777777771', '1777777777777',
          'Local Canonical Fixture', 'USER', true, now(), true,
          encode(extensions.digest('1777777777777', 'sha256'), 'hex'),
          encode(extensions.digest('1777777777777', 'sha256'), 'hex')
        ),
        (
          '87777777-7777-4777-8777-777777777772', '1666666666666',
          'Local Duplicate Fixture', 'USER', true, now(), true,
          encode(extensions.digest('1666666666666', 'sha256'), 'hex'),
          encode(extensions.digest('1666666666666', 'sha256'), 'hex')
        );

        update public.users
        set national_id_hash = null,
            national_id_fingerprint = encode(extensions.digest('1777777777777', 'sha256'), 'hex')
        where id = '87777777-7777-4777-8777-777777777772';

        insert into public.user_training_access(user_id, program_code)
        values ('87777777-7777-4777-8777-777777777772', 'CONTRACTOR');
      `);
    }
  }
  await client.query(`
    create temporary table phase1_duplicate_canonical on commit drop as
    with groups as (
      select national_id_fingerprint from public.users
      where national_id_fingerprint is not null
      group by national_id_fingerprint having count(*) > 1
    )
    select u.id as canonical_id, split_part(lower(au.email), '@', 1) as national_id
    from public.users u
    join groups g using (national_id_fingerprint)
    join auth.users au on au.id = u.id
    where lower(au.email) ~ '^[0-9]{13}@safetypass[.]com$'
  `);
  const before = (await client.query(snapshotSql)).rows[0].snapshot;
  await client.query(migration);
  const after = (await client.query(snapshotSql)).rows[0].snapshot;

  for (const key of ['users_count', 'exam_count', 'exam_digest', 'logs_count', 'logs_digest',
    'permit_count', 'permit_digest', 'pass_count', 'pass_digest']) {
    if (String(after[key]) !== String(before[key])) {
      throw new Error(`Protected data changed unexpectedly: ${key}`);
    }
  }
  if (Number(after.duplicate_groups) !== 0) throw new Error('Duplicate fingerprint groups remain');
  if (Number(after.training_count) < Number(before.training_count)) {
    throw new Error('Training access rows were lost');
  }
  const archivedCount = Number((await client.query(`
    select count(*) from public.users
    where identity_archive_reason = 'DUPLICATE_AUTH_PROFILE'
      and identity_archived_at is not null
      and identity_merged_into_user_id is not null
      and is_active = false
      and national_id_fingerprint is null
      and national_id_hash is null
      and national_id_cipher is null
  `)).rows[0].count);
  if (archivedCount !== Number(before.duplicate_profiles)) {
    throw new Error(`Expected ${before.duplicate_profiles} archived profiles, found ${archivedCount}`);
  }
  const uniqueIndex = (await client.query(`
    select to_regclass('public.users_national_id_fingerprint_unique')::text as name
  `)).rows[0].name;
  if (!uniqueIndex) throw new Error('Unique fingerprint index was not created');

  await client.query(pinMigration);
  await client.query(pinRegression);
  const incorrectCanonicalLogins = Number((await client.query(`
    select count(*)
    from phase1_duplicate_canonical expected
    cross join lateral public.get_auth_login_context(expected.national_id) context
    where (context->>'user_id')::uuid is distinct from expected.canonical_id
  `)).rows[0].count);
  if (incorrectCanonicalLogins !== 0) {
    throw new Error('PIN-v2 login context did not select the Auth-linked canonical profile');
  }

  await client.query('rollback');
  const afterRollback = (await client.query(snapshotSql)).rows[0].snapshot;
  const archiveColumnAfterRollback = (await client.query(`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
        and column_name = 'identity_archived_at'
    ) as present
  `)).rows[0].present;
  if (JSON.stringify(initial) !== JSON.stringify(afterRollback) || archiveColumnAfterRollback) {
    throw new Error('Rollback did not restore the exact pre-migration schema/data snapshot');
  }
  console.log(JSON.stringify({
    result: 'PASS_ROLLED_BACK',
    duplicateGroupsExercised: Number(before.duplicate_groups),
    duplicateProfilesExercised: Number(before.duplicate_profiles),
    protectedHistoryPreserved: true,
    pinV2ChainExercised: true,
  }));
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
