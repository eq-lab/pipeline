# Issue #1250: KYB: OTP email-verification screen

Source: https://github.com/eq-lab/pipeline/issues/1250

Sub-issue of epic #1247 (KYB login flow). Branch `feat/1250-kyb-otp` (cut from `main`), draft PR #1258.

Sibling sub-issues: #1248 Sign-in modal (merged, PR #1256), #1249 Create-account modal (PR #1257,
**unmerged**), #1251 Company Docs, #1252 Owners, #1253 Account-in-review, #1254 auth
session/orchestration/wiring (`blocked`), #1255 QA (`blocked`).

> ## ⚠ Change request — 2026-09-18 (APPLIED 2026-09-18; supersedes the 2026-09-17 approval of Open Question 1)
>
> The implementation below is **complete and green** against the 2026-09-17 approval, which
> resolved Open Question 1 as "the mock always rejects". The user has since given new direction:
>
> > "if loader success it will navigate to next finish account setup page, if not show error or
> > resend if time passed"
>
> That replaces the always-reject mock with a two-way resolution and decouples the countdown from
> the error state. Decisions 7 and 9, the `useOtpModal` step, the preview seam, the Test Strategy
> and TD-60 have been rewritten to match; the **shipped code still has the old behaviour**. This
> needs a follow-up coder pass — do not read the `[DONE]` markers as covering it. Concretely:
>
> | File | Change |
> | --- | --- |
> | `packages/frontend/src/components/useOtpModal.ts` | add `MOCK_VALID_CODE = "123456"`; branch the verify timeout on `next === MOCK_VALID_CODE` → `onVerified?.(next)` + return to `"idle"`, else `"error"`; add `onVerified` to `UseOtpModalOptions`; drop `status === "error"` from the countdown-interval guard (line 54) **and** from `resendLabel` (line 91) so the countdown runs independently |
> | `packages/frontend/src/components/OtpModal.tsx` | add `onVerified?: (code: string) => void` to `OtpModalProps` and pass it through |
> | `packages/frontend/src/routes/test.tsx` | wire `onVerified` to the success stand-in described in step 6 |
> | `packages/frontend/src/components/OtpModal.test.tsx` | split the old "always rejects" case into the success/failure pair and add the independent-countdown case (Test Strategy items 6–9) |
> | `docs/frontend/auth-components.md`, `docs/user-stories/epic-1247/1250-kyb-otp.md`, `docs/exec-plans/tech-debt-tracker.md` (TD-60) | restate the two-way mock and the independent countdown |
>
> Open Question 2 (is `Resend` clickable?) is **still open** — the new direction settles when the
> label appears, not whether it is interactive.

Binding decisions inherited from the epic and the #1248/#1249 resolutions — do not re-litigate:

- **Presentational only, no network call.** Static Figma-mock data until endpoints land.
- **No production entry point.** The screen is reachable only from `/test?tab=auth`. `TopBar`
  keeps opening `ConnectWalletModal` unchanged; the LP header gets separate auth buttons later,
  under its own forthcoming Figma.
- **Inert affordances ship as plain text**, not as `<button>`s with no-op handlers (#1248
  resolution 4 + coder deviation 4).
- **Comment-minimal** — at most one 2–3-line spec-pointer header per file, no other comments;
  `// ── Section ──` dividers are allowed.
- **Token-exact to Figma.** Add tokens rather than approximating with an existing near-match
  (#1248 precedent for `--color-pipeline-negative-strong`/`-secondary`).

## Scope

### In scope

A new presentational OTP screen reproducing the Figma "OTP" frames in all three states, plus the
reusable code-input primitive it needs.

1. **`OtpInput`** — a new 6-box one-time-code primitive in `@pipeline/ui`
   (`packages/ui/src/components/OtpInput/`), reproducing the Figma `input-otp` component.
2. **`OtpModal`** — a new LP-app screen (`packages/frontend/src/components/OtpModal.tsx` +
   `useOtpModal.ts`) rendered through the existing `AuthModalShell`, reproducing:
   - default `6486:81665` — empty code, caret in the first box, running resend countdown;
   - enabled `6486:81848` — six digits entered, spinner below (verifying);
   - error `6486:81863` — red boxes/digits, "Enter the correct code", "Resend" without countdown.
3. **`AuthModalShell` extension** — five backward-compatible optional props the OTP frame needs
   (`description`, `showImagePanel`, `showCloseButton`, `onBack`, `align`), including the
   back-arrow affordance (Figma node `6486:81678`).
4. **Preview seam** — a third trigger button on the existing `/test?tab=auth` tab.
5. **Tokens** — `--text-pipeline-body-s` (14px/18px, the Figma `Body S` text style used by the
   error caption).
6. **Docs** — `auth-components.md` (`OtpModal` + shell props + preview seam),
   `ui-components.md` (`OtpInput`), `docs/frontend/index.md`,
   `docs/user-stories/epic-1247/1250-kyb-otp.md` + its row in `docs/user-stories/index.md`, and
   two tech-debt entries.

### Out of scope

- Any HTTP call, OTP issuance, OTP verification, resend request, session token, or persisted
  state. No email-account auth endpoint exists (#1240's Sumsub `/v1/kyc/*` routes are
  wallet-keyed). All wiring is #1254.
- Step sequencing. Nothing navigates into or out of this screen; the back arrow closes the
  preview. Create-account → OTP → Company Docs sequencing is #1254.
- The verification email template (backend, out of epic scope per #1247).
- Any change to `TopBar`, `ConnectModalProvider`, or the six production `openConnectModal` call
  sites.
- Re-aligning `SignInModal`/`CreateAccountModal` to the Figma vertical centering (see Risks →
  TD-61).
- A product spec — deferred to #1254 with the rest of the epic, same reasoning as #1248.
- Mobile/responsive design. The Figma frame is desktop-only (1728×916); no mobile KYB frame
  exists. The 400px column and the flex-1 boxes degrade gracefully inside the shell's existing
  `px-6` padding.

## Design facts extracted from Figma

Read via the **local Dev Mode MCP server** at `http://127.0.0.1:3845/mcp` (curl JSON-RPC:
`initialize` → capture the `mcp-session-id` response header → `notifications/initialized` →
`tools/call`; responses are SSE, filter `^data:` lines). `get_metadata`, `get_variable_defs`,
`get_screenshot` and `get_design_context` all responded during planning; `get_design_context`
took ~30 s per frame. The session-scoped `mcp__figma__*` tools and the remote `figma` MCP server
are **not** available — use curl.

Everything below is confirmed by `get_design_context` + `get_variable_defs`, not sampled from
pixels. The coder should re-verify against the live file but should not need to re-derive it.

### Frame structure (identical across all three states)

```
frame "OTP" 1728×916, bg = bg/primary #f8f7f6
├── instance "Sign In" (the shared shell component 8550:10210)
│   ├── Content: flex-1, flex-col, items-center, justify-center   ← vertically centered
│   │   └── slot "Container": w-400, flex-col, items-center, gap 32, padding-bottom 64
│   │        ├── heading (400×142)
│   │        │   ├── TitleCont  → "Check your inbox"                    Heading L 48/56, content-test/primary
│   │        │   └── SubtitleCont (gap 8 below the title)
│   │        │       └── "We’ve sent a passcode to user@email.io"       Body 16/22, content-test/primary
│   │        ├── input-otp wrapper → the 6-box row (400×64)
│   │        ├── resend row (400×16, centered)
│   │        └── [state-specific 4th child]
│   ├── slot "Image"      hidden="true"   ← NO right-hand image pane
│   └── "Close Icon"      hidden="true"   ← NO × close button
└── instance "arrow-left" at (20, 20), 24×24   ← the only visible dismiss affordance
```

The `Container` is vertically centered in every KYB frame, including sign-in
(`6486:81615` y=186/h=544), company-docs (`6486:81679` y=140/h=636) and account-in-review
(`6486:81745` y=224/h=468) — `AuthModalShell` currently top-aligns. See Risks → TD-61.

`Image` hidden + `SubtitleCont` visible is **not OTP-specific**: `6486:81679` (#1251) and
`6486:81745` (#1253) share it. Only OTP hides the close icon and adds the back arrow.

### The `input-otp` component (Figma `8926:9304`–`8926:9309`)

- Row: `flex gap-8 items-center w-full`; six items, each `flex-1 min-w-0 h-[64px]`,
  `rounded-[var(--radius-16, 4px)]`, `px-[12px]`, `items-center justify-center`.
  At a 400px column that is exactly 60 × 64 per box with 8px gaps.
- **Default frame:** all six boxes `bg = fill-test/on-primary #ffffff`. Only the **first**
  (active) box also carries `border border-solid border-[border-test/primary rgba(56,53,56,0.3)]`
  and contains `.cursor` — a 28px-tall, 1px-wide bar, `rounded-[1px]`, `content-test/primary`.
  The other five have no border.
- **Enabled frame:** all six `bg = fill-test/on-primary`, no border, no caret; each holds a digit
  `text-[24px] leading-[28px]`, `font/title-font-family` (Besley), `font/title-font-weight`
  (Regular), `content-test/primary #262524`. Figma content is `1 2 3 4 5 6`.
- **Error frame:** all six `bg = fill/negative-secondary rgba(178,0,0,0.16)`, **no border**, no
  caret; digits `content-test/negative #b20000`, same 24/28 type. Figma content is again
  `1 2 3 4 5 6` — the designer used `123456` as filler in **both** the enabled and the error
  frame, so it is *not* a "valid code" signal.

### Copy (verbatim — do not paraphrase)

| Element | String |
| --- | --- |
| Title | `Check your inbox` |
| Description | `We’ve sent a passcode to user@email.io` (U+2019 right single quote, **not** `'`) |
| Resend, counting down | `Resend in 00:59` |
| Resend, elapsed / error | `Resend` |
| Error caption | `Enter the correct code` |

### Type / token mapping

| Element | Figma | Repo token |
| --- | --- | --- |
| Title | Heading L 48/56, `content-test/primary` | `--text-pipeline-heading-l` + `--color-pipeline-ink`, `--font-display` |
| Description | Body 16/22, `content-test/primary` | `--text-pipeline-body` + `--color-pipeline-ink` (**full ink, not muted**) |
| Resend label | Caption 12/16, `content-test/secondary` | `--text-pipeline-caption` + `--color-pipeline-ink-muted` (both states, incl. `Resend`) |
| Error caption | `Body S` 14/18, `content-test/negative` | **new** `--text-pipeline-body-s` + existing `--color-pipeline-negative-strong` |
| Box fill, default | `fill-test/on-primary` | `--color-pipeline-surface` |
| Box fill, invalid | `fill/negative-secondary` | `--color-pipeline-negative-secondary` (exists, #1248) |
| Active-box border | `border-test/primary` | `--color-pipeline-ink-subtle` (same one-channel match #1248 accepted for the OR rule) |
| Digit, default | 24/28, `content-test/primary` | `--color-pipeline-ink`, `--font-display`, `--font-weight-regular` |
| Digit, invalid | 24/28, `content-test/negative` | `--color-pipeline-negative-strong` |
| Caret | 28×1, `content-test/primary`, `rounded-[1px]` | `--color-pipeline-ink` |
| Box radius | `radius-16` → **4px** | `--radius-pipeline-card` |
| Gaps | `gap-xs` 8, `size-32` 32, `size-64` 64 | `gap-2`, `gap-8`, `pb-16` |

`24px/28px` (the digit) is a **raw literal** in Figma, not a named variable — ship it as
`text-[24px] leading-[28px]`, do not invent a token. `Body S` (14/18) **is** a named Figma text
style, so it earns `--text-pipeline-body-s`.

### Exported SVGs (assets expire — the path data is reproduced here)

`arrow-left` (Figma `6486:81678`, 24×24, `viewBox="0 0 24 24"`, single path, `fillRule`/
`clipRule` `evenodd`):

```
M3.46967 11.4697C3.17678 11.7626 3.17678 12.2374 3.46967 12.5303L9.46967 18.5303C9.76256 18.8232 10.2374 18.8232 10.5303 18.5303C10.8232 18.2374 10.8232 17.7626 10.5303 17.4697L5.81066 12.75H20C20.4142 12.75 20.75 12.4142 20.75 12C20.75 11.5858 20.4142 11.25 20 11.25H5.81066L10.5303 6.53033C10.8232 6.23744 10.8232 5.76256 10.5303 5.46967C10.2374 5.17678 9.76256 5.17678 9.46967 5.46967L3.46967 11.4697Z
```

`loader` (Figma `6486:81860`, 24×24, `viewBox="0 0 24 24"`, single path, no fill rule):

```
M20.7805 10.7806C21.454 10.7806 22 11.3276 22 12.0011L21.9924 12.3955C21.9144 14.368 21.2536 16.2769 20.0897 17.8787C18.8484 19.587 17.0981 20.8581 15.0897 21.5106C13.0813 22.1631 10.9177 22.1632 8.9093 21.5106C6.90105 20.8579 5.15047 19.5861 3.9093 17.8777C2.66825 16.1693 2 14.1118 2 12.0001C2.00002 9.88836 2.66901 7.83105 3.91025 6.12258C5.15142 4.41423 6.9011 3.14235 8.9093 2.48971C10.7921 1.87792 12.8117 1.8392 14.7115 2.37443L15.0897 2.48971L15.2069 2.53354C15.7724 2.78299 16.068 3.42602 15.8729 4.02651C15.6777 4.62666 15.061 4.97246 14.4571 4.84207L14.3361 4.80872L14.0503 4.72202C12.614 4.31736 11.0873 4.34629 9.66387 4.80872C8.14547 5.3021 6.82188 6.26394 5.88338 7.55552C4.94487 8.8473 4.43904 10.4034 4.43902 12.0001C4.43902 13.5968 4.9449 15.153 5.88338 16.4448C6.82181 17.7362 8.14467 18.6981 9.66292 19.1916C11.1814 19.685 12.8176 19.6849 14.3361 19.1916C15.8546 18.6982 17.1781 17.7364 18.1166 16.4448C18.9965 15.2337 19.4962 13.7906 19.5553 12.2993L19.561 12.0001C19.5612 11.3268 20.1071 10.7806 20.7805 10.7806Z
```

Both export with `fill="black"` because the node fill is not bound to a variable — ship them with
`fill="currentColor"` and drive colour from `--color-pipeline-ink`, matching the shell's existing
`CloseIcon`.

## Decisions settled during planning

1. **Input pattern: one real `<input>` behind six presentational boxes** — not six inputs. It
   reproduces the Figma caret-in-the-active-box exactly, gets paste, mobile SMS autofill
   (`autocomplete="one-time-code"`) and backspace for free, and keeps the shell's focus trap to a
   single focusable element. Six inputs would need hand-rolled paste distribution and
   arrow/backspace handling for no visual gain.
2. **Code length: 6**, from the frames. Exposed as `length` (default `6`) on `OtpInput`.
3. **Paste:** native. `onChange` sanitises with `value.replace(/\D/g, "").slice(0, length)`, so
   `123456`, `12 34 56` and `123-456` all land as `123456`; letters are dropped.
4. **Back arrow = the only dismiss.** Figma hides the Close Icon instance, so a non-interactive
   arrow would trap the preview. It ships as a real `<button aria-label="Back">`. `OtpModal`
   takes a single `onBack` prop and passes it to the shell as **both** `onBack` and `onDismiss`,
   so Escape and the arrow are the same action. In the preview it closes the screen; once #1254
   lands it returns to Create account (the step before OTP in the epic's sequence).
5. **Focus on open.** The shell auto-focuses the first focusable descendant. Render the back
   button *after* `{children}` in the DOM (next to the close button) so the OTP input stays
   first — matching Figma's caret-in-the-first-box default state.
6. **Countdown is live**, owned by `useOtpModal`: `RESEND_COUNTDOWN_SECONDS = 59`, a 1 s
   interval, `MM:SS` zero-padded. 59 (not 60) so first paint reads `Resend in 00:59` exactly as
   the frame does. Cleared on unmount and reset when `open` flips `false → true`.
7. **The countdown is independent of the verification status** (user, 2026-09-18: "show error
   **or** resend if time passed"). It runs from open to zero regardless of `verifying`/`error`;
   the label is driven solely by the remaining seconds. The Figma error frame showing `Resend`
   with no countdown is therefore a post-countdown moment, not an error side-effect. A QA pass
   comparing against the error frame must let the 59 s elapse first.
8. **`Resend` is inert text**, not a button — same treatment as "Forgot password?" in #1248.
   There is no resend endpoint and no sub-issue owns the action. No unused `onResend` seam prop
   (#1248 coder deviation 4). *See Open Question 1.*
9. **Verification resolves both ways** (user, 2026-09-18: "if loader success it will navigate to
   next finish account setup page, if not show error"). Six digits → `verifying` (loader) → after
   `MOCK_VERIFY_DELAY_MS`, either success or `error`:
   - `MOCK_VALID_CODE = "123456"` is the accepted code — the value the Figma *enabled* frame
     shows mid-verification. (The error frame reuses `123456` as filler; treat that as a
     design-file artifact, the same way #1248 treated the corrupt `C` submit label.)
   - Success fires `onVerified?.(code)`. **#1250 ships no navigation** — the "finish account
     setup" destination is #1251 (Company Docs) and the step sequencing is #1254, and neither
     exists yet. `onVerified` is the seam they attach to; the `/test` preview stands in for it
     (step 6).
   - Any other six-digit code fires nothing and lands on the `error` frame.
   - `onSubmit?.(code)` still fires the moment six digits are entered — that is where #1254
     attaches the verify request, as distinct from where it attaches the navigation.
10. **Editing clears the error.** Any keystroke while `verifying` or `error` cancels the pending
    timer and returns to `idle`. The countdown is untouched (decision 7) — it is a one-shot per
    open and does not restart.
11. **`email` is a prop** defaulting to the Figma mock `"user@email.io"`; #1254 passes the real
    address. Not read from any store — there is no session.
12. **`OtpInput` lives in `@pipeline/ui`**, `OtpModal` in the LP app — the #1248 split
    (`TextField` shared, `SignInModal`/`AuthModalShell` app-local).
13. **Naming:** `OtpModal`, `testId` `otp-modal`, `headingId` `otp-modal-heading` — consistent
    with `SignInModal`/`CreateAccountModal` even though this frame hides the image pane.
14. **`#1250` does not depend on PR #1257.** Verified against the PR diff: `AuthModalParts.tsx`
    exports only `ContinueWithWalletButton` and `OrDivider`, and `useAuthCredentialsForm.ts` is
    an email/password hook. The OTP frame has neither a wallet button, nor an OR divider, nor a
    text field. **No stacking; build on `main`.**

## Assumptions and Risks

- **PR #1257 (#1249) is unmerged and edits five of the same files.** Not a dependency, but a
  guaranteed textual conflict on `packages/frontend/src/routes/test.tsx`,
  `packages/frontend/src/routes/-test.test.tsx`, `docs/frontend/auth-components.md`,
  `docs/frontend/index.md` and `docs/user-stories/index.md`. Recommended merge order
  **#1256 → #1257 → #1258**; rebase `feat/1250-kyb-otp` on `main` after #1257 lands and resolve
  by keeping both additions (three trigger buttons in `AuthTab`, three `###` doc sections).
  `AuthModalShell.tsx` is **not** in #1257's diff, so the shell extension conflicts with nothing.
- **The shell extension touches merged, QA-relevant code.** All five props are optional with
  defaults that reproduce today's behaviour byte-for-byte (`showImagePanel`/`showCloseButton`
  default `true`, `align` defaults `"start"`, `description`/`onBack` default `undefined`).
  `SignInModal` and `CreateAccountModal` pass none of them and must render identically — assert
  this with the existing `AuthModalShell.test.tsx`/`SignInModal.test.tsx` suites staying green
  and unmodified.
- **Vertical centering divergence (TD-61).** Every KYB frame centres its container; the shell
  top-aligns because it was lifted from `ConnectWalletModal`. This plan adds the opt-in `align`
  prop and uses it for OTP only, rather than silently re-laying-out two already-reviewed screens.
  Log the divergence so a designer/QA pass can decide whether #1248/#1249 should follow.
- **The hardcoded `123456` mock (TD-60)** will read like a bug — or worse, like a real credential
  check — to anyone who does not read the spec. It must be called out in the spec doc, the
  user-stories doc, the `/test` tab copy, and the tech-debt tracker, and removed by #1254. It is
  a presentational stand-in only: no code is issued, stored, or verified anywhere.
- **The success path dead-ends in this issue.** #1251 (Company Docs) is the "finish account
  setup" destination and does not exist yet, so `onVerified` has nothing to navigate to. The
  `/test` preview renders a confirmation line instead; do not invent a route, a redirect, or a
  placeholder page.
- **U+2019 in the description string.** `We’ve` uses a right single quotation mark. Prettier and
  ESLint accept the literal character in JSX text; do not "fix" it to an ASCII apostrophe and do
  not HTML-escape it into `&rsquo;` (the assertion in the tests should compare the literal).
- **`@pipeline/ui` has no test runner.** Component tests for shared primitives live in the LP app
  as `packages/frontend/src/components/*.dom.test.tsx` (the `TextField.dom.test.tsx` precedent) —
  follow it for `OtpInput`.
- **Tailwind sourcing is already handled**: `packages/frontend/src/index.css` carries
  `@source "../../ui/src/**/*.{ts,tsx}"`, so a new `@pipeline/ui` component is scanned. No change
  needed (contrast with the shared-package pitfall in the memory note).
- **Fake timers.** `useOtpModal` owns two timers (the 1 s countdown interval and the 800 ms mock
  verify timeout). Tests must use `vi.useFakeTimers()` and pair `userEvent` with
  `advanceTimers` — otherwise `userEvent`'s internal delay deadlocks against fake timers.
- **Tech-debt numbering.** TD-59 is the highest on `main` and PR #1257 adds none; if another PR
  lands a TD-60 first, renumber.

## Open Questions

1. **Is `Resend` interactive in this issue?** In the error frame it is styled identically to the
   countdown text (Caption 12/16, `content-test/secondary`) with no link, underline or accent —
   i.e. the design gives it no affordance — and there is no resend endpoint. The 2026-09-18
   direction ("show error or resend if time passed") settles *when the label appears* but not
   whether it is clickable. Proposed default: ship it as inert text, exactly like "Forgot
   password?" in #1248, with the action deferred to #1254. Confirm, or say it should be a real
   `<button>` (with a no-op handler now, or an `onResend` seam) so the elapsed countdown offers a
   working affordance.

**Resolved 2026-09-18 (user):** what happens after the loader — success navigates to the next
"finish account setup" step, failure shows the error, and `Resend` appears once the time has
passed. Folded into decisions 7 and 9; the navigation itself belongs to #1251/#1254, so #1250
exposes it as the `onVerified` seam.

## Implementation Steps — completed 2026-09-17

Both Open Questions were resolved with their proposed defaults per the 2026-09-17 approval
comment (mock always rejects, `onSubmit` seam, TD-60; `Resend` ships inert, no seam prop). Two
deviations surfaced during implementation, both logged below and on the Issue:

1. **`maxLength={length}` dropped from `OtpInput`'s real `<input>`.** The plan's step 2 listed it
   alongside `pattern="[0-9]*"`, but a native `maxlength` attribute truncates the *raw* pasted
   string before `onChange`/the sanitiser ever sees it. Pasting `"12 34 56"` (8 raw characters)
   into an empty, `maxLength={6}` input truncates to `"12 34 "` (6 raw characters) pre-sanitise,
   which then strips to `"1234"` — silently dropping the last two digits and breaking decision 3
   and Test Strategy item 4 (`12 34 56` / `123-456` must land as `123456`). Removed the attribute;
   the sanitiser's own `.slice(0, length)` (post digit-extraction) is the only length cap, exactly
   as decision 3 specifies. Confirmed via `OtpInput.dom.test.tsx`.
2. **`OtpInput.stories.tsx` defaults `value`/`onChange` in `meta.args`, unlike the
   `TextField.stories.tsx` precedent it mirrors.** `yarn workspace @pipeline/ui exec tsc --noEmit`
   fails on `main` today (confirmed pre-#1250, commit `9eeef7ca`) because `TextField.stories.tsx`'s
   per-`Story` `args` omit `value`/`onChange`, which CSF3 typing requires unless defaulted at the
   `meta.args` level — a real, pre-existing gap, not something #1250 introduced. Logged as
   **BUG-19** in `docs/exec-plans/known-bugs.md` rather than fixed inline (out of scope: #1250
   never touches `TextField`). `OtpInput.stories.tsx` sidesteps the same trap by supplying
   `value: ""` / `onChange: () => {}` defaults in `meta.args`, so the new file's own `tsc --noEmit`
   is clean.
3. **`OtpInput`'s outer row carries an explicit `onClick={() => inputRef.current?.focus()}`.**
   The plan relied solely on the absolutely-positioned, `opacity-0` real `<input>` naturally
   receiving the click by sitting on top of the presentational boxes — true in a real browser's
   pixel-based hit-testing, but jsdom/RTL's `userEvent.click(box)` dispatches directly on the
   target node passed to it and does not simulate z-index/layering, so Test Strategy item 7
   ("clicking any box focuses the single underlying input") is unverifiable through implicit
   overlay behaviour alone. Added a `ref` + container `onClick` that focuses the input on any
   click within the row (bubbling works normally in jsdom). This is a superset of the plan's
   behaviour — real browsers still hit the overlay input directly — and makes the contract
   testable and robust to future layout changes.

### 1. Token — `packages/ui/src/styles/theme.css` — [DONE]

Add the Figma `Body S` text style alongside the existing `--text-pipeline-*` scale, in **both**
blocks that define it (the `@theme` block around line 110 and the documented block around line
202, mirroring how every other size is declared twice):

```css
--text-pipeline-body-s: 14px; /* font style "Body S" — KYB OTP error caption; Figma node 6486:81875 (issue #1250) */
--text-pipeline-body-s--line-height: 18px;
```

No new colour tokens: `--color-pipeline-negative-strong`, `--color-pipeline-negative-secondary`,
`--color-pipeline-ink-subtle`, `--color-pipeline-surface`, `--radius-pipeline-card` all already
carry the needed values.

### 2. `OtpInput` — `packages/ui/src/components/OtpInput/` — [DONE, deviated]

Four files, mirroring `TextField/`:

- `OtpInput.tsx`
- `useOtpInput.ts` — the co-located state hook (focus tracking + the sanitiser), per
  `docs/FRONTEND.md` code-structure rule 6; component-local, so **not** catalogued in
  `docs/frontend/hooks.md`.
- `OtpInput.stories.tsx` — `title: "Components/OtpInput"`, `layout: "centered"`, a controlled
  wrapper at `width: 400`, and stories for Empty / Partial / Complete / Invalid.
- `index.ts` — `export { OtpInput }` + `export type { OtpInputProps }`.

Then re-export from `packages/ui/src/index.ts` next to the `TextField` lines.

**Props:**

```ts
export interface OtpInputProps {
  value: string;
  onChange: (next: string) => void;
  length?: number;      // default 6
  invalid?: boolean;
  "aria-label"?: string;
}
```

**Structure** — a `relative flex w-full items-center gap-2` row of `length` presentational boxes
with one real `<input>` absolutely positioned over the whole row:

- Input: `type="text"`, `inputMode="numeric"`, `autoComplete="one-time-code"`,
  `pattern="[0-9]*"`, `maxLength={length}`, `aria-invalid={invalid || undefined}`,
  `className="absolute inset-0 z-10 h-full w-full cursor-default opacity-0"`. `opacity-0` (not
  `hidden`/`sr-only`) so clicking any box focuses it and the native caret stays invisible.
  `onChange` passes `e.target.value.replace(/\D/g, "").slice(0, length)` up.
- Boxes: `aria-hidden="true"`, each
  `flex h-16 min-w-0 flex-1 items-center justify-center rounded-[var(--radius-pipeline-card)] px-3`,
  fill `--color-pipeline-negative-secondary` when `invalid` else `--color-pipeline-surface`.
  The **active** box — `!invalid && focused && index === value.length` — additionally gets
  `border border-solid border-[color:var(--color-pipeline-ink-subtle)]`. Tailwind's border-box
  default keeps the 64px outer height constant.
- Digit: `<span>` with
  `font-[family-name:var(--font-display)] text-[24px] leading-[28px] font-[var(--font-weight-regular)]`,
  colour `--color-pipeline-negative-strong` when `invalid` else `--color-pipeline-ink`.
- Caret: rendered only in the active box, `h-7 w-px rounded-[1px] bg-[color:var(--color-pipeline-ink)]`
  (28×1, Figma `.cursor`). **Static, no blink animation** — the frame shows it static and there
  is no Tailwind utility that reproduces a caret blink faithfully.
- Accessibility: the active-box border + caret are the visible focus indicator (the real input is
  invisible); `aria-label` defaults to `"Verification code"`.

### 3. `AuthModalShell` — `packages/frontend/src/components/AuthModalShell.tsx` — [DONE]

Add five optional props to `AuthModalShellProps`, all backward-compatible:

```ts
description?: string;
showImagePanel?: boolean;   // default true
showCloseButton?: boolean;  // default true
onBack?: () => void;
align?: "start" | "center"; // default "start"
```

Changes inside the component:

- Inner column: append `align === "center" ? "my-auto" : ""` to the existing
  `flex w-full max-w-[400px] flex-col gap-6` class list. `my-auto` (rather than flipping the
  parent to `justify-center`) keeps `overflow-y-auto` scroll-safe on short viewports.
- Below the `<h2>`, when `description` is set, render a sibling `<p>`:
  `font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink)]`.
  The title and description must sit 8px apart while the heading block sits 24px above
  `children` — wrap `<h2>` + `<p>` in a `flex flex-col gap-2` div so the column's existing
  `gap-6` still applies between the heading block and `children`.
- Gate `<RightImagePanel />` on `showImagePanel !== false`.
- Gate the close `<button>` on `showCloseButton !== false`.
- Add a new back `<button>` rendered **after** `{children}` and `<RightImagePanel />` (so DOM
  order keeps the content's first field focusable-first), only when `onBack` is provided:
  `type="button"`, `aria-label="Back"`, positioned `absolute top-4 left-4 z-10` as a
  `flex h-8 w-8 items-center justify-center` box holding the 24×24 `ArrowLeftIcon` — which puts
  the glyph at exactly (20, 20), matching node `6486:81678`. Reuse the close button's remaining
  classes verbatim (`rounded-[var(--radius-pipeline-card)]`,
  `text-[color:var(--color-pipeline-ink)]`, `transition-colors hover:bg-[rgba(56,55,53,0.08)]`,
  `focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]`).
- Add an `ArrowLeftIcon()` function next to `CloseIcon()`, using the exported path data above with
  `fill="currentColor"` and `aria-hidden="true"`.

### 4. `useOtpModal` — `packages/frontend/src/components/useOtpModal.ts` — [DONE, incl. 2026-09-18 change request]

Co-located state machine, modelled on `useSignInModal.ts`.

```ts
export const OTP_LENGTH = 6;
export const OTP_ERROR_MESSAGE = "Enter the correct code";
export const RESEND_COUNTDOWN_SECONDS = 59;
export const MOCK_VERIFY_DELAY_MS = 800;
export const MOCK_VALID_CODE = "123456";

export type OtpStatus = "idle" | "verifying" | "error";
```

- `useOtpModal({ open, onSubmit, onVerified })` returns
  `{ code, setCode, status, errorMessage, resendLabel }`.
- `setCode(next)`: stores the sanitised value; if `status !== "idle"`, cancel the pending verify
  timer and reset to `"idle"`; when `next.length === OTP_LENGTH` set `"verifying"`, call
  `onSubmit?.(next)`, and schedule `MOCK_VERIFY_DELAY_MS` → `onVerified?.(next)` and back to
  `"idle"` if `next === MOCK_VALID_CODE`, otherwise `"error"`.
- Countdown: `useEffect` on `open` starts a 1 s interval from `RESEND_COUNTDOWN_SECONDS` and
  stops at 0. It is **not** affected by `status` (decision 7); cleared on unmount.
- `resendLabel`: `remaining > 0` → `` `Resend in ${mm}:${ss}` `` (zero-padded two digits each)
  else `"Resend"`.
- `errorMessage`: `status === "error" ? OTP_ERROR_MESSAGE : undefined`.
- Reset `code`, `status`, timers and the countdown whenever `open` flips `false → true`.

### 5. `OtpModal` — `packages/frontend/src/components/OtpModal.tsx` — [DONE, incl. 2026-09-18 change request]

```ts
export interface OtpModalProps {
  open: boolean;
  onBack: () => void;
  email?: string;                        // default "user@email.io"
  onSubmit?: (code: string) => void;     // six digits entered — #1254 attaches the verify request
  onVerified?: (code: string) => void;   // mock accepted — #1254/#1251 attach the next step
}
```

Renders `AuthModalShell` with `heading="Check your inbox"`,
`` description={`We’ve sent a passcode to ${email}`} ``, `headingId="otp-modal-heading"`,
`testId="otp-modal"`, `showImagePanel={false}`, `showCloseButton={false}`, `align="center"`,
`onBack={onBack}`, `onDismiss={onBack}`.

Children — one `<div data-node-id="6486:81665" className="mt-2 flex w-full flex-col items-center gap-8 pb-16">`
(`mt-2` lifts the shell's 24px heading gap to the frame's 32px, the same trick `SignInModal`
already uses; `pb-16` is the container's 64px bottom padding; `gap-8` is the 32px rhythm):

1. `<OtpInput value={code} onChange={setCode} invalid={status === "error"} aria-label="Verification code" />`
2. Resend line — a `<p>` with
   `text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink-muted)] text-center`
   rendering `resendLabel`. Plain text, not focusable (decision 8).
3. State-specific tail:
   - `status === "verifying"` → a `<span role="status" aria-label="Verifying code">` wrapping the
     24×24 `LoaderIcon` (path above, `fill="currentColor"`, `aria-hidden="true"`) with
     `animate-spin` and `text-[color:var(--color-pipeline-ink)]`.
   - `status === "error"` → a `<p role="alert">` with
     `text-[length:var(--text-pipeline-body-s)] leading-[var(--text-pipeline-body-s--line-height)] text-[color:var(--color-pipeline-negative-strong)] text-center`
     rendering `errorMessage`.
   - otherwise nothing.

File header (the single allowed comment):
`// spec: docs/frontend/auth-components.md#otpmodal (Figma nodes 6486:81665 / 6486:81848 / 6486:81863 — default / enabled / error states).`

### 6. Preview seam — `packages/frontend/src/routes/test.tsx` — [DONE, incl. 2026-09-18 change request]

In `AuthTab`, add `otpOpen` state, a third `<Button variant="secondary">Open OTP screen</Button>`
in the trigger row, and the screen itself. `onVerified` stands in for the navigation the preview
cannot perform (#1251's page does not exist): close the screen and render a line under the
trigger row — `Verified — the next step is #1251 KYB Company Docs` — so the success path is
visible to a human and assertable by the QA agent. Reset that line when the screen is reopened.
Update the tab's description paragraph to name #1250 and to state the `123456` mock code. Keep
the three screens independent (never stacked) — the shell's body-scroll-lock and capture-phase
Escape are not stack-safe (see `auth-components.md` → shell caveats).

### 7. Docs — [DONE, incl. 2026-09-18 change request]

- **`docs/frontend/auth-components.md`** — new `### OtpModal` section after `### SignInModal`
  (or after `### CreateAccountModal` post-rebase): the three Figma node ids, composition,
  the state machine (`idle`/`verifying`/`error`), the countdown rule, the always-rejecting mock
  and its #1254 owner, verbatim copy, the token table, and the accessibility contract. Extend
  `### AuthModalShell` with the five new props and their defaults, and note that the OTP frame
  hides both the image pane and the close button so the back arrow is the only dismiss. Update
  the intro sentence's remaining-screens count and the `### Diagnostics preview seam` section to
  three triggers.
- **`docs/frontend/ui-components.md`** — new `## OtpInput` section next to `## TextField`: source
  path, Figma node `8926:9304`–`8926:9309`, the single-input-behind-boxes rationale, the props,
  the sanitiser, the active-box/caret rule, and the token table.
- **`docs/frontend/index.md`** — add `OtpModal`/`OtpInput` to the "KYB auth components" line.
- **`docs/user-stories/epic-1247/1250-kyb-otp.md`** — see Test Strategy for the story list; link
  it from `docs/user-stories/index.md` under `## Epic #1247` (`Status: Initial`).
- **`docs/exec-plans/tech-debt-tracker.md`** —
  - **TD-60:** `OtpModal`'s verification is a client-side mock — `MOCK_VALID_CODE = "123456"`
    accepted after an 800 ms fake delay, everything else rejected — because no OTP issue/verify
    endpoint exists, and its success seam `onVerified` has no destination until #1251 lands.
    Owner: #1254.
  - **TD-61:** `AuthModalShell` top-aligns its content column while every KYB Figma frame centres
    it; #1250 opts in via `align="center"`, leaving `SignInModal`/`CreateAccountModal`
    top-aligned pending a design decision.

## Test Strategy

> Items 6–9 below were rewritten by the 2026-09-18 change request; the shipped
> `OtpModal.test.tsx` still asserts the superseded always-reject behaviour.

All tests are vitest + React Testing Library in `packages/frontend`
(`yarn workspace @pipeline/frontend test`). `@pipeline/ui` has no runner, so the shared
primitive's tests live in the LP app per the `TextField.dom.test.tsx` precedent.

### `packages/frontend/src/components/OtpInput.dom.test.tsx` (new)

1. Renders exactly six boxes by default, and `length={4}` renders four.
2. Typing digits fills boxes left to right; the rendered digits match the value.
3. Non-digits are rejected — typing `a1b2` yields `12`.
4. Paste of `123456` fills all six; paste of `12 34 56` and `123-456` also yield `123456`.
5. Input beyond `length` is truncated — pasting `1234567` yields `123456`.
6. Backspace removes the last digit (native `<input>` behaviour through the controlled value).
7. Clicking any box focuses the single underlying input.
8. `invalid` sets `aria-invalid` on the input and paints the error fill/text tokens; the active
   box carries no border while invalid.
9. The caret element is present only while focused and only in the box at `value.length`.

### `packages/frontend/src/components/OtpModal.test.tsx` (new) — fake timers throughout

1. Closed by default: no `dialog` in the document; `open` renders `role="dialog"` with the
   accessible name "Check your inbox".
2. Renders the description verbatim, including the U+2019 apostrophe, with the default
   `user@email.io`; an `email` prop replaces the address.
3. Default state: `Resend in 00:59` on first paint, no loader (`role="status"` absent), no alert.
4. Countdown ticks — advancing 10 s renders `Resend in 00:49`; advancing past the end renders
   `Resend` with no countdown.
5. Entering six digits fires `onSubmit` once with the code and shows the loader (`role="status"`),
   with the resend countdown still running.
6. **Success path** — entering `MOCK_VALID_CODE` and advancing `MOCK_VERIFY_DELAY_MS` fires
   `onVerified` once with `"123456"`, and renders no alert.
7. **Failure path** — entering any other six digits and advancing `MOCK_VERIFY_DELAY_MS` replaces
   the loader with `role="alert"` / `Enter the correct code`, sets `aria-invalid` on the input,
   and does **not** fire `onVerified`.
8. The countdown is independent of status (decision 7): from the error state, the resend label
   still reads `Resend in 00:4x` until the 59 s elapse, then `Resend`.
9. Editing the code from the error state clears the alert and the `aria-invalid` flag and returns
   to the idle rendering, leaving the countdown untouched.
10. The back arrow (`aria-label="Back"`) calls `onBack`; Escape calls `onBack`; **no** close
    button (`aria-label="Close"`) is rendered.
11. On open, focus lands on the OTP input, not on the back button.
12. Reopening resets the code, the status and the countdown to `Resend in 00:59`.
13. No image pane: the hero `img` rendered by `RightImagePanel` is absent.

### `packages/frontend/src/components/AuthModalShell.test.tsx` (extend)

14. Defaults are unchanged — no `description`, image pane present, close button present, no back
    button, no `my-auto` on the column (regression guard for #1248/#1249).
15. `description` renders a `<p>` under the heading; `showImagePanel={false}` /
    `showCloseButton={false}` remove them; `onBack` renders the labelled back button.

### `packages/frontend/src/routes/-test.test.tsx` (extend)

16. `?tab=auth` renders an "Open OTP screen" button.
17. Clicking it opens the OTP screen (heading "Check your inbox"); no dialog before the click.

### Regression / gates

`SignInModal.test.tsx` and the existing `AuthModalShell.test.tsx` cases must stay green
**unmodified** — proof the shell extension is backward-compatible.

Gate before handing back (all must pass):

```bash
yarn workspace @pipeline/ui   exec tsc --noEmit
yarn workspace @pipeline/frontend exec tsc --noEmit
yarn workspace @pipeline/ui   lint
yarn workspace @pipeline/frontend lint
yarn workspace @pipeline/frontend test
yarn workspace @pipeline/frontend build
yarn lint:docs
```

No Rust is touched, so `cargo clippy`/`cargo test` are not required for this issue.

### Figma verification

After implementing, re-open each frame through the local Dev Mode MCP server and compare the
rendered `/test?tab=auth` screen at a 1728×916 viewport against:

- default `6486-81665` — caret in box 1, five plain white boxes, `Resend in 00:59`, back arrow at
  (20, 20), no image pane, no × ;
- enabled `6486-81848` — six white boxes with ink digits, countdown still visible, spinner 32px
  below the countdown;
- error `6486-81863` — six `rgba(178,0,0,0.16)` boxes with `#b20000` digits and no border,
  `Resend`, `Enter the correct code` at 14/18 in `#b20000`.

Check the 32px container rhythm (heading → input → resend → tail), the 8px title/description gap,
the 8px box gaps at 60×64, and the 64px bottom padding.

## Docs to Update

| File | Change |
| --- | --- |
| `packages/ui/src/styles/theme.css` | `--text-pipeline-body-s` + `--text-pipeline-body-s--line-height` (both declaration blocks) |
| `docs/frontend/auth-components.md` | new `### OtpModal`; extend `### AuthModalShell` (five props); update intro count + `### Diagnostics preview seam` |
| `docs/frontend/ui-components.md` | new `## OtpInput` |
| `docs/frontend/index.md` | KYB auth components line mentions `OtpModal`/`OtpInput` |
| `docs/user-stories/epic-1247/1250-kyb-otp.md` | new (stories 1–11 above, behaviour only — no styling stories) |
| `docs/user-stories/index.md` | new row under `## Epic #1247` |
| `docs/exec-plans/tech-debt-tracker.md` | TD-60 (always-rejecting mock), TD-61 (shell vertical alignment) |

No product spec in this issue — the epic's two open questions (wallet relationship, KYB
verification mechanism) are unresolved, so the spec lands with #1254, same as #1248/#1249.
