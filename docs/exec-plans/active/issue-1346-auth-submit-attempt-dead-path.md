# Issue #1346: SignInModal/CreateAccountModal submit-attempt validation path is unreachable in-browser (BUG-20)

Source: https://github.com/eq-lab/pipeline/issues/1346 — `docs/exec-plans/known-bugs.md` BUG-20
(epic #1247). Branch: `fix/1346-auth-submit-attempt-dead-path`.

## Decision

The issue offers two fixes: enable the submit button unconditionally and validate in the handler,
or remove the submit-attempt reveal as dead code. The Figma frames design the disabled-until-valid
button (`— Enable` companion frames, 32% opacity when invalid), so enabling it is a visible design
change that needs a designer, not a bug fix. **Remove the dead path**: a user can only ever reveal
field errors on blur today, and that stays exactly the same.

## Scope

`packages/frontend` only.

- `useAuthCredentialsForm`, `useForgotPasswordForm`, `useResetPasswordForm`: drop
  `submitAttempted`; errors reveal on blur only (`handleSubmit` keeps `preventDefault` and the
  `!isValid || isSubmitting` guard). Sign-in's never-shown "Enter the correct password" copy
  (`PASSWORD_ERROR_MESSAGE`, non-policy mode) goes with it — the disabled button already covers an
  empty password. The forgot/reset forms carry the same dead branch (same template) and are
  included; `AddEmailModal` uses the shared hook.
- Tests that reached the branch via `fireEvent.submit` now assert the real contract: an invalid
  submit reveals nothing and calls nothing; reveal happens on blur.
- Docs: `auth-components.md` (five "or on submit attempt" sentences), user stories 1248 Story 4 /
  1249 Story 4 (rewritten to the blur path), the BUG-20 notes in 1278 / 1281, BUG-20 → Resolved,
  a user-stories doc for this issue + index row.

Out of scope: any visual change; the button's disabled rule.

## Open Questions

_None._

## Implementation Steps

1. Three hooks. 2. Tests. 3. Docs.

## Test Strategy

`yarn workspace @pipeline/frontend lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`,
`npx tsx scripts/lint-comments.ts`.

## Docs to Update

`docs/frontend/auth-components.md`; `docs/user-stories/epic-1247/{1248,1249,1278,1281}-*.md`;
`docs/exec-plans/known-bugs.md`; `docs/user-stories/epic-1247/1346-auth-blur-validation.md` + index.
