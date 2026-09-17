# KYB auth components

LP-facing email+password authentication modals for epic #1247 (KYB login flow). This is a new
area doc — `dashboard-components.md` is already 117 KB and epic #1247 adds six more screens
(#1249 Create-account, #1250 OTP, #1251 Company Docs, #1252 Owners, #1253 Account-in-review) that
will all land here, same reasoning as `wallet-flows.md` / `trustee-flows.md`.

**No production entry point changes in this epic yet.** These modals are reachable only from the
`/test?tab=auth` diagnostics route (see `dashboard-components.md#diagnostics-route`). `TopBar`'s
"Connect Wallet" button keeps opening `ConnectWalletModal` unchanged. The LP header will get
separate entry buttons once a dedicated Figma for that change ships — tracked on epic #1247, not
this issue.

### AuthModalShell

`packages/frontend/src/components/AuthModalShell.tsx`. The full-viewport two-pane modal frame
shared by the KYB auth screens (Figma component `8550:10210` content pane + `8550:10546` image
pane) — lifted verbatim from `ConnectWalletModal`'s shell (focus trap, capture-phase Escape,
body-scroll lock, `RightImagePanel`) so the two families of modals stay pixel-identical. Renders
a `<h2>` heading (wired to `aria-labelledby`) plus arbitrary `children` in the left pane, and the
hero photo + Pipeline logo + "Access real-world yield on-chain" headline in the right pane
(hidden below `lg`).

`ConnectWalletModal` itself was **not** refactored onto this shell (TD-58,
`docs/exec-plans/tech-debt-tracker.md`) — it is merged, QA-verified, and on the critical connect
path.

Known shell caveats it inherits unchanged (both pre-existing, not introduced by #1248):

- **Unguarded body-scroll-lock.** `document.body.style.overflow` is set to `"hidden"` and reset
  to `""` on cleanup with no reference counter. If `SignInModal` is ever stacked over
  `ConnectWalletModal`, closing the inner one unlocks the body under the outer one. Not triggered
  today — the modal only opens standalone from `/test`.
- **Escape-key capture-phase collision.** Both this shell and `ConnectWalletModal`/
  `FirstConnectionModal` listen for Escape on `document` in the capture phase with
  `e.stopPropagation()`. If two of these modals are ever stacked, use the
  `stopImmediatePropagation` pattern from
  `packages/ui/src/components/ErrorDetailsDialog/useErrorDetailsDialog.ts` (documented at
  `docs/frontend/error-handling.md#nested-dialogs-1037`).

**Accessibility:** `role="dialog" aria-modal="true"`, `aria-labelledby` resolves to the heading
element's id; focus trap (Tab/Shift+Tab cycle among non-`aria-hidden` focusable descendants);
Escape and the × button both dismiss; no scrim click (the panel is full-viewport, matching
`ConnectWalletModal`).

### SignInModal

`packages/frontend/src/components/SignInModal.tsx` + `useSignInModal.ts`. The email+password
sign-in screen — a presentational component with **no network call**; `onSubmit` is a seam for
#1254 (defaults to a no-op).

Visual specs (Figma):

- Default (empty fields, submit disabled): node `6486:81557`.
- Enabled (both fields filled, submit enabled): node `6486:81576`.
- Validation error (malformed email + empty password): node `6486:81595`.

Composition inside `AuthModalShell` (heading "Sign in", `headingId`
`sign-in-modal-heading`, `testId` `sign-in-modal`), top to bottom, wrapped in the repo's first
`<form onSubmit>` (so Enter submits natively):

1. **"Continue with wallet"** — `Button variant="secondary"`, white fill override (the shared
   `secondary` variant ships transparent), a 24×24 wallet glyph + label. Seam `onContinueWithWallet`
   (defaults to a no-op) — a development annotation on the Figma node confirms the intended
   destination is the existing `ConnectWalletModal`; wiring is #1254's job.
2. **"OR" divider** — a hairline rule each side of a centered `OR` label, `--color-pipeline-ink-subtle`
   for both the rule and the label (confirmed via Figma variable defs: `border-test/primary` /
   `content-test/tertiary` both resolve to `rgba(56,53,56,0.3)` — within one channel unit of the
   repo's existing `ink-subtle` (`rgb(56 55 53 / 0.3)`), so no new token was added).
3. **Fields** — two `TextField`s (`@pipeline/ui`): `type="email"` placeholder
   "Enter corporate email", then `type="password"` placeholder "Password".
4. **Submit** — `Button variant="primary-blue" type="submit"`, label "Sign In" in every state
   (the default-state frame renders the disabled button's label as a single corrupt `C` glyph in
   the design file; treated as a design-file artifact, `get_design_context` confirms the two other
   frames render "Sign In"). Disabled fill is the brand color at `opacity-[0.32]`, confirmed by
   `get_design_context` (`opacity-32` class on the Figma-exported node) rather than a separately
   sampled color.
5. **"Forgot password?"** — renders as inert text (no `<button>`, no handler) — it has no
   destination frame in the "KYB Onboarding" file and no sub-issue.
6. **"New here? Create account"** — also inert text in #1248; the real destination is #1249.

**Figma → token mapping** (confirmed via `get_variable_defs` + `get_design_context`, not
estimated from pixel sampling):

| Element | Token | Figma binding |
| --- | --- | --- |
| Field fill, default | `--color-pipeline-surface` | `fill-test/on-primary` |
| Field fill, invalid | `--color-pipeline-negative-secondary` (new) | `fill/negative-secondary` = `#b2000029` |
| Field/error text, invalid | `--color-pipeline-negative-strong` (new) | `content-test/negative` = `#b20000` |
| Placeholder | `--color-pipeline-ink-muted` | `content-test/secondary` |
| "Forgot password?" | `--color-pipeline-ink` | `content-test/primary` (full ink, **not** muted) |
| "New here?" | `--color-pipeline-ink-muted` | `content-test/secondary` |
| "Create account" | `--color-pipeline-ink`, `--font-weight-emphasized` | `content-test/primary` |
| OR rule + label | `--color-pipeline-ink-subtle` | `border-test/primary` / `content-test/tertiary` |
| Submit label (enabled) | `--color-pipeline-on-dark` | `content-test/primary-on-invert` |

The two new tokens (`--color-pipeline-negative-strong: #b20000`,
`--color-pipeline-negative-secondary: rgb(178 0 0 / 0.16)`) were added to
`packages/ui/src/styles/theme.css` token-exact to the KYB frame rather than reusing the existing
`--color-pipeline-negative: #c0392b` — the two live in different Figma variable namespaces and
render visibly different reds. The divergence is logged as tech debt (TD-59) for a designer
reconciliation pass.

**Vertical rhythm** (400px column, confirmed via `get_design_context` node metadata — not a flat
32px gap): the heading sits 32px above the content; within the content, the wallet button, the OR
divider, and the fields-block are each spaced 16px apart; **inside** the fields-block, the two
fields, the submit button, "Forgot password?", and "New here?" are each spaced 32px apart. The
error caption is absolutely positioned (`top-full`, right-aligned) below its field so it never
shifts the 32px field-to-field rhythm.

**Validation** (presentational only — no complexity rule, free-mail domains allowed):

- Email: format-checked against `local@domain.tld` on blur or on submit attempt. No error while
  the field is empty.
- Password: only checked for emptiness, and only after a submit attempt.
- Submit is disabled until the email is non-empty and well-formed **and** the password is
  non-empty — including while showing a validation error, matching the Figma error frame (its
  submit button is also rendered disabled).
- Error copy is verbatim from the Figma frame: "Enter the correct email address" /
  "Enter the correct password" — reused by #1254 for the server-rejection case.
- All local state resets when the modal reopens (`open` flips `false` → `true`).

**Icons.** The wallet glyph, the eye glyph, and the eye-slashed glyph are the exact Figma-exported
SVG paths (via `get_design_context`, which recovered on retry after initially hanging — see the
exec plan's Figma-access note) — no hand-authored vector paths.

**Accessibility:** first `<form>` element in the repo. `aria-invalid` on `TextField`'s `<input>`
(also a repo first — see `ui-components.md#textfield`). "Forgot password?"/"Create account" are
plain text, not focusable, since they are inert in this issue.

### Diagnostics preview seam

`packages/frontend/src/routes/test.tsx` — a new `"auth"` tab (`/test?tab=auth`) renders a button
that opens `SignInModal` with every seam left at its no-op default. This is the only reachable
entry point for #1248; it does not touch `TopBar`, `ConnectModalProvider`, or any of the six
production `openConnectModal` call sites.
