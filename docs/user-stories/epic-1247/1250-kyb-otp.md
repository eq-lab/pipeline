# User Stories: #1250 — KYB: OTP email-verification screen

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1250](https://github.com/eq-lab/pipeline/issues/1250)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md)

This is a presentational modal — no network call. `OtpModal` is reachable only from
`/test?tab=auth`; it is not wired to any production entry point. Styling-only stories (spacing,
colors, radius) are out of scope here — visual fidelity is verified separately by the QA agent's
Figma comparison.

**Tech debt to be aware of while executing these stories:** verification is mocked (TD-60,
`docs/exec-plans/tech-debt-tracker.md`): `123456` succeeds after ~800ms (a stand-in confirmation
line appears on the preview page), every other six-digit code ends in the error state. This is
intentional, not a bug to file.

---

## Story 1: Opening the screen shows the default empty state

**Persona:** LP visiting the OTP preview.

**Pre-conditions:** LP dev server running, at `http://localhost:5173/test?tab=auth`.

**Steps:**

1. Click "Open OTP screen".

**Expected outcomes:**

- The modal opens full-viewport with the heading "Check your inbox" and the description
  "We’ve sent a passcode to user@email.io" (apostrophe is a right single quotation mark).
- The code input is empty; no loader and no error message are shown.
- The resend line reads "Resend in 00:59".

---

## Story 2: The countdown ticks down every second

**Persona:** LP waiting to see if the code arrives.

**Pre-conditions:** OTP screen open, freshly opened.

**Steps:**

1. Wait ~10 seconds without typing anything.

**Expected outcomes:**

- The resend line's countdown decreases roughly in step with elapsed time (e.g. reads
  "Resend in 00:49" after 10 seconds).

---

## Story 3: The countdown reaching zero shows "Resend" with no timer

**Persona:** LP who waits out the full countdown.

**Pre-conditions:** OTP screen open.

**Steps:**

1. Wait for the full 59-second countdown to elapse without typing anything.

**Expected outcomes:**

- The resend line reads exactly "Resend", with no `MM:SS` suffix.

---

## Story 4: Entering six digits shows a verifying spinner

**Persona:** LP who received their code and types it in.

**Pre-conditions:** OTP screen open, code input empty.

**Steps:**

1. Type or paste six digits into the code input (e.g. `123456`).

**Expected outcomes:**

- A loading spinner appears below the resend line.
- The resend countdown keeps running (typing does not pause it).
- No error message is shown yet.

---

## Story 5: A wrong code ends in the error state

**Persona:** LP whose code is checked against the (mocked) backend.

**Pre-conditions:** Six digits just entered, spinner showing.

**Steps:**

1. Enter a wrong code (any six digits other than `123456`).
2. Wait about one second for the mock verification to resolve.

**Expected outcomes:**

- The spinner disappears.
- All six boxes render with the error styling, and a message "Enter the correct code" appears
  below the code input.
- The resend line keeps counting down; once the 59 seconds elapse it reads "Resend".

Entering `123456` instead succeeds (TD-60 mock): the modal closes and the preview page shows the
stand-in confirmation line ("OTP verified — open the Company Docs step from the button above.").
Neither behavior is a bug to file.

---

## Story 6: Editing the code after an error clears the error

**Persona:** LP retrying after a rejected code.

**Pre-conditions:** OTP screen showing the error state (per Story 5).

**Steps:**

1. Press Backspace (or otherwise change the code) in the code input.

**Expected outcomes:**

- The error message disappears immediately.
- The boxes return to their normal (non-error) appearance.
- The screen returns to its default, non-verifying state — no spinner is shown until six digits
  are entered again.

---

## Story 7: The back arrow and Escape both dismiss the modal

**Persona:** LP who decides not to complete verification.

**Pre-conditions:** OTP screen open.

**Steps:**

1. Press Escape.
2. Reopen the modal, then click the back arrow in the top-left corner.

**Expected outcomes:**

- Both actions close the modal.
- There is no × close button anywhere on this screen — the back arrow is the only visible
  dismiss affordance.

---

## Story 8: Reopening the modal resets the code, the countdown, and any error

**Persona:** LP who closes the modal mid-entry and reopens it.

**Pre-conditions:** OTP screen previously shown an error or a partially typed code.

**Steps:**

1. Dismiss the modal (Escape or the back arrow).
2. Reopen it via "Open OTP screen".

**Expected outcomes:**

- The code input is empty again.
- No error message or spinner is shown.
- The resend line reads "Resend in 00:59" again, as if freshly opened.

---

## Story 9: Non-digit and over-length input is rejected

**Persona:** LP pasting a code with formatting characters.

**Pre-conditions:** OTP screen open, code input empty.

**Steps:**

1. Paste `12 34 56` into the code input.
2. Clear it, then paste `1234567` (seven digits).

**Expected outcomes:**

- After the first paste, the input reads `123456` (spaces stripped).
- After the second paste, the input reads `123456` (truncated to six digits, the seventh
  dropped).

---

## Story 10: Submitting six digits performs no network call

**Persona:** Developer verifying the "presentational only" contract of #1250.

**Pre-conditions:** OTP screen open.

**Steps:**

1. Type six digits into the code input.
2. Observe the browser's Network tab throughout the spinner-then-error sequence.

**Expected outcomes:**

- No HTTP request is made — this issue ships no OTP verification endpoint call (deferred to
  #1254).

---

## Story 11: "Resend" is inert text

**Persona:** Developer verifying the "presentational only" scope of #1250.

**Pre-conditions:** OTP screen open, in the error state (Resend line reads "Resend" with no
countdown).

**Steps:**

1. Click the "Resend" text.

**Expected outcomes:**

- Nothing happens — it renders as plain, non-interactive text (no button, no handler). No
  sub-issue owns the resend action in this epic; it is deferred to #1254.
