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

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const env = parseEnv('.env.local');
if (!env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required');

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-duplicate-identity-read-only-audit',
});

try {
  await client.connect();
  await client.query('begin read only');

  const groupSummary = (await client.query(`
    with duplicate_groups as (
      select national_id_fingerprint
      from public.users
      where national_id_fingerprint is not null
      group by national_id_fingerprint
      having count(*) > 1
    ), numbered_groups as (
      select national_id_fingerprint,
             row_number() over (order by national_id_fingerprint) as group_number
      from duplicate_groups
    )
    select
      ng.group_number,
      count(*)::integer as profile_count,
      count(*) filter (where au.id is not null)::integer as auth_linked_count,
      count(*) filter (where u.is_active)::integer as active_count,
      count(distinct u.vendor_id)::integer as distinct_vendor_count,
      count(distinct u.role)::integer as distinct_role_count
    from numbered_groups ng
    join public.users u using (national_id_fingerprint)
    left join auth.users au on au.id = u.id
    group by ng.group_number
    order by ng.group_number
  `)).rows;

  const references = (await client.query(`
    select
      ns.nspname as schema_name,
      cls.relname as table_name,
      att.attname as column_name,
      con.conname as constraint_name,
      case con.confdeltype
        when 'a' then 'NO ACTION'
        when 'r' then 'RESTRICT'
        when 'c' then 'CASCADE'
        when 'n' then 'SET NULL'
        when 'd' then 'SET DEFAULT'
      end as on_delete
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    join unnest(con.conkey) with ordinality as key(attnum, ordinality) on true
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = key.attnum
    where con.contype = 'f'
      and con.confrelid = 'public.users'::regclass
    order by ns.nspname, cls.relname, att.attname
  `)).rows;

  const dependencyCounts = [];
  for (const reference of references) {
    const table = `${quoteIdentifier(reference.schema_name)}.${quoteIdentifier(reference.table_name)}`;
    const column = quoteIdentifier(reference.column_name);
    const counts = (await client.query(`
      with duplicate_groups as (
        select national_id_fingerprint
        from public.users
        where national_id_fingerprint is not null
        group by national_id_fingerprint
        having count(*) > 1
      ), duplicate_members as (
        select u.id, (au.id is not null) as auth_linked
        from public.users u
        join duplicate_groups dg using (national_id_fingerprint)
        left join auth.users au on au.id = u.id
      )
      select
        count(*) filter (where dm.auth_linked)::integer as canonical_rows,
        count(*) filter (where not dm.auth_linked)::integer as duplicate_rows
      from ${table} dependency
      join duplicate_members dm on dm.id = dependency.${column}
    `)).rows[0];
    dependencyCounts.push({ ...reference, ...counts });
  }

  console.log(JSON.stringify({
    mode: 'READ_ONLY_REDACTED',
    duplicateGroupCount: groupSummary.length,
    groups: groupSummary,
    userForeignKeys: dependencyCounts,
  }, null, 2));
  await client.query('rollback');
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
