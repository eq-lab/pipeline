# Issue #1249: KYB: Create-account modal

Source: https://github.com/eq-lab/pipeline/issues/1249

Sub-issue of epic #1247 (KYB login flow). Branch `feat/1249-kyb-create-account`, draft PR #1257,
**stacked on `feat/1248-kyb-signin-modal`** (PR #1256, still open against `main`).

Sibling sub-issues: #1248 Sign-in modal (`executed`, PR open), #1250 OTP screen, #1251 Company
Docs, #1252 Owners, #1253 Account-in-review, #1254 auth session/orchestration/wiring (`blocked`),
#1255 QA (`blocked`).

This is a **thin delta on #1248**, not a new screen family. The Figma frame is literally an
instance of the same `Sign In` component (`6486:81639` → `8550:10210`/`8550:10546`) with four
slot overrides. Read `docs/frontend/auth-components.md` and
`docs/exec-plans/completed/issue-1248-kyb-signin-modal.md` before starting — everything not listed
as a delta below is already built and must be reused verbatim.

## Scope

**In scope — a presentational modal, no network calls.**

- A new LP-app modal `CreateAccountModal` reproducing Figma frames "Create account" default
  (`6486:81615`) and enabled (`6486:81640`), composed inside the existing `AuthModalShell`.
- Extraction of the two form parts that #1248 left local to `SignInModal.tsx` and that the
  create-account frame instances **identically** (confirmed this session via `get_metadata` +
  `get_design_context`): the "Continue with wallet" button (`6486:81624`) and the OR divider
  (`6486:81625`). #1248's own plan scheduled this promotion for #1249, conditional on exactly this
  confirmation.
- Reuse of #1248's credential form state/validation, generalized out of `useSignInModal.ts`.
- A focus ring on `@pipeline/ui`'s `TextField`, which the enabled frame documents and the shipped
  component is missing entirely (see "Design delta" → the focus-ring finding).
- Extension of the existing `/test?tab=auth` preview seam with a second trigger button.
- Spec entry in `docs/frontend/auth-components.md` and a user-stories doc under
  `docs/user-stories/epic-1247/`, linked from the index.

**Out of scope**

- Any HTTP call, account creation, session, or persisted state. `onSubmit` is a no-op seam for
  #1254, exactly as in #1248.
- Navigation to the OTP screen. #1250 owns that screen and #1254 owns the flow between screens —
  "Sign Up" is a no-op seam, not a route change.
- Wiring the two cross-links between the modals. "Log in" here, and "Create account" in
  `SignInModal`, both stay inert plain text (#1248 resolution 4, same class of question).
- Production entry point changes. Per the epic comment of 2026-09-17 the LP header gets **separate
  buttons** from a forthcoming Figma; no sub-issue touches `TopBar`, `ConnectModalProvider`, or the
  six `openConnectModal` call sites.
- A "confirm password" field, company/organization fields, a country selector, and a
  terms-acceptance checkbox. **None of these exist in the design** — see "Design delta" below.
- A validation-error frame. The epic's screen list gives Create account only two states
  (default / enabled); error behavior is inherited from #1248, not newly designed.
- A product spec — deferred to #1254 for the same reason as #1248 (no authentication happens, and
  the epic's two product questions are still open).
- Mobile/responsive work beyond what `AuthModalShell` already does. The frame is desktop-only
  (1728×916).

## Design delta vs. the sign-in modal

`6486:81615` is `<instance id="6486:81639" name="Sign In">` — the same component as the sign-in
frame (`6486:81557`). Diffing the two `get_design_context` outputs, **only four things differ:**

| | Sign in (#1248) | Create account (#1249) |
| --- | --- | --- |
| Heading | `Sign in` | `Create account` |
| Submit label | `Sign In` | `Sign Up` |
| Footer line 1 | `Forgot password?` | **absent** |
| Footer line 2 | `New here? Create account` | `Already have an account? Log in` |

Everything else is byte-identical: the "Continue with wallet" button and its 24px wallet glyph,
the OR divider, the `Enter corporate email` field, the `Password` field with its eye toggle, the
disabled-submit treatment, the right-hand image pane, and the close button.

**Field set — exactly two inputs.** Metadata for `6486:81626` lists, in order: `input`
(email, y=0), `Field` (password + `button-icon` eye toggle, y=88), `input` (y=176,
**`hidden="true"`**), `button` (submit, y=176), `text` (footer, y=256). The third `input` is a
hidden leftover layer sitting underneath the submit button — it renders nowhere in either
screenshot and must **not** be built. There is no password-confirm, no company field, and no
checkbox anywhere in the frame.

**Vertical rhythm** (400px column, from node offsets):

- Container `6486:81639;8550:10453`: `w-[400px]`, `gap-32`, `pb-[64px]` → heading (h56) then the
  content block 32px below.
- Content block `6486:81623`: `gap-16` → [wallet button h48] · [divider h40] · [fields block].
- Fields block `6486:81626`: `gap-32` → [email h56] · [password h56] · [submit h48] · [footer h16].

Note the fields block is **flat** here — unlike the sign-in frame, there is no nested
fields-group. Both render identically (32px everywhere), so `SignInModal`'s existing nesting is
not a defect; the create-account modal can use a single `gap-8` column.

`AuthModalShell`'s inner column is `gap-6` (24px); `SignInModal` recovers the Figma's 32px by
adding `mt-2` on its form. Do the same here rather than changing the shared shell.

**Token bindings** (from `get_variable_defs`; the two frames return identical maps):

| Element | Figma binding | Repo token |
| --- | --- | --- |
| Heading `Create account` | `Heading L` (Besley 48/56) / `content-test/primary` `#262524` | shell default (`--text-pipeline-heading-l`, `--color-pipeline-ink`) |
| Wallet button fill / label | `fill-test/on-primary` `#ffffff` / `content-test/primary`, `Body Emphasized` | `--color-pipeline-surface`, `--font-weight-emphasized` |
| Divider rule + `OR` label | `border-test/primary` / `content-test/tertiary`, both `#3835384d`; `Label` 12/16 Medium, `tracking 0.84px` (= 0.07em) | `--color-pipeline-ink-subtle`, `--tracking-pipeline-label` |
| Field fill / placeholder | `fill-test/on-primary` / `content-test/secondary` `rgba(56,55,53,0.6)`, `Body` 16/22 | `--color-pipeline-surface`, `--color-pipeline-ink-muted` |
| Field box | `radius/radius-s` = 4, `h-56`, `px-12`, `gap-4` | `--radius-pipeline-card` |
| Submit fill | `fill/brand` `#000080`, `opacity-32` in the default frame | `--color-pipeline-brand`, `disabled:opacity-[0.32]` |
| Submit label `Sign Up` | `content-test/primary-on-invert` `#ffffff`, `Body Emphasized` | `--color-pipeline-on-dark` |
| `Already have an account? ` | `content-test/secondary`, `Caption` 12/16 | `--color-pipeline-ink-muted` |
| `Log in` | `content-test/primary` `#262524`, `Caption` 12/16 | `--color-pipeline-ink` |

**No negative/error tokens appear in either frame's variable map** — further confirmation that
Create account has no designed error state.

**Two design-file artifacts to ignore**, both in the footer's exported code (same class as
#1248's corrupt `C` submit label):

1. `Log in` is emitted as `font-['Inter:Regular'] font-normal` — an unstyled link run, not a real
   font switch. Use the body font. Its **weight** is the one genuinely ambiguous pixel: the
   codegen says regular, while the sibling `Create account` link in the sign-in frame is
   `Body Emphasized`. Ship **regular** (token-exact to the codegen) and record the divergence in
   the spec so the QA Figma comparison can flag it if the designer intended otherwise.
2. `Log in` carries a stray `href="https://rive.app/login/?redirect=…"` — a leftover from a
   copied layer pointing at the design tool's own vendor. Do **not** render an anchor or any
   href.

**Difference between the two frames** (`6486:81615` → `6486:81640`): the email field shows
`hello@eqlab.io` in `content-test/primary` instead of the muted placeholder, the password field
shows ten bullets, and the submit button loses `opacity-32` (full `#000080`). The eye toggle stays
in its `eye` (show) state in both. That much is the same default→enabled pair #1248 already
implements from local component state — no new code path.

**One genuinely new finding: `TextField` is missing a focus ring.** In `6486:81640` the email
field also gains `border: 1px solid var(--border-test/primary)` = `#3835384d`, and the `.cursor`
node (hidden in the default frame) becomes visible inside that same field. The password field is
filled but has **no** border. Caret + border on exactly one field is conclusive: this is the
**focused** state, not a filled state.

The shipped `TextField` has no visible focus indicator at all — the box carries no border in
either state and the `<input>` sets `outline-none`. #1248's spec records "Border: none in either
state", which was read off the default `input` component node where it is correct. So this is both
a Figma fidelity gap and a WCAG 2.4.7 (focus visible) failure, and #1249's enabled frame is the
first frame in the epic that documents the intended treatment. See Implementation Step 3.

## Design source

Extracted this session from the local Dev Mode MCP server (`http://127.0.0.1:3845/mcp`, curl
JSON-RPC: initialize → capture the `mcp-session-id` header → `notifications/initialized` →
`tools/call`; responses are SSE, filter `^data:` lines). Unlike the #1248 planning pass,
`get_design_context` did **not** hang — all calls succeeded on the first attempt for
`6486:81615`, `6486:81640`, and `6486:81557` (the sign-in frame, fetched for the diff).

No assets need re-exporting: the asset block is byte-for-byte identical across all three frames
(same content hashes for `imgWallet`, `imgDivider`, `imgEye`, `imgProjectLogo`, `imgCloseIcon`,
and the two right-pane PNGs), so every glyph #1248 already shipped is the same instance.

## Assumptions and Risks

- **Branch stacking.** PR #1257 targets `feat/1248-kyb-signin-modal`, and PR #1256 (#1248 → `main`)
  is still open. Per the project's incremental-merge convention, #1256 must merge before #1257.
  Steps 1 and 2 below edit files introduced by #1248 (`SignInModal.tsx`, `useSignInModal.ts`); if
  #1256 takes review edits to those files, rebase #1257 before continuing. See Open Questions.
- **Extraction must not regress #1248.** `SignInModal.test.tsx` and `AuthModalShell.test.tsx` must
  pass unchanged after Steps 1–2 — they are the regression guard proving the refactor is pure.
  (`TextField.dom.test.tsx` is the one #1248 test that gains a case, from Step 3.)
- **No new design tokens are needed.** Every binding in the table above already maps to an
  existing token, including the two negative tokens #1248 added (unused here). Do not add to
  `theme.css`.
- **No new glyphs.** The wallet and eye/eye-slashed SVGs #1248 exported are the same instances.
  Do not re-export or hand-author vector paths.
- **The `TextField` focus ring is the one shared-primitive change** (Step 3) and it retroactively
  alters `SignInModal`'s appearance. It is a fidelity + a11y fix, but it lands in a PR stacked
  under an open #1248 — call it out explicitly in #1257's description. This issue adds no new
  `@pipeline/ui` component, so `packages/ui`'s "no test runner / no CI typecheck" constraint still
  means every new test lives in `packages/frontend/src/`.
- **Inherited shell caveats** (unguarded body-scroll-lock, capture-phase Escape collision) are
  documented in `auth-components.md#authmodalshell` and are not triggered here — the modal only
  opens standalone from `/test`. Do not stack `CreateAccountModal` over `SignInModal` in the
  preview tab; use two independent trigger buttons and two independent `open` flags.
- Epic #1247's two open questions (wallet relationship; KYB verification mechanism) do not gate
  this screen — it renders no wallet state and calls no KYB provider.

## Open Questions

1. **Should #1257 refactor files that #1248 introduced, while PR #1256 is still open?** Steps 1–2
   move `WalletIcon`/`OrDivider` out of `SignInModal.tsx` into a shared module and rename
   `useSignInModal.ts` → `useAuthCredentialsForm.ts`, so #1257's diff also touches already-reviewed
   #1248 code. **Proposed default: yes, do the extraction** — #1248's own plan explicitly deferred
   the OR-divider promotion to "when #1249 confirms it is unchanged there", and this session
   confirmed it is the same instance; duplicating ~70 lines instead would be worse. Confirm, or
   say "keep #1248's files untouched" and the coder will have `CreateAccountModal` import the
   existing symbols under their current names instead (marking the tidy-up as tech debt).

   The same call covers **Step 3**, which changes `@pipeline/ui`'s `TextField` — also a #1248
   file, and the one change here that alters how the already-reviewed sign-in modal *looks*
   (it gains the focus ring too). Proposed default is likewise yes: the component currently has
   no visible focus indicator in any state, so this is a WCAG 2.4.7 fix as much as a Figma one.
   Answering "no" to the refactor but "yes" to the focus ring (or vice versa) is fine — they are
   independent; say which.

## Implementation Steps

**Status: all 6 steps implemented (2026-09-17).** See the coder report on issue #1249 for the
lint/typecheck/test/build gate results.

### 1. Extract the shared form parts — done

New `packages/frontend/src/components/AuthModalParts.tsx` — a 2–3-line `// spec:` pointer header,
no other comments (house style). Move **verbatim**, with no styling changes, out of
`SignInModal.tsx`:

- `WalletIcon` (the 24×24 Figma-exported wallet SVG) — keep it unexported, consumed only by the
  button below.
- `ContinueWithWalletButton({ onClick }: { onClick?: () => void })` — the whole `Button
  variant="secondary"` with its existing `!w-full !min-w-0 !justify-start !px-2`, white-fill
  override, hover rule, and the `flex items-center gap-2` span holding the glyph and the
  `Continue with wallet` label at `--font-weight-emphasized`.
- `OrDivider()` — unchanged.

Then edit `packages/frontend/src/components/SignInModal.tsx` to import both and delete its local
copies. Nothing else in that file changes. The rendered DOM must be identical — verify by running
`SignInModal.test.tsx` unchanged.

Keep these in `packages/frontend`, next to `AuthModalShell`, not in `@pipeline/ui` — same
reasoning as #1248's resolution 6 (the LP app is the only consumer).

### 2. Generalize the credential form hook — done

Rename `packages/frontend/src/components/useSignInModal.ts` →
`packages/frontend/src/components/useAuthCredentialsForm.ts`:

- `useSignInModal` → `useAuthCredentialsForm`; `UseSignInModalOptions`/`UseSignInModalResult` →
  `UseAuthCredentialsFormOptions`/`UseAuthCredentialsFormResult`.
- Keep the exported `EMAIL_ERROR_MESSAGE` / `PASSWORD_ERROR_MESSAGE` constants and every rule
  exactly as shipped: email format-checked against `local@domain.tld` on blur or submit attempt,
  no error while empty; password empty-checked on submit only; `isValid` gates the submit button;
  all state resets when `open` flips `false` → `true`.
- **No new validation.** Per #1248's resolution 3 (reused here, same class): no complexity rule,
  no minimum length, free-mail domains allowed, "corporate email" is placeholder copy not a
  constraint. The real sign-up rule is #1254's to adopt from the backend.
- Update the import in `SignInModal.tsx` and the `useSignInModal` references in
  `docs/frontend/auth-components.md`.

### 3. Add the missing focus ring to `TextField` — done

`packages/ui/src/components/TextField/TextField.tsx` — the field row currently renders no border
in any state. Add a focus ring bound to the Figma value, on the **row**, not the `<input>` (the
input keeps `outline-none`; the visible affordance is the box):

- `focus-within:border` + `focus-within:border-[color:var(--color-pipeline-ink-subtle)]`
  (`border-test/primary` = `#3835384d`, which is what `--color-pipeline-ink-subtle` already
  resolves to — #1248 established that equivalence for the OR divider; no new token).
- Add a matching transparent 1px border in the resting state so gaining focus does not shift the
  56px height or the inner 12px padding by a pixel.
- The invalid state keeps its `--color-pipeline-negative-secondary` fill; the focus border sits on
  top of it unchanged (no error-specific focus color appears in any frame).

This is deliberately in scope: it is the only state in the whole epic's Figma that documents the
treatment, and `TextField` today has **no** visible focus indicator at all. It changes
`SignInModal`'s rendering too — that is the point, and it is a fidelity fix, not a regression.
Before writing it, re-check sign-in's enabled frame `6486:81576` for the same border; if it is
present there too (expected — the two frames are instances of one component), say so in the PR
description so the #1248 reviewer sees the retroactive change is intentional.

Update `docs/frontend/ui-components.md#textfield`: the Figma → token table row currently reading
"Border: none in either state" becomes the focus-ring row, and the `### Accessibility` section
gains the focus-visible note.

### 4. Build the modal — done

New `packages/frontend/src/components/CreateAccountModal.tsx`:

```ts
export interface CreateAccountModalProps {
  open: boolean;
  onDismiss: () => void;
  /** Seam for #1254 — no network call ships in #1249. Defaults to a no-op. */
  onSubmit?: (credentials: { email: string; password: string }) => void;
  /** Seam for #1254 — opens the wallet chooser. Defaults to a no-op. */
  onContinueWithWallet?: () => void;
}
```

State comes entirely from Step 2's hook — `useAuthCredentialsForm({ open, onSubmit })`, same
destructure as `SignInModal` (`email`, `setEmail`, `password`, `setPassword`, `isValid`,
`emailError`, `passwordError`, `handleEmailBlur`, `handleSubmit`). No local `useState` in the
component.

Composition inside `AuthModalShell` (`heading="Create account"`, `headingId`
`create-account-modal-heading`, `testId` `create-account-modal`), mirroring `SignInModal.tsx`
line for line:

1. `<form onSubmit={handleSubmit} data-node-id="6486:81615" className="mt-2 flex w-full flex-col gap-4">`
   — the `mt-2` recovers the Figma's 32px heading gap over the shell's `gap-6`; `gap-4` is the
   16px content-block rhythm.
2. `<ContinueWithWalletButton onClick={onContinueWithWallet} />`.
3. `<OrDivider />`.
4. A `flex w-full flex-col gap-8` column holding, in order:
   - `TextField type="email" autoComplete="email" placeholder="Enter corporate email"`;
   - `TextField type="password" autoComplete="new-password" placeholder="Password"` — note
     `new-password`, not `current-password`;
   - `Button type="submit" variant="primary-blue" disabled={!isValid}
     className="!w-full !min-w-0 disabled:opacity-[0.32]"` with the label **`Sign Up`**;
   - one centered `<p>` at `--text-pipeline-caption`: `Already have an account? ` in
     `--color-pipeline-ink-muted`, then `Log in` in `--color-pipeline-ink` at the **regular**
     weight (see "design-file artifacts" above — no `--font-weight-emphasized`, no `<a>`, no
     `href`, no handler; plain non-interactive text, per #1248's resolution 4).

No `Forgot password?` line. Both `TextField`s take `invalid` / `error` from the hook so the
inherited error styling still works even though no error frame was designed.

### 5. Extend the preview seam — done

`packages/frontend/src/routes/test.tsx` → `AuthTab`: add a second `React.useState` flag and a
second `Button` labelled "Open Create Account modal", rendering
`<CreateAccountModal open={…} onDismiss={…} />` with every seam at its default. Keep the two
modals independent (never stacked — see Assumptions). Update the tab's intro sentence to name both
issues. No change to `TestTab`, `TABS`, or `validateSearch` — the `auth` tab already exists.

### 6. Lint, typecheck, test, build — done, all green

```bash
yarn workspace @pipeline/ui lint
yarn workspace @pipeline/frontend lint
cd /Users/luiza/Projects/pipeline/packages/frontend && npx tsc --noEmit
yarn workspace @pipeline/frontend test
npx tsx scripts/lint-docs.ts
yarn workspace @pipeline/frontend build
```

Do not start or restart a dev server — the user runs their own and HMR picks up edits.

## Test Strategy

Vitest + Testing Library, `TZ=UTC vitest run`, all under `packages/frontend/src/`. Title the
`describe` `"CreateAccountModal (#1249)"` per house style.

**New — `packages/frontend/src/components/CreateAccountModal.test.tsx`.** Mirror
`SignInModal.test.tsx` (reuse its `renderModal` / `fillValid` helper shape):

- renders nothing when `open` is false; portals into `document.body` when true;
- `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` resolve to the **`Create account`**
  heading;
- the two designed states: submit (accessible name **`Sign Up`**) is `disabled` with both fields
  empty, and enabled once the email is well-formed and the password non-empty;
- both error messages render with the #1248 copy after an invalid submit, and submit stays
  disabled;
- the presentational contract — a valid submit calls `onSubmit` once with `{ email, password }`;
  with no `onSubmit` prop it neither throws nor calls `fetch`
  (`vi.spyOn(globalThis, "fetch")` never called). This pins "no network in #1249" so #1254's
  wiring is deliberate;
- state resets when `open` goes `false` → `true`;
- Escape and the × button both call `onDismiss`; no scrim click;
- focus trap: Tab from the last focusable wraps to the first;
- password eye toggle flips the input type and its accessible name (covered by
  `TextField.dom.test.tsx`, asserted once here through the modal);
- **negative assertions pinning the design delta** — the modal renders exactly two `<input>`
  elements (no confirm-password, no company field, no checkbox); no `Forgot password?` text
  appears; no `New here?` text appears; the footer reads `Already have an account?` + `Log in`
  and contains **no** `<a>` and no clickable element (query the footer `<p>` and assert
  `queryByRole("link")` / `queryByRole("button", { name: "Log in" })` are null).

**Update — `packages/frontend/src/components/TextField.dom.test.tsx`:** add a case for the Step 3
focus ring — the field row carries the `focus-within:` border classes and a transparent resting
border (the established class-string proxy for styling regressions in this repo), asserted in both
the default and the `invalid` state.

**Regression guards, all must pass unchanged:** `SignInModal.test.tsx`, `AuthModalShell.test.tsx`
(Steps 1–2 must be pure refactors — the only intended visual change to `SignInModal` is Step 3's
focus ring, which those tests do not assert), plus `ConnectWalletModal.test.tsx`,
`FirstConnectionModal.test.tsx`, `TopBar.test.tsx` (this issue must not touch the connect flow).

**Update — `packages/frontend/src/routes/-test.test.tsx`:** the Auth tab now renders two trigger
buttons; add a case that the create-account button opens `CreateAccountModal` and that it is
closed by default. Keep the existing sign-in cases.

**Figma verification (the acceptance check — the frontend flow has no QA phase).** Render
`/test?tab=auth` at 1728×916, open the create-account modal, and compare side by side against
`6486:81615` (empty) and `6486:81640` (filled, `hello@eqlab.io`). Check in order: the 400px column
and its 32 / 16 / 16 / 32 / 32 / 32px rhythm; the heading reading `Create account`; the submit
reading `Sign Up` and resolving to `#000080` at 0.32 when disabled and full when enabled; the
focused email field showing the 1px `#3835384d` border with no height shift; the single footer
line with `Log in` in full ink; the **absence** of a `Forgot password?` line and of any third
field; and that the wallet button, OR divider, and both fields are pixel-identical to the
already-verified sign-in modal (they are the same Figma instances, so any delta means Step 1's
extraction changed rendering). Record residual deltas in the PR description.

## Docs to Update

- **`docs/frontend/auth-components.md`** — a new `### CreateAccountModal` section after
  `### SignInModal`, in the same house format: role + "no network call, seam for #1254" contract,
  a `Visual specs (Figma):` bullet list (`6486:81615` default, `6486:81640` enabled), the
  top-to-bottom composition, the delta table against `SignInModal`, the two design-file artifacts
  (the `Inter:Regular` weight ambiguity on `Log in` and the stray rive.app `href`), the "exactly
  two fields — the third `input` is hidden" note, and a bolded `**Accessibility:**` paragraph.
  Also: add a short `### Shared form parts` entry for `AuthModalParts.tsx`; update
  `### SignInModal` where it names `useSignInModal` (now `useAuthCredentialsForm`) and where it
  says "the real destination is #1249"; update the opening paragraph's screen list (#1249 is no
  longer future work); update `### Diagnostics preview seam` to describe two trigger buttons.
- **`docs/frontend/ui-components.md`** — `## TextField`: replace the table's "Border: none in
  either state" claim with the focus-ring row (`border-test/primary` `#3835384d` via
  `--color-pipeline-ink-subtle`, `focus-within` on the field row, transparent resting border to
  avoid a height shift), and add the focus-visible note to `### Accessibility`. Add
  `CreateAccountModal` to the **Consumer:** line.
- **`docs/frontend/index.md`** — line 14–15 lists `AuthModalShell, SignInModal`; add
  `CreateAccountModal`. Required in the same commit (`scripts/lint-docs.ts` reachability rule).
- **New — `docs/user-stories/epic-1247/1249-kyb-create-account.md`**, linked from a new row under
  `## Epic #1247 — KYB login flow` in `docs/user-stories/index.md`. Behavioral stories only
  (styling stays out per that index's preamble): empty → `Sign Up` disabled; filled → enabled;
  malformed email → error copy on blur; submit with empty password → error copy; password
  show/hide; Escape and × dismissal; reopen resets; valid submit performs **no** network call and
  does not navigate to OTP; `Continue with wallet` and `Log in` are inert; and one story asserting
  the screen has exactly two fields with no `Forgot password?` line (the reader's cue that the
  delta against sign-in is intentional).
- **No product spec** — deferred to #1254 on the same reasoning recorded for #1248: no
  authentication happens, no session exists, and the epic's two product questions are open.
  Writing `docs/product-specs/` now would encode guesses.
- **No new tech-debt entries expected.** If Open Question 1 resolves toward "keep #1248's files
  untouched", log the deferred extraction as the next free `TD-` id in
  `docs/exec-plans/tech-debt-tracker.md` (TD-59 is currently the highest).
- **No `theme.css` change** — every binding maps to an existing token.
- Move this plan to `docs/exec-plans/completed/` when the issue closes (manager/coder
  housekeeping).
