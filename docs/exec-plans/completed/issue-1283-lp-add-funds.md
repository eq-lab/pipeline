# Issue #1283: LP: Add Funds wire-transfer modal + bank-transfer home states

Source: https://github.com/eq-lab/pipeline/issues/1283

## Implementation status (coder, 2026-09-22)

All steps (1–9) implemented. Deviations from this plan, logged on the Issue and in
`docs/frontend/bank-transfers.md`:

- **Step 3's "existing hint icon" claim was wrong.** `get_design_context`/`get_variable_defs`
  against node `6701:97113` showed the note row's hint glyph is a real, distinct exported asset
  (`imgHint`, a 20×20 info-circle), not something `EarnedCard` already renders — no such icon
  exists anywhere else in the repo. Exported it as a new asset,
  `packages/frontend/src/assets/hint.svg`, rather than reusing a nonexistent component.
- **`get_variable_defs` corrected several of this plan's assumed pixel values** against the
  frame's actually-bound tokens (the codegen's Tailwind-fallback literals were stale): modal panel
  and card corner radii all resolve to `4` (not the `32`/`24`/`8` literals `get_design_context`
  emitted), and the circular button's brand fill resolves to `#000080` navy (not `#8fb2a4`). The
  plan's *conclusions* (identical to `FirstConnectionModal`, `Button variant="circular-blue"`
  already matches) held; only the intermediate literals were wrong. Recorded in
  `bank-transfers.md`'s Figma → token mapping table.
- **Step 2's per-line `TODO(#1285)` marker on `FUNDING_DETAILS_PLACEHOLDER` was dropped** to
  satisfy the coder invocation's stricter hard rule (one bare `// spec:` pointer per file, nothing
  else — no exception for TODO markers). The seam and its owner are documented in
  `bank-transfers.md`'s Seams table instead of inline.
- Tech debt logged as **TD-87 through TD-91** (one more than the plan's single "starting at
  TD-87" bucket — the six-way clipboard duplication, the missing wire-details backend source, the
  dangling Contact Support destination, the typo-correction divergence, and the no-mobile-frames
  note each got their own entry rather than folding). **BUG-21** logged for the duplicate TD-73 id.


Epic: [#1247 — KYB login flow / V1.0](https://github.com/eq-lab/pipeline/issues/1247). LP side of
wire transfers; trustee side is epic #1269 (recording endpoint #1276), LP-visible trust-account
balance + withdraw is #1285.

Figma file `A43rjYYjSwdTmiwwf5cx5n`. Frames and the exact nodes this issue implements:

| Deliverable | Frame | Node to codegen |
| --- | --- | --- |
| Funding details modal | `6701-97113` | `I6701:97134;8256:6735` (the 420×520 panel), `I6701:97134;8256:6752` (the scrim) |
| Card — `locked` | `6701-98220` (No Authenticated) | `6701:98378` |
| Card — `verify` | `6701-97538` (No Verified Account + No Connected Wallet) | `6701:97695` |
| Card — `verifying` | `6701-98417` (PLUSD = 0, sPLUSD = 0, Veryfying account) | `6701:98539` |
| Card — `unlocked` | `6701-97340` (PLUSD > 0, sPLUSD = 0, Bank Transfer unlocked) | `6701:97494` |
| Card — `funded` | `6701-97136` (PLUSD = 0, sPLUSD > 1, Bank transfer received) | `6701:97289` |
| Striped illustration (shared by `verify` + `verifying`) | — | `6701:97696` (291 × 193.66 Union) |

`6701-97942` is a second "Veryfying account…" frame; its card is the same as `6701:98539` and needs
no separate treatment.

## Scope

Two presentational deliverables plus a dev-only preview seam. **Nothing is mounted on `/`.**

**In scope**

1. `FundingDetailsModal` — the "Funding details" wire-transfer modal (`6701-97113`). A small
   centred 420 px card on a scrim; **not** `AuthModalShell`. Six label/value rows, a
   transfers-take-up-to-5-business-days note with a hint icon, one full-width `Copy` action, and a
   `Need help? Contact Support` footer. Not a form — no inputs, no amount, no submit.
   Its values come from a **real `apiFetch` call** through a new `useFundingDetails` React Query
   hook; the frame's payload is hardcoded as a dev-only fallback until #1311 lands.
2. `AddUsdCard` — the "Add USD / Use a bank transfer" home card as a **standalone presentational
   component with an explicit `variant` prop** covering the five designed states
   (`locked` · `verify` · `verifying` · `unlocked` · `funded`). Every action is an optional,
   no-op-by-default seam.
3. `CheckIllustration` in `@pipeline/ui` — the striped check artwork the `verify` and `verifying`
   variants clip into their top-right corner, following the existing
   `ActivityEmptyIllustration` / `WalletIllustration` CSS-mask recipe.
4. A `/test?tab=auth` preview block: one modal trigger plus all five card variants rendered inline,
   wired to stand-in confirmation lines.
5. Spec doc `docs/frontend/bank-transfers.md`, a user-stories doc, and the catalogue/index updates.

**Out of scope — and why**

| Concern | Owner |
| --- | --- |
| Deciding **which** card variant renders for a given account state (the home gating state machine) | #1282 |
| Mounting `AddUsdCard` into the home grid, and the home grid's V1.0 re-layout | #1282 |
| Header Sign In / Sign Up buttons, the account icon | #1282 |
| The Total Balance card's placeholder-bars / promo-banner variants | #1282 |
| A real trust-account USD balance, and the Withdraw flow behind the seam | #1285 |
| Recent-activity rows "Add funds / Withdraw funds … Bank transfer" | #1285 (data) + #1282 (render) |
| Recording a received wire (trustee side) | #1276, epic #1269 |
| The real `GET` for funding details, and the per-LP wire payment reference | #1311 |
| Any other network call, persistence, or auth on either surface | #1254 / #1265 / #1285 |

The boundary with **#1282** is the `AddUsdCardVariant` union type. This issue ships the type, the
five renderings, and the seams; #1282 writes the `(authenticated?, kybStatus, trustAccountBalance)
→ AddUsdCardVariant` derivation and mounts the card. **This issue deliberately does not ship a
`deriveAddUsdCardVariant` helper** — unlike `accountPageState.ts`'s `deriveDocumentsState`, whose
owning page was in the same issue, the inputs here live entirely in #1282's state machine and a
guessed precedence order would be a fabricated contract.

`routes/index.tsx`, `TopBar.tsx`, `ConnectModalProvider`, and every existing home card are
untouched.

## Assumptions and Risks

- **The epic's standing rule holds: no sub-issue changes a production entry point.** `AddUsdCard`
  therefore ships unmounted, reachable only from `/test?tab=auth`. If the reviewer expects to see
  it on `/`, that expectation belongs to #1282.
- **The frames' wire details are scratch data.** `1234567890`, `GB29 UKBP 1234 5678 9012 34`,
  `UKBPLD2LXXX` are obviously placeholder values, and the company name is misspelled
  (`Pipiline Trust LLC`). There is **no backend endpoint serving trust-account bank details** —
  confirmed against the LP surface (`/v1/lps/*` returns identity + `kyb_status`;
  `POST /v1/lp-ledger/deposits` records a wire *after* it arrives; nothing serves the receiving
  account). Tracked as #1311.
- **A wrong IBAN in a production UI loses real money.** The hardcoded payload is a development
  stand-in only. #1282 must not mount this modal in production until #1311 lands — the plan states
  this in the spec doc's out-of-scope table so the constraint survives past this issue.
- The `verify` / `verifying` illustration is one asset, not two — both Unions measure
  291 × 193.66 and differ only by offset (`x=164 y=76.34` vs `x=174 y=66.34`). If codegen disagrees,
  ship one asset and position per variant rather than exporting twice.
- `packages/ui` `tsc --noEmit` already fails on `TextField.stories.tsx` (**BUG-19**, pre-existing).
  A new `CheckIllustration.stories.tsx` must not add to it — default `value`/`onChange`-style
  `meta.args` gaps are the trap; a props-only illustration story has none.
- **BUG-20** (unreachable submit-attempt validation) is pre-existing and untouched — neither
  surface here has a form.
- `docs/exec-plans/tech-debt-tracker.md` contains **two entries numbered TD-73**. New entries in
  this issue start at **TD-87**; log the duplicate id as a known bug rather than renumbering.
- No mobile frames exist for either surface (the whole V1.0 family is desktop-only). Same call as
  TD-82: the card is width-driven by its grid slot and the modal already caps at
  `calc(100vw - 32px)`; log as debt, do not invent a mobile layout.

## Open Questions

_None_ — both were resolved by the user on 2026-09-22 during planning:

1. **Where do the real trust-account wire details come from?** → **Implement the endpoint call now
   and hardcode the payload behind it.** The modal fetches through a real client function with a
   real response type; that function returns a hardcoded payload until the backend lands, so the
   call site, the loading/error states, and the response shape are all production-shaped from day
   one and the swap is a one-function change. See step 2a.
2. **Wire attribution — does the LP need a per-LP reference code?** → **Raised as a backend issue:
   [#1311](https://github.com/eq-lab/pipeline/issues/1311)** ("Backend: LP funding details endpoint
   + per-LP wire payment reference"), filed and linked as a sub-issue of epic #1247 with
   `enhancement` · `backend` · `backlog`. It covers both the missing `GET` for the funding details
   and the missing per-LP payment reference. `bank_transactions.payment_reference` already exists
   (`packages/shared/migrations/20260917000001_bank_transactions_lp_ledger.sql:36`) and
   `POST /v1/lp-ledger/deposits` accepts it, but it is free text typed by the trustee at recording
   time — nothing issues a reference to the LP, which is why the designed modal has no row for one.
   If #1311 concludes a reference is required, the modal gains a seventh row; that is a follow-up,
   not a blocker here.

Neither resolution blocks this presentational slice. **#1282 must still not mount the modal in
production while the payload is hardcoded** — a wrong IBAN in a live UI loses real money.

## Implementation Steps

Run `get_design_context` on each node in the table above before writing the corresponding
component — the screenshots below record structure and copy, not token-exact values. Local Dev Mode
MCP is at `http://127.0.0.1:3845/mcp`; if the session lacks the tools, drive it with
`curl -m 120` JSON-RPC (initialize → capture `mcp-session-id` → `notifications/initialized` →
`tools/call`), retrying once on timeout before falling back to
`get_metadata` + `get_variable_defs` + `get_screenshot`.

### 1. Striped check illustration (`@pipeline/ui`)

- Export node `6701:97696` as SVG into
  `packages/ui/src/assets/illustrations/striped-check.svg`.
- Add `packages/ui/src/components/CheckIllustration/CheckIllustration.tsx` +
  `index.ts` + `CheckIllustration.stories.tsx`, copying
  `packages/ui/src/components/ActivityEmptyIllustration/ActivityEmptyIllustration.tsx` verbatim in
  shape: `?url` import, `width` (number → px, string passthrough) + `tone` (`"primary" | "muted"`)
  props, CSS `maskImage` painting `currentColor`, `aria-hidden="true"`, `data-tone`,
  `forwardRef<HTMLSpanElement>`, `displayName`. Intrinsic aspect ratio is `291 / 193.66`, not `1 / 1`.
- Export from `packages/ui/src/index.ts` using the direct-file style
  (`export { CheckIllustration } from "./components/CheckIllustration";` plus the paired
  `export type { CheckIllustrationProps, CheckIllustrationTone }`).

### 2a. API hook — `packages/frontend/src/api/useFundingDetails.ts`

Per the user's 2026-09-22 decision: **a real endpoint call, with the payload hardcoded behind it
until #1311 lands.** This slots into the existing API module rather than inventing a parallel
mechanism — `packages/frontend/src/api/` is the only place allowed to call `fetch` (an ESLint
`no-restricted-globals` rule enforces the boundary), every read goes through `apiFetch` + React
Query, and `usePnl.ts` is the closest template.

```ts
export interface FundingDetailsResponse {
  company_name: string;
  bank_name: string;
  bank_address: string;
  account_number: string;
  iban: string;
  swift_bic: string;
}

export const FUNDING_DETAILS_PATH = "/v1/funding-details";
export const FUNDING_DETAILS_DEV_FALLBACK: FundingDetailsResponse;

export interface UseFundingDetailsResult {
  data: FundingDetailsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}
export function useFundingDetails(enabled: boolean): UseFundingDetailsResult;
```

- Snake-case response fields, matching every existing DTO (`PnlResponse`, `LoanBookResponse`, …).
- `useQuery` with `queryKey: ["funding-details"]`, `queryFn: () => apiFetch<FundingDetailsResponse>(FUNDING_DETAILS_PATH)`,
  `enabled` driven by the modal's `open` so a closed modal issues no request.
- **The global path, not a per-LP one — and it must be unauthenticated.** Two independent reasons:
  the LP app has no `lp_id` today (register / link-address is #1254's wiring), and
  `packages/frontend/src/api/client.ts` has **no bearer/`Authorization` support at all** (the LP
  frontend has no session store; every endpoint it calls is unauthenticated and wallet-scoped by
  query param — only `packages/trustee/src/api/client.ts` injects a JWT). A per-LP
  `GET /v1/lps/{id}/funding-details` would be JWT-gated like the rest of `/v1/lps/*`, which would
  mean porting the trustee client's `Headers`/`getSessionToken`/`ApiError` block into the LP client —
  far outside this issue. Recorded as a comment on #1311 so the backend designs to it. Keeping the
  path in `FUNDING_DETAILS_PATH` makes a later move to a per-LP route a one-line change plus an
  `lpId` parameter.
- **`FUNDING_DETAILS_DEV_FALLBACK` is applied only when `ENV.IS_DEV`.** The endpoint does not exist,
  so the call will fail; in dev the hook substitutes the frame's values (company name typo-corrected
  to `Pipeline Trust LLC`) so the modal renders as designed. **In a production build the fallback is
  never applied** — the same `ENV.IS_DEV` guard `routes/test.tsx` and `routes/account.tsx` already
  use. This is what keeps a fabricated IBAN out of a live UI while still satisfying "hardcode it for
  now". Assert both halves in tests.
- `apiFetch`'s localStorage mock layer works for free on top of this: seeding
  `pipeline.mock.api.GET./v1/funding-details` short-circuits the request before any network call, so
  QA can override the payload without touching code. Add a matching entry to `SCENARIOS` in
  `packages/frontend/src/routes/test/-scenarios.ts` so the Mocks tab can seed it in one click.
- Export the hook and its types from the `packages/frontend/src/api/index.ts` barrel, and add a row
  to `docs/frontend/hooks.md` alongside the other `src/api` hooks.
- Comment budget: the existing `src/api/*.ts` files carry long docblocks — those predate the current
  rule. New files get **one bare single-line `// spec:` pointer**, nothing else.

### 2b. Pure presentation module — `packages/frontend/src/components/fundingDetails.ts`

No React, no network. Maps the response onto the frame's six display rows.

```ts
export interface FundingDetailRow { label: string; value: string }

export const FUNDING_DETAIL_LABELS: ReadonlyArray<string>;
export function toFundingDetailRows(data: FundingDetailsResponse | undefined): ReadonlyArray<FundingDetailRow>;
export function formatFundingDetailsForCopy(rows: ReadonlyArray<FundingDetailRow>): string;
```

- `FUNDING_DETAIL_LABELS` — `Company Name`, `Bank Name`, `Bank Address`, `Account Number`, `IBAN`,
  `SWIFT / BIC code`, in frame order. Labels are presentation (they come from the frame); the
  response supplies values only.
- `toFundingDetailRows(undefined)` → all six rows with `—`. A per-field missing/empty value also
  renders `—`. Never a fabricated or derived value.
- `formatFundingDetailsForCopy` — one `"{label}: {value}"` line per row, joined with `\n`, rows in
  frame order, `—` rows included verbatim. The whole-block serialization the single `Copy` button
  writes (the frame has exactly one Copy action and no per-row copy affordance).

### 3. `packages/frontend/src/components/FundingDetailsModal.tsx` + `useFundingDetailsModal.ts`

Props (all seams optional, house pattern):

```ts
export interface FundingDetailsModalProps {
  open: boolean;
  onDismiss: () => void;
  details?: FundingDetailsResponse;   // test/preview override; omitted → the hook fetches
  onContactSupport?: () => void;      // no-op default
}
```

`useFundingDetailsModal(props)` calls `useFundingDetails(open)` (skipped when `details` is supplied)
and returns `rows = toFundingDetailRows(details ?? data)`. **Loading and error both render `—` rows**
— no spinner, no fabricated values, and `Copy` is `disabled` whenever there is no data. There is no
designed error state for this modal and surfacing one via `InlineError` would open
`ErrorDetailsDialog` *inside* a dialog, which is precisely the un-stack-safe path the shell caveats
warn about; log the missing error state as a designer ask instead.

Shell — **copy `packages/frontend/src/components/FirstConnectionModal.tsx`, not `AuthModalShell`.**
`FirstConnectionModal` already is this exact recipe: `createPortal` into `document.body`, scrim
`fixed inset-0 z-[9999] flex items-center justify-center` at `rgba(56,55,53,0.6)` (the frame's
`fill/overlay` `#38373599` — identical), panel `width: 420`,
`maxWidth: "calc(100vw - 32px)"`, `backgroundColor: #f8f7f6` (`bg/modal` →
`--color-pipeline-paper`), `borderRadius: 4` (`radius/radius-s` → `--radius-pipeline-card`),
`padding: 24`, close `×` at `absolute top-4 right-4 h-8 w-8`, scrim click dismisses.
`AuthModalShell` is wrong here on both counts — it is a full-viewport two-pane frame with no scrim,
and even `showImagePanel={false}` leaves a full-bleed panel rather than the 420 × 520 centred card
the frame shows.

Anatomy (panel 420 × 520, content column 372 wide at 24 px padding):

- Heading `Funding details` — `<h2>` wired to `aria-labelledby` via a `React.useId()`-derived id,
  Besley 28/36 (`--text-pipeline-heading-m`), 36 px tall row with the `×` at its right.
- Details list at `y=84`: six rows, 24 px tall on a 40 px pitch. Label left in
  `content-test/secondary` → `--color-pipeline-ink-muted`, value right in `content-test/primary` →
  `--color-pipeline-ink`, both body 16/22.
- Note row at `y=272`, 44 px tall:
  `Transfers may take from the same day up to 5 business days` in ink-muted body, with the existing
  hint `(i)` glyph trailing right (same icon `EarnedCard` already renders — reuse it, do not inline
  a new SVG).
- Bottom slot at `y=424`: full-width 48 px `Button variant="primary-dark"` labelled `Copy` with a
  leading copy glyph. `packages/frontend/src/assets/copy.svg` exists and is currently imported
  nowhere — give it its first consumer rather than inlining a third `CopyGlyph`.
- Footer, centred, caption 12/16: `Need help? ` + `Contact Support` as a real `<button>` calling
  `onContactSupport` (inert-seam contract — clicking with nothing wired must not throw).

`useFundingDetailsModal.ts` (rule 2 — the `.tsx` stays JSX-only) owns: `copied` state with the
established 1500 ms reset, a feature-detected `navigator.clipboard` write that silently no-ops on
rejection, `copied` reset on close, the Escape listener, the body-scroll lock, and initial focus.
Use the `stopImmediatePropagation` Escape pattern from
`packages/ui/src/components/ErrorDetailsDialog/useErrorDetailsDialog.ts`
(`docs/frontend/error-handling.md#nested-dialogs-1037`) rather than `AuthModalShell`'s
`stopPropagation` — this modal will eventually open over a home page that may itself host a dialog.
While `copied` is true the button label reads `Copied` (the repo-wide convention across five
existing call sites; no tooltip anywhere).

The clipboard logic is **not** extracted to a shared hook in this issue — it is ~8 lines and would
mean editing a `@pipeline/ui` primitive plus four frontend files from a presentational frontend
slice. Log the now-six-way duplication as debt instead (step 8).

### 4. `packages/frontend/src/components/addUsdCardState.ts`

```ts
export type AddUsdCardVariant = "locked" | "verify" | "verifying" | "unlocked" | "funded";
export const ADD_USD_CARD_VARIANTS: ReadonlyArray<AddUsdCardVariant>;  // frame order, for previews
```

No derivation function — see Scope.

### 5. `packages/frontend/src/components/AddUsdCard.tsx`

```ts
export interface AddUsdCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  variant: AddUsdCardVariant;
  usdBalanceLabel?: string;          // "funded" only; omitted → "—"
  padding?: CardPadding;
  onAddFunds?: () => void;
  onWithdraw?: () => void;
  onStartVerification?: () => void;
  onViewStatus?: () => void;
}
```

`forwardRef<HTMLDivElement>`, built on `Card` from `@pipeline/ui` (`variant="white"`), with
`role="region" aria-labelledby={\`add-usd-card-title-${React.useId()}\`}`, a `data-node-id` per
variant, and the home cards' shared border idiom
(`!border-t !border-r-[3px] !border-b-[3px] !border-l`). `variant` is required — unlike the other
seams there is no honest default state.

**Two layout shapes, not one.** The frames confirm this at the node level:

*Shape A — `card-horizontal`* (`locked`, `unlocked`, `funded`). 313 × 246, 16 px padding.
A text block at `(16, 16)` (eyebrow caption 12/16 → heading 28/36 → sub-caption 12/16) and a
`Buttons` frame at `(16, 102)` holding a 128 × 128 circular action at `x=153`.
The circular action is `Button variant="circular-blue"` — `size-32` (128 px),
`--radius-pipeline-pill`, brand fill, and a `disabled:` treatment of `rgba(184,191,190,0.12)` +
ink-subtle text that already matches the greyed-out `locked` rendering exactly. No new variant, no
override.

*Shape B — `Section`* (`verify`, `verifying`). 313 × 246 with `CheckIllustration` absolutely
positioned top-right and clipped by the card (`overflow-hidden`), a heading block at `(16, 16)`
(title 28/36 + description 16/22), and a rectangular `Button variant="primary-dark"` at `(16, 190)`
— 161 × 40 for `verify`, so pass `size="m"` (the `!h-10` rectangular override) rather than the
48 px default.

Per-variant presence table:

| Variant | Node | Eyebrow | Heading | Sub-caption | Illustration | Primary action | Secondary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `locked` | `6701:98378` | `Add USD` | `Use a bank transfer` | `KYB verification required` | no | circular `Add Funds`, **disabled** | none |
| `verify` | `6701:97695` | none | `Verify your account` | `Complete KYB to unlock bank transfers.` (16/22, not caption) | yes | `Start Verification` (dark, 161 × 40) | none |
| `verifying` | `6701:98539` | none | `Verifying account…` | `We are reviewing your documents.` | yes | `View Status` (dark) | none |
| `unlocked` | `6701:97494` | `Add USD` | `Use a bank transfer` | `Transfers unlocked` | no | circular `Add Funds` | none |
| `funded` | `6701:97289` | `USD Balance` | `{usdBalanceLabel}` | `on Trust account` | no | circular `Add Funds` | `Withdraw` |

Notes the coder must honour:

- **`Verifying account…` ships typo-corrected.** The frames say "Veryfying". `account-page.md`
  already shipped the corrected spelling when it borrowed this exact caption for its `under-review`
  stand-in, citing the #1248 design-file-artifact precedent; shipping the typo here would make the
  two surfaces disagree. Log as a designer ask.
- **`funded`'s balance never gets a fabricated number.** `usdBalanceLabel` omitted → `—`. The
  frame's `$1,000.00` is preview-fixture data only. The project rule is absolute: render only
  backend-served values, `—` for what is missing, never derive client-side.
- **`Withdraw` is a `button-link`, not a rectangular button** — node `6701:97301`, 74 × 22, i.e.
  exactly one body line-height tall, bottom-left of the `Buttons` frame. Check
  `PortfolioPlaceholderCard`'s existing contextual-link idiom first; if it does not fit, a bare
  `<button type="button">` with body typography is correct — a `Button variant="secondary"` would
  impose a 48/32 px box the frame does not have. It appears in `funded` only (`unlocked`'s
  `Buttons` frame at `6701:97505` has no `button-link`).
- The teal horizontal line leaving the `Add Funds` circle in `6701-97340` is a **Figma prototype
  connector to the Add Funds modal frame**, not a visual element. Do not render it. It does confirm
  that the circular action opens `FundingDetailsModal` — the same modal in both `unlocked` and
  `funded`; there is no funded-specific modal frame.

### 6. `/test?tab=auth` preview seam

Extend `AuthTab` in `packages/frontend/src/routes/test.tsx` with one new `Section` titled
`Wire transfers (#1283)`, placed after the existing Account-page preview links:

- A `Button variant="secondary" className="w-fit"` labelled `Open Funding details modal`, matching
  the six existing modal triggers, opening `FundingDetailsModal` with
  no `details` prop — under the dev server the hook's `ENV.IS_DEV` fallback already populates it, so
  QA can Figma-compare the real fetch path rather than a prop-injected fixture.
- `ADD_USD_CARD_VARIANTS.map(...)` into a `flex flex-wrap gap-4`, each card in a fixed
  `w-[313px]` box with its variant id as a caption above it, `usdBalanceLabel="$1,000.00"` on
  `funded` only.
- Seam wiring: `onAddFunds` opens the same modal; `onWithdraw`, `onStartVerification`, and
  `onViewStatus` each set a stand-in confirmation line
  (`data-testid="wire-withdraw-clicked"` / `-start-verification-clicked` / `-view-status-clicked`)
  naming the owning issue — `#1285` for Withdraw, `#1282` for the two verification CTAs. Do **not**
  navigate to `/account` from here; that routing decision is #1282's.

A single boolean drives the modal (there is only one), but the triggers stay independent of each
other per the tab's established no-stacking convention. Reusing `?tab=auth` rather than adding a
fifth tab follows #1284's recorded rationale — the auth tab is this epic's discovery surface.

### 7. Spec doc — `docs/frontend/bank-transfers.md` (new)

A new area doc, not a section in an existing one: `auth-components.md`'s scope is authentication
*modals*, `account-page.md`'s is one route, and `dashboard-components.md` is already 1580+ lines
and will absorb #1282's much larger home rewrite. `bank-transfers.md` is the LP wire-transfer
*feature*, which spans a modal and a card and keeps growing through #1282, #1285, and #1276 — the
same reasoning `account-page.md` records for its own existence.

Mirror `account-page.md`'s section set: intent + presentational-only statement · modal anatomy and
shell rationale · card variants (the presence table above) · verbatim copy · Figma → token mapping ·
reuse verdicts · seams-and-who-wires-them table · `/test` preview contract · out-of-scope table ·
accessibility · no-mobile-frames note. Link it from `docs/frontend/index.md` under "Area specs".

Verbatim copy to record — modal: `Funding details` · `Company Name` · `Bank Name` · `Bank Address` ·
`Account Number` · `IBAN` · `SWIFT / BIC code` ·
`Transfers may take from the same day up to 5 business days` · `Copy` / `Copied` · `Need help?` ·
`Contact Support`. Card: `Add USD` · `Use a bank transfer` · `KYB verification required` ·
`Transfers unlocked` · `USD Balance` · `on Trust account` · `Add Funds` · `Withdraw` ·
`Verify your account` · `Complete KYB to unlock bank transfers.` · `Verifying account…` ·
`We are reviewing your documents.` · `Start Verification` · `View Status`.

Seams table:

| Seam | Default | Wired by |
| --- | --- | --- |
| `useFundingDetails()` | real `GET /v1/funding-details`; in dev only, a failure falls back to `FUNDING_DETAILS_DEV_FALLBACK` | #1311 (endpoint lands → delete the fallback) |
| `FundingDetailsModal.details` | omitted → the hook fetches | already wired; the prop is a test/preview override |
| `FundingDetailsModal.onContactSupport` | no-op | unassigned — no destination exists in the design (TD) |
| `AddUsdCard.variant` | required, no default | #1282's state machine |
| `AddUsdCard.usdBalanceLabel` | `—` | #1285 |
| `AddUsdCard.onAddFunds` | no-op | #1282 (opens `FundingDetailsModal`) |
| `AddUsdCard.onWithdraw` | no-op | #1285 |
| `AddUsdCard.onStartVerification` / `onViewStatus` | no-op | #1282 |

### 8. Tech debt and bug log

Add to `docs/exec-plans/tech-debt-tracker.md`, starting at **TD-87** (TD-73 is duplicated — do not
reuse it):

- Six-way `navigator.clipboard` + 1500 ms `copied` duplication (`useErrorDetailsDialog.ts`,
  `useAccountDropdown.ts`, `XlmFundingBanner.tsx`, `routes/deposit.tsx`, `AccountWalletCard.tsx`,
  and now `useFundingDetailsModal.ts`) — extract a shared `useCopyToClipboard`.
- `useFundingDetails` ships an `ENV.IS_DEV`-gated hardcoded fallback because `GET /v1/funding-details`
  does not exist yet. Resolved by #1311, which also deletes the fallback; **#1282 must not mount the
  modal in production until then** (in a production build the modal would render six `—` rows).
  Cross-reference #1311 in the entry.
- `Contact Support` has no destination anywhere in the V1.0 file — shipped as an inert seam
  (same shape as TD-78's decorative chevron). Designer ask.
- `Veryfying account…` typo shipped corrected on both the home card and the Account stand-in —
  designer ask (can be folded into the existing TD-77 copy-inconsistency entry if it fits).
- No mobile frames for either surface (cf. TD-82).

Add to `docs/exec-plans/known-bugs.md` as **BUG-21**: two tech-debt entries share the id `TD-73`
(the unidentified-wire queue entry and the create-account password-policy entry), so
cross-references to "TD-73" are ambiguous.

### 9. Lint and build

`yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/ui lint`, the frontend test
suite, and `npx tsx scripts/lint-docs.ts`. Comment budget per `AGENTS.md`: **at most one bare
single-line `// spec:` pointer per new file, nothing else** — no field JSDoc, no body comments, no
test comments. Everything explanatory in this plan belongs in `bank-transfers.md`, not in the
source. Note that `CheckIllustration.tsx` copies `ActivityEmptyIllustration.tsx`, which carries
two in-body comments — those are pre-existing on that file; do not carry them into the new one.

## Test Strategy

Vitest + Testing Library, jsdom. Files colocated as siblings; each opens with a docblock citing
`docs/frontend/bank-transfers.md#<anchor>`.

**`packages/frontend/src/components/fundingDetails.test.ts`**
- `toFundingDetailRows(undefined)` returns six rows whose labels equal `FUNDING_DETAIL_LABELS` and
  whose values are all `—`; a response with an empty-string field also yields `—` for that row.
- `toFundingDetailRows(response)` maps every snake-case field onto the right label, in frame order.
- `formatFundingDetailsForCopy` emits one `"{label}: {value}"` line per row in frame order, joined
  by `\n`.
- `—` values are serialized verbatim, not skipped (the empty modal's Copy must not silently produce
  a partial block).

**`packages/frontend/src/api/useFundingDetails.test.tsx`** — mirror
`useDashboardSummary.test.tsx`'s setup exactly: `vi.mock("@/wallet", …)` stubbing
`subscribeMock`/`readMock`/`parseJson`, `vi.mock("@/lib/env", …)` with a literal `ENV` (this is the
handle for flipping `IS_DEV`), `vi.stubGlobal("fetch", vi.fn<typeof fetch>())`, and a local
`makeWrapper()` building `new QueryClient({ defaultOptions: { queries: { retry: false } } })` +
`QueryClientProvider`.
- Calls `apiFetch` with `FUNDING_DETAILS_PATH` exactly once when `enabled`, and not at all when
  `enabled` is false.
- **With `ENV.IS_DEV` true**, a rejected request resolves to `FUNDING_DETAILS_DEV_FALLBACK`.
- **With `ENV.IS_DEV` false**, the same rejection surfaces as `error` and `data` stays `undefined` —
  the fallback is never applied. This is the money-safety guard; it must have its own test.
- `FUNDING_DETAILS_DEV_FALLBACK.company_name` is `Pipeline Trust LLC` — a regression guard on the
  typo correction.
- A successful response is returned unchanged (no client-side reformatting of any field).

**`packages/frontend/src/components/FundingDetailsModal.test.tsx`**
- `open={false}` renders nothing (no portal node) and issues no request.
- Open renders `role="dialog"`, `aria-modal="true"`, and an `aria-labelledby` resolving to the
  `Funding details` heading.
- All six labels always render; while loading, and on error, every value cell is `—` and `Copy` is
  `disabled`; with a `details` override the six values render and `Copy` is enabled.
- `Copy` writes `formatFundingDetailsForCopy(rows)` to a mocked `navigator.clipboard.writeText` and
  the label flips to `Copied`; assert the *serialized string*, not just that write was called.
- A rejected clipboard promise does not throw and leaves the label at `Copy`.
- Absent `navigator.clipboard` (feature-detection path) does not throw.
- Escape, the `×`, and a scrim click each call `onDismiss`; a click inside the panel does not.
- Rendering with no `onContactSupport` and clicking `Contact Support` does not throw
  (inert-seam contract).
- `document.body.style.overflow` is `"hidden"` while open and restored on unmount.

**`packages/frontend/src/components/AddUsdCard.test.tsx`**
- One `it.each` over the presence table: per variant, the expected heading/eyebrow/sub-caption text
  and the expected control set (circular `Add Funds` / `Start Verification` / `View Status` /
  `Withdraw`) are present, and the controls of other variants are absent.
- `locked`'s `Add Funds` is `disabled`; `unlocked`'s and `funded`'s are not.
- `funded` with no `usdBalanceLabel` renders `—`; with one, renders it verbatim (no reformatting,
  no scaling — per the display-backend-values-verbatim rule).
- `Withdraw` appears only in `funded`.
- `verify` and `verifying` render the illustration (`data-tone` span present); the three
  `card-horizontal` variants do not.
- Every variant renders with **no** handlers and clicking every control throws nothing.
- Handlers fire on click, one assertion per seam.
- `role="region"` with a resolvable `aria-labelledby` on every variant.

**`packages/frontend/src/routes/-test.test.tsx`** (extend)
- `?tab=auth` renders five `AddUsdCard`s, one per `ADD_USD_CARD_VARIANTS` entry.
- `Open Funding details modal` opens exactly one `role="dialog"`; Escape closes it; no dialog is
  present initially.
- Clicking `unlocked`'s `Add Funds` opens the same single dialog (no stacking — assert exactly one
  `dialog` role).
- `Withdraw` / `Start Verification` / `View Status` each reveal their stand-in line by testid.

**Not tested:** `CheckIllustration` — `packages/ui/src` ships stories, not tests, per the repo
convention (`Card.danger.test.tsx` in the frontend package is the exception for behavior-bearing
primitives; a mask-only span has no behavior).

**Figma verification** (post-implementation, before the PR): re-screenshot each of the six nodes in
the table at the top and diff against the rendered `/test?tab=auth` block and the open modal.
Confirm in particular the 420 × 520 panel geometry, the 40 px details-row pitch, the 128 px circular
button and its disabled fill in `locked`, and the illustration's clip in `verify` / `verifying`.

## Docs to Update

| Doc | Change |
| --- | --- |
| `docs/frontend/bank-transfers.md` | **New.** Full area spec per step 7, including the `useFundingDetails` contract, the `ENV.IS_DEV` fallback rule, and the #1311 swap. |
| `docs/frontend/hooks.md` | Add a `useFundingDetails` row alongside the other `src/api` hooks. |
| `packages/frontend/src/api/README.md` | Add the `pipeline.mock.api.GET./v1/funding-details` key to the mock-key schema. |
| `docs/frontend/index.md` | Add the `bank-transfers.md` row under "Area specs". |
| `docs/frontend/ui-components.md` | Add a `CheckIllustration` section next to `ActivityEmptyIllustration` / `WalletIllustration`. |
| `docs/frontend/auth-components.md` | Extend `### Diagnostics preview seam` with the new `Wire transfers (#1283)` block, as #1284 did for its `?state=` links. |
| `docs/user-stories/epic-1247/1283-lp-add-funds.md` | **New.** Stories per card variant + the modal (open, copy, dismiss, inert seams), all against `/test?tab=auth` under the dev server. Styling-only assertions out of scope — the QA agent's Figma pass covers fidelity. Follow `1284-lp-account-page.md`'s shape. |
| `docs/user-stories/index.md` | Add the `#1283` row to the epic #1247 table, status `Initial`. |
| `docs/exec-plans/tech-debt-tracker.md` | TD-87 onward per step 8. |
| `docs/exec-plans/known-bugs.md` | BUG-21 — duplicate `TD-73` id. |

No product-spec change: this issue adds no user- or agent-facing *behavior* beyond a dev-only
preview. The user-facing wire-transfer flow is specified by the epic's own comments and lands in
production with #1282 / #1285 / #1311.

## Related issues opened during planning

- **[#1311](https://github.com/eq-lab/pipeline/issues/1311) — Backend: LP funding details endpoint
  + per-LP wire payment reference.** `enhancement` · `backend` · `backlog`, linked as a sub-issue of
  epic #1247. Covers the missing `GET` for the trust account's receiving bank details and the
  missing per-LP payment reference the LP must quote on the wire (`bank_transactions.payment_reference`
  exists but is trustee-typed free text, compounding TD-73's no-matching-queue gap). This issue's
  `useFundingDetails()` is the frontend half of that contract, and the LP app now commits to the
  global path `GET /v1/funding-details` (recorded as a comment on #1311).
