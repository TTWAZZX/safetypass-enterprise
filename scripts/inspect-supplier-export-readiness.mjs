import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')];
    }),
);

const poolerUrl = new URL(readFileSync('supabase/.temp/pooler-url', 'utf8').trim());
poolerUrl.password = env.SUPABASE_DB_PASSWORD;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { rejectUnauthorized: false },
  application_name: 'safetypass-supplier-export-inspection',
});

try {
  await client.connect();
  const result = await client.query(`
    select
      count(*)::integer as total_rows,
      count(*) filter (where u.national_id ~ '^[0-9]{13}$')::integer as plain_id_rows,
      count(*) filter (
        where u.national_id !~ '^[0-9]{13}$'
          and au.email ~ '^[0-9]{13}@safetypass[.]com$'
      )::integer as auth_email_id_rows,
      count(*) filter (
        where u.national_id !~ '^[0-9]{13}$'
          and (au.email is null or au.email !~ '^[0-9]{13}@safetypass[.]com$')
      )::integer as missing_export_id_rows
    from public.user_training_access access_row
    join public.users u on u.id = access_row.user_id
    left join auth.users au on au.id = u.id
    where access_row.program_code = 'SUPPLIER_OUTSOURCE'
  `);
  console.log(JSON.stringify(result.rows[0], null, 2));
} finally {
  await client.end().catch(() => undefined);
}
