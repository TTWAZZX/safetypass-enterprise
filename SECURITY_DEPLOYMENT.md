# Security deployment checklist

## Administrator, account activation, exams and pass links

Run `npm run test:db:staging-bootstrap` against disposable local PostgreSQL
before applying the four `20261123` migrations to staging. Apply the schema
before deploying the app build that reads the new verification token columns.

- Check that an existing administrator can manage users, approve applications,
  view reports and reset a PIN. Confirm a regular user can edit their profile,
  resume a saved exam and complete a training program they are assigned to.
- Keep `REGISTRATION_INVITATION_REQUIRED` at its default `false` for the first
  smoke test. In staging, turn it on, issue an invitation from Vendors & Users
  and verify first login with the invitation and last six national ID digits.
  With the requirement enabled, legacy PIN accounts must upgrade before
  using admin controls or exams.
  Use a verified channel to deliver activation codes. Test valid and expired
  resets, legacy PIN upgrade, and recovery of staged or orphaned accounts
  before enabling the invitation requirement in production. Setting the
  requirement back to `false` pauses the new activation requirement.
- Check the QR codes and LINE links for Induction and Work Permit, including
  previously printed cards. New links contain verification tokens. Old links
  continue to resolve for existing cards during reissue. Review the status of
  old cards before retiring the legacy lookup endpoints.
- Normal admin reports show masked national IDs. Verify that an authorized
  identity reveal or export still requires the existing PIN recheck and a
  recorded reason.

## Verified LINE, shared rate limits and email retries

Apply both `2026112310` migrations before releasing the API code. Test with
Node.js 22, a staging LINE Login channel, and non-production mail accounts.

- Set `LINE_LOGIN_CHANNEL_ID` to the LINE Login channel associated with the
  configured LIFF app. Test opening the sync action and sending a direct
  notification. Existing linked accounts can continue receiving messages
  while users re-sync. Enable `LINE_VERIFIED_LINK_REQUIRED=true` after affected
  users have re-synced to restrict direct messages to verified accounts.
- Set `SHARED_RATE_LIMIT_ENABLED=true` in staging and test login, account
  activation, PIN changes and notifications. With no shared limiter setting,
  the API uses a bounded instance-local limiter. If the shared database
  limiter is unavailable, protected requests are rate limited until it returns.
- Set server-only `CRON_SECRET` in Vercel to enable the scheduled worker. Its
  configured daily start is 07:00 ICT, and normal submit and approve actions
  still attempt to send immediately. Retries use a database lease and stop
  after five attempts. An SMTP acknowledgement followed by a database or
  process failure may still result in a duplicate. Before production, test
  retries and the scheduler endpoint using a staging mailbox.

The notification endpoints now require a valid Supabase access token and verify an active work permit before notifying LINE.

## Browser response headers

`vercel.json` is the source of truth for browser security headers. It enforces a
Content Security Policy and sends MIME-sniffing, clickjacking, referrer,
permissions, and HTTPS-transport protections on every route.

The application currently does not use camera, microphone, geolocation, payment,
or USB browser permissions; those capabilities remain disabled with
`Permissions-Policy`. If a future feature needs one, update the policy and add a
corresponding security review and test in the same change.

LINE LIFF requires only these CSP exceptions:

- `https://static.line-scdn.net` in `script-src`
- `https://api.line.me` in `connect-src`
- `https://liffsdk.line-scdn.net` in `connect-src`
- `https://profile.line-scdn.net` in `img-src`

Do not replace the allowlists with wildcards or weaken the remaining CSP directives.

LINE profile sync is optional. The LIFF SDK is initialized only after a user
chooses to sync their profile picture, and only on the configured production
LIFF endpoint (`https://safetypass-enterprise.vercel.app`). Vercel Preview and
local URLs do not initiate LIFF, because LINE rejects redirect URLs outside
that endpoint.

## Browser session privacy

The Supabase Auth session is stored in `sessionStorage`, never `localStorage`.
This prevents the synthetic login email (which includes the national ID) and
access tokens from remaining on a device after the browser tab is closed. A
new tab requires signing in again; a reload within the same tab keeps the
session and reloads the profile only after validation. On first load, the app
also removes the legacy Supabase and `safety_pass_current_user` localStorage
entries used by previous releases.

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

## Administrator PIN reset

An administrator can reset an active `USER` account from the personnel screen.
The temporary PIN is the last six digits of that user's national ID, expires
after 30 minutes, and forces the user to choose a permanent six-digit PIN
before entering the application. Permanent PINs may be memorable, but cannot
be `000000`, `123456`, or the last six digits of the user's national ID.

The reset endpoint verifies the administrator session, derives the temporary
credential only on the server, and never returns or records the PIN or national
ID. The audit event records only the target user UUID, reset method, expiry,
and confirmation that no PIN value was recorded. Apply
`20260809104500_admin_pin_reset.sql` before deploying the matching API code,
and run `npm run test:db:admin-pin-reset` first; that regression test always
rolls back its transaction.

Keep Row Level Security enabled in Supabase. A signed-in user must be allowed to read only their own `work_permits` record; administrators require separate explicit policies. Do not disable RLS to work around an authorization error.

Database schema changes are managed through the versioned SQL files in `supabase/migrations`.
