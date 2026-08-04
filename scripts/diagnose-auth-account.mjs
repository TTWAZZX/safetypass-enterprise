import { readFileSync } from 'node:fs';
import process from 'node:process';
import pg from 'pg';

const nationalId = process.argv[2] || '';
if (!/^[0-9]{13}$/.test(nationalId)) {
  throw new Error('Usage: node scripts/diagnose-auth-account.mjs <13-digit-national-id>');
}

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

if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-auth-diagnosis',
});

try {
  await client.connect();
  const result = await client.query(`
    select
      u.pdpa_agreed,
      u.is_active,
      (a.id is not null) as auth_exists,
      (a.id = u.id) as ids_match,
      (a.email_confirmed_at is not null) as email_confirmed,
      (nullif(a.encrypted_password, '') is not null) as has_password,
      a.raw_user_meta_data->>'password_scheme' as password_scheme,
      a.last_sign_in_at
    from public.users u
    left join auth.users a
      on lower(a.email) = lower($1 || '@safetypass.com')
    where u.national_id_fingerprint = encode(extensions.digest($1, 'sha256'), 'hex')
    order by u.created_at desc
    limit 1
  `, [nationalId]);

  const references = await client.query(`
    select
      child_ns.nspname as schema_name,
      child.relname as table_name,
      child_col.attname as column_name,
      constraint_row.confdeltype as on_delete
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class parent on parent.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
    join pg_catalog.pg_class child on child.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
    join lateral unnest(constraint_row.conkey) with ordinality child_key(attnum, position) on true
    join lateral unnest(constraint_row.confkey) with ordinality parent_key(attnum, position)
      on parent_key.position = child_key.position
    join pg_catalog.pg_attribute child_col
      on child_col.attrelid = child.oid and child_col.attnum = child_key.attnum
    join pg_catalog.pg_attribute parent_col
      on parent_col.attrelid = parent.oid and parent_col.attnum = parent_key.attnum
    where constraint_row.contype = 'f'
      and parent_ns.nspname = 'public'
      and parent.relname = 'users'
      and parent_col.attname = 'id'
    order by child_ns.nspname, child.relname, child_col.attname
  `);

  const row = result.rows[0];
  console.log(JSON.stringify(row ? {
    profileExists: true,
    pdpaAgreed: row.pdpa_agreed,
    active: row.is_active,
    authExists: row.auth_exists,
    profileMatchesAuth: row.ids_match,
    emailConfirmed: row.email_confirmed,
    hasPassword: row.has_password,
    passwordScheme: row.password_scheme,
    hasSignedInBefore: row.last_sign_in_at !== null,
    profileReferences: references.rows,
  } : { profileExists: false }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
