# Issue #1281: KYB: create-account validation-error state

Source: https://github.com/eq-lab/pipeline/issues/1281

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247) (V1.0)
Figma (styling source of truth): `Create account — Validation error`, node
[`6585:75897`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6585-75897&m=dev)
Branch: `feat/1281-create-account-error` (draft PR #1289)

## Scope

### What the error frame actually shows (read via local Dev Mode MCP `get_metadata` + `get_design_context` on `6585:75897`)

The frame is an instance of the same `Sign In` component as every other KYB auth frame, with the
`Create account` slot overrides already shipped in #1249. Nothing structural is new:

| Element | State in the frame |
| --- | --- |
| Heading | `Create account`, no subtitle (`SubtitleCont` is `hidden="true"`) |
| Email field | **Valid, not in error** — white fill (`fill-test/on-primary`), value `hello@eqlab.io`, primary ink |
| Password field | **In error** — fill `fill/negative-secondary` (`rgba(178,0,0,0.16)`), value `••••` (4 masked chars) in `content-test/negative` (`#b20000`), eye toggle (`button-icon`, 22px glyph) present |
| Error caption | `At least 8 characters, including a number and a special character` — caption 12/16, `content-test/negative`, **right-aligned**, absolutely positioned (`absolute bottom-[-2px] … translate-y-full`) so it adds no layout height |
| Submit | `Sign Up`, `fill/brand` + `opacity-32` → **disabled** |
| Everything else | `Continue with wallet`, `OR` divider, `Already have an account? Log in`, right-hand image pane, close icon — byte-identical to the shipped default/enabled frames |

There is **no banner**, no error summary, no requirements checklist, no new field, and no new token.
The frame also carries the same `hidden="true"` third `input` layer (`6585:75919`) already documented
as a design-file artifact in #1249 — still intentionally not built.

Cross-checks performed:

- Enabled frame [`6486:81640`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6486-81640&m=dev):
  password is `••••••••••` (10 chars) and the submit button has **no** `opacity-32` → enabled. Consistent
  with gating submit on the length rule; nothing in the designed states contradicts the new policy.
- Sign-in validation-error frame [`6486:81595`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6486-81595&m=dev)
  is **unchanged**: both fields in error, old copy. Sign-in keeps its own rules.

### The delta this issue ships

`TextField` (`packages/ui/src/components/TextField/TextField.tsx`) already renders every pixel of this
state — invalid fill `--color-pipeline-negative-secondary`, invalid value text
`--color-pipeline-negative-strong`, the eye toggle, and the absolutely-positioned right-aligned caption.
**No visual work is required.** The entire delta is validation logic + copy:

1. **Create-account gains a real password policy** that sign-in does not have:
   `length ≥ 8` **and** at least one digit **and** at least one character that is neither a letter nor a
   digit. Verbatim copy: `At least 8 characters, including a number and a special character`.
2. **Sign-in is untouched.** `useAuthCredentialsForm` gains an opt-in option; `SignInModal` does not pass
   it and renders byte-identical.
3. `isValid` (and therefore the disabled submit) for create-account now requires the policy, matching
   both the error frame (weak password → disabled) and the enabled frame (10 chars → enabled).
4. The create-account password error copy **replaces** `Enter the correct password` in that modal (a
   signup form has no "correct" password yet; the policy line is the reason for every rejection).

**Reveal timing (decided, not designed).** The frame cannot tell us blur vs. keystroke, so this follows
the email field's existing rule exactly, for repo consistency:

```
meetsPasswordPolicy(p) = p.length >= 8 && /\d/.test(p) && /[^A-Za-z0-9]/.test(p)
showPasswordError      = ((passwordTouched && password !== "") || submitAttempted)
                         && !meetsPasswordPolicy(password)
```

i.e. no error while the field is empty and untouched; the error appears on blur and then updates live as
the user keeps typing; a submit attempt also reveals it (including for an empty password). Clicking the
disabled `Sign Up` button blurs the input, so the user is never dead-ended with a disabled button and no
explanation.

### Out of scope

- Any change to `SignInModal`, its copy, or its validation rules.
- Any change to `TextField` / `useTextField` / `packages/ui` (the visual state already exists and is
  token-exact).
- Any change to `AuthModalShell`, `AuthModalParts`, or `packages/frontend/src/routes/test.tsx` — the
  `/test?tab=auth` trigger already opens the modal and the state is reached by typing.
- Network calls, server-side rejection copy, and the cross-link to `SignInModal` — all still #1254's.
- Production entry points (the modals remain reachable only from `/test?tab=auth`).
- Fixing BUG-20 (below) — logged, not fixed.

## Assumptions and Risks

- **`#1280` is not merged.** Contrary to the task briefing, `origin/main` is at `f0416377` (#1286,
  Owners retired); `SignInModal.tsx` has **no** `onForgotPassword` prop and `/test`'s `AuthTab` has no
  forgot-password swap. PR #1287 (`feat/1280-kyb-forgot-password`) is still open. This branch is cut
  from that same main, so the two are independent. **Risk:** #1287 edits `SignInModal.tsx` and
  `routes/test.tsx`; this issue touches neither, so a textual conflict is not expected — but if #1287
  also touches `useAuthCredentialsForm.ts`, whichever lands second must rebase.
- **The password policy has no backend counterpart.** Email/password auth endpoints do not exist yet
  (epic #1247: the auth-wiring slice is blocked). The rule here is derived from the Figma copy alone —
  notably it does **not** require a letter, because the copy does not. When the real endpoint lands, the
  frontend rule must be reconciled with the server's policy or the two will disagree. Logged as TD-73 (renumbered from the plan's TD-71 — #1280 took TD-71/72).
- **"Special character" is undefined by the copy.** Implemented as "not `[A-Za-z0-9]`" (so punctuation,
  symbols, whitespace and non-ASCII all count). Recorded in the spec so a later reconciliation is a
  one-line change.
- **Existing test fixtures break.** `CreateAccountModal.test.tsx`'s `fillValid` helper types `hunter2`
  (7 chars, no special character) — now invalid. Every create-account test that expects an enabled
  submit must switch to a policy-passing password. `SignInModal.test.tsx` must keep `hunter2` (proving
  sign-in did not inherit the rule).
- **Pre-existing:** BUG-19 (`packages/ui` `tsc --noEmit` fails on `TextField.stories.tsx`) — unrelated,
  `packages/ui` is not touched here, and `yarn lint` passes regardless.
- **Pre-existing, discovered during this planning:** the submit-attempt validation path is unreachable in
  a real browser. HTML implicit form submission is a no-op when the form's default button is disabled,
  and `Sign Up`/`Sign In` are disabled exactly when the form is invalid. Unit tests reach it only because
  they call `fireEvent.submit(form)` directly. This makes Story 4 of both
  `docs/user-stories/epic-1247/1248-kyb-signin-modal.md` and `1249-kyb-create-account.md` unexecutable by
  the QA agent. Log as **BUG-20**; do not fix here. #1281's own user stories therefore exercise the blur
  path only.

## Open Questions

_None_

## Implementation Steps

All steps below are complete.

1. **`packages/frontend/src/components/useAuthCredentialsForm.ts`** — add the opt-in policy.
   - Export `PASSWORD_POLICY_ERROR_MESSAGE = "At least 8 characters, including a number and a special character"`.
     Keep `EMAIL_ERROR_MESSAGE` and `PASSWORD_ERROR_MESSAGE` exported and unchanged.
   - Add a module-level `meetsPasswordPolicy(password: string): boolean` implementing
     `length >= 8 && /\d/ && /[^A-Za-z0-9]/`.
   - Add `passwordRule?: "non-empty" | "policy"` to `UseAuthCredentialsFormOptions`, defaulting to
     `"non-empty"` so `SignInModal` is unaffected.
   - Add `passwordTouched` state (reset alongside the others in the existing `open` effect) and
     `handlePasswordBlur()` to both `UseAuthCredentialsFormResult` and the returned object.
   - `isValid` becomes `isEmailWellFormed && (passwordRule === "policy" ? meetsPasswordPolicy(password) : password !== "")`.
   - `showPasswordError` branches on `passwordRule`:
     - `"non-empty"` → `submitAttempted && password === ""` (today's behaviour, byte-identical).
     - `"policy"` → `((passwordTouched && password !== "") || submitAttempted) && !meetsPasswordPolicy(password)`.
   - `passwordError` resolves to `PASSWORD_ERROR_MESSAGE` under `"non-empty"` and
     `PASSWORD_POLICY_ERROR_MESSAGE` under `"policy"`.
   - Keep the file's single 2–3-line spec-pointer header; update it to name both modals and the new
     Figma node. No other comments (AGENTS.md comment-minimal HARD RULE).
2. **`packages/frontend/src/components/CreateAccountModal.tsx`** — pass `passwordRule: "policy"` to
   `useAuthCredentialsForm`, destructure `handlePasswordBlur`, and wire `onBlur={handlePasswordBlur}` on
   the password `TextField`. Update the file's spec-pointer header to add node `6585:75897`. No other
   change — no new markup, no new classes.
3. **`packages/frontend/src/components/SignInModal.tsx`** — **no change.** Verify by diff that the file is
   untouched.
4. Do **not** touch `packages/ui`, `AuthModalShell.tsx`, `AuthModalParts.tsx`, or `routes/test.tsx`.
5. **`docs/frontend/auth-components.md`** — the spec edits (see "Docs to Update" for the exact claims that
   are now false).
6. **`docs/user-stories/epic-1247/1281-create-account-error.md`** — new stories doc (per-issue convention,
   `docs/ISSUE_PROTOCOL.md` §6).
7. **`docs/user-stories/index.md`** — add the `#1281` row to the Epic #1247 table (lint-docs reachability).
8. **`docs/user-stories/epic-1247/1249-kyb-create-account.md`** — amend the three stories the new rule
   invalidates, in the same "superseded note" style #1286 used on the `1252` doc:
   - Story 2 ("any non-empty value" enables submit) → the password must satisfy the policy; supersede
     note pointing at the `1281` doc.
   - Story 4 (`Enter the correct password`) → superseded: create-account now shows the policy copy, and
     see BUG-20 for why the submit-attempt path is not browser-executable.
   - Story 8 (pre-condition "any non-empty password") → use a policy-passing password.
9. **`docs/exec-plans/known-bugs.md`** — add **BUG-20** (disabled default button blocks implicit form
   submission; affects `SignInModal` + `CreateAccountModal`; date, location, symptom, root cause,
   workaround = validate on blur, impact = two user stories unexecutable).
10. **`docs/exec-plans/tech-debt-tracker.md`** — add **TD-73** (renumbered; create-account password policy is derived
    from Figma copy only; no backend policy exists; "special character" set and the absent letter
    requirement need reconciliation when the auth endpoints land).
11. Run the checks: `yarn workspace @pipeline/frontend test`,
    `yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/frontend build`, and
    `yarn lint:docs`.

## Test Strategy

All in `packages/frontend/src/components/CreateAccountModal.test.tsx` unless stated. Use
`P@ssw0rd!` (9 chars, digit, special) as the canonical valid password and update `fillValid` to it.

**New — create-account policy:**

- Weak password + blur renders the exact copy `At least 8 characters, including a number and a special character`.
- No error while the password field is empty and has never been blurred (mirrors the email rule).
- Blurring an **empty** password field shows **no** error.
- After the field has been blurred once, the error clears live as soon as the value satisfies the policy
  (type `P@ssw0rd!` over the weak value, assert the copy is gone).
- Table-driven policy boundaries, each asserting the submit button's disabled state and error presence:
  - `P@ssw0r` (7 chars, digit + special) → invalid.
  - `Password!` (9 chars, special, **no digit**) → invalid.
  - `Password1` (9 chars, digit, **no special**) → invalid.
  - `12345678!` (no letter) → **valid** — the copy does not require a letter; this test pins that reading.
  - `P@ssw0rd!` → valid, submit enabled.
- The old copy `Enter the correct password` is **never** rendered by `CreateAccountModal` (query returns
  null after a `fireEvent.submit` on an empty password; the policy copy is rendered instead).
- A submit attempt with a valid email and an empty password renders the policy copy and keeps submit
  disabled (unit-level only — see BUG-20).
- A well-formed email plus a policy-passing password calls `onSubmit` once with `{ email, password }`.
- Reopening the modal (`open` false → true) clears the password error and `passwordTouched`.

**Regression — sign-in must not inherit the rule** (`SignInModal.test.tsx`):

- `hunter2` (7 chars, no special) with a well-formed email still enables `Sign In`.
- An invalid submit still renders `Enter the correct password`, not the policy copy.
- Blurring an invalid password on sign-in renders no error.

**Unchanged suites that must stay green:** `AuthModalShell.test.tsx`, `TextField.dom.test.tsx`, and every
existing `CreateAccountModal.test.tsx` case not listed above (dialog semantics, focus trap, Escape/×, eye
toggle, exactly-two-inputs, absent "Forgot password?", inert footer).

**Figma verification** (required — the Issue references a Figma frame): with the dev server running, open
`http://localhost:5173/test?tab=auth` → "Open Create Account modal", type `hello@eqlab.io`, type a 4-char
password, blur, and compare side-by-side against node `6585:75897` (local Dev Mode MCP
`http://127.0.0.1:3845/mcp`, or the Figma URL) for: email field **not** in error, password field
negative-secondary fill with negative-strong value text, eye toggle visible, right-aligned caption with
the exact copy sitting below the field **without shifting** the 32px field-to-field rhythm, and a disabled
`Sign Up`. Any residual difference is a token/`TextField` matter, not a #1281 change — file it rather than
patching it here.

## Docs to Update

**`docs/frontend/auth-components.md`** — four claims are now false and one section gains content:

1. `### Shared form parts` (~line 77–80): "the shared credential-form state/validation hook consumed by
   both modals — see the validation rules under 'SignInModal' below, **which apply unchanged to
   `CreateAccountModal`**" → document the `passwordRule` option and that the two modals now diverge on the
   password rule only.
2. `### SignInModal` → **Validation** (~line 149): the parenthetical "presentational only — **no
   complexity rule**, free-mail domains allowed" must be scoped to sign-in explicitly.
3. `### CreateAccountModal` → **Field set — exactly two inputs** (~line 206–207): delete "**no
   validation-error frame was designed for this screen** (error styling is inherited from `TextField`/the
   shared hook, unverified against Figma)" and replace it with the node `6585:75897` reference. Keep the
   hidden-third-input paragraph (the error frame reproduces the same artifact).
4. `### CreateAccountModal` → the delta table (~line 209–216) headed "the only **four** differences"
   becomes five: add a **Password rule** row (`non-empty` vs `≥8 chars + digit + special`), and correct
   the closing sentence "Token bindings, **validation rules**, and icon sourcing are identical to
   `SignInModal`" (tokens and icons still are; validation no longer is).
5. `### CreateAccountModal` → new **Validation error** subsection: the node id, the verbatim copy, the
   policy predicate, the "special character = not `[A-Za-z0-9]`, no letter required" reading, the reveal
   timing rule and why it mirrors the email field, and the fact that every pixel comes from the existing
   `TextField` invalid state with no new token and no new glyph.

**`docs/user-stories/epic-1247/1281-create-account-error.md`** (new) — blur-path stories only (BUG-20):
weak password + blur shows the copy and keeps submit disabled; the email field stays un-errored; each
boundary case (too short / no digit / no special / no letter) behaves as specified; the error clears live
once the policy is met and submit enables; the eye toggle still works while the field is in error; the
error does not shift the fields below it; reopening the modal clears the error.

**`docs/user-stories/index.md`** — new `#1281` row under Epic #1247, status `Initial`; mark the `#1249`
row's status as amended by #1281.

**`docs/user-stories/epic-1247/1249-kyb-create-account.md`** — supersede notes on Stories 2, 4 and 8
(step 8 above).

**`docs/exec-plans/known-bugs.md`** — BUG-20.

**`docs/exec-plans/tech-debt-tracker.md`** — TD-73 (renumbered).

No product-spec change: `docs/product-specs/` owns protocol/product intent, and this is an LP-facing
frontend state whose spec home is `docs/frontend/auth-components.md`, consistent with #1248–#1253.
