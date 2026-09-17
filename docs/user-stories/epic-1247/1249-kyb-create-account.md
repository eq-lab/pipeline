# User Stories: #1249 — KYB: Create-account modal

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1249](https://github.com/eq-lab/pipeline/issues/1249)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md)

This is a presentational modal — no network call. `CreateAccountModal` is reachable only from
`/test?tab=auth`; it is not wired to any production entry point. Styling-only stories (spacing,
colors, radius) are out of scope here — visual fidelity is verified separately by the QA agent's
Figma comparison.

---

## Story 1: Empty fields render a disabled submit button

**Persona:** LP visiting the create-account preview.

**Pre-conditions:** LP dev server running, at `http://localhost:5173/test?tab=auth`.

**Steps:**

1. Click "Open Create Account modal".
2. Observe the modal with both fields empty.

**Expected outcomes:**

- The modal opens full-viewport with the heading "Create account".
- Both the email field (placeholder "Enter corporate email") and the password field
  (placeholder "Password") are empty.
- The "Sign Up" submit button is disabled.
- No validation error message is shown for either field.

---

## Story 2: Filling both fields with a well-formed email enables submit

**Persona:** LP filling out the create-account form.

**Pre-conditions:** Create Account modal open, both fields empty.

**Steps:**

1. Type a well-formed email (e.g. `lp@example.com`) into the email field.
2. Type any non-empty value into the password field.

**Expected outcomes:**

- The "Sign Up" submit button becomes enabled.
- No validation error message is shown.

---

## Story 3: A malformed email shows its error on blur, and keeps submit disabled

**Persona:** LP who mistypes their email.

**Pre-conditions:** Create Account modal open.

**Steps:**

1. Type a malformed value (e.g. `dsfdffs`) into the email field.
2. Move focus away from the email field (blur), leaving the password field empty.

**Expected outcomes:**

- The email field shows the error "Enter the correct email address", right-aligned below the
  field, without shifting the layout of the fields below it.
- The "Sign Up" submit button remains disabled.

---

## Story 4: An attempted submit with an empty password shows its error

**Persona:** LP who submits before filling the password.

**Pre-conditions:** Create Account modal open, a well-formed email entered, password left empty.

**Steps:**

1. Trigger the form's submit (e.g. pressing Enter in the email field).

**Expected outcomes:**

- The password field shows the error "Enter the correct password", right-aligned below the
  field.
- The "Sign Up" submit button remains disabled (the form is still invalid).

---

## Story 5: Password show/hide toggle

**Persona:** LP verifying their typed password before submitting.

**Pre-conditions:** Create Account modal open, some text typed into the password field.

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

**Persona:** LP who decides not to create an account.

**Pre-conditions:** Create Account modal open.

**Steps:**

1. Press Escape.
2. Reopen the modal, then click the × button in the top-right corner.

**Expected outcomes:**

- Both actions close the modal. Clicking anywhere else inside the panel does not close it (the
  panel is full-viewport — there is no scrim to click).

---

## Story 7: Reopening the modal resets all fields

**Persona:** LP who closes the modal mid-entry and reopens it.

**Pre-conditions:** Create Account modal open with text typed into both fields.

**Steps:**

1. Dismiss the modal (Escape or × button).
2. Reopen it via "Open Create Account modal".

**Expected outcomes:**

- Both the email and password fields are empty again; no validation errors are shown.

---

## Story 8: Submitting valid credentials performs no network call and does not navigate

**Persona:** Developer verifying the "presentational only" contract of #1249.

**Pre-conditions:** Create Account modal open, a well-formed email and any non-empty password
entered.

**Steps:**

1. Click the "Sign Up" submit button.
2. Observe the browser's Network tab and the current URL.

**Expected outcomes:**

- No HTTP request is made — this issue ships no account-creation endpoint call (deferred to
  #1254). The button click does not throw, navigate to an OTP screen (#1250 owns that screen),
  or show any error.

---

## Story 9: "Continue with wallet" and "Log in" are inert

**Persona:** Developer verifying the "presentational only" scope of #1249.

**Pre-conditions:** Create Account modal open.

**Steps:**

1. Click "Continue with wallet".
2. Click the "Log in" text in the footer.

**Expected outcomes:**

- "Continue with wallet" is a real button but its default handler is a no-op (wiring is
  #1254's job).
- "Log in" renders as plain, non-interactive text — clicking it does nothing and it is not
  reachable via `Tab`. The cross-link to `SignInModal` is #1254's job.

---

## Story 10: The screen has exactly two fields and no "Forgot password?" line

**Persona:** Developer confirming the create-account frame's delta against sign-in is
intentional, not a missed field.

**Pre-conditions:** Create Account modal open.

**Steps:**

1. Count the visible input fields.
2. Look for a "Forgot password?" line.

**Expected outcomes:**

- Exactly two fields are present: email and password. There is no confirm-password field, no
  company/organization field, and no terms-acceptance checkbox — none of these exist in the
  Figma design.
- No "Forgot password?" line is rendered (present in `SignInModal`, intentionally absent here).
