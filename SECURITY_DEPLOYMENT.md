# Security deployment checklist

The notification endpoints now require a valid Supabase access token and verify an active work permit before notifying LINE.

Before deployment, configure these Vercel environment variables:

- `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL` / legacy `VITE_SUPABASE_URL`)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_PUBLISHABLE_KEY` / legacy anon-key names)
- `LINE_ACCESS_TOKEN`
- `LINE_GROUP_ID`
- `ADMIN_LINE_USER_ID`

Keep Row Level Security enabled in Supabase. A signed-in user must be allowed to read only their own `work_permits` record; administrators require separate explicit policies. Do not disable RLS to work around an authorization error.

Database schema changes are managed through the versioned SQL files in `supabase/migrations`.
