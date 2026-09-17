# User Stories: #1248 — KYB: Sign-in modal (email + password)

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1248](https://github.com/eq-lab/pipeline/issues/1248)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md)

This is a presentational modal — no network call. `SignInModal` is reachable only from
`/test?tab=auth`; it is not wired to any production entry point (`TopBar`'s "Connect Wallet"
still opens `ConnectWalletModal` unchanged). Styling-only stories (spacing, colors, radius) are
out of scope here — visual fidelity is verified separately by the QA agent's Figma comparison.

---

## Story 1: Empty fields render a disabled submit button

**Persona:** LP visiting the sign-in preview.

**Pre-conditions:** LP dev server running, at `http://localhost:5173/test?tab=auth`.

**Steps:**

1. Click "Open Sign In modal".
2. Observe the modal with both fields empty.

**Expected outcomes:**

- The modal opens full-viewport with the heading "Sign in".
- Both the email field (placeholder "Enter corporate email") and the password field
  (placeholder "Password") are empty.
- The "Sign In" submit button is disabled.
- No validation error message is shown for either field.

---

## Story 2: Filling both fields with a well-formed email enables submit

**Persona:** LP filling out the sign-in form.

**Pre-conditions:** Sign In modal open, both fields empty.

**Steps:**

1. Type a well-formed email (e.g. `lp@example.com`) into the email field.
2. Type any non-empty value into the password field.

**Expected outcomes:**

- The "Sign In" submit button becomes enabled.
- No validation error message is shown.

---

## Story 3: A malformed email shows its error on blur, and keeps submit disabled

**Persona:** LP who mistypes their email.

**Pre-conditions:** Sign In modal open.

**Steps:**

1. Type a malformed value (e.g. `dsfdffs`) into the email field.
2. Move focus away from the email field (blur), leaving the password field empty.

**Expected outcomes:**

- The email field shows the error "Enter the correct email address", right-aligned below the
  field, without shifting the layout of the fields below it.
- The "Sign In" submit button remains disabled.

---

## Story 4: An attempted submit with an empty password shows its error

**Persona:** LP who submits before filling the password.

**Pre-conditions:** Sign In modal open, a well-formed email entered, password left empty.

**Steps:**

1. Trigger the form's submit (e.g. pressing Enter in the email field).

**Expected outcomes:**

- The password field shows the error "Enter the correct password", right-aligned below the
  field.
- The "Sign In" submit button remains disabled (the form is still invalid).

---

## Story 5: Password show/hide toggle

**Persona:** LP verifying their typed password before submitting.

**Pre-conditions:** Sign In modal open, some text typed into the password field.

**Steps:**

1. Click the eye icon inside the password field.
2. Click it again.

**Expected outcomes:**

- After the first click, the password field's content is shown as plain text and the icon
  flips to its "hide" affordance (accessible name "Hide password").
- After the second click, the password field is masked again and the icon's accessible name
  reverts to "Show password".

---

## Story 6: Escape and the × button dismiss the modal

**Persona:** LP who decides not to sign in.

**Pre-conditions:** Sign In modal open.

**Steps:**

1. Press Escape.
2. Reopen the modal, then click the × button in the top-right corner.

**Expected outcomes:**

- Both actions close the modal. Clicking anywhere else inside the panel does not close it (the
  panel is full-viewport — there is no scrim to click).

---

## Story 7: Reopening the modal resets all fields

**Persona:** LP who closes the modal mid-entry and reopens it.

**Pre-conditions:** Sign In modal open with text typed into both fields.

**Steps:**

1. Dismiss the modal (Escape or × button).
2. Reopen it via "Open Sign In modal".

**Expected outcomes:**

- Both the email and password fields are empty again; no validation errors are shown.

---

## Story 8: Submitting valid credentials performs no network call

**Persona:** Developer verifying the "presentational only" contract of #1248.

**Pre-conditions:** Sign In modal open, a well-formed email and any non-empty password entered.

**Steps:**

1. Click the "Sign In" submit button.
2. Observe the browser's Network tab.

**Expected outcomes:**

- No HTTP request is made — this issue ships no email+password endpoint call (deferred to
  #1254). The button click does not throw, navigate, or show any error.

---

## Story 9: "Continue with wallet", "Forgot password?", and "Create account" are inert

**Persona:** Developer verifying the "presentational only" scope of #1248.

**Pre-conditions:** Sign In modal open.

**Steps:**

1. Click "Continue with wallet".
2. Click "Forgot password?" text.
3. Click "Create account" text.

**Expected outcomes:**

- "Continue with wallet" is a real button but its default handler is a no-op (the wallet
  chooser wiring belongs to #1254).
- "Forgot password?" and "Create account" render as plain, non-interactive text — clicking them
  does nothing (no sub-issue owns "Forgot password?" in this epic; "Create account" is #1249).
