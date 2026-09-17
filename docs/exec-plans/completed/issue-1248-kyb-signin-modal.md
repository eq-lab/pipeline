# Issue #1248: KYB: Sign-in modal (email + password)

Source: https://github.com/eq-lab/pipeline/issues/1248

Sub-issue of epic #1247 (KYB login flow). Branch `feat/1248-kyb-signin-modal`, draft PR #1256.

Sibling sub-issues: #1249 Create-account modal, #1250 OTP screen, #1251 Company Docs,
#1252 Owners, #1253 Account-in-review, #1254 auth session/orchestration/wiring (`blocked`),
#1255 QA (`blocked`).

## Scope

**In scope — a presentational modal, no network calls.**

- A new LP-app modal `SignInModal` reproducing Figma frame "Sign in" in all three states:
  default (`6486:81557`), enabled (`6486:81576`), validation error (`6486:81595`).
- A new shared text-field primitive in `@pipeline/ui` reproducing the Figma `input`
  component (`6486:81613`), including the password variant with its eye show/hide toggle
  and its error styling.
- Extraction of the two-pane full-viewport modal shell that the Figma "Sign In" component
  (`8550:10210` content pane + `8550:10546` image pane) shares with the already-shipped
  `ConnectWalletModal`, so #1249/#1250 can reuse it.
- Full visual state coverage driven by **local component state only**: empty → disabled
  submit, filled → enabled submit, invalid → error state. One clearly-marked seam
  (`onSubmit` prop, default no-op) for #1254 to attach the real request to.
- A preview seam so a human and the QA agent can reach the modal: a new `auth` tab on the
  existing `/test` diagnostics route.
- Component specs in a new `docs/frontend/auth-components.md` (+ `ui-components.md` entry
  for the new primitive), and a user-stories doc under `docs/user-stories/epic-1247/`.

**Out of scope**

- Any HTTP call, session token, credential verification, or persisted auth state. There is
  no email+password endpoint on the backend (`packages/api/src/routes/auth.rs` exposes only
  the wallet-signature pair `GET /v1/auth/challenge` + `POST /v1/auth/verify`); #1240's
  Sumsub `/v1/kyc/*` endpoints are wallet-keyed. All wiring belongs to #1254.
- Changing the production connect entry point. `TopBar`'s "Connect Wallet" button keeps
  opening `ConnectWalletModal` via `useConnectModal().open()`. See Open Question 1.
- "Forgot password?" and "New here? Create account" destinations — rendered as the designed
  affordances, but inert in this issue (`Create account` is #1249, forgot-password has no
  Figma frame in the epic at all).
- Refactoring `ConnectWalletModal` onto the extracted shell (tech-debt entry instead — see
  Implementation Step 2).
- Mobile/responsive layout beyond mirroring `ConnectWalletModal`'s existing breakpoint
  behavior. The Figma frame is desktop-only (1728×916); there is no mobile KYB frame.
- A product spec. See "Docs to Update" for why this is deferred to #1254.

## Assumptions and Risks

### Figma access is partially degraded — read this before starting

The session's `mcp__figma__*` tools are unavailable and the remote `figma` MCP server fails
to connect, so the design was read through the **local Dev Mode MCP server** at
`http://127.0.0.1:3845/mcp` via curl JSON-RPC (initialize → capture the `mcp-session-id`
response header → `notifications/initialized` → `tools/call`; responses are SSE, filter
`^data:` lines). In that server, right now:

- `get_metadata` and `get_variable_defs` work and are fast.
- `get_screenshot` works and is fast (returns base64 PNG).
- **`get_design_context` hangs indefinitely** — three attempts (plain args, and with
  `excludeScreenshot: true`) returned zero bytes after 100 s / 300 s / 300 s timeouts on
  both a leaf node (`6486:81613`) and a frame (`6486:81557`). Everything below was derived
  from metadata + variable defs + pixel sampling of the screenshots instead.

**Consequences the coder must handle:**

1. **Retry `get_design_context` first.** It may work in a fresh session (restart the Figma
   desktop app if not). It is the only source for two things this plan could not obtain:
   the **exported wallet glyph** on the "Continue with wallet" button and the **exported
   eye / eye-slashed glyphs** (`20×20`) inside the password field. Per the
   `figma:figma-design-to-code` skill, icons must come from the exported asset — do not
   hand-author the vector paths. If `get_design_context` still hangs, stop and ask the user
   to export those three SVGs out-of-band (this is the same out-of-band route used for
   #787; see `docs/exec-plans/completed/issue-787-trustee-sign-in.md`).
2. **Colors below are derived, not quoted from codegen.** Exact hexes were recovered from
   Figma variable defs (authoritative) and cross-checked by sampling flat fills in the
   screenshots. Values marked *(confirm)* were inferred from an antialiased downscaled
   render and must be re-verified once `get_design_context` works.

### Design-system risks

- **The error red in the KYB frames is not the repo's negative token.** Frame `6486:81595`
  binds `content-test/negative` = `#b20000` and `fill/negative-secondary` = `#b2000029`
  (= `rgba(178,0,0,0.16)`). `packages/ui/src/styles/theme.css` has
  `--color-pipeline-negative: #c0392b`, bound to a Figma variable named `content/negative`.
  Two different variable namespaces, two different reds. Open Question 2.
- **`@pipeline/ui` has no text input, label, or password primitive** — confirmed again this
  session. The kit's only input is `TokenInput` (an amount widget). There is **no `<form>`
  element anywhere in the repo**, no form library (no react-hook-form / formik / zod), and
  **`aria-invalid` is used nowhere** — invalid state is signalled today only by a sibling
  error `<p>` or a `role="alert"` banner. This issue introduces the first real credential
  form in the LP app, so it also sets conventions.
- **`packages/ui` has no test script and no CI typecheck job.** `.github/workflows/lint.yml`
  typechecks `frontend`/`trustee`/`wallet-connect` only; `tests.yml` has no `ui` job. A new
  `packages/ui` component is covered only transitively, so its tests must live in
  `packages/frontend/src/components/` (the established `*.dom.test.tsx` convention for
  exercising `packages/ui` internals from a consuming app).
- **Two `ConnectWalletModal` copies exist** (`packages/frontend/src/components/` and
  `packages/wallet-connect/src/`). Only the LP-local one is in the LP tree. Do not touch
  the `wallet-connect` copy.
- **Body scroll lock is unguarded** in every LP modal (`document.body.style.overflow =
  "hidden"`, reset to `""` on cleanup). If `SignInModal` is ever stacked over
  `ConnectWalletModal`, closing the inner one unlocks the body. Not triggered by this issue
  (the modal is only opened standalone from `/test`), but the extracted shell should not
  make it worse — note it in the shell's spec and leave the counter to #1254.
- **Escape-key collision.** `ConnectWalletModal` and `FirstConnectionModal` both listen on
  `document` in the **capture** phase with `e.stopPropagation()`. If Sign-in can ever stack
  over them, use the `stopImmediatePropagation` pattern from
  `packages/ui/src/components/ErrorDetailsDialog/useErrorDetailsDialog.ts`
  (documented at `docs/frontend/error-handling.md#nested-dialogs-1037`).
- **The default-state frame's submit label is corrupt in the design file.** Frame
  `6486:81557` renders the disabled submit button with the single character `C`; frames
  `6486:81576` and `6486:81595` both render `Sign In`. Treated as a design-file artifact —
  use `Sign In` in every state. Open Question 5.

### Dependency risks

- No blocking code dependency. #1254 is `blocked` and downstream of this issue, not
  upstream. #1249/#1250 will consume the shell and the field primitive this issue creates,
  so land this one first.
- Epic #1247's two open questions (wallet relationship; KYB provider) do **not** gate this
  screen — it renders no wallet state and calls no KYB provider.

## Open Questions

1. **Does the production connect entry point change in this epic, and when?** The Figma
   answers half of this and raises the other half: the Sign-in modal itself contains a
   "Continue with wallet" button above an "OR" divider, which means the intended end state
   is that the app's entry CTA opens **Sign in**, and the existing `ConnectWalletModal`
   becomes a second-level modal reached from that button. Nothing in the frame says whether
   the `TopBar` CTA is relabelled ("Connect Wallet" → "Sign in"), nor whether the six other
   `openConnectModal` call sites (`routes/index.tsx` ×3 + 2 promo cards, `deposit.tsx:572`,
   `stake.tsx:341`, `transactions.tsx:122`) follow. **Proposed default:** leave the
   production entry point untouched in #1248 and give the flow switch to #1254, which owns
   orchestration. Confirm.
2. **Which red?** Match the Figma nodes exactly by adding
   `--color-pipeline-negative-strong: #b20000` and
   `--color-pipeline-negative-secondary: rgb(178 0 0 / 0.16)` to `theme.css`, or restyle
   with the existing `--color-pipeline-negative: #c0392b` and accept a visible delta in the
   QA Figma comparison? **Proposed default:** add the two new tokens (token-exact wins per
   the project's Figma-styling rule) and log the `#c0392b` vs `#b20000` divergence as tech
   debt for the designer to reconcile. Confirm — this changes the shared theme file.
3. **What exactly triggers each field's error state?** The copy is
   "Enter the correct email address" and "Enter the correct password" — "correct", not
   "valid", which reads like a server credential rejection rather than client-side format
   validation, yet the frame is named "Validation error" and shows a malformed email
   (`dsfdffs`). **Proposed default for this presentational issue:** email error when a
   non-empty value fails a basic `local@domain.tld` pattern on blur-or-submit; password
   error only when empty on submit; both messages reused verbatim by #1254 for the
   server-rejection case. Is a password min-length / complexity rule in scope, and is
   "corporate email" a real constraint (block free-mail domains) or just placeholder copy?
4. **Is "Forgot password?" in this epic at all?** It is rendered in all three frames but has
   no destination frame in "KYB Onboarding" and no sub-issue. Ship inert, or omit?
5. **Confirm the submit label is `Sign In` in the default state** (the `6486:81557` frame
   renders a single `C` — assumed to be a broken text layer in the design file).
6. **Where should `AuthModalShell` live** — `packages/frontend/src/components/` (proposed;
   the LP app is its only consumer and the hero image asset is LP-local) or promoted to
   `@pipeline/ui` so the Trustee app's `SignInOverlay` could eventually share it?

## Implementation Steps — completed 2026-09-17

**`get_design_context` recovered on retry** (see "Assumptions and Risks" above) — three
follow-up calls (`6486:81613`, `6486:81557`/enabled/`6486:81576`, `6486:81595`) all succeeded in
75–90s, well under the 300s cap, on the same local Dev Mode MCP session that had hung earlier.
The out-of-band fallback was **not** needed. This recovered hard data corrected several
`*(confirm)*` markers below — see the `[DONE, deviated]` notes.

### 1. Re-verify the design — [DONE]

`get_design_context` succeeded on retry for all three frames plus the wallet button's
`Continue with wallet` context. All three exported glyphs (wallet, eye, eye-slashed) were
downloaded as real SVG assets from the local Dev Mode MCP asset server — no hand-authored paths.
See `auth-components.md` for the confirmed Figma → token table.

Re-run the Figma extraction before writing code, following the curl recipe in
"Assumptions and Risks":

```bash
# initialize, capture mcp-session-id header, POST notifications/initialized, then:
tools/call get_variable_defs  { nodeId: "6486:81557" }   # and 6486:81576 / 6486:81595 / 6486:81613
tools/call get_screenshot     { nodeId: "6486:81557" }   # and the other three
tools/call get_design_context { nodeId: "6486:81613" }   # retry — see the hang note above
```

Confirm every value marked *(confirm)* in Step 4, and obtain the three exported glyphs
(wallet, eye, eye-slashed). Node ids come from the `node-id=` URL param with `-` → `:`.

### 2. Extract the two-pane modal shell — [DONE]

Lifted verbatim as specified; TD-58 logged. `AuthModalShell.tsx` — new, exporting one component plus
its props type. Lift it **verbatim** from
`packages/frontend/src/components/ConnectWalletModal.tsx` lines 9–39 (`FOCUSABLE`,
`trapFocus`), 442–490 (`RightImagePanel`), 524–564 (the four effects: initial focus, capture
-phase Escape, focus trap, body scroll lock) and 594–714 (overlay + panel + close button +
`createPortal`). Do not redesign it — byte-identical classes keep the two modals visually
consistent and keep the QA Figma comparison honest.

Props:

```ts
export interface AuthModalShellProps {
  open: boolean;
  onDismiss: () => void;
  /** Rendered as the left pane's <h2>; also wired to aria-labelledby. */
  heading: string;
  /** Stable id used for aria-labelledby and the heading element. */
  headingId: string;
  /** data-testid for the panel; the overlay gets `${testId}-overlay`. */
  testId: string;
  children: React.ReactNode;
}
```

The left pane keeps `flex flex-1 flex-col items-center justify-start overflow-y-auto px-6
py-10 lg:px-8 lg:py-12` with the inner `flex w-full max-w-[400px] flex-col gap-6` — the
Figma container is 400 wide with a 32px gap under the heading, which `gap-6` (24px) does
**not** match; the sign-in content wrapper supplies its own `gap-8` inside the 400px column
rather than changing the shared shell (see Step 4).

Keep the `<h2>` at `--font-weight-regular`, matching the shipped `ConnectWalletModal`
heading, even though the Figma `Heading L` type style records weight 700 — same shell, same
rendering, and the screenshot shows the light serif.

**Do not refactor `ConnectWalletModal` onto the shell in this issue.** It is merged,
QA-verified, and on the critical connect path. Instead log a tech-debt entry (next free id
is **TD-58**) in `docs/exec-plans/tech-debt-tracker.md`: "`ConnectWalletModal` still carries
its own copy of the two-pane shell, `FOCUSABLE`/`trapFocus`, and the four modal effects that
`AuthModalShell` (#1248) now owns; migrate it once the KYB modals have shipped."

### 3. Add the shared text-field primitive — [DONE]

`packages/ui/src/components/TextField/TextField.tsx` (+ `index.ts`, and a
`TextField.stories.tsx` per `docs/FRONTEND.md` → Component workshop). Export from
`packages/ui/src/index.ts` alongside its props type, in the file's existing position order.
No `@source` change is needed — `packages/frontend/src/index.css` already globs
`@source "../../ui/src/**/*.{ts,tsx}"`.

```ts
export interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (next: string) => void;
  /** "password" renders the eye show/hide toggle. */
  type?: "text" | "email" | "password";
  /** Paints the error fill + red text and wires aria-invalid. */
  invalid?: boolean;
  /** Error line rendered below the field, right-aligned, without shifting layout. */
  error?: string;
}
```

Geometry and styling, from the Figma `input` component (`6486:81613`) and the detached
password field in `6486:81628`–`6486:81635`:

| Property | Value | Figma binding |
| --- | --- | --- |
| Box | `w-full h-14` (56px), `rounded-[var(--radius-pipeline-card)]` (4px) | `radius/radius-s` = 4 |
| Fill, default | `--color-pipeline-surface` (`#ffffff`) | `fill-test/on-primary` |
| Fill, invalid | `rgb(178 0 0 / 0.16)` → new token (OQ 2) | `fill/negative-secondary` = `#b2000029` |
| Border | none in either state | no border variable bound on the node |
| Text padding | `pl-3` (12px left) | text frame at `x=12` |
| Text | `--text-pipeline-body` 16/22, `--font-weight-regular`, `--color-pipeline-ink` | `Body` / `content-test/primary` |
| Text, invalid | `#b20000` → new token (OQ 2) | `content-test/negative` |
| Placeholder | `--color-pipeline-ink-muted` *(confirm)* | `content-test/secondary` = `#38373599` |
| Eye button | 32×32, right inset 12px, vertically centered (`y=12` of 56) | `button-icon` at `x=356 y=12` |
| Eye glyph | 20×20, `eye` / `eye-slashed` variants | `eye-slashed` instance, 20×20 |
| Error line | `--text-pipeline-caption` 12/16, red, right-aligned | `Caption` |

**The error line must not move the layout.** Figma keeps both inputs at the identical y
offsets (0 and 88) in the default, enabled, *and* error frames, so the 32px inter-field gap
absorbs the message. Implement the field as a `relative` wrapper with the 56px input and
`<p className="absolute top-full right-0 mt-1 …">` for the error. Verify the 4px offset
*(confirm)* against `get_design_context`.

Accessibility — this sets new repo conventions, so state them in the spec:
`aria-invalid={invalid || undefined}` on the input (first use of `aria-invalid` in the
repo); `aria-describedby` pointing at the error `<p>`'s generated id when `error` is set;
the error `<p>` gets `role="alert"`; the eye toggle is a real `<button type="button">` with
`aria-label` flipping between `Show password` / `Hide password` and `aria-pressed`. Follow
the `packages/ui` house style: `React.forwardRef`, a 2–3-line `// spec:` pointer header, no
other comments.

Put non-trivial state in a co-located `useTextField.ts` per `docs/FRONTEND.md` → Code
structure rules, rule 2 — at minimum the `showPassword` toggle and the derived input `type`
and error id.

### 4. Build the Sign-in modal — [DONE, deviated]

`get_design_context` recovery (Step 1) surfaced hard data that corrected several `*(confirm)*`
guesses in this section:

- **Vertical rhythm is not a flat `gap-8`.** The real structure is two nested containers: an
  outer `gap-4` (16px) wrapping [wallet button, OR divider, fields-block], and the fields-block
  itself `gap-8` (32px) wrapping [fields-group (`gap-8`: email, password), submit, "Forgot
  password?", "New here?"]. Implemented as two nested flex columns instead of one.
- **"Forgot password?" is full ink (`--color-pipeline-ink`, `content-test/primary`), not
  `ink-muted`** as guessed.
- **"New here?" is `--color-pipeline-ink-muted` (`content-test/secondary`, 0.6 alpha), not
  `ink-subtle`** as guessed (`ink-subtle` was right for the OR divider/label, which really is
  `content-test/tertiary`).
- **The OR divider/label color is confirmed exactly** — `border-test/primary` /
  `content-test/tertiary` both resolve to `rgba(56,53,56,0.3)`, matching the existing
  `--color-pipeline-ink-subtle` token exactly enough that no new token was added.
- **The default frame's submit label reads "Sign In"** in the actual exported code (not the
  literal `C` visible in the screenshot) — Open Question 5 confirmed independently of the
  human resolution.
- **Dropped `onForgotPassword`/`onCreateAccount` props** from the plan's `SignInModalProps`.
  Both render as plain non-interactive `<p>` text with no click handler — a more literal reading
  of the resolved Open Question 4 ("renders inert") than wiring an unused no-op seam, and the
  Test Strategy below never exercises those two props.

`packages/frontend/src/components/SignInModal.tsx` + `useSignInModal.ts`. Follow the
`ConnectWalletModal` precedent for small unexported subcomponents living in the same file
(`WalletRow`, `RightImagePanel`, the inline icons) rather than one file each.

```ts
export interface SignInModalProps {
  open: boolean;
  onDismiss: () => void;
  /**
   * Seam for #1254. Receives the validated credentials. Defaults to a no-op —
   * #1248 ships no network call.
   */
  onSubmit?: (credentials: { email: string; password: string }) => void;
  /** Seam for #1254 — opens the wallet chooser. Defaults to a no-op. */
  onContinueWithWallet?: () => void;
  onForgotPassword?: () => void;
  onCreateAccount?: () => void;
}
```

Left-pane composition inside `AuthModalShell` (heading `Sign in`, headingId
`sign-in-modal-heading`, testId `sign-in-modal`), a `flex flex-col gap-8` (32px) column:

1. **"Continue with wallet"** — `Button variant="secondary"` with
   `className="!w-full !min-w-0 !justify-start !px-2 bg-[color:var(--color-pipeline-surface)]"`
   (8px outer + the Button's built-in inner `px-2` = the 16px Figma inset), children a
   `flex items-center gap-2` span holding the exported 24×24 wallet glyph and the label at
   `--font-weight-emphasized`. 48px tall, radius 4 — both already `Button` defaults. Add a
   hover background; `secondary` ships `bg-transparent` with no hover.
2. **"OR" divider** — 400×40, a centered hairline with the label inset. Rule color
   `--color-pipeline-line` *(confirm — the frame also binds `border-test/primary` at 0.30
   alpha; pixel math on the downscaled render implies ≈0.18–0.19)*. Label `OR` in
   `--text-pipeline-caption` + `--font-weight-medium` + `--tracking-pipeline-label`
   (`Label`, letterSpacing 7 = 0.07em), color `--color-pipeline-ink-subtle` *(confirm)*.
   Keep it as an unexported subcomponent in this file; promote it to `@pipeline/ui` only
   when #1249 confirms it is unchanged there (it is instanced identically in `6486:81625`).
3. **Fields** — two `TextField`s, `gap-8` (32px): `type="email"`, placeholder
   `Enter corporate email`, `autoComplete="email"`; then `type="password"`, placeholder
   `Password`, `autoComplete="current-password"`.
4. **Submit** — `Button variant="primary-blue" type="submit"` with
   `className="!w-full !min-w-0 disabled:opacity-[0.32]"`, label `Sign In`. Enabled fill is
   `#000080` = `--color-pipeline-brand` (sampled exactly). The disabled fill sampled
   `#a9a8d0`, which solves to brand at **0.32** alpha over paper — i.e. exactly the
   `disabled:opacity-[0.32]` the kit's `secondary` variant already uses. `primary-blue`
   does not carry that rule today, hence the className override (the established pattern,
   per `packages/trustee/src/components/SignInCard.tsx`).
5. **"Forgot password?"** — `--text-pipeline-caption`, `--color-pipeline-ink-muted`
   *(confirm)*, centered, 32px below the submit button.
6. **"New here? Create account"** — centered, 32px below; `New here?` in
   `--color-pipeline-ink-subtle` *(confirm)*, `Create account` in
   `--color-pipeline-ink` at `--font-weight-emphasized`, as one line.

Wrap the fields + submit in a real `<form onSubmit>` — the first `<form>` in the repo — so
Enter submits natively. `Button` defaults `type="button"`, so pass `type="submit"`
explicitly.

State in `useSignInModal.ts`, mirroring the `useRejectReasonDialog` convention
(`packages/trustee/src/routes/-useRejectReasonDialog.ts`): `email`, `password`, per-field
`touched` flags, derived `emailError` / `passwordError` / `isValid`, a `reset()` called when
`open` flips to true, and a `submit()` that validates, sets `touched`, and calls `onSubmit`
only when valid. Suppress messages until the field is touched or submit was attempted.
Error copy is verbatim from the frame: `Enter the correct email address`,
`Enter the correct password`. Validation rules per Open Question 3.

Add the `data-node-id` Figma-traceability attribute on the panel, per the
`FirstConnectionModal` precedent: `data-node-id="6486:81557"`.

### 5. Add the preview seam — [DONE]

`packages/frontend/src/routes/test.tsx` — add `"auth"` to the `TestTab` union, to `TABS`
(`{ id: "auth", label: "Auth" }`), and to `validateSearch`. The tab body renders a short
note plus one button that flips local state to open `<SignInModal open … onDismiss … />`
with all four seam callbacks left at their defaults. This keeps the modal reachable at
`/test?tab=auth` for live human review and for the #1255 QA pass, without touching
`TopBar`, `ConnectModalProvider`, or any of the six production `openConnectModal` call
sites. Update `packages/frontend/src/routes/-test.test.tsx` for the new tab.

### 6. Lint, typecheck, build — [DONE]

```bash
yarn workspace @pipeline/ui lint
yarn workspace @pipeline/frontend lint
cd /Users/luiza/Projects/pipeline/packages/frontend && npx tsc --noEmit
yarn workspace @pipeline/frontend test
npx tsx scripts/lint-docs.ts
yarn workspace @pipeline/frontend build
```

Do not start or restart a dev server if one is already running — the user runs their own and
HMR picks up edits.

## Test Strategy

Vitest + Testing Library, `TZ=UTC vitest run`. All new tests live under
`packages/frontend/src/` (`packages/ui` has no runner and no CI job). Title each `describe`
with the issue number, per house style (`describe("SignInModal (#1248)", …)`).

**`packages/frontend/src/components/TextField.dom.test.tsx`** — new, exercising the
`@pipeline/ui` primitive through the package boundary:

- renders a `text` / `email` / `password` input with the right `type` and placeholder;
- the password eye toggle flips `type` between `password` and `text`, and flips its
  `aria-label` between `Show password` / `Hide password`;
- `invalid` sets `aria-invalid="true"`; absent `invalid` leaves it unset;
- `error` renders a `role="alert"` message wired via `aria-describedby`;
- token-exactness assertions on the class string, the established proxy for styling
  regressions (e.g. `expect(input.className).toContain("rounded-[var(--radius-pipeline-card)]")`
  and the invalid fill token) — one per row of the Step 3 table that is expressible as a class;
- `onChange` receives the next string, not the event.

**`packages/frontend/src/components/SignInModal.test.tsx`** — new:

- renders nothing when `open` is false; portals into `document.body` when true;
- the three states: submit is `disabled` with both fields empty; enabled once both are
  non-empty and the email is well-formed; both error messages render with the exact Figma
  copy after an invalid submit, and the submit stays disabled;
- **the presentational contract** — clicking submit with valid input calls `onSubmit` once
  with `{ email, password }`, and with no `onSubmit` prop it neither throws nor triggers any
  `fetch` (assert with `vi.spyOn(globalThis, "fetch")` never called). This pins the "no
  network in #1248" guarantee so #1254's wiring is a deliberate change, not an accident;
- **no layout shift in the error state** — both field wrappers keep the same class set with
  and without `error`, and the error `<p>` carries `absolute top-full`;
- state resets when `open` goes false → true;
- dismissal: Escape and the × button both call `onDismiss`; no scrim click (the panel is
  full-viewport, matching `ConnectWalletModal`);
- `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` resolve to the `Sign in`
  heading; Tab from the last focusable wraps to the first (focus trap).

**`packages/frontend/src/components/AuthModalShell.test.tsx`** — new, minimal: heading and
`aria-labelledby` wiring, children render in the left pane, the right image pane is
`aria-hidden` and hidden below `lg`, body `overflow` is `hidden` while open and restored on
unmount.

**`packages/frontend/src/routes/-test.test.tsx`** — update for the new `auth` tab
(`validateSearch` maps an unknown tab to `status`; the Auth tab renders its open button).

**Regression guard:** `ConnectWalletModal.test.tsx`, `FirstConnectionModal.test.tsx`,
`TopBar.test.tsx` must pass unchanged — this issue must not alter the connect flow.

**Figma verification (the acceptance check; the frontend flow has no QA phase):** render
`/test?tab=auth` at 1728×916 and compare side by side against `6486:81557` (empty),
`6486:81576` (filled), and `6486:81595` (both errors). Check, in order: the 400px column and
its 32/16/32/32/32px vertical rhythm; the 56px field height and 4px radius; the error fill
`rgba(178,0,0,0.16)` and text `#b20000`; the disabled submit resolving to brand at 0.32; the
right pane's logo (116px) and `Access real-world / yield on-chain` headline, which must be
pixel-identical to the existing `ConnectWalletModal` since both use the extracted shell.
Record residual deltas in the PR description.

## Docs to Update

- **New — `docs/frontend/auth-components.md`.** Specs for `AuthModalShell` and
  `SignInModal`, in the `dashboard-components.md` house format: `###` + component name, an
  opening paragraph stating role and trigger, a `Visual specs (Figma):` bullet list with one
  backticked `NNNN:NNNNN` node per state, a `Dimensions:` paragraph with px/token values and
  parenthesised issue provenance, and a closing bolded `**Accessibility:**` paragraph.
  Record here: the Figma → token mapping table from Step 3, the no-layout-shift error rule,
  the "no network call in #1248, seam for #1254" contract, the unguarded body-scroll-lock
  and capture-phase-Escape caveats, and the desktop-only-Figma note. A new area doc (rather
  than growing `dashboard-components.md`, already 117 KB) because epic #1247 adds six more
  screens that will all land here — same reasoning as `wallet-flows.md` / `trustee-flows.md`.
- **`docs/frontend/index.md`** — add the new doc to the `## Area specs` list. This is
  **required in the same commit**: `scripts/lint-docs.ts` rule 2 BFS-walks from `AGENTS.md`
  and errors on any unreachable `docs/**.md`. Do **not** add a line to `AGENTS.md` — it is
  at exactly 100 lines, the linter's warn threshold.
- **`docs/frontend/ui-components.md`** — a `## TextField` entry in alphabetical position,
  with its `### Figma → token mapping`, `### Variants`, and `### Accessibility`
  sub-headings, per that file's existing structure. Note the two new repo firsts
  (`aria-invalid`, the first `<form>`).
- **`docs/frontend/dashboard-components.md`** — a short cross-reference under
  `## Navigation & wallet UI`, next to `### ConnectWalletModal` (~L667), pointing at
  `auth-components.md` and stating that the connect entry point is unchanged by #1248.
- **`packages/ui/src/styles/theme.css`** — the two new negative tokens, if Open Question 2
  resolves that way; `docs/FRONTEND.md` → Design tokens gets the matching bullet.
- **`docs/exec-plans/tech-debt-tracker.md`** — **TD-58** (`ConnectWalletModal` not yet on
  `AuthModalShell`, per Step 2) and, if OQ 2 resolves toward new tokens, a second entry for
  the `#c0392b` vs `#b20000` negative-red divergence for the designer to reconcile.
- **New — `docs/user-stories/epic-1247/1248-signin-modal.md`**, linked from a new
  `## Epic #1247 — KYB login flow` section in `docs/user-stories/index.md`. Cover the
  behavioral stories only — empty→disabled, filled→enabled, invalid→error copy, password
  show/hide, Escape/× dismissal, and "submit performs no network call". Per that index's own
  preamble, styling-only stories stay out; visual fidelity is the QA agent's Figma
  comparison. This is what #1255 will execute.
- **Product spec — deliberately deferred to #1254.** `AGENTS.md` requires a spec for
  user-facing *behavior*, and this issue ships none: no authentication happens, no session
  exists, and the two product questions that define the flow (wallet relationship, KYB
  provider) are open on epic #1247. Writing `docs/product-specs/` now would encode guesses.
  The presentational contract lives in `auth-components.md`; the obligation to add a KYB
  product spec transfers to #1254 and should be noted in that issue when it unblocks.
- Move this plan to `docs/exec-plans/completed/` when the issue closes (manager/coder
  housekeeping).
