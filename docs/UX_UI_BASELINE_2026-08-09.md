# UX/UI improvement baseline — 2026-08-09

## Scope and release guardrails

- Work is split into UX/UI phases 0–9 and committed separately.
- Existing business rules, authorization, PIN, examination, permit, card, import, and audit behaviour must remain compatible.
- Vercel deployable API files are capped at 12. Files prefixed with `_` are private helpers and are not routes.
- No push or deployment is allowed until the final review is approved by the project owner.
- Database or security behaviour changes require a separate risk review before implementation.

## Baseline evidence

- Git baseline: `0ac2242 Harden post-rollout regression checks`
- Deployable API endpoints: 12/12
- Unit/API/component tests: 105/105 passing (20 files)
- Baseline captured before UX/UI phase implementation.

## Protected user journeys

1. Existing user login and forced four-to-six digit PIN upgrade.
2. New-user registration with a six-digit PIN.
3. Administrator temporary PIN reset and mandatory replacement.
4. User profile, optional LINE avatar sync, safety induction, examination history, digital card, and work permit.
5. Supplier & Outsource enrollment, examination, pass, and expiry state.
6. Admin dashboard, vendor/personnel management, import/export, archive, PIN reset, and audit log.
7. External registration submission, review, result email, correction, and resubmission.

## Phase quality gate

At minimum, each phase must pass the API budget check, relevant focused tests, TypeScript/build validation, and text-encoding validation. Final release additionally requires the full test, accessibility, E2E, bundle, audit, database, and production-readiness checks.

