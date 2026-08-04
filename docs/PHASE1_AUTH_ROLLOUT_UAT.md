# Phase 1 Authentication — Rollout Readiness and UAT

Status: **NO-GO until every mandatory item below has evidence and an authorized approver records GO.**

This runbook does not authorize a production deployment. The Phase 1 database migration is additive and forward-only. Database rollback is not the normal recovery path after users begin migrating to PIN v2.

## 1. Release identity and approvals

- [ ] Release commit: `________________`
- [ ] Migration 1: `20260804110000_archive_duplicate_auth_profiles.sql`
- [ ] Migration 2: `20260804120000_progressive_pin_v2.sql`
- [ ] Both migration SHA-256 values match `npm run check:rollout:phase1`: `________________`
- [ ] Rollout owner: `________________`
- [ ] Database operator: `________________`
- [ ] UAT lead: `________________`
- [ ] Security approver: `________________`
- [ ] Approved rollout window and timezone: `________________`
- [ ] Support/on-call contact confirmed: `________________`

### Rollout workstation tools

Recommended setup for this Windows workstation:

- Supabase CLI as a pinned project dev dependency: `npm install supabase --save-dev`, then use `npx supabase ...`.
- Docker Desktop (or another Docker-compatible runtime) when running the local Supabase stack or an isolated local restore drill.
- Vercel CLI is optional if environment-variable names/scopes are verified in Dashboard. If CLI is preferred, install it using the current official Vercel CLI instructions and run `vercel env ls production` / `vercel env ls preview`; do not pull or print secret values into evidence.
- A PostgreSQL 17-compatible client is useful for `psql`, `pg_dump`, and `pg_restore`, but the Supabase CLI dump workflow is preferred because it applies Supabase-specific filtering.

Docker is not required to apply the production migration or deploy Vercel. It is required for the full local Supabase stack and is the recommended way to perform an isolated local restore test.

## 2. Mandatory preflight evidence

### Secrets

- [ ] Vercel Production contains `SUPABASE_SERVICE_ROLE_KEY`; value is server-only and is not exposed with a public prefix.
- [ ] Vercel Preview contains an appropriate non-production `SUPABASE_SERVICE_ROLE_KEY` if Preview is used for UAT.
- [ ] `AUTH_PIN_PEPPER` is random, at least 32 characters, and identical across all instances of the same environment.
- [ ] `AUTH_PIN_PEPPER` is stored in the approved secret manager with recovery access tested by two authorized people.
- [ ] `AUTH_PIN_V2_ENFORCEMENT=false` is configured for the first deployment and smoke test.
- [ ] Screenshot/export of environment variable **names and scopes only** is attached. Never capture secret values.

### Backup and restore

- [ ] Supabase plan and backup retention are confirmed in Dashboard → Database → Backups.
- [ ] A fresh full logical dump or provider backup was completed immediately before the rollout window.
- [ ] Backup ID/path: `________________`
- [ ] Backup timestamp (Asia/Bangkok): `________________`
- [ ] Backup size and checksum: `________________`
- [ ] The backup is encrypted and access-controlled; it is not stored in the repository.
- [ ] `pg_restore --list` succeeds for a custom-format dump, or provider backup status is `COMPLETED`.
- [ ] Restore was tested in an isolated database/project—not production—and critical row counts were compared.
- [ ] Restore drill evidence/owner/date: `________________`

CSV exports alone are not accepted as a full restore point because they do not preserve Auth identities, functions, triggers, grants, RLS policies, and migration history.

### Database preflight

- [ ] `npm run check:rollout:phase1` reports expected latest migration `20260804093000`.
- [ ] The only pending local migrations, in order, are `20260804110000` and `20260804120000`.
- [ ] `public.user_auth_security` does not exist before rollout.
- [ ] Critical tables have RLS enabled.
- [ ] No waiting database locks are present.
- [ ] Duplicate identity groups are compatible with the reviewed archive migration (one Auth-linked canonical profile per group; protected history remains on canonical profiles).
- [ ] `npm run test:db:identity-dedup` passes on local with its legacy duplicate fixture and rolls back the complete migration chain.
- [ ] `npm run test:db:pin-v2` passes and confirms transaction rollback plus unchanged user/history digests.

## 3. Migration plan

1. Announce the change window and pause unrelated schema/data maintenance.
2. Capture the approved backup evidence and the pre-migration readiness JSON.
3. Acquire the migration advisory lock used by the controlled migration process.
4. Apply `20260804110000_archive_duplicate_auth_profiles.sql`, verify its postconditions, then apply `20260804120000_progressive_pin_v2.sql` exactly once.
5. Record version, name, statements, operator, timestamp, and migration SHA-256.
6. Verify:
   - one `user_auth_security` row exists per existing `public.users` row;
   - every backfilled row starts at `pin_version = 1`;
   - critical users/history/permit counts and stable ID-link digests match the preflight baseline;
   - anonymous/authenticated roles cannot execute service-only login-state functions;
   - the new-user trigger creates a security row for a controlled test registration.
7. Keep `AUTH_PIN_V2_ENFORCEMENT=false` while deploying and smoke-testing the PIN-v2-compatible application.
8. Obtain explicit GO approval before changing enforcement to `true` and redeploying the same reviewed artifact.

Do not manually delete the new table or migration record as a rollback. Before the first PIN v2 upgrade, the application deployment may be reverted. After any account is upgraded, keep the PIN-v2-compatible release and use a forward fix.

## 4. UAT test identities

Use dedicated test accounts only. Do not intentionally lock a real employee or administrator.

- [ ] Existing registered USER with working legacy PIN.
- [ ] Existing ADMIN with working legacy PIN.
- [ ] Staged USER that has not accepted PDPA.
- [ ] Brand-new registration identity.
- [ ] Suspended USER.
- [ ] Recovery account marked `bootstrap-v2` for interrupted-registration testing.
- [ ] Test account dedicated to lockout testing.

Record only masked identity references in evidence.

## 5. UAT cases

| ID | Scenario | Expected result | Evidence | Pass |
|---|---|---|---|---|
| AUTH-01 | Existing USER logs in with old 4-digit PIN while enforcement is false | Login succeeds; no forced migration |  | [ ] |
| AUTH-02 | Existing USER logs in after enforcement is true | Forced 6-digit PIN screen appears before application access |  | [ ] |
| AUTH-03 | Try fewer than 6 digits, repeated digits, sequences, and last 6 ID digits | Every weak PIN is rejected without changing account data |  | [ ] |
| AUTH-04 | Set an allowed PIN and continue | Existing user ID, profile, vendor, exams, permits, and role are unchanged |  | [ ] |
| AUTH-05 | Log out; retry old 4-digit PIN | Old PIN is rejected |  | [ ] |
| AUTH-06 | Log in with the new 6-digit PIN | Login and session refresh succeed |  | [ ] |
| AUTH-07 | Refresh/reopen a pre-migration saved session | User cannot bypass the required PIN migration |  | [ ] |
| AUTH-08 | Existing ADMIN completes migration | ADMIN role and admin-only screens remain available |  | [ ] |
| AUTH-09 | Staged user completes first registration | PDPA flow succeeds; PIN v2 login works; no duplicate profile is created |  | [ ] |
| AUTH-10 | Brand-new user completes registration | Random bootstrap credential is replaced; PIN v2 login works |  | [ ] |
| AUTH-11 | Interrupt final PIN update, then retry with recovery test account | Recovery succeeds only for `bootstrap-v2`; forced PIN update still occurs |  | [ ] |
| AUTH-12 | Suspended user attempts login | Access is denied with the correct suspended-account message |  | [ ] |
| AUTH-13 | Enter wrong PIN five times on lockout test account | Lock persists across refresh/browser and lasts 15 minutes |  | [ ] |
| AUTH-14 | Successful login after lock expires | Failure count and lock timestamp are cleared |  | [ ] |
| AUTH-15 | Change network/browser during lock | Persistent DB lock is still enforced |  | [ ] |
| AUTH-16 | Toggle enforcement back to false using the reviewed artifact | New legacy migrations pause; migrated PIN-v2 accounts still log in |  | [ ] |
| REG-01 | Existing registered identity selects Register | User is redirected to Login without creating another profile |  | [ ] |
| REG-02 | Staged identity lookup and registration | Prepared name/company/history remain attached to the same intended identity |  | [ ] |
| DATA-01 | Compare pre/post counts | Users, exams, permits, vendors, questions have no unexpected loss |  | [ ] |
| DATA-02 | Compare stable ID-link digests | User IDs and history/permit ownership links are unchanged |  | [ ] |
| OPS-01 | API/service secret absent in Preview | Authentication fails closed without exposing secret values or stack traces |  | [ ] |
| OPS-02 | Browser console/network inspection | No service-role key, pepper, national-ID-derived v2 password, or raw server error is exposed |  | [ ] |

## 6. Automated final gate

- [ ] `npm test`
- [ ] `npx tsc --noEmit`
- [ ] `npm run check:text`
- [ ] `npm run build`
- [ ] `npm run check:bundle`
- [ ] `npm run test:a11y`
- [ ] `npm run test:e2e`
- [ ] `npm run test:db:pin-v2`
- [ ] `npm run test:db:identity-dedup`
- [ ] `npm run check:rollout:phase1` returns `GO` after external evidence is recorded/verified.

## 7. Monitoring and stop conditions

Monitor API status codes, Supabase Auth failures, database locks, registration failures, and support reports using aggregate data only.

Immediately stop new migrations by setting `AUTH_PIN_V2_ENFORCEMENT=false` on the same PIN-v2-compatible artifact if any condition occurs:

- existing user IDs/history/roles change unexpectedly;
- multiple valid legacy accounts cannot migrate;
- migrated users cannot establish or refresh a session;
- service-role or pepper material appears in client traffic/logs;
- error rate or lockouts materially exceed the agreed baseline;
- database blocking locks or sustained latency appear;
- backup or restore evidence becomes invalid.

## 8. Go/No-Go decision

GO requires all mandatory preflight items, automated gates, critical UAT cases (`AUTH-01` through `AUTH-16`, `DATA-01`, `DATA-02`, `OPS-02`), and approvals to pass.

- [ ] GO — enable enforcement during the approved window.
- [ ] NO-GO — keep enforcement false; do not deploy/apply further changes.
- Decision time: `________________`
- Approver and signature/reference: `________________`
- Notes: `________________`
