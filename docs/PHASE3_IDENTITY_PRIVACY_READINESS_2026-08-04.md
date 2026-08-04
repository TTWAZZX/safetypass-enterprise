# Phase 3 Identity Privacy Readiness

Date: 2026-08-04  
Status: READY FOR CONTROLLED ROLLOUT — NOT DEPLOYED

## Objective

Move national-ID account-state lookup behind a rate-limited server boundary
without changing existing users, authentication credentials, registration
history, exam history, work permits, or training access.

## Implemented changes

- Added a status-only action to the existing `POST /api/prepare-staged-auth`
  server function so the project remains within the Vercel Hobby function limit.
- The endpoint validates a 13-digit identity, applies per-client and hashed
  per-identity throttling, returns only the existing three account-state flags,
  and never returns profile fields or upstream diagnostics.
- A two-second sanitized cache preserves the existing login-to-staged-
  registration handoff without performing a second database lookup.
- The browser no longer calls `check_user_exists` directly.
- `prepare-staged-auth` now calls the lookup with the server-only service role.
- Added forward-only migration
  `20260804170000_phase3_identity_lookup_boundary.sql` to revoke the RPC from
  `public`, `anon`, and `authenticated`, while retaining `service_role` access.
- Existing `complete_registration_v4` transaction and the protected-user-field
  trigger are unchanged.

## Data-safety assessment

- Migration contains only `REVOKE` and `GRANT`; it has no DDL affecting tables
  and no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, or backfill.
- Encrypted Phase 2 Production backup checksums were verified before restore.
- Restored local snapshot contained:
  - users: 446
  - exam history: 1,009
  - work permits: 361
  - training access: 447
- Migration and SQL assertions ran inside one transaction and rolled back.
- Protected-table snapshots before and after the migration matched exactly.

## Verification completed

- Unit tests: 79/79 passed.
- TypeScript: passed.
- Text encoding: passed.
- Production build: passed.
- Bundle budget: passed.
- Accessibility: passed.
- Production Assurance E2E: passed, including staged registration and a check
  that the browser never calls the identity RPC directly.
- External Registration E2E and preflight: passed; feature remains disabled.
- Isolated restored-database regression: `PASS_ROLLED_BACK`.
- Production database dry-run: exactly one pending migration, no seeds or role
  files.

## Required rollout order

1. Create and verify a fresh encrypted Production backup.
2. Record pre-rollout counts/digests and active database locks.
3. Deploy the application/API commit first while the old RPC grant still exists.
4. Smoke-test the new server endpoint for staged, registered, suspended, and
   unknown identities without recording identity values in evidence.
5. Apply the forward-only Phase 3 migration.
6. Verify browser roles cannot execute `check_user_exists` and `service_role`
   still can.
7. Repeat login, staged registration, new registration, and suspended-account
   smoke tests through the Production UI.
8. Push/synchronize GitHub only after Production verification passes.

The app-first order is mandatory. Applying the migration before the API/client
deployment would break the currently deployed browser lookup.

## Rollback strategy

- Do not reverse or edit an applied migration.
- If the application deployment fails before migration, roll back the app; the
  database remains compatible.
- If a problem appears after migration, keep the service-only database boundary
  and deploy the previous UI with a small server lookup adapter. Do not restore
  data because this migration does not mutate data.
- `AUTH_PIN_V2_ENFORCEMENT` must remain `false`; Phase 3 does not change PIN
  enforcement.

## Known repository-history limitation

A database created from an empty volume cannot replay the oldest repository
migrations because the first tracked migration expects pre-existing tables such
as `public.questions`. This predates Phase 3. The verified encrypted Production
backup restores the current public schema and data successfully, and Phase 3
was validated on that restored state. A separate future baseline/archive task
should make disaster-recovery bootstrap independent of the historical gap.

## Approval gate

No Production migration or deployment has been performed for Phase 3. Proceed
only with the controlled rollout order above.
