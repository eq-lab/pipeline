# Issue #1280: KYB: Forgot Password screen

Source: https://github.com/eq-lab/pipeline/issues/1280

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Branch: `feat/1280-kyb-forgot-password` (draft PR #1287), cut from `main` at `f0416377`
(#1286, the Owners retirement) — verified: the branch has **no** diff against `origin/main`, so
`OwnersModal` and its `/test` trigger are already gone from this branch's base. No stacking, no
merge-order constraint.

Figma (styling source of truth, file `A43rjYYjSwdTmiwwf5cx5n`, section `6486:81556`
"V1.0 — KYB & Wire transfers"):

- Forgot Password: [`6704-107100`](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6704-107100&m=dev)
  (1728 × 916) — **the only frame for this screen**.
- Shell instance: `6704:107101` (the same shared `Sign In` component every KYB screen uses —
  `…;8550:10210` content pane, `…;8550:10546` image pane, `…;8591:7781` Close Icon).
- Content column: `…;8550:10453` (400 × 392, `gap 32`, `padding-bottom 64`, centered on both
  axes inside the 864 × 916 left half).
- Heading: `…;6704:107108` → `…;6539:2315`. Subtitle slot `…;6539:2316` is `hidden="true"`.
- Form group: `…;6704:107192` → email `…;6704:107193`/`…;6704:107194` (Field `…;6364:359`,
  placeholder `…;9117:2930`), submit `…;6704:107196` (label `…;6462:6007`), footer link
  `…;6704:107198`.
- Cross-referenced siblings: `6486:81557` Sign in, `6486:81576` Sign in — Enable,
  `6486:81595` Sign in — Validation error.

All Figma facts below were recovered **during this planning session** via the local Dev Mode MCP
(`http://127.0.0.1:3845/mcp`, curl JSON-RPC: `initialize` → capture the `mcp-session-id` response
header → `notifications/initialized` → `tools/call`), using `get_metadata`, `get_variable_defs`,
`get_design_context` and `get_screenshot`, plus a full enumeration of section `6486:81556`'s
children. Every call succeeded. **Re-extraction is not required to implement** — the numbers,
copy and token bindings in this plan are the extracted values, not estimates. Re-verification
against the live frame is still a step (step 11).

## Scope

Build the **Forgot Password** screen as a presentational-only modal in the same shell family as
#1248–#1253: no network call, no persistence, seams left as no-ops for #1265, and no production
entry point — reachable from `/test?tab=auth` only.

Also, per the Issue body, **un-inert `SignInModal`'s "Forgot password?" affordance**: #1248 shipped
it as plain non-interactive text explicitly because "it has no destination frame … and no
sub-issue". Both of those conditions are now false, so the treatment flips to the epic's standard
seam pattern (a real `<button>` with an optional no-op handler, exactly like
`ContinueWithWalletButton` and `AccountInReviewModal`'s `Go to app`).

### What the screen is

One frame, **one state**. Unlike Sign in and Create account, Figma has **no** `— Enable` and no
`— Validation error` companion for this screen, and no confirmation / "check your email" /
"set a new password" frame exists anywhere in section `6486:81556` (full child enumeration done —
the only nearby artifact, `6486:82159` "Email", is the OTP email template in the OTP column). A
flow connector (`6704:107291`) runs Sign in → Forgot Password; **nothing leaves Forgot Password**.

Composition, top to bottom, inside the shared shell:

| Element | Figma | Build |
| --- | --- | --- |
| Right image panel | present, byte-identical to Sign in | shell default (`showImagePanel` unset) |
| Close × (top-right, over the photo) | present, `right 16 / top 16` | shell default (`showCloseButton` unset) |
| Back arrow | **absent** | do not pass `onBack` |
| Step label / icon badge / description | **absent** (`SubtitleCont` hidden) | pass none of `stepLabel`, `icon`, `description` |
| Content column | 400px, `gap 32`, `pb 64`, vertically centered | `max-w-[400px]` (shell) + `align="center"` + `mt-2 … gap-8 pb-16` on the children wrapper |
| Heading | "Reset your password" — Besley 48/56, `content-test/primary`, wraps to two lines at 400px (112px tall) | shell `heading`, `headingAlign` default `start` |
| Email field | one 56px `Field`, white fill, radius 4, placeholder "Enter corporate email" (`content-test/secondary`), **no label, no helper text** | `TextField type="email"` |
| Submit | full-width, 48px, `fill/brand` `#000080`, radius 4, label "Send Reset Link" (Body Emphasized, white), rendered at **`opacity: 0.32`** = the disabled state | `Button variant="primary-blue"` + `!w-full !min-w-0 disabled:opacity-[0.32]` (verbatim from `SignInModal`) |
| Footer | one caption line, centered: `"Remembered it? "` (`content-test/secondary`) + `"Back to sign in"` (`content-test/primary`) | caption `<p>` with an inline `<button>` for the second span |

**No wallet button and no OR divider** — the two parts `SignInModal`/`CreateAccountModal` share are
both absent here. `AuthModalParts` is not imported.

**No new `AuthModalShell` props and no new theme tokens are needed.** Every value on the frame maps
onto tokens already in `packages/ui/src/styles/theme.css`
(`--color-pipeline-paper`, `--color-pipeline-surface`, `--color-pipeline-brand`,
`--color-pipeline-ink`, `--color-pipeline-ink-muted`, `--color-pipeline-on-dark`,
`--text-pipeline-heading-l`, `--text-pipeline-body`, `--text-pipeline-caption`,
`--radius-pipeline-card`, `--radius-pipeline-button`) — this is the first screen in the epic that
adds neither.

### In scope

1. `packages/frontend/src/components/ForgotPasswordModal.tsx` +
   `packages/frontend/src/components/useForgotPasswordForm.ts` +
   `ForgotPasswordModal.test.tsx`.
2. Exporting `EMAIL_PATTERN` from `useAuthCredentialsForm.ts` so the new hook reuses the shipped
   regex and the shipped `EMAIL_ERROR_MESSAGE` copy verbatim.
3. `SignInModal`: new `onForgotPassword?: () => void` seam; the affordance becomes a real button.
4. A sixth `/test?tab=auth` trigger + the Sign in ↔ Forgot Password round trip + a stand-in
   submitted line.
5. Specs in `docs/frontend/auth-components.md`; a user-stories doc + its index row; two tech-debt
   entries; narrowing TD-61's wording.

### Out of scope

- **Any real password-reset call.** `onSubmit` is a no-op seam for #1265. There is no
  reset-request endpoint (#1266 covers auth endpoints and does not mention password reset).
- **Any in-modal success/confirmation state.** None is designed; inventing one would be a design
  decision, not an implementation. The `/test` preview shows a stand-in line and closes the modal —
  the exact treatment #1250 used for the missing OTP success frame, approved on 2026-09-18.
  Logged as TD-71.
- **A "set a new password" / reset-link landing screen.** Not designed, not this issue.
- **Production entry points.** `TopBar` keeps opening `ConnectWalletModal`; the LP header's
  Sign In / Sign Up buttons are #1282's.
- **"New here? Create account" on `SignInModal`** stays inert text — that cross-link's destination
  is #1249's shipped modal but the pairing is #1265's declared scope, and nothing in #1280's Issue
  body asks for it. Only "Forgot password?" is un-inerted here.
- `@pipeline/ui` promotion — LP-only, following `AuthModalShell`'s placement.
- BUG-19 (`packages/ui` `tsc --noEmit` on `TextField.stories.tsx`) — pre-existing, confirm
  unchanged, do not fix.

## Decisions

1. **`align="center"`, diverging from `SignInModal`.** The frame's 400 × 392 column sits exactly
   centered in the 864 × 916 left half ((864−400)/2 = 232, (916−392)/2 = 262). Following the frame
   is token-exact and matches the `OtpModal` / `AccountInReviewModal` precedent. `SignInModal` and
   `CreateAccountModal` still top-align — that is **TD-61**, pre-existing debt, and this issue
   narrows TD-61's wording from "only `OtpModal` opts in" to naming the two remaining hold-outs
   rather than widening it.

2. **"Forgot password?" becomes a real `<button type="button">` unconditionally**, with
   `onClick={onForgotPassword}` (undefined ⇒ no handler ⇒ a harmless no-op click). This is the
   repo's established seam shape (`ContinueWithWalletButton`, `Go to app`), not a new pattern.
   #1248's coder note deliberately *dropped* an `onForgotPassword` prop because the affordance was
   inert; this issue reinstates it for the same reason it was dropped — the destination now exists.

3. **"Back to sign in" is live too**, via an `onBackToSignIn?: () => void` seam. Same reasoning as
   decision 2: it is the mirror affordance, its destination is a shipped screen, and leaving it
   dead would make the preview a one-way trip that QA cannot exercise. It is **not** Body
   Emphasized — unlike Sign in's "Create account" span, Figma renders it at regular weight with
   only the colour shift carrying the emphasis.

4. **The `/test` preview swaps modals; it never stacks them.** Clicking "Forgot password?" closes
   Sign in *and* opens Forgot Password in one handler, so exactly one shell is mounted at any
   moment. This deliberately departs from the epic's "every trigger is independent" convention
   (recorded in `auth-components.md#diagnostics-preview-seam`), and the departure is safe because
   that convention's stated reason is **stacking** — un-refcounted body-scroll-lock and
   capture-phase Escape collisions — which a swap does not create: React runs the outgoing tree's
   effect cleanups before the incoming tree's effect creates within a single commit, so
   `document.body.style.overflow` lands on `"hidden"` and exactly one Escape listener is
   registered. The convention was also about **auto-advancing a wizard** (OTP → Company Docs),
   which is flow orchestration owned by #1254/#1265; a link whose entire purpose is navigation to
   a screen this issue ships is a different thing. The mechanism is asserted by tests rather than
   trusted (see Test Strategy), and to make the invariant structural the `AuthTab` models the pair
   as one union-typed state so "both open" is unrepresentable.

5. **No new shared hook abstraction.** `useAuthCredentialsForm` requires a non-empty password for
   `isValid` and emits `{ email, password }`; bending it into an email-only mode would change a
   signature two shipped modals depend on. A ~40-line `useForgotPasswordForm` that imports the
   shared `EMAIL_PATTERN` + `EMAIL_ERROR_MESSAGE` keeps the error copy from drifting at zero risk
   to #1248/#1249, and matches the one-hook-per-screen shape (`useOtpModal`, `useCompanyDocsModal`).

6. **Undesigned states are derived, not invented.** The enabled submit = the same button at full
   opacity (from `6486:81576` Sign in — Enable). The email validation error = `TextField`'s
   shipped `invalid`/`error` treatment with the verbatim copy "Enter the correct email address"
   (from `6486:81595` Sign in — Validation error). Hover/focus on the two un-inerted links have no
   Figma state — `hover:underline` plus the shell's existing focus-visible outline token. Logged
   as TD-72.

7. **The `Inter` font override Figma emits on the "Back to sign in" span is a file artifact**, not
   intent — the identical override appears on Sign in's shipped "Create account" span, which
   ships as Graphik LC. Build with `--font-body`. Same class of stale-export artifact as #1251's
   leading-tile fill and #1253's `#34C759` check.

8. **Component name vs. heading copy.** The frame and the Issue are called "Forgot Password"; the
   heading reads **"Reset your password"**. Files/testids use the former, rendered copy the
   latter. Called out so the QA pass does not file this as a copy defect.

## Assumptions and Risks

- **The design dead-ends after "Send Reset Link".** No confirmation state, no reset-link landing
  screen, no "set a new password" screen exists in the V1.0 section, and no connector leaves the
  frame. This does not block #1280 (precedent-resolved by #1250), but **#1265 cannot wire a real
  reset flow until a designer supplies those screens.** Recommend the manager raise a design
  request / follow-up sub-issue on epic #1247 — see TD-71.
- **Scope overlap with #1265.** #1265's body claims "the inert affordances (Forgot password,
  cross-links) becoming live" as its own. #1280's body (newer, 2026-09-21) explicitly says
  "un-inert the link". Read as: #1280 un-inerts the affordance and gives it a seam + a `/test`
  destination; #1265 supplies the production handler and the real request. Recommend the manager
  post a one-line scope note on #1265 so the two do not collide.
- **Decision 4 overrides a convention a human approved.** If review disagrees, the fallback is
  cheap and contained: keep the standalone sixth trigger, and have the two links close their modal
  and reveal a stand-in line ("Forgot password — open the Forgot Password screen from the button
  above.") instead of swapping. No component change required — only the `/test` handlers.
- **`SignInModal` gains a focusable element**, which shifts its tab order and the "last focusable"
  element in the focus-trap test. That test computes first/last dynamically (`SignInModal.test.tsx`
  line 186), so it should keep passing — verify rather than assume.
- **The × sits over the dark photo** and inherits the shell's ink-coloured close button, i.e. it is
  low-contrast on this frame. That is exactly how the shipped `SignInModal` already renders with
  the same panel — pre-existing shell behaviour, not introduced here. Do not "fix" it in #1280.
- **Pre-existing red in the gate.** `packages/ui` `tsc --noEmit` fails only on BUG-19, and the
  frontend vitest suite carries a handful of timezone-dependent failures recorded in #1253's gate.
  Confirm both reproduce unchanged with the branch's changes stashed out; file anything new in
  `known-bugs.md` rather than fixing inline.
- **Parallel epic work.** #1281 (create-account validation error), #1282, #1283, #1284 are all
  `backlog`, none in flight. #1281 touches `CreateAccountModal`, not `SignInModal` — no expected
  conflict.

## Open Questions

_None_

## Implementation Steps

1. [x] **Export the shared email validation primitives.** In
   `packages/frontend/src/components/useAuthCredentialsForm.ts`, change
   `const EMAIL_PATTERN` to `export const EMAIL_PATTERN`. No other change to this file; the two
   shipped modals must stay byte-identical in behaviour.

2. [x] **Add `packages/frontend/src/components/useForgotPasswordForm.ts`.** One 2–3-line spec-pointer
   header comment, nothing else (comment-minimal HARD RULE). Modelled on
   `useAuthCredentialsForm`, email-only:

   ```ts
   export interface UseForgotPasswordFormOptions {
     open: boolean;
     onSubmit?: (payload: { email: string }) => void;
   }
   export interface UseForgotPasswordFormResult {
     email: string;
     setEmail: (next: string) => void;
     isValid: boolean;
     emailError: string | undefined;
     handleEmailBlur: () => void;
     handleSubmit: (e: React.FormEvent) => void;
   }
   ```

   - State: `email`, `emailTouched`, `submitAttempted`; all three reset when `open` flips
     `false → true`.
   - `isValid = email !== "" && EMAIL_PATTERN.test(email)`.
   - `emailError` shows `EMAIL_ERROR_MESSAGE` (imported, not re-declared) when
     `(emailTouched || submitAttempted) && email !== "" && !isValid` — identical rule to the
     credentials hook, so an empty field never shows an error.
   - `handleSubmit` calls `e.preventDefault()`, sets `submitAttempted`, and fires
     `onSubmit?.({ email })` only when `isValid`.

3. [x] **Add `packages/frontend/src/components/ForgotPasswordModal.tsx`.** Spec-pointer header:

   ```
   // spec: docs/frontend/auth-components.md#forgotpasswordmodal (Figma node
   // 6704:107100 — one frame, no enabled/error/success variants in the design).
   ```

   Props: `open`, `onDismiss`, `onSubmit?: (payload: { email: string }) => void`,
   `onBackToSignIn?: () => void`.

   Shell call — **only one non-default prop**:

   ```tsx
   <AuthModalShell
     open={open}
     onDismiss={onDismiss}
     heading="Reset your password"
     headingId="forgot-password-modal-heading"
     testId="forgot-password-modal"
     align="center"
   >
   ```

   Children: `<form onSubmit={handleSubmit} data-node-id="6704:107100"
   className="mt-2 flex w-full flex-col items-center gap-8 pb-16">` (the `mt-2` turns the shell
   column's 24px `gap-6` into the frame's 32px heading→content gap — the same technique
   `OtpModal`/`CompanyDocsModal` use; `gap-8` = the frame's 32px; `pb-16` = the column's 64px
   `padding-bottom`), containing:

   1. `<TextField type="email" autoComplete="email" placeholder="Enter corporate email"
      value={email} onChange={setEmail} onBlur={handleEmailBlur} invalid={Boolean(emailError)}
      error={emailError} />`
   2. `<Button type="submit" variant="primary-blue" disabled={!isValid}
      className="!w-full !min-w-0 disabled:opacity-[0.32]">Send Reset Link</Button>`
   3. The footer caption `<p>` (`--font-body`, `--text-pipeline-caption` 12/16, `text-center`,
      `w-full`) containing `<span className="text-[color:var(--color-pipeline-ink-muted)]">Remembered it? </span>`
      — note the trailing space is part of the string — followed by an inline
      `<button type="button" onClick={onBackToSignIn}>Back to sign in</button>` at
      `--color-pipeline-ink`, **regular weight** (no `--font-weight-emphasized`),
      `cursor-pointer bg-transparent hover:underline` plus
      `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-pipeline-ink)]`.

4. [x] **Un-inert "Forgot password?" in `packages/frontend/src/components/SignInModal.tsx`.** Add
   `onForgotPassword?: () => void` to `SignInModalProps` and destructuring. Replace the `<p>` at
   lines 90–100 with a `<button type="button" onClick={onForgotPassword}>` carrying the **same**
   classes it has today (`w-full text-center`, `--font-body`, `--text-pipeline-caption` +
   line-height, `--color-pipeline-ink`) plus `cursor-pointer bg-transparent hover:underline` and
   the same `focus-visible:outline…` trio as step 3. Do not touch the "New here? Create account"
   paragraph.

5. [x] **Rework the `/test?tab=auth` Sign-in trigger into a union state.** In
   `packages/frontend/src/routes/test.tsx`, `AuthTab`:

   - Replace `const [signInOpen, setSignInOpen] = React.useState(false)` with
     `const [authScreen, setAuthScreen] = React.useState<"none" | "sign-in" | "forgot-password">("none")`
     so both-open is unrepresentable. The existing "Open Sign In modal" button sets `"sign-in"`.
   - Add a sixth trigger button, **"Open Forgot Password screen"**, setting `"forgot-password"`.
     Leave the other four triggers (`CreateAccountModal`, `OtpModal`, `CompanyDocsModal`,
     `AccountInReviewModal`) exactly as they are.
   - Add `const [resetLinkRequested, setResetLinkRequested] = React.useState(false)`.
   - `<SignInModal open={authScreen === "sign-in"} onDismiss={() => setAuthScreen("none")}
     onForgotPassword={() => setAuthScreen("forgot-password")} />`
   - `<ForgotPasswordModal open={authScreen === "forgot-password"}
     onDismiss={() => setAuthScreen("none")}
     onBackToSignIn={() => setAuthScreen("sign-in")}
     onSubmit={() => { setResetLinkRequested(true); setAuthScreen("none"); }} />`
   - Stand-in line, matching the three existing ones:
     `{resetLinkRequested && <p data-testid="auth-forgot-password-submitted" className="text-sm text-[color:var(--color-pipeline-positive)]">Reset link requested — #1265 wires this to the real password-reset endpoint.</p>}`
   - Update the tab's intro paragraph to name issue #1280 alongside #1248–#1253.

6. [x] **`ForgotPasswordModal.test.tsx`** — see Test Strategy.

7. [x] **Extend `packages/frontend/src/components/SignInModal.test.tsx`** — see Test Strategy.

8. [x] **Extend `packages/frontend/src/routes/-test.test.tsx`** — see Test Strategy.

9. [x] **Docs — `docs/frontend/auth-components.md`:**
   - Header paragraph (lines 3–7): add #1280 to the list of screens this doc covers.
   - `### SignInModal` item 5 (lines 114–115): rewrite — the affordance is now a real button with
     the `onForgotPassword` seam, destination `ForgotPasswordModal` (#1280); keep item 6 ("New
     here? Create account") as inert.
   - `### SignInModal` → **Accessibility** (lines 165–167): "Forgot password?" is now focusable;
     only "Create account" remains plain text.
   - New `### ForgotPasswordModal` section, placed after `### CreateAccountModal` (it is a
     sign-in-family screen) — Figma node, the one-frame/one-state fact, the shell composition
     table from Scope, the token mapping, the vertical rhythm (32/32/32 + 64 bottom, 400px column,
     centered), the copy block (verbatim: "Reset your password", "Enter corporate email",
     "Send Reset Link", "Remembered it? ", "Back to sign in"), the validation rules, the
     derived-state notes (decision 6), and an explicit "out of scope" naming the missing
     post-submit design.
   - `### Diagnostics preview seam` (lines 504–519): six triggers; document the Sign in ↔ Forgot
     Password **swap** (never a stack) and why decision 4 departs from the independent-triggers
     convention; add the `auth-forgot-password-submitted` stand-in line.
   - `docs/frontend/index.md` line 14–16: add `ForgotPasswordModal` to the parenthetical list.

10. [x] **Docs — user stories and trackers:**
    - New `docs/user-stories/epic-1247/1280-kyb-forgot-password.md` (see Test Strategy) and its
      row in `docs/user-stories/index.md` under "Epic #1247 — KYB login flow", status `Initial`.
    - `docs/user-stories/epic-1247/1248-kyb-signin-modal.md` **Story 9** (lines 163–180): retitle
      and rewrite — "Continue with wallet" and "Forgot password?" are now real buttons ("Forgot
      password?" opens the Forgot Password screen in the preview); only "Create account" is still
      inert text.
    - `docs/exec-plans/tech-debt-tracker.md`, two new entries after TD-70:
      - **TD-71** — the Forgot Password flow has no designed post-submit state: no confirmation,
        no reset-link landing screen, no "set a new password" screen anywhere in section
        `6486:81556`, and no connector leaves `6704:107100`. `/test` shows a stand-in line; #1265
        cannot wire a real reset until a designer supplies those screens. Same shape as TD-60.
      - **TD-72** — the Forgot Password frame has no enabled-button, no validation-error, and no
        link hover/focus state; all three are derived (from `6486:81576`, `6486:81595`, and repo
        convention respectively) rather than designed.
      - **TD-61** — narrow the wording: `OtpModal`, `AccountInReviewModal` and now
        `ForgotPasswordModal` centre their column; `SignInModal`/`CreateAccountModal` are the
        remaining top-aligned hold-outs.
    - `docs/exec-plans/known-bugs.md`: no change expected — confirm **BUG-19** still reproduces
      unchanged, and file anything newly discovered rather than fixing it inline.
    - No `docs/product-specs/` change: presentational frontend work, no product-behaviour change;
      the epic's product intent lives on #1247.

11. [x] **Figma re-verification** (required — the Issue carries a Figma link). Against
    `6704-107100`: content column 400px wide and centred on both axes in the left half; heading
    "Reset your password" on two lines, 48/56 Besley, left-aligned, **no** description; 32px
    heading → field, 32px field → button, 32px button → footer link, 64px below the link; field
    56px, white, radius 4, placeholder "Enter corporate email" at 60% ink; button full-width 48px,
    `#000080`, radius 4, label "Send Reset Link" white Body Emphasized, rendered at 0.32 opacity
    while the field is empty; footer caption 12/16 centred with "Remembered it? " at 60% ink and
    "Back to sign in" at full ink, regular weight; image panel present and identical to Sign in;
    × top-right; **no** back arrow, **no** step badge, **no** icon, **no** OR divider, **no**
    wallet button, **no** password field. If the local Dev Mode MCP is unreachable in the coder
    session, record that as a deviation — per `AGENTS.md` the frontend flow has no per-issue QA
    step and the pixel comparison happens at epic #1247's QA pass (#1255) via the user-stories
    doc, which carries this checklist.

12. [x] **Gate.** `yarn workspace @pipeline/frontend exec tsc --noEmit`;
    `yarn workspace @pipeline/ui exec tsc --noEmit` (expect **only** BUG-19);
    `yarn workspace @pipeline/frontend lint` and `yarn workspace @pipeline/ui lint`;
    `yarn workspace @pipeline/frontend test`; `yarn workspace @pipeline/frontend build`;
    `npx tsx scripts/lint-docs.ts` (0 errors). No Rust touched, so no `cargo clippy` needed.
    Any pre-existing failure must be shown to reproduce with the branch's changes stashed out.

## Test Strategy

Unit tests are vitest + Testing Library, following `SignInModal.test.tsx` and
`AccountInReviewModal.test.tsx`.

**New — `packages/frontend/src/components/ForgotPasswordModal.test.tsx`:**

1. Renders nothing when `open={false}`; portals into `document.body` when open.
2. `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` resolves to the "Reset your
   password" heading.
3. **Field set** — exactly one `<input>`, `type="email"`, placeholder "Enter corporate email"; no
   password input, no "Continue with wallet" button, no "OR" text. (The mirror of #1249's
   "exactly two fields" story.)
4. Submit is disabled with the field empty.
5. Submit becomes enabled once a well-formed email is typed.
6. A malformed email shows "Enter the correct email address" **on blur** and keeps submit disabled.
7. A submit attempt with an **empty** field shows no error and leaves submit disabled (the
   `email !== ""` guard — same rule as the credentials hook).
8. A valid submit calls `onSubmit` exactly once with `{ email }`.
9. With no `onSubmit` prop, a valid submit neither throws nor calls `fetch` (spy on `global.fetch`,
   the #1248 pattern).
10. All state resets when `open` goes `false → true` (value cleared, error cleared, submit
    disabled again).
11. **Shell composition** — image panel present, × present, **no** button with accessible name
    "Back", no `Step` badge, and the content column carries `my-auto` (`align="center"`).
12. Escape calls `onDismiss` once; the × button calls `onDismiss` once.
13. "Back to sign in" is a real `<button>`, calls `onBackToSignIn` exactly once, and does not
    throw when the prop is omitted; the "Remembered it?" prefix renders.
14. **Copy is verbatim** — heading "Reset your password", submit "Send Reset Link", the footer's
    two spans including the trailing space in "Remembered it? ".
15. Focus trap: Tab from the last focusable element wraps to the first.

**Extended — `packages/frontend/src/components/SignInModal.test.tsx`:**

16. "Forgot password?" is a `<button>` (queryable via `getByRole("button")`) and calls
    `onForgotPassword` exactly once when clicked.
17. With no `onForgotPassword` prop, clicking it does not throw and does not call `onSubmit`.
18. "New here? Create account" is **still** non-interactive text (regression guard on the
    deliberate asymmetry in decision/scope).
19. Re-run the existing focus-trap case unchanged — it computes first/last dynamically, so the new
    focusable element must not break it.

**Extended — `packages/frontend/src/routes/-test.test.tsx`:**

20. `?tab=auth` shows an "Open Forgot Password screen" trigger; clicking it opens a dialog headed
    "Reset your password", closed by default.
21. **Swap, not stack (the decision-4 regression test).** Open Sign In, click "Forgot password?",
    then assert: `screen.getAllByRole("dialog")` has length **1**, its heading is "Reset your
    password", and no "Sign in" heading remains.
22. **Body-scroll-lock survives the swap** — `document.body.style.overflow === "hidden"`
    immediately after the swap, and `""` after dismissing the second modal. This is the concrete
    guard for the un-refcounted lock called out in the shell caveats.
23. **Round trip** — from Forgot Password, clicking "Back to sign in" returns to exactly one dialog
    headed "Sign in".
24. Submitting a valid email closes the modal and reveals the
    `auth-forgot-password-submitted` stand-in line; no dialog remains.
25. The other four triggers still open their own modals unchanged (the existing cases must pass
    untouched after the `signInOpen` → `authScreen` refactor).

**New — `docs/user-stories/epic-1247/1280-kyb-forgot-password.md`** (QA-executable against
`http://localhost:5173/test?tab=auth`, modelled on the #1250/#1253 docs; styling-only checks are
excluded per the index's convention and live in step 11's checklist instead):

- Story 1: Opening the screen shows the empty state (heading, one field, disabled "Send Reset
  Link", the footer line, image panel, ×, no back arrow, no password field).
- Story 2: Typing a well-formed email enables "Send Reset Link".
- Story 3: A malformed email shows "Enter the correct email address" on blur and keeps submit
  disabled.
- Story 4: Submitting closes the modal and shows the reset-link stand-in line; **no** HTTP request
  is made (Network tab empty).
- Story 5: "Forgot password?" on the Sign in screen opens this screen — and only one screen is on
  top at a time.
- Story 6: "Back to sign in" returns to the Sign in screen.
- Story 7: × and Escape both dismiss to the `/test` page.
- Story 8: Reopening resets the field, the error, and the disabled button.

## Docs to Update

- `docs/frontend/auth-components.md` — header paragraph; `### SignInModal` items 5–6 and its
  Accessibility note; **new** `### ForgotPasswordModal` section; `### Diagnostics preview seam`.
- `docs/frontend/index.md` — add `ForgotPasswordModal` to the KYB auth components line.
- `docs/user-stories/epic-1247/1280-kyb-forgot-password.md` — **new**.
- `docs/user-stories/index.md` — new row under "Epic #1247 — KYB login flow".
- `docs/user-stories/epic-1247/1248-kyb-signin-modal.md` — rewrite Story 9.
- `docs/exec-plans/tech-debt-tracker.md` — add TD-71 and TD-72; narrow TD-61's wording.
- `docs/exec-plans/known-bugs.md` — no change expected; confirm BUG-19 unchanged.
- No `docs/product-specs/` change.
