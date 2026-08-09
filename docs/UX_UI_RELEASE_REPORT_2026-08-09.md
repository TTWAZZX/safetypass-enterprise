# UX/UI release report — 2026-08-09

## Release decision

The Phase 0–9 change set is a release candidate. No critical or high-severity regression was found in the completed automated, browser, dependency, API-budget, or database checks.

This work is committed locally only. It has not been pushed to GitHub and has not triggered a Vercel deployment.

## Phase results

| Phase | Result | Local commit |
| --- | --- | --- |
| 0 | Baseline, protected journeys, and 12-endpoint API guard | `4b11ef9` |
| 1 | User readiness summary and direct next action | `48ca5cd` |
| 2 | Human-readable expiry and urgency status | `3b68bc3` |
| 3 | Admin action center using existing dashboard data | `0e66839` |
| 4 | Personnel result count, active filters, and clear action | `c312699` |
| 5 | Excel validation and preview before any database write | `d10a871` |
| 6 | Offline banner and consistent recovery/error messaging | `08ce6f8` |
| 7 | PIN visibility, confirmation feedback, and accurate PIN guidance | `5a35fd2` |
| 8 | Mobile keyboard/touch accessibility and UX contract | `bb4d2df` |
| 9 | Full regression evidence and this release report | `Complete UX release validation` |

No deployable API endpoint was added by these phases.

## Final verification evidence

- Unit/API/service tests: **124/124 passed across 26 files**.
- Production TypeScript/Vite build: **passed**.
- Production Assurance browser E2E: **passed** for login, forced PIN upgrade, user journeys, retake/resume, admin, Excel preview/import, export, mobile layout, and accessibility.
- WCAG A/AA mobile login scan: **passed**.
- UX static guard: **passed** for keyboard navigation, accessible names, and core touch targets.
- Text encoding check: **passed**.
- Bundle budget: **passed** (`main 431477 B`, `UserPanel 239741 B`, charts `393164 B`, ExcelJS `939167 B`).
- Deployable API budget: **12/12 passed**; 5 underscore-prefixed private helpers excluded.
- Production dependency audit: **0 vulnerabilities** with `npm audit --omit=dev`.
- Supabase migration inventory: **local and remote aligned** through `20260809104500_admin_pin_reset.sql`.
- PIN v2 migration regression: **passed and rolled back** with existing-data parity preserved.
- Admin PIN reset migration regression: **passed and rolled back**.
- Staged registration database regression: **passed and rolled back**.
- Auth orphan repair and identity-dedup regression: **passed and rolled back**.
- External registration submission, admin workflow, and follow-up database regressions: **passed and rolled back**.

## Issues found during final validation

1. The successful PIN confirmation text did not meet the 4.5:1 contrast threshold. It now uses a darker accessible green.
2. Excel import summary labels lost contrast because status colors were combined with opacity. The opacity reduction was removed.
3. The E2E script still expected an immediate import after file selection. It now verifies the Phase 5 preview dialog and explicitly confirms the import, matching production behavior.

All three were corrected and the complete E2E suite passed afterward.

## Residual evidence limitation

The Phase 2, Phase 3, Phase 4 boundary scripts and restore-parity script intentionally refuse to run without separate local isolated database URLs (`PHASE2_TEST_DATABASE_URL`, `PHASE3_TEST_DATABASE_URL`, `PHASE4_TEST_DATABASE_URL`, and `RESTORE_TEST_DATABASE_URL`). Those isolated targets were not configured in this workspace, so these four drills were not rerun. They were not pointed at production because their safety guards explicitly prohibit it.

This is a test-environment evidence gap, not an observed application defect. Current remote schema parity, rollback-safe production database regressions, and the complete browser E2E suite all passed.

## Approval-controlled release steps

After the project owner approves:

1. Push the local Phase 0–9 commits to `origin/main`.
2. Allow the existing Vercel integration to deploy; do not create another API route.
3. Confirm the deployment is Ready and the production domain targets the new commit.
4. Run a production smoke check for login/PIN upgrade, user readiness, admin action center, Excel preview/import, optional LINE avatar sync, and console errors.

Until that approval, no push or deployment is authorized.
