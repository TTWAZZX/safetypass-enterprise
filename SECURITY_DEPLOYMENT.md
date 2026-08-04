# Security deployment checklist

The notification endpoints now require a valid Supabase access token and verify an active work permit before notifying LINE.

Before deployment, configure these Vercel environment variables:

- `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL` / legacy `VITE_SUPABASE_URL`)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_PUBLISHABLE_KEY` / legacy anon-key names)
- `LINE_ACCESS_TOKEN`
- `LINE_GROUP_ID`
- `ADMIN_LINE_USER_ID`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; never prefix with `VITE_` or `NEXT_PUBLIC_`)
- `AUTH_PIN_PEPPER` (server-only random secret, at least 32 characters)
- `AUTH_PIN_V2_ENFORCEMENT` (`false` for initial smoke checks; explicitly switch to `true` only at approved rollout)

## Phase 1 authentication rollout

The authentication migration is intentionally additive and forward-only. It creates `public.user_auth_security`, backfills one compatibility row per existing user, and does not update or replace existing user IDs, profiles, exam history, permits, or audit records.

Required pre-deployment gate:

1. Back up the database and keep the current production deployment available for rollback.
2. Store `SUPABASE_SERVICE_ROLE_KEY`, a newly generated `AUTH_PIN_PEPPER`, and `AUTH_PIN_V2_ENFORCEMENT=false` in every Vercel environment that will run the authentication APIs.
3. Back up `AUTH_PIN_PEPPER` in the approved secret manager. Changing or losing it invalidates PIN v2 credentials and requires an account recovery procedure.
4. Run `npm test`, `npx tsc --noEmit`, `npm run check:text`, `npm run build`, `npm run check:bundle`, `npm run test:a11y`, and `npm run test:e2e`.
5. Run `npm run test:db:pin-v2`. This applies the pending migration and regression SQL inside a PostgreSQL transaction, verifies existing user/history digests, and rolls the entire transaction back.
6. Apply `supabase/migrations/20260804120000_progressive_pin_v2.sql` once through the controlled migration process.
7. Verify the migration record and row count before deploying application code.
8. Deploy with `AUTH_PIN_V2_ENFORCEMENT=false`, run smoke tests, then enable enforcement only after explicit Go approval.

After any account has migrated to PIN v2, do not roll the whole application back to a pre-PIN-v2 build. That build cannot authenticate migrated accounts. Use `AUTH_PIN_V2_ENFORCEMENT=false` to pause new legacy migrations while keeping the PIN-v2-compatible release running, then ship a forward fix or enter maintenance mode.

Do not deploy the Phase 1 application code if any gate fails or either server-only secret is missing. Do not rotate `AUTH_PIN_PEPPER` during routine deployments.

Keep Row Level Security enabled in Supabase. A signed-in user must be allowed to read only their own `work_permits` record; administrators require separate explicit policies. Do not disable RLS to work around an authorization error.

Database schema changes are managed through the versioned SQL files in `supabase/migrations`.
