# User Stories: #1442 — OTP: a rejected code stays on screen and clears when you edit it

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1442](https://github.com/eq-lab/pipeline/issues/1442)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md#otpmodal),
[docs/frontend/ui-components.md](../../frontend/ui-components.md#otpinput)

A rejected passcode used to leave the OTP screen in a dead end: six red boxes already at the
sanitiser's length cap, so further keystrokes were silently swallowed, no caret or border rendered
anywhere, and — in the production flow, where the Cloudflare Turnstile widget sits inside the modal
— focus could be taken off the hidden input entirely. The error state is now stable and editable:
it stays on screen for as long as the user needs, focus is pulled back to the field the moment the
rejection lands, the last box carries the focused-box border so the field does not look locked, and
the red state clears on the first edit — a Backspace or a keystroke. Nothing is cleared on a timer.

Reached through the **production entry point** — `TopBar` → "Sign Up" (or "Sign In" with an
unverified account) → OTP screen. The `/test?tab=auth` "Open OTP screen" trigger named in
[1250-kyb-otp.md](./1250-kyb-otp.md) no longer exists; it was removed when #1362 landed the
production entry (logged in `docs/exec-plans/tech-debt-tracker.md`).

These stories need `VITE_API_BASE_URL` pointed at a live API and `VITE_TURNSTILE_SITE_KEY` set, and
a real inbox for a throwaway test address to reach the OTP screen with an outstanding passcode.

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

## Story 2: The error waits for you — it never clears itself

**Persona:** LP who reads the error message and then looks away from the screen.

**Pre-conditions:** The error state from Story 1, visible on screen. Do not touch the keyboard or
the mouse.

**Steps:**

1. Wait at least ten seconds without interacting.

**Expected outcomes:**

- The six boxes still hold the rejected digits and still carry the red fill — nothing has emptied
  itself.
- The error caption is still on screen, word for word.
- The field still has keyboard focus, so the next keystroke goes to it without a click.
- The last of the six boxes shows the focused-box border, so the field reads as editable rather
  than as a disabled control.

---

## Story 3: Backspace clears the error and gives the field back

**Persona:** LP who reacts to the red boxes by deleting a digit.

**Pre-conditions:** The error state from Story 1. Do not click anything first.

**Steps:**

1. Press Backspace once.

**Expected outcomes:**

- The red fill and the error caption clear at once, on the keystroke.
- Exactly one digit is removed; five digits remain in the boxes.
- The sixth box is now empty and shows the caret, so the next digit's destination is obvious.
- No click on the boxes was needed to get the keystroke through.

---

## Story 4: Typing the replacement digit re-verifies the corrected code

**Persona:** LP correcting a single mistyped digit.

**Pre-conditions:** The five-digit state from Story 3.

**Steps:**

1. Type one digit so the field reaches six again.

**Expected outcomes:**

- The digit appears in box 6 immediately.
- The spinner appears and the corrected six-digit code is sent for verification.
- If it is still wrong, the red state and caption return and stay — Stories 2 and 3 apply again,
  with no limit on how many corrections can be made this way.
- If it is right, the OTP screen closes and the session continues.

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
- Throughout Stories 1–5 the countdown ticks down once per second without interruption; it is
  independent of the verify and error states.

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
