# User Stories: #1280 — KYB: Forgot Password screen

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1280](https://github.com/eq-lab/pipeline/issues/1280)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md)

This is a presentational modal — no network call, no persistence. `ForgotPasswordModal` is
reachable only from `/test?tab=auth`; it is not wired to any production entry point.
Styling-only stories (spacing, colors, radius) are out of scope here — visual fidelity is
verified separately by the QA agent's Figma comparison against Figma node `6704-107100`.

**Tech debt to be aware of while executing these stories:** the design has no confirmation, no
reset-link landing screen, and no "set a new password" screen (TD-71,
`docs/exec-plans/tech-debt-tracker.md`) — submitting shows a stand-in line instead of a real
result. This is intentional, not a bug to file.

---

## Story 1: Opening the screen shows the empty state

**Persona:** LP who forgot their password.

**Pre-conditions:** LP dev server running, at `http://localhost:5173/test?tab=auth`.

**Steps:**

1. Click "Open Forgot Password screen".

**Expected outcomes:**

- The modal opens full-viewport with the heading "Reset your password".
- One email field is shown, empty, placeholder "Enter corporate email"; no password field.
- "Send Reset Link" is disabled.
- The footer reads "Remembered it? Back to sign in".
- The right-hand image panel is present, and a × close button sits top-right.
- There is no back arrow and no step badge.

---

## Story 2: Typing a well-formed email enables "Send Reset Link"

**Persona:** LP entering their corporate email.

**Pre-conditions:** Forgot Password screen open, field empty.

**Steps:**

1. Type a well-formed email, e.g. `lp@example.com`.

**Expected outcomes:**

- "Send Reset Link" becomes enabled (full opacity).

---

## Story 3: A malformed email shows an error on blur

**Persona:** LP who mistypes their email.

**Pre-conditions:** Forgot Password screen open, field empty.

**Steps:**

1. Type a malformed email, e.g. `notanemail`.
2. Click or tab away from the field (blur).

**Expected outcomes:**

- The message "Enter the correct email address" appears below the field.
- "Send Reset Link" stays disabled.

---

## Story 4: Submitting closes the modal and shows the stand-in line

**Persona:** LP requesting a reset link.

**Pre-conditions:** Forgot Password screen open, a well-formed email entered.

**Steps:**

1. Click "Send Reset Link".
2. Observe the browser's Network tab throughout.

**Expected outcomes:**

- The modal closes.
- The preview page shows "Reset link requested — #1265 wires this to the real password-reset
  endpoint."
- No HTTP request is made — this issue ships no reset-request endpoint call (deferred to #1265).

---

## Story 5: "Forgot password?" on the Sign in screen opens this screen

**Persona:** LP who can't remember their password while signing in.

**Pre-conditions:** Sign in screen open (`Open Sign In modal`).

**Steps:**

1. Click "Forgot password?".

**Expected outcomes:**

- The Sign in screen closes and the Forgot Password screen opens in its place.
- Only one modal is visible at any time — Sign in and Forgot Password never appear stacked.

---

## Story 6: "Back to sign in" returns to the Sign in screen

**Persona:** LP who remembered their password after all.

**Pre-conditions:** Forgot Password screen open (via Story 5 or the standalone trigger).

**Steps:**

1. Click "Back to sign in".

**Expected outcomes:**

- The Forgot Password screen closes and the Sign in screen opens in its place.
- Only one modal is visible at any time.

---

## Story 7: × and Escape both dismiss the screen

**Persona:** LP who decides not to reset their password.

**Pre-conditions:** Forgot Password screen open.

**Steps:**

1. Press Escape.
2. Reopen the modal, then click the × button top-right.

**Expected outcomes:**

- Both actions close the modal and return to the `/test` page with no dialog visible.

---

## Story 8: Reopening the screen resets the field, the error, and the disabled button

**Persona:** LP who closes the modal mid-entry and reopens it.

**Pre-conditions:** Forgot Password screen previously shown a typed email or an error.

**Steps:**

1. Dismiss the modal (Escape or ×).
2. Reopen it via "Open Forgot Password screen".

**Expected outcomes:**

- The email field is empty again.
- No error message is shown.
- "Send Reset Link" is disabled again, as if freshly opened.
