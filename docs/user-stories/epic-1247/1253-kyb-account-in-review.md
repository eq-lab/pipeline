# User Stories: #1253 — KYB: Account-in-review screen

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1253](https://github.com/eq-lab/pipeline/issues/1253)
Spec: [docs/frontend/auth-components.md](../../frontend/auth-components.md)

This is a presentational modal — no network call, no persistence. `AccountInReviewModal` is
reachable only from `/test?tab=auth`; it is not wired to any production entry point. The
"notified" confirmation is local React state for the lifetime of the open modal —
closing/reopening the modal resets it. Styling-only stories (spacing, colors, radius) are out of
scope here — visual fidelity is verified separately by the QA agent's Figma comparison.

**Tech debt to be aware of while executing these stories:**

- TD-68: `--color-pipeline-positive-strong` (`#208000`) diverges from the existing
  `--color-pipeline-positive` (`#1a6600`) — shipped as a new token, not a bug to file.
- TD-69: the Issue's "review banner" deliverable has no node in the source-of-truth Figma
  section — nothing is built for it; not a bug to file.
- TD-70: the "Notify me" → notified flip is a local, non-persistent presentational mock with no
  endpoint and no reviewed-state source — not a bug to file.
- TD-61 (carried over): `AuthModalShell` centres its content column only when a screen opts into
  `align="center"` — this screen does; not a bug to file.

See `docs/exec-plans/tech-debt-tracker.md` for full detail on each entry.

---

## Story 1: Opening the screen shows the default state

**Persona:** LP visiting the Account-in-review preview.

**Pre-conditions:** LP dev server running, at `http://localhost:5173/test?tab=auth`.

**Steps:**

1. Click "Open Account-in-review screen".

**Expected outcomes:**

- The modal opens full-viewport, content vertically and horizontally centered.
- A round icon tile with a shield-check glyph appears above the heading.
- The heading reads "Your account is under review" and the description reads "It can take up to
  2 weeks. We can notify you when it’s ready."
- Two full-width buttons appear: a dark "Notify me" button and a "Go to app" button.
- The close button is present (top-right); there is no back arrow and no step badge.

---

## Story 2: Clicking "Notify me" flips to the confirmation

**Persona:** LP who wants to be notified when their account clears review.

**Pre-conditions:** Account-in-review modal open, default state.

**Steps:**

1. Click "Notify me".

**Expected outcomes:**

- The same button now reads "We’ll notify you" with a check glyph, in a pale-green fill with
  dark-green text.
- "Go to app" is unchanged.
- No page navigation occurs and no HTTP request is made.

---

## Story 3: The notified button is inert on a second click

**Persona:** LP who accidentally clicks the confirmed button again.

**Pre-conditions:** Already clicked "Notify me" once (button shows "We’ll notify you").

**Steps:**

1. Click the "We’ll notify you" button again.

**Expected outcomes:**

- Nothing changes — the button stays in the notified state.
- The button remains focusable (not visually or functionally `disabled`), just inert to clicks.

---

## Story 4: "Go to app" reaches the stand-in line

**Persona:** LP done waiting and ready to leave the screen.

**Pre-conditions:** Account-in-review modal open, in either state.

**Steps:**

1. Click "Go to app".

**Expected outcomes:**

- The modal closes.
- The preview page shows the stand-in line "Go to app — #1254 wires this to the LP dashboard."
- No HTTP request is made and no real navigation occurs — the LP-dashboard destination is
  #1254's job.

---

## Story 5: Closing via the × button

**Persona:** LP who wants to dismiss the screen without acting.

**Pre-conditions:** Account-in-review modal open.

**Steps:**

1. Click the × button (top-right).

**Expected outcomes:**

- The modal closes with no confirmation state change recorded.

---

## Story 6: Closing via Escape

**Persona:** LP who prefers the keyboard.

**Pre-conditions:** Account-in-review modal open.

**Steps:**

1. Press Escape.

**Expected outcomes:**

- The modal closes, same as clicking the × button.

---

## Story 7: Reopening after notifying resets the button

**Persona:** LP who closes the modal after notifying, then reopens it later.

**Pre-conditions:** Previously clicked "Notify me" (button showed "We’ll notify you"), then closed
the modal.

**Steps:**

1. Close the modal.
2. Reopen it via "Open Account-in-review screen".

**Expected outcomes:**

- The button is back to "Notify me" — the notified state does not persist across a close/reopen
  cycle.
