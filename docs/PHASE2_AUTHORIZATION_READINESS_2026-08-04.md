# Phase 2 Authorization and Data Integrity Readiness

Date: 2026-08-04 (Asia/Bangkok)  
Status: **READY FOR REVIEW — NOT DEPLOYED**

## Scope

Phase 2 hardens database authorization boundaries without changing existing
application rows, authentication identities, PIN versions, roles, history, or
permits. `AUTH_PIN_V2_ENFORCEMENT` remains `false`.

## Findings addressed

1. The public external-registration email endpoint used an anonymous Supabase
   key to read queued recipient addresses and update delivery state. Anyone
   holding an applicant tracking token could call the underlying RPCs directly.
2. The superseded `add_my_training_access` RPC remained executable by an
   authenticated client even though the current replacement performs stronger
   active-account and program validation.
3. Existing client roles retained non-DML table privileges such as `TRUNCATE`,
   `REFERENCES`, and `TRIGGER`; these are not required by the browser and do not
   belong in its database capability set.

## Changes prepared

- `api/send-external-registration-submission.js` now uses the server-only
  service-role configuration and fails closed when it is unavailable.
- `20260804160000_phase2_service_boundary_hardening.sql`:
  - restricts email outbox read/update RPCs to `service_role`;
  - removes browser access to the superseded training-access RPC while keeping
    service-role compatibility;
  - revokes `TRUNCATE`, `REFERENCES`, and `TRIGGER` on existing public tables
    from `anon` and `authenticated`;
  - keeps future repository-created objects private by default.
- No table rows are inserted, updated, archived, or deleted by the migration.

## Verification

- Unit tests: **74/74 passed**
- TypeScript: **passed**
- Production build and text encoding: **passed**
- Bundle budget: **passed**
- Accessibility WCAG A/AA: **passed**
- External Registration E2E: **passed**
- External Registration preflight: **passed; feature remains disabled**
- Isolated Supabase schema regression: **PASS_ROLLED_BACK**
- Protected-data snapshot before/after migration: **unchanged**
- Production migration dry-run: exactly one pending migration,
  `20260804160000_phase2_service_boundary_hardening.sql`

## Platform note

Supabase-owned `supabase_admin` default privileges are platform-managed and the
application `postgres` role is not permitted to modify them. Every future
schema migration must therefore continue to revoke/grant privileges explicitly
and must include a privilege regression check. Repository migrations owned by
`postgres` are configured private-by-default.

## Rollout gate

Before Production rollout:

1. Create a fresh encrypted logical backup.
2. Re-run all automated gates and the isolated database regression.
3. Apply only the single reviewed forward migration.
4. Deploy the matching API artifact.
5. Smoke-test external registration submission email using a dedicated test
   application, then confirm direct anon RPC calls receive permission denied.

Production migration and deployment require a separate approval.
