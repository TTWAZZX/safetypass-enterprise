import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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

if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const vendorsResult = await client.rpc('get_public_registration_vendors');
if (vendorsResult.error) throw vendorsResult.error;

const sampleName = vendorsResult.data?.[0]?.name;
if (!sampleName) throw new Error('No approved vendor available for RPC smoke test');

const matchResult = await client.rpc('find_vendor_name_matches', {
  search_name_param: `  ${sampleName}  `,
  exclude_vendor_id_param: null,
  limit_param: 5,
});
if (matchResult.error) throw matchResult.error;

const exactApprovedMatch = matchResult.data?.some((item) => (
  item.match_type === 'EXACT' && item.status === 'APPROVED'
));
if (!exactApprovedMatch) throw new Error('Exact approved vendor match was not returned');

console.log(JSON.stringify({
  publicVendorRpc: true,
  vendorMatchRpc: true,
  exactApprovedMatch: true,
  resultCount: matchResult.data.length,
}));
