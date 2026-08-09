# SafetyPass UX design system

This lightweight contract protects the existing interface while new screens are added.

## Interaction

- Primary touch targets are at least 44 x 44 CSS pixels (`min-h-11 min-w-11`).
- Icon-only buttons require a localized accessible name.
- Buttons must declare `type="button"` unless they intentionally submit a form.
- Controls hidden by animated navigation must also leave the keyboard tab order.
- The active navigation destination uses `aria-current="page"`.

## Status language

- Green means ready, passed, or safely complete.
- Amber means attention is needed soon; it is not a failure.
- Red means blocked, expired, suspended, or an action failed.
- Slate/blue is neutral information or the default action tone.
- Never rely on color alone: status text or an accessible label must accompany it.

## Feedback and motion

- Network-dependent failures must offer a recovery action where possible.
- Long operations keep their action disabled and show progress text or a spinner.
- Validation appears close to the relevant field and uses `aria-live` for changes.
- Existing reduced-motion behavior remains authoritative for transitions and scrolling.

Run `npm run check:ux` together with build, accessibility, and bundle checks before release.
