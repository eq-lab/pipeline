# Issue #1442: OTP: a wrong code cannot be deleted; show the error briefly, then clear the boxes for a fresh entry

Source: https://github.com/eq-lab/pipeline/issues/1442

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247). The OTP screen
shipped in #1250 and was wired to the backend in #1265.

## Root cause (reproduced before planning)

The symptom was reproduced in a **real Chrome** against an isolated harness that mounts the
production `OtpModal` with a `verify` that rejects with `ApiError(401)`, and independently in
jsdom via a throwaway vitest probe. Both environments agree, and both contradict the literal
report. The confirmed facts:

1. **Focus is never lost.** After the rejected verify, `document.activeElement` is still the
   hidden `<input>` (`aria-label="Verification code"`), with `selectionStart/End === 6`. The
   `role="alert"` caption mounting does not move focus — `AuthModalShell`'s auto-focus effect is
   keyed on `[open]` only, and the caption is a sibling node, so `OtpInput` is not remounted.
   The hypothesis in the issue comment (focus loss) is **wrong**; no `.focus()`-on-click fix is
   needed for that reason.
2. **Backspace does work.** Pressing Backspace in the error state changes the value `111111` →
   `11111`, clears `aria-invalid`, and removes the alert — exactly as the spec says.
3. **Typing does nothing, silently.** `useOtpInput.sanitize` does `raw.replace(/\D/g, "").slice(0, length)`.
   At six digits the field is already at `length`, so every further keystroke is sliced away:
   `onChange` fires with the unchanged value, `setCode` re-renders nothing. A user who reacts to
   the red boxes by *typing* the correct code sees **zero** response — no digit, no caret, no
   error clearing. That is the reported "cannot be edited".
4. **The error state renders no caret and no focus affordance at all.** `OtpInput` computes
   `isActive = !invalid && focused && index === value.length`. With six digits, `value.length` is
   `6` and no box index equals 6, so even without the `!invalid` guard there is no caret; the six
   boxes are flat red fills with no border and no focus ring. Verified in Chrome: zero caret
   elements rendered while focused. The field therefore *looks* disabled.
5. **Single-digit correction snaps straight back to red.** Deleting one digit and typing a
   replacement reaches six digits again, which re-fires auto-verify on a still-wrong code; the
   boxes go red again within the request latency. Verified in Chrome (`111111` → Backspace →
   type `2` → `111112`, `aria-invalid="true"`, alert back). This is why the wrong code appears
   to "come back" and the user feels stuck.

So the defect is **not** a broken state machine or lost focus: it is that the error state is a
dead end with no visible way out — a full field that silently swallows keystrokes, no caret, and
no reset affordance. The issue's prescribed fix (hold the error briefly, then clear to six empty
boxes with the caret in box 1) addresses exactly this, and is the fix planned below.

## Figma

File `A43rjYYjSwdTmiwwf5cx5n`, error state node `6486:81863` ("OTP — Error"), read through the
local Dev Mode MCP.

- The frame is **static**: `get_motion_context` on `6486:81863` returns
  `timelineDurationMs: null`, `motionSummary: null`. There is **no timed-clear affordance in
  Figma** — the error-window duration is product behaviour, not a design artifact, and is decided
  below.
- The frame's only variable binding is `gap-xs: 8`. The error-state fills already shipped in
  #1250 (`--color-pipeline-negative-secondary` box fill,
  `--color-pipeline-negative-strong` digits and caption) are unchanged by this issue.
- The frame still renders the Resend line (`6486:81874`) alongside the error, confirming the
  countdown is independent of the error state — matching today's behaviour, which stays unchanged.
- The post-clear target state is the already-shipped default frame `6486:81665` (six empty boxes,
  caret in box 1, countdown line, no caption). **No new visual is introduced by this issue.**

## Scope

In scope:

- `docs/frontend/auth-components.md` § OtpModal — specify the timed error window and the
  auto-clear (docs lead; this is step 1).
- `docs/frontend/ui-components.md` § OtpInput — document the new imperative `focus()` ref handle.
- `packages/ui/src/components/OtpInput/OtpInput.tsx` — expose a `focus()` handle via
  `forwardRef` + `useImperativeHandle`.
- `packages/frontend/src/components/useOtpModal.ts` — the error-window timer, the auto-clear, and
  a focus-request signal.
- `packages/frontend/src/components/OtpModal.tsx` — hold the `OtpInput` ref and honour the
  focus-request signal.
- Tests in `packages/frontend/src/components/OtpModal.test.tsx` and
  `packages/frontend/src/components/OtpInput.dom.test.tsx`.
- A new user-stories doc `docs/user-stories/epic-1247/1442-otp-error-auto-clear.md`.

Out of scope:

- The resend countdown, the Turnstile captcha slot, and every resend-related message — unchanged.
- `useEmailAuthFlow.ts` — `handleOtpVerify` just throws; no change is needed there. (The issue
  body names `useEmailAuthFlow.ts` as a location; that is inaccurate — the OTP `status`
  transitions and `setCode` live in `useOtpModal.ts`, which did not exist under that name when
  the issue was filed.)
- Per-box caret positioning / click-to-edit-a-specific-box. `OtpInput` is one hidden input behind
  six painted boxes; making box 3 individually editable is a redesign, not this fix.
- Any change to `sanitize`'s six-digit cap, or to the auto-verify-at-six-digits behaviour.

## Decisions

**D1 — The error window is 3000 ms** (`OTP_ERROR_VISIBLE_MS = 3000`, exported from
`useOtpModal.ts`), the top of the 2–3 s range the issue suggests. Reasoning:

- The caption "Code is incorrect or expired. Request a new one." is 9 words. At a typical silent
  reading rate of ~200 wpm that is ~2.7 s, plus roughly half a second to notice the colour change
  and move the eye to the caption. At 2000 ms the layout would change out from under a user who
  is still reading the sentence that explains it; 3000 ms lets the message land.
- `role="alert"` makes a screen reader start speaking the caption immediately; the spoken caption
  runs ~3 s, so clearing earlier would reset focus and the field mid-announcement.
- 3000 ms is an order of magnitude inside the 20-second bound of WCAG 2.2.1 (Timing Adjustable),
  and the user can always pre-empt it by typing, so no extend/disable control is required.
- It stays short enough that an idle user is not left staring at a dead field.

**D2 — After the window, the screen returns to the already-shipped default state**
(Figma `6486:81665`): six empty boxes, caret in box 1, countdown line, **no caption**. The
alternative — keeping the error caption as a lingering notice after the boxes clear — was
rejected: it would render a state that exists in no Figma frame, it would need a fourth piece of
state in a hook the epic's QA pass checks against Figma, and the user has already had the full
3 s to read the message. The issue's "Expected" text ("six empty, fresh fields") says the same.

**D3 — Focus is requested explicitly, not assumed.** Although focus is usually still on the
hidden input (fact 1 above), the user may have clicked the Back button, the Resend button, or the
Turnstile iframe during the 3 s window. The auto-clear therefore calls `focus()` on the input
imperatively so the caret always lands in box 1, as the issue requires.

**D4 — Clicking Resend also clears the code and cancels the window.** A resend means a new code
is on its way; leaving the old rejected digits on screen in red, with a pending timer, would be
wrong. `onResend` resets `code` to `""` and `status` to `idle` and raises the same focus request.
This is a deliberate extension beyond the issue text; it does not touch the countdown, the resend
notices, or the resend-error captions, so "the countdown / Resend affordance behaves as today"
still holds.

**D5 — No change to `isActive` in `OtpInput`.** The missing caret in the error state is a
consequence of the field being full (fact 4), which the auto-clear removes. Dropping the
`!invalid` guard would change nothing while six digits are present and would repaint a caret the
Figma error frame does not show. Left alone.

## Assumptions and Risks

- Branch `fix/otp-error-clear` is checked out and pushed; draft PR #1443 is open. The manager
  owns the commit — the coder must not commit.
- `.mcp.json` (modified) and the untracked `Cash management.md` / `trustee-new.md` are unrelated
  to this work and must not be staged or touched.
- **Timer leak risk.** The window must be a `useEffect` cleanup-owned `setTimeout`, never a bare
  `setTimeout` inside the `verify` rejection handler — otherwise a second rejection stacks timers
  and a close/unmount sets state on an unmounted hook. The effect must restart on each new error,
  keyed on a monotonically increasing error sequence number, so the second rejection restarts the
  window instead of inheriting the first one's remaining time.
- **Stale-rejection risk.** `setCode` already bumps `requestIdRef` on every edit, so a rejection
  that arrives after the user edited is dropped and must therefore never schedule a window. Since
  the timer is driven by the `status === "error"` transition (which the guard already prevents),
  this falls out for free — but it needs a test.
- **Existing test suite.** `OtpModal.test.tsx` runs under
  `vi.useFakeTimers({ shouldAdvanceTime: true })` with `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
  Several existing tests (`"a rejected verify shows the error alert and aria-invalid"`, the
  network-error `it.each`, `"editing the code from the error state clears the alert"`,
  `"editing the code while a verify is in flight discards the stale result"`) assert on the error
  state *after* an `await` that may advance real time. If any of them starts flaking because the
  3 s window fires mid-assertion, assert immediately after the rejection and do **not** widen the
  window — shortening it is a product regression.
- **`OtpInput` is exported from `@pipeline/ui`.** Converting it to `forwardRef` changes its public
  type. Check for other consumers before editing: `OtpInput.stories.tsx` and
  `OtpInput.dom.test.tsx` are the only ones known; re-run the `@pipeline/ui` build.
- **Stale user-stories doc.** `docs/user-stories/epic-1247/1250-kyb-otp.md` still instructs the
  reader to click "Open OTP screen" on `/test?tab=auth`; that trigger no longer exists in
  `packages/frontend/src/routes/test.tsx` (the production entry point landed in #1362). Do not
  rewrite that doc as part of this issue — log it in
  `docs/exec-plans/tech-debt-tracker.md` and write the new stories against the production path.
- Reaching the OTP screen manually requires a real signup against the backend. For local
  verification, the isolated-harness approach used for the root-cause analysis (a throwaway Vite
  entry outside the repo that mounts `OtpModal` with a rejecting `verify`) is the cheap path; the
  automated tests are the contract.

## Open Questions

_None_

## Implementation Steps

1. **Docs first — `docs/frontend/auth-components.md` § OtpModal.** In the **State machine**
   bullet list, immediately after the existing bullet "Any edit clears an `error` back to
   `idle` …", insert:

   > - An `error` is held for `OTP_ERROR_VISIBLE_MS` (3000 ms) and then clears itself: the code
   >   resets to the empty string, `status` returns to `idle`, the caption is removed, and focus
   >   is driven back to the OTP input so the caret sits in box 1 and the user can type a new code
   >   immediately. The screen is then byte-identical to the default state (Figma `6486:81665`).
   >   The duration is product behaviour — the Figma error frame (`6486:81863`) carries no timed
   >   affordance — chosen so the 9-word caption can be read, and spoken by a screen reader,
   >   before the layout changes.
   > - The window is pre-empted by any edit: typing or deleting during those 3 s clears the error
   >   at once, accepts the keystroke, and cancels the pending clear (nothing is wiped out from
   >   under the user). A second rejection restarts the window from zero rather than stacking a
   >   second timer. A successful verify, a `Resend` click, and closing or reopening the modal all
   >   cancel it. Clicking `Resend` additionally clears the code back to six empty boxes and
   >   returns focus to box 1, since a new code is on its way.
   > - Note that while six digits are present the field is at `OtpInput`'s length cap, so further
   >   keystrokes are sanitised away with no visible effect, and no caret is rendered. The timed
   >   clear is what guarantees the error state is never a dead end.

   Also add to the **Accessibility** paragraph: "the timed error clear moves focus back to the OTP
   input; it never moves focus away from a control the user is interacting with, because any edit
   cancels it first."

2. **`docs/frontend/ui-components.md` § OtpInput** (starts at line 642). Document the new
   imperative handle on the props/API block: `OtpInput` is a `forwardRef` component exposing
   `OtpInputHandle { focus(): void }`, which focuses the single hidden `<input>` (the caret then
   renders at `value.length`). Added for #1442 so `OtpModal` can return the caret to box 1 after
   the timed error clear; the component is otherwise unchanged and the ref is optional.

3. **`packages/ui/src/components/OtpInput/OtpInput.tsx`.** Wrap the component in `forwardRef`,
   export `export interface OtpInputHandle { focus: () => void }`, and
   `useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), [])`. Mirror the
   existing repo pattern in `packages/frontend/src/components/Turnstile.tsx` (`forwardRef` with a
   named function component so the displayName survives). Export the handle type from
   `packages/ui/src/components/OtpInput/index.ts` and from the package barrel alongside
   `OtpInput`. Change nothing else — not `isActive`, not `sanitize`, not the fills (D5).

4. **`packages/frontend/src/components/useOtpModal.ts`.**
   - Export `export const OTP_ERROR_VISIBLE_MS = 3000;` next to the other constants.
   - Add `const [errorSeq, setErrorSeq] = useState(0);` and
     `const [focusRequestId, setFocusRequestId] = useState(0);`
   - In the `verify` rejection branch, alongside `setStatus("error")` and `setErrorMessage(...)`,
     do `setErrorSeq((n) => n + 1)`. The existing `requestIdRef` guard already fences this, so a
     stale rejection never schedules a window.
   - Add the window effect:
     ```
     useEffect(() => {
       if (!open || status !== "error") return;
       const id = setTimeout(() => {
         setCodeState("");
         setStatus("idle");
         setErrorMessage(undefined);
         requestIdRef.current += 1;
         setFocusRequestId((n) => n + 1);
       }, OTP_ERROR_VISIBLE_MS);
       return () => clearTimeout(id);
     }, [open, status, errorSeq]);
     ```
     The `errorSeq` dependency is what makes a second rejection restart the window (the first
     effect run is cleaned up, so no timers stack); `status !== "error"` covers the edit, success
     and close cases through the same cleanup. Bumping `requestIdRef` on clear discards any verify
     still in flight against the now-wiped code.
   - In the existing `open` reset effect, also reset `errorSeq` and leave `focusRequestId` alone
     (the shell already focuses the input on open, so no extra request is needed there).
   - In `onResend`, after the early-return guard, add `setCodeState("")`, `setStatus("idle")`,
     `setErrorMessage(undefined)`, `requestIdRef.current += 1` and
     `setFocusRequestId((n) => n + 1)` (D4), before the existing resend bookkeeping.
   - Add `focusRequestId: number` to `UseOtpModalResult` and return it.

5. **`packages/frontend/src/components/OtpModal.tsx`.** Add
   `const otpInputRef = useRef<OtpInputHandle>(null);`, pass it to `<OtpInput ref={otpInputRef} … />`,
   pull `focusRequestId` out of `useOtpModal`, and add
   ```
   useEffect(() => {
     if (focusRequestId > 0) otpInputRef.current?.focus();
   }, [focusRequestId]);
   ```
   No markup, copy, or class changes.

6. **Comment hygiene.** Each touched file keeps exactly its one existing 2–3-line `// spec:`
   header and gains no other comment — no JSDoc, no body comments, no test comments
   (`AGENTS.md` → Lint & style).

7. **`docs/user-stories/epic-1247/1442-otp-error-auto-clear.md`** — new file, following the shape
   of `1265-wire-kyb-auth.md`. Stories, written against the production entry point (TopBar →
   Sign Up → OTP), not the removed `/test` trigger:
   1. Wrong code → the six boxes turn red and the caption "Code is incorrect or expired. Request
      a new one." appears.
   2. Waiting ~3 s without touching anything → the boxes clear to six empty fields, the caption
      disappears, and the caret blinks in box 1; typing a digit immediately fills box 1.
   3. Pressing Backspace while the boxes are red → the red state and caption clear at once, the
      digit is removed, and the field is **not** wiped 3 s later.
   4. A second wrong code after the first → the red state is held for a fresh ~3 s from the second
      rejection.
   5. The resend countdown keeps ticking throughout and is unaffected by the error window.

8. **Tech debt.** Append an entry to `docs/exec-plans/tech-debt-tracker.md` for the stale
   `/test?tab=auth` "Open OTP screen" instructions in
   `docs/user-stories/epic-1247/1250-kyb-otp.md` (the trigger was removed when #1362 added the
   production entry point), per `AGENTS.md` → Tech debt. Do not fix it inline.

## Test Strategy

All new `OtpModal` tests go in `packages/frontend/src/components/OtpModal.test.tsx`, inside the
existing `describe`, reusing `renderModal`, `typeCode` and `pendingVerify`. The suite already runs
`vi.useFakeTimers({ shouldAdvanceTime: true })`, so advance the window with
`act(() => { vi.advanceTimersByTime(OTP_ERROR_VISIBLE_MS); })` and import the constant rather
than hard-coding `3000`.

1. **Auto-clear.** Reject with `ApiError(401)`; advance `OTP_ERROR_VISIBLE_MS`. Assert the input
   has value `""`, no `aria-invalid`, `queryByRole("alert")` is `null`, all six boxes render empty,
   and `document.activeElement` is the OTP input.
2. **Held until the window elapses.** Reject; advance `OTP_ERROR_VISIBLE_MS - 100`. Assert the
   alert is still present, `aria-invalid` is `"true"`, and the value is still the typed code.
3. **Typing pre-empts and cancels.** Reject; advance 1000 ms; press Backspace. Assert the alert
   and `aria-invalid` are gone and the value is five digits. Then advance a further
   `OTP_ERROR_VISIBLE_MS`. Assert the value is **still** those five digits — the pending clear was
   cancelled, nothing was wiped from under the user.
4. **A second rejection restarts the window, no stacked timers.** Reject; advance 2000 ms;
   Backspace and retype a digit so verify fires and rejects again; advance 2000 ms — assert the
   error is still shown (it would already be gone if the first timer had survived); advance the
   remainder — assert exactly one clear happened and the field is empty.
5. **A successful verify schedules nothing.** Resolve the verify; advance 5× the window. Assert
   `onVerified` fired once, no alert ever appeared, and no spurious re-render/clear occurred.
6. **Close during the window.** Reject; advance 1000 ms; rerender with `open={false}`; advance
   past the window. Assert no act/unmounted-state-update warning is raised (fail the test on a
   `console.error`) and that reopening shows an empty field, `idle` status and a reset countdown —
   extend the existing `"reopening resets code, status and countdown"` test rather than duplicating
   it.
7. **A stale rejection never schedules a window.** Start a verify, edit the code before it
   settles, then reject the in-flight promise; advance past the window. Assert no alert appeared
   and the edited value is untouched (guards the `requestIdRef` interaction).
8. **Resend clears the error and the code (D4).** Reject; run the countdown to zero; click
   `Resend`. Assert the code is empty, the alert is gone, focus is on the OTP input, and the
   countdown restarts — i.e. the existing resend assertions still pass.
9. **Focus is restored even after the user clicks away.** Reject; click the Back button (which
   blurs the input but, per `OtpModal`, also fires `onBack` — instead click the Resend/countdown
   text, or blur the input directly via `fireEvent.blur`); advance the window; assert
   `document.activeElement` is the OTP input.

In `packages/frontend/src/components/OtpInput.dom.test.tsx`, add one test: a ref passed to
`OtpInput` exposes `focus()`, and calling it makes the hidden input `document.activeElement` and
renders the caret at `value.length`.

Then run, from the repo root: `yarn test` for `@pipeline/ui` and `packages/frontend` (or
`npx vitest run` in each), the TypeScript build for both packages, and
`npx tsx scripts/lint-docs.ts` after the doc edits (`AGENTS.md` → Lint & style). Everything must
be green before handing back; do not commit.

## Docs to Update

- `docs/frontend/auth-components.md` § OtpModal — the timed error window, the auto-clear, the
  cancel/restart rules, the resend interaction, and the accessibility note (step 1). **This edit
  lands before the code changes.**
- `docs/frontend/ui-components.md` § OtpInput (line 642 onwards) — the `OtpInputHandle` ref
  (step 2).
- `docs/user-stories/epic-1247/1442-otp-error-auto-clear.md` — new (step 7).
- `docs/exec-plans/tech-debt-tracker.md` — the stale `/test?tab=auth` OTP preview instructions in
  `1250-kyb-otp.md` (step 8).
