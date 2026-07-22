# Security deployment checklist

The notification endpoints now require a valid Supabase access token and verify an active work permit before notifying LINE.

Before deployment, configure these Vercel environment variables:

- `SUPABASE_URL` (or the existing `VITE_SUPABASE_URL`)
- `SUPABASE_ANON_KEY` (or the existing `VITE_SUPABASE_ANON_KEY`)
- `LINE_ACCESS_TOKEN`
- `LINE_GROUP_ID`
- `ADMIN_LINE_USER_ID`

Keep Row Level Security enabled in Supabase. A signed-in user must be allowed to read only their own `work_permits` record; administrators require separate explicit policies. Do not disable RLS to work around an authorization error.

`schema.prisma` in this repository is not a usable schema file. Recover the original database migration or export the current Supabase schema before making database-policy changes.
