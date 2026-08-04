# Phase 4 Admin Data Integrity and Audit Readiness

Date: 2026-08-04
Status: READY FOR CONTROLLED ROLLOUT - NOT DEPLOYED

## Objective

Protect high-integrity administrative data from direct browser writes, make
user and vendor removal reversible, and produce trustworthy database-side
audit records without changing existing users or their linked history.

## Implemented changes

- Added forward-only migration
  `20260804180000_phase4_admin_integrity_audit.sql`.
- Added admin-only `admin_archive_user(uuid)` and
  `admin_archive_vendor(uuid)` RPCs.
- User archive sets `is_active = false`; it does not delete the user, exam
  history, exam logs, work permits, or training access.
- Vendor archive sets `status = 'REJECTED'`; it does not delete the vendor or
  linked users.
- Added database triggers that create audit records for admin changes to users
  and vendors. Audit metadata records action, target, and changed field names,
  but does not copy identity values or profile values into the log.
- Revoked direct browser-role writes to audit logs and other high-integrity
  administration tables. Supported mutations continue through reviewed RPCs.
- Removed browser-created audit events and non-transactional destructive
  delete sequences from the admin UI.

## Data-safety assessment

- The migration itself contains no data backfill, `INSERT`, `UPDATE`,
  `DELETE`, or `TRUNCATE` against existing rows.
- The latest encrypted Production backup checksums were verified before the
  isolated restore.
- The restored local snapshot contained:
  - users: 446
  - vendors: 115
  - exam history: 1,009
  - work permits: 361
  - training access: 447
  - audit logs: 203
- Migration and SQL assertions ran inside one transaction and rolled back.
- Archive tests verified that linked history remains present.
- Counts after rollback matched the restored snapshot exactly.
- The dedicated Docker test container was removed after verification.

## Verification completed

- Unit tests: 77/77 passed.
- TypeScript check: passed.
- Text-encoding check: passed.
- Production build: passed.
- Bundle budget: passed.
- Accessibility check: passed.
- Production Assurance E2E: passed, including archive RPC calls and an
  assertion that the browser performs no direct high-integrity writes.
- Restored-database regression: `PASS_ROLLED_BACK`.
- Database regression verified browser write revocations, RPC permissions,
  reversible archive behavior, linked-history preservation, and database-side
  audit generation.
- Production database dry-run found exactly one pending migration:
  `20260804180000_phase4_admin_integrity_audit.sql`; no seed or role changes.

## Required rollout order

1. Obtain explicit Production rollout approval and agree on a low-traffic
   maintenance window.
2. Create and verify a fresh encrypted Production backup immediately before
   rollout.
3. Record pre-rollout row counts for users, vendors, exam history, work
   permits, training access, and audit logs.
4. Deploy the Phase 4 application commit first. Do not archive any record yet.
   The existing database remains compatible with this application build.
5. Apply the forward-only Phase 4 migration.
6. Verify grants: browser roles cannot write high-integrity tables directly,
   authenticated admins can execute the two archive RPCs, and non-admin calls
   are rejected.
7. Use an approved synthetic or disposable test record to verify user and
   vendor archive through the Production UI. Never test archive on a real
   employee or vendor record.
8. Confirm the test records remain stored, linked history remains intact, and
   database-generated audit events identify the acting admin.
9. Repeat login, admin list/search/edit, import/export, exam history, work
   permit, and audit-view smoke tests.
10. Compare post-rollout row counts with the baseline. Archive tests may change
    status and audit counts only for approved synthetic records; they must not
    reduce entity or history counts.
11. Synchronize GitHub and record rollout evidence only after all checks pass.

The app-first order is mandatory because the currently deployed UI still uses
direct vendor status writes and destructive delete paths that the migration
will revoke.

## Failure and recovery strategy

- Do not reverse, rename, or edit a migration after it has been applied.
- If the application deployment fails before migration, roll back the
  application; the database has not changed.
- If migration application fails, stop the rollout and do not retry blindly.
  Capture the error, verify migration history, and assess the exact statement
  before continuing.
- If a UI issue appears after migration, keep the database protections in
  place and deploy a corrected compatible application. Do not restore the
  database merely to re-enable direct browser writes.
- Because Phase 4 does not delete or rewrite existing rows, backup restoration
  is reserved for independently verified data corruption, not normal rollback.
- Keep `AUTH_PIN_V2_ENFORCEMENT=false`; Phase 4 does not alter PIN enforcement.

## Known repository-history limitation

The oldest repository migrations still cannot bootstrap an empty database
without the pre-existing baseline schema. Phase 4 was therefore tested against
the verified restored Production schema and data. Baseline reconstruction
remains a separate disaster-recovery hardening task.

## Approval gate

No Phase 4 application deployment or Production migration has been performed.
Proceed only after explicit approval and complete the rollout in the order
above.
