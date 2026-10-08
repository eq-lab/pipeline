# User Stories: #1442 — OTP: hold the error briefly, then clear the boxes for a fresh entry

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1442](https://github.com/eq-lab/pipeline/issues/1442)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md#otpmodal),
[docs/frontend/ui-components.md](../../frontend/ui-components.md#otpinput)

A rejected passcode used to leave the OTP screen in a dead end: six red boxes already at the
sanitiser's length cap, so further keystrokes were silently swallowed, no caret rendered, and — in
the production flow, where the Cloudflare Turnstile widget sits inside the modal — focus could be
taken off the hidden input entirely. The error is now held for three seconds and then clears
itself back to the shipped default state (Figma `6486:81665`): six empty boxes, caption gone,
caret in box 1. Focus is also reclaimed the moment the rejection lands, so an immediate correction
is typed into the field rather than lost.

Reached through the **production entry point** — `TopBar` → "Sign Up" (or "Sign In" with an
unverified account) → OTP screen. The `/test?tab=auth` "Open OTP screen" trigger named in
[1250-kyb-otp.md](./1250-kyb-otp.md) no longer exists; it was removed when #1362 landed the
production entry (logged in `docs/exec-plans/tech-debt-tracker.md`).

These stories need `VITE_API_BASE_URL` pointed at a live API and `VITE_TURNSTILE_SITE_KEY` set, and
a real inbox for a throwaway test address to reach the OTP screen with an outstanding passcode.
Story 2's timing assertion is "about three seconds" by observation — the exact constant is
`OTP_ERROR_VISIBLE_MS` in `useOtpModal.ts`.

Styling-only assertions (spacing, colors) are out of scope here — visual fidelity is verified
separately against Figma `6486:81863` (error) and `6486:81665` (default).

---

## Story 1: A wrong code turns the boxes red and explains why

**Persona:** LP on the OTP screen who mistypes the passcode.

**Pre-conditions:** OTP screen open with a genuinely outstanding passcode.

**Steps:**

1. Type six digits that do not match the real code.

**Expected outcomes:**

- A loading spinner (`role="status"`) appears while the request is in flight.
- All six boxes then render in the invalid style (negative-secondary fill, negative-strong digits)
  and the caption (`role="alert"`) reads "Code is incorrect or expired. Request a new one."
- The resend countdown keeps ticking — it is not stopped, paused, or restarted by the error.
- The keyboard caret is still in the field: nothing has to be clicked before the next story works.

---

## Story 2: Waiting out the error returns a fresh, empty field with the caret in box 1

**Persona:** LP who reads the error message and does nothing else.

**Pre-conditions:** The error state from Story 1, visible on screen. Do not touch the keyboard or
the mouse.

**Steps:**

1. Wait about three seconds without interacting.
2. Type a single digit.

**Expected outcomes:**

- The six boxes clear to empty and lose the red fill.
- The error caption disappears entirely — no lingering notice is left behind; the screen is
  identical to the default state, countdown line included.
- The caret is visible in box 1 (the active-box border and caret element are both rendered), with
  no click needed.
- The digit typed in step 2 lands in box 1 immediately.

---

## Story 3: Correcting the code pre-empts the clear — nothing is wiped from under you

**Persona:** LP who reacts to the red boxes by deleting a digit instead of waiting.

**Pre-conditions:** The error state from Story 1, freshly shown.

**Steps:**

1. Within the three-second window, press Backspace once.
2. Wait a further five seconds without typing anything else.

**Expected outcomes:**

- The red fill and the error caption clear at once, on the keystroke — not after a delay.
- Exactly one digit is removed; five digits remain in the boxes.
- After the five-second wait those five digits are **still there**. The pending clear was
  cancelled by the edit; the field is not wiped out from under a user who is mid-correction.

---

## Story 4: A second wrong code gets its own full three seconds

**Persona:** LP who gets the code wrong twice in a row.

**Pre-conditions:** The error state from Story 1. A second outstanding passcode is not required —
any six digits will be rejected once the first code is burned.

**Steps:**

1. Wait about two seconds into the error window.
2. Press Backspace, then type any digit so the field reaches six again and re-verifies.
3. When the second error appears, start counting again.

**Expected outcomes:**

- The second rejection shows the red boxes and the caption as before.
- The error is held for a fresh ~3 s measured from the **second** rejection — it does not vanish
  after the ~1 s left over from the first window, and it does not clear twice.
- After that window the field clears once, to six empty boxes with the caret in box 1.

---

## Story 5: Resend clears the rejected code and the countdown is never disturbed

**Persona:** LP who gives up on the mistyped code and asks for a new one.

**Pre-conditions:** OTP screen open; the countdown has reached zero so "Resend" is a button.

**Steps:**

1. Type a wrong code and let it be rejected.
2. Click "Resend" while the boxes are still red.

**Expected outcomes:**

- The boxes clear to six empty fields and the error caption disappears immediately on the click —
  the old rejected digits are not left on screen in red while a new code is in flight.
- The caret returns to box 1, so the new passcode can be typed as soon as it arrives.
- The countdown restarts at "Resend in 00:59" and the accepted-request notice appears.
- Throughout Stories 1–5 the countdown ticks down once per second without interruption; the error
  window and the countdown are independent.

---

## Story 6: Focus stays in the field across the rejection, with the captcha widget present

**Persona:** LP verifying in the real production flow, where the Turnstile widget is rendered
inside the OTP modal below the resend line.

**Pre-conditions:** OTP screen reached through TopBar → Sign Up (or Sign In with an unverified
account), with `VITE_TURNSTILE_SITE_KEY` set so the real widget mounts.

**Steps:**

1. Type a wrong code and let it be rejected.
2. Without clicking anything, immediately press Backspace and type a replacement digit.

**Expected outcomes:**

- The keystrokes in step 2 reach the OTP field — the digit count changes on screen. They are not
  swallowed by the captcha iframe or dropped on the floor.
- No click on the boxes is required first.
- If focus had drifted to the captcha widget, it is pulled back to the OTP input when the error
  appears; if the user had deliberately tabbed to the back arrow or the Resend affordance, focus
  stays on that control instead and is not yanked away.
