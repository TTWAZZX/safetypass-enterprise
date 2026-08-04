# Phase 1 Authentication Rollout Readiness Report

Date: 2026-08-04 (Asia/Bangkok)  
Mode: read-only readiness audit  
Decision: **NO-GO**  
Production migration/deployment performed: **No**

## Ready

- Current latest applied database migration is `20260804093000_repair_orphaned_auth_accounts`.
- The reviewed pending migrations are `20260804110000_archive_duplicate_auth_profiles` followed by `20260804120000_progressive_pin_v2`.
- `public.user_auth_security` is not present in production.
- No waiting database locks were observed during the audit.
- RLS is enabled on `users`, `exam_history`, `work_permits`, `vendors`, and `questions`.
- No active user rows are missing a national-ID fingerprint.
- The duplicate-archive migration was exercised against both production-shaped duplicate data (transaction rolled back) and a local legacy duplicate fixture. The complete local chain through PIN v2 passed and rolled back.
- An operational kill switch, `AUTH_PIN_V2_ENFORCEMENT`, has been added. Initial deployment must use `false`.
- UAT and Go/No-Go procedure is documented in `docs/PHASE1_AUTH_ROLLOUT_UAT.md`.

## Current non-sensitive baseline

| Item | Value |
|---|---:|
| PostgreSQL | 17.6 |
| Database size | 17,427,603 bytes |
| Public users | 446 |
| Auth users | 276 |
| Exam history | 1,004 |
| Work permits | 360 |
| Vendors | 115 |
| Questions | 70 |

## Blocking findings

### 1. Duplicate registered identities (remediation prepared, not applied)

Two national-ID fingerprint groups each contain two active, registered public profiles. Each group has exactly one Auth-linked profile, and the login-context ordering currently selects that Auth-linked profile.

- Group summary A: 2 profiles, 1 Auth-linked; all 3 exam records and 1 permit are attached to the Auth-linked profile.
- Group summary B: 2 profiles, 1 Auth-linked; no exam or permit records exist in the group.

No national ID, fingerprint, user ID, or name is included in this report. A forward-only migration now archives the non-Auth profiles in place, keeps their rows and FK history, copies missing training entitlements to the canonical profile, removes duplicate login lookup keys, and adds a uniqueness guard. It has not been applied to production.

### 2. Hosted secret names/scopes verified; recovery evidence remains manual

Vercel CLI 58.5.1 verified the Production metadata on 2026-08-04 without downloading or displaying secret values. Evidence is recorded in `docs/phase1-vercel-production-env-evidence.json`.

Required hosted variables:

- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_PIN_PEPPER`
- `AUTH_PIN_V2_ENFORCEMENT=false` for initial smoke deployment

`AUTH_PIN_PEPPER` was generated from 48 cryptographically random bytes and stored as a Sensitive Production variable. `AUTH_PIN_V2_ENFORCEMENT` was explicitly set to `false`. No deployment was triggered. Secret-manager recovery/escrow approval remains a manual checklist item before enforcement can be enabled.

### 3. Encrypted logical backup and isolated restore verified

- Supabase CLI 2.111.0 and Docker/WSL2 were used to create roles, schema, and data dumps for `public` and `auth`.
- All files are stored under an EFS-encrypted directory outside the repository and have recorded SHA-256 hashes.
- Roles, schema, and data restored successfully into an isolated local PostgreSQL container.
- Forty base tables were checked: 39 matched exact counts/full-row digests; the only expected exclusion was the Supabase-managed `auth.schema_migrations` ledger.
- The duplicate-archive and PIN-v2 migration chain passed against the restored production copy and rolled back.
- Evidence is recorded in `docs/phase1-backup-restore-evidence.json`; no data rows or secret values are included in the evidence.

CSV exports are not sufficient because they do not preserve Auth identities, functions, triggers, grants, RLS policies, and migration history.

### 4. Repository migration baseline is not self-contained

Starting PostgreSQL from an empty database and replaying the repository migrations fails at `20260722195000_secure_read_rpcs.sql` because it references `public.questions` before any committed migration creates the original application tables. Phase 1 migrations were therefore replayed successfully against a schema-only production snapshot, which validates compatibility with the current production shape but does not prove disaster recovery from migrations alone.

Before final project closure, create and test an approved baseline/squash strategy for new environments without rewriting migration records already applied to production.

Official references:

- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase CLI installation](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Vercel CLI](https://vercel.com/docs/cli)
- [Vercel environment-variable audit](https://vercel.com/docs/environment-variables/manage-across-environments)

## Recommended next actions

1. Obtain approval for the reviewed duplicate-archive and PIN-v2 migration chain; do not apply it before the remaining gates pass.
2. Complete one full-data backup verification path:
   - install pinned Supabase CLI plus Docker Desktop and perform an isolated restore drill; or
   - provide Dashboard backup evidence and restore it to an isolated Supabase project.
3. Verify Vercel variable names/scopes through Dashboard, or install/authenticate Vercel CLI and run name-only environment listings.
4. Store and escrow a stable `AUTH_PIN_PEPPER`; never print it or commit it.
5. Re-run `npm run check:rollout:phase1`. Continue only when it reports `GO` and the UAT approvers authorize rollout.

Until then: do not apply the PIN-v2 migration, do not enable enforcement, and do not deploy the Phase 1 authentication release to production.
