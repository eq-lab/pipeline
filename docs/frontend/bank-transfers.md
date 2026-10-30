# Bank transfers (LP wire transfers)

The LP side of wire transfers for epic #1247 (V1.0, issue #1283). Trustee-side recording is epic
#1269 / #1276; the LP-visible trust-account balance and Withdraw flow is #1285. A new area doc
rather than a section in `auth-components.md` (scope: authentication modals) or
`dashboard-components.md` (already 1580+ lines) — this feature spans a modal and a card and keeps
growing through #1282, #1285, and #1276, the same reasoning `account-page.md` records for its own
existence.

**Presentational only.** No network call, no persistence, no auth. Every side-effecting action is
a named, no-op-by-default seam — see [Seams and who wires them](#seams-and-who-wires-them).

**`FundingDetailsModal` is now also reachable from `/` (state 4, #1424), beyond `/test?tab=auth`.**
`AddUsdCard` is mounted on `/`: the `"locked"` variant ships from #1421 (zero state), `"verify"`
from #1422 (unverified state), `"verifying"` from #1423 (KYB-pending state), `"unlocked"` from
#1424 (state 4, `kyb_status: "Passed"` with PLUSD held and sPLUSD zero), and `"declined"` from
#1426 (state 6, `kyb_status: "ChangesRequested"` or `"Failed"`, gated on status alone) — its
`onAddFunds` opens `FundingDetailsModal` with no `details`, so every row renders `—` just as the
`/test` preview does. The variant for a given account state is decided by `deriveHomeState` in
`packages/frontend/src/components/homeState.ts`, not in this file — see
`docs/frontend/dashboard-components.md#home-route`. A real trust-account USD balance and the
Withdraw flow behind its seam are #1285's; the `"funded"` variant is still not wired to any route.

## FundingDetailsModal

`packages/frontend/src/components/FundingDetailsModal.tsx` +
`packages/frontend/src/components/useFundingDetailsModal.ts` — the static "Funding details" wire
transfer modal, Figma node `6701-97113`. Not a form: no inputs, no amount, no submit.

Shell follows `FirstConnectionModal.tsx`'s recipe (confirmed byte-identical via
`get_variable_defs` against the frame's own bound tokens, not the codegen's stale Tailwind
fallbacks — see [Figma → token mapping](#figma--token-mapping)), **not** `AuthModalShell`, which is
a full-viewport two-pane frame with no scrim: `createPortal` into `document.body`, scrim
`fixed inset-0 z-[9999] flex items-center justify-center` at `rgba(56,55,53,0.6)`, panel
`width: 420`, `maxWidth: calc(100vw - 32px)`, `backgroundColor: #f8f7f6`, `borderRadius: 4`,
`padding: 24`, close `×` at `absolute top-4 right-4 h-8 w-8` (the same inline glyph
`FirstConnectionModal` already ships), scrim click and Escape both dismiss.

Anatomy: `Funding details` heading (`<h2>`, Besley 28/36, `aria-labelledby` via `React.useId()`) →
six label/value rows (label ink-muted, value ink, body 16/22) → a note row (`Transfers may take
from the same day up to 5 business days`, ink-muted, with a trailing 20×20 hint-circle icon,
`packages/frontend/src/assets/hint.svg`, exported from the frame — **not** a reuse of any existing
component, since no such icon exists anywhere else in the repo; the plan's original claim that
`EarnedCard` already renders a hint glyph is a documentation error, corrected here) → a full-width
`Button variant="primary-dark"` labelled `Copy`/`Copied` with a leading copy glyph (masked from
`packages/frontend/src/assets/copy.svg`, its first consumer) → a centred caption footer,
`Need help? Contact Support`, the latter a real `<button>` calling `onContactSupport`.

`useFundingDetailsModal.ts` owns `copied` state (1500 ms reset), a feature-detected
`navigator.clipboard` write that silently no-ops on rejection, the Escape listener via
`stopImmediatePropagation` (the `useErrorDetailsDialog.ts` pattern — this modal will eventually
open over a home page that may itself host a dialog), and the body-scroll lock.

```ts
export interface FundingDetailsModalProps {
  open: boolean;
  onDismiss: () => void;
  details?: ReadonlyArray<FundingDetailRow>;   // omitted → every value renders "—"
  onContactSupport?: () => void;               // no-op default
}
```

### fundingDetails

`packages/frontend/src/components/fundingDetails.ts` — pure data, no React.

- `FUNDING_DETAIL_LABELS` — the six labels in frame order: `Company Name`, `Bank Name`,
  `Bank Address`, `Account Number`, `IBAN`, `SWIFT / BIC code`.
- `FUNDING_DETAILS_PLACEHOLDER` — the frame's values with the company-name typo corrected to
  `Pipeline Trust LLC` (the frame reads `Pipiline Trust LLC`). `/test`-only fixture data; there is
  **no backend endpoint serving real trust-account wire details** — see
  [Out of scope](#out-of-scope).
- `formatFundingDetailsForCopy(rows)` — one `"{label}: {value}"` line per row, joined by `\n`, `—`
  rows included verbatim. This is the whole-block serialization the single `Copy` button writes —
  the frame has exactly one Copy action and no per-row copy affordance.

## AddUsdCard

`packages/frontend/src/components/AddUsdCard.tsx` — the "Add USD / Use a bank transfer" home card
as a standalone presentational component with an explicit `variant` prop covering the six designed
states. `variant` is required — unlike the modal's seams there is no honest default state.

```ts
export type AddUsdCardVariant = "locked" | "verify" | "verifying" | "declined" | "unlocked" | "funded";

export interface AddUsdCardProps {
  variant: AddUsdCardVariant;
  usdBalanceLabel?: string;          // "funded" only; omitted → "—"
  padding?: CardPadding;
  onAddFunds?: () => void;
  onWithdraw?: () => void;
  onStartVerification?: () => void;
  onViewStatus?: () => void;
}
```

`locked` and `verify` ship on `/` for home states 1 and 2 (#1421/#1422); `verifying` ships on `/`
for home state 3 (#1423, Figma frame `6701:98417`), stacked above `EarnedCard layout="compact"`
with **no `flex-1`** — the card owns its 246px height, per § "Shape B frame and illustration
anchor". `unlocked` ships on `/` for home state 4 (#1424, Figma frame `6701:97340`, node
`6701:97494`), stacked above `EarnedCard layout="compact"` **with** `className="flex-1"` (Shape A
carries no height of its own). `declined` ships on `/` for home state 6 (#1426, Figma frame
`6702:104071`, node `6702:104191`), gated on `kyb_status` alone (`ChangesRequested` or `Failed`, no
wallet or balance gating — see `docs/product-specs/home-screen-states.md`), stacked above
`EarnedCard layout="compact"` with **no `flex-1`**, same as `verifying`. `funded` is still
preview-only.

`addUsdCardState.ts` ships the `AddUsdCardVariant` union and `ADD_USD_CARD_VARIANTS` (frame order,
for previews) only — **no derivation function**. Deciding which variant renders for a given
`(authenticated?, kybStatus, trustAccountBalance)` triple is epic #1419's home-state machine (see
`docs/product-specs/home-screen-states.md` and
`packages/frontend/src/components/homeState.ts`), not #1282's; the precedence rule lives there.

Built on `Card` from `@pipeline/ui` (`variant="white"`), `role="region"
aria-labelledby={derived id}`, a `data-node-id` per variant, and the home cards' shared border
idiom (`!border-t !border-r-[3px] !border-b-[3px] !border-l`).

### Two layout shapes

**Shape A — `card-horizontal`** (`locked`, `unlocked`, `funded`). A text block (eyebrow body 16/22
→ heading Besley 20/28 → sub-caption caption 12/16) and a bottom-aligned row holding a 128×128
circular action. The circular action is `Button variant="circular-blue"` — its brand fill
(`--color-pipeline-brand`, confirmed via `get_variable_defs` against `fill/brand`, not the
codegen's stale `#8fb2a4` literal) and disabled treatment
(`rgba(184,191,190,0.12)` + ink-subtle text) already match the greyed-out `locked` rendering
exactly. No new variant, no override.

**Shape B — `Section`** (`verify`, `verifying`, `declined`). A card-anchored illustration
(`CheckIllustration` for `verify`/`verifying`, `WarningIllustration` for `declined`) clipped by the
card, a heading block (title Besley 20/28 + description body 16/22, no eyebrow), and a rectangular
`Button variant="primary-dark" size="m"` (the `!h-10` override — all three designed buttons are
40 px tall, not the 48 px default).

#### Shape B frame and illustration anchor (#1430, #1426)

All three frames are 313.14 × 246 with 16 px padding — 313.14 px is the home grid's `col-span-2`
width at the 1136 px design container, and 246 px is the frame height the card owns. The anchor
math:

| | `verify` (`6701:97695`) | `verifying` (`6701:98539`) | `declined` (`6702:104191`) |
| --- | --- | --- | --- |
| Illustration node | `6701:97696` (Union) | `6701:98540` (Union) | `6703:106694` (`warning 1`) |
| Illustration size | 291 × 193.66 | 291 × 193.66 | 236 × 236 |
| Offset from the **card** box | `x=164, y=76` | `x=174, y=66` | `x=128.86, y=48` |
| Bleed past the right edge | 142 px | 152 px | 51.72 px |
| Bleed past the bottom edge | 24 px | 14 px | 38 px |
| Visible artwork width | ~149 px | ~139 px | ~184 px |
| Title block | `(16, 16)` | `(16, 16)` | `(16, 16)`, text column capped `227px` |
| Button frame | 161 × 40 at `(16, 190)` | 122 × 40 at `(16, 190)` | 70 × 40 at `(16, 190)` |

The `declined` card's frame (`6702:104191`) also carries a second, **hidden** artwork node —
`Union` `6702:104192`, 291 × 193.66 at card-box `(174, 66.34)`, the identical leftover striped-check
geometry the `verifying` card uses. It is not rendered; the visible artwork is `warning 1`
(`6703:106694`) only. The title block's 227px cap is load-bearing: it is what wraps the `declined`
heading `We can’t verify your account` onto two lines — without the cap the heading fits on one
line and the card stops matching the frame. (The frame's own `Frame 1321317268` title container
reports `height: 46`, which is a Figma clip artifact — its content measures 82px (56 heading + 4
gap + 22 description) and the frame screenshot shows all three lines; the block is left to flow
naturally, not pinned to 46px.)

The offsets are measured from the **card** box, not from the padded content box, so the `Card`
itself is the positioning and clipping context: it carries `relative h-[246px] overflow-hidden` for
all three Shape B variants, and the inner column is a plain `flex h-full w-full flex-col
justify-between` with no `relative`/`overflow` of its own. The illustration is `absolute` with the
per-variant `top`/`left` above; the right and bottom bleed falls outside the card and is clipped
there, which is what leaves only the artwork's visible portion in the card, behind the text column.
The heading block and button keep `relative` so they paint over it.

Three 1–3 px deltas against the frame come from the home cards' shared border idiom
(`!border-t !border-r-[3px] !border-b-[3px] !border-l`), not from the anchor. Absolute offsets
resolve against the card's padding box, so `left:164` lands 165 px from the outer edge, and
`overflow-hidden` clips at the padding box, so the right and bottom cuts fall 3 px inside the Figma
frame edge. `justify-between` likewise places the button's bottom at 227 rather than the frame's
`y=230`.

Because the card owns its height, the stack that mounts it must not stretch it. The unverified
right stack (`6701:97694`, 344 = 246 + 16 gap + 82) mounts `<AddUsdCard variant="verify">` with no
`flex-1`; `EarnedCard` keeps its own 82 px. The state-6 right stack (`6702:104190`) mounts
`<AddUsdCard variant="declined">` the same way. Shape A carries no height and is still free to grow.

### Per-variant presence table

| Variant | Node | Eyebrow | Heading | Sub-caption | Illustration | Primary action | Secondary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `locked` | `6701:98378` | `Add USD` | `Use a bank transfer` | `KYB verification required` | no | circular `Add Funds`, **disabled** | none |
| `verify` | `6701:97695` | none | `Verify your account` | `Complete KYB to unlock bank transfers.` | yes | `Start Verification` | none |
| `verifying` | `6701:98539` | none | `Verifying account…` | `We are reviewing your documents.` | yes | `View Status` → `/account` | none |
| `declined` | `6702:104191` | none | `We can’t verify your account` | `Please check and try again.` | yes | `View` → `/account` | none |
| `unlocked` | `6701:97494` | `Add USD` | `Use a bank transfer` | `Transfers unlocked` | no | circular `Add Funds` | none |
| `funded` | `6701:97289` | `USD Balance` | `{usdBalanceLabel}` | `on Trust account` | no | circular `Add Funds` | `Withdraw` |

Notes:

- **`Verifying account…` ships typo-corrected.** The frame says "Veryfying". `account-page.md`
  already shipped the corrected spelling for its own `under-review` stand-in, citing the #1248
  design-file-artifact precedent; shipping the typo here would make the two surfaces disagree.
  Logged as a designer ask (tech debt).
- **`declined`'s apostrophe ships as the frame's typographic U+2019**, `We can’t verify your
  account` — no typo correction needed here, unlike `Veryfying` above.
- **`declined` is gated on `kyb_status` alone.** No wallet-connection or balance condition — see
  `docs/product-specs/home-screen-states.md` state 6. `ChangesRequested` is what the frame renders
  for in practice; `Failed` is in the condition but unobservable today because a `Failed` verdict
  suspends the account, and since #1465 the LP is signed out on the next authenticated request
  instead of the home read ever reaching `"legacy"` — logged as tech debt.
- **`funded`'s balance never gets a fabricated number.** `usdBalanceLabel` omitted → `—`. The
  frame's `$1,000.00` is preview-fixture data only.
- **`Withdraw` is a plain `<button>` styled as a body-text link**, not a rectangular `Button` —
  node `6701:97301`, bottom-left of the horizontal card, one body line-height tall. A
  `Button variant="secondary"` would impose a 48/32 px box the frame does not have. Present in
  `funded` only.
- The teal connector line leaving the `Add Funds` circle in the Figma frame is a prototype wire to
  the Add Funds modal frame, not a visual element — not rendered. It confirms the circular action
  opens `FundingDetailsModal` in both `unlocked` and `funded`; there is no funded-specific modal
  frame.

## CheckIllustration

`packages/ui/src/components/CheckIllustration/` — the striped-check artwork the `verify` and
`verifying` variants clip into their bottom-right corner. Follows the `ActivityEmptyIllustration`
CSS-mask recipe verbatim: `width` (number → px, string passthrough) + `tone`
(`"primary" | "muted"`) props, `maskImage` painting `currentColor`, `aria-hidden="true"`,
`data-tone`, `forwardRef<HTMLSpanElement>`. Intrinsic aspect ratio `291 / 193.66` (not `1 / 1`).
Asset: `packages/ui/src/assets/illustrations/striped-check.svg`, exported from Figma node
`6701:97696` (`verify`) — the `verifying` variant's own Union node (`6701:98540`) resolves to the
identical asset hash, confirming the plan's assumption that this is one shared asset positioned
per variant, not two exports.

The `declined` variant clips a different artwork, `WarningIllustration` — same CSS-mask recipe,
new asset (`packages/ui/src/assets/illustrations/striped-warning.svg`, Figma node `6703:106694`,
square `236 / 236` aspect ratio). Full spec: `docs/frontend/ui-components.md#warningillustration`.

## Verbatim copy

Modal: `Funding details` · `Company Name` · `Bank Name` · `Bank Address` · `Account Number` ·
`IBAN` · `SWIFT / BIC code` ·
`Transfers may take from the same day up to 5 business days` · `Copy` / `Copied` · `Need help?` ·
`Contact Support`.

Card: `Add USD` · `Use a bank transfer` · `KYB verification required` · `Transfers unlocked` ·
`USD Balance` · `on Trust account` · `Add Funds` · `Withdraw` · `Verify your account` ·
`Complete KYB to unlock bank transfers.` · `Verifying account…` · `We are reviewing your
documents.` · `Start Verification` · `View Status` · `We can’t verify your account` ·
`Please check and try again.` · `View`.

## Figma → token mapping

Confirmed via `get_variable_defs` against each node's own bound variables — several of the plan's
assumed values corrected the *codegen's* stale Tailwind-fallback literals (e.g. `radius-3xl,32px`,
`radius-xxl,24px`, `fill/brand,#8fb2a4`), which do not reflect the currently bound value, the same
class of staleness `account-page.md` documents for its own frame.

| Figma variable | Codegen literal (stale) | Resolved value | Repo token |
| --- | --- | --- | --- |
| `fill/overlay` | `rgba(50,56,55,0.6)` | `#38373599` | matches `rgba(56,55,53,0.6)` scrim |
| `bg/modal` | `#f6f8f8` | `#f8f7f6` | `--color-pipeline-paper` |
| `radius/radius-3xl` (modal panel) | `32px` | `4` | `--radius-pipeline-card` |
| `radius/radius-xxl` (card) | `24px` | `4` | `--radius-pipeline-card` |
| `radius/radius-s` (buttons) | `8px` | `4` | `--radius-pipeline-button` |
| `content-test/primary` | — | `#262524` | `--color-pipeline-ink` |
| `content-test/secondary` | — | `#38373599` | `--color-pipeline-ink-muted` |
| `border-test/secondary` | — | `#3837352e` | `--color-pipeline-line` |
| `fill/brand` (circular button) | `#8fb2a4` | `#000080` | `--color-pipeline-brand` |
| `fill-test/primary` (Copy / dark buttons) | — | `#262524` | `--color-pipeline-cta` |
| Heading M (modal title) | — | Besley 28/36 | `--text-pipeline-heading-m` |
| Heading 20 (card titles) | — | Besley 20/28 | `--text-pipeline-heading-s` |
| Body | — | 16/22 | `--text-pipeline-body` |
| Caption | — | 12/16 | `--text-pipeline-caption` |

## Reuse verdicts

| Piece | Verdict |
| --- | --- |
| `FirstConnectionModal`'s shell recipe | **Reused as the pattern**, not as a shared component — `FundingDetailsModal` owns its own file, matching the modal-per-file convention every other KYB modal follows. |
| `Button variant="circular-blue"` | **Reused verbatim** for the 128px circular action, including its disabled treatment. |
| `Button variant="primary-dark"` | **Reused verbatim** for the modal's `Copy` action and the `Section` shape's rectangular action, with `size="m"` for the latter. |
| `packages/frontend/src/assets/copy.svg` | **First consumer** — the modal's Copy button glyph, painted via CSS mask like `ActivityEmptyIllustration`/`HeroIcon`. |
| `useErrorDetailsDialog.ts`'s Escape pattern | **Pattern reused**, not imported — `stopImmediatePropagation` on a capture-phase listener, since this modal may one day open over a page hosting another dialog. |
| A shared hint-icon component | **Does not exist.** The plan's claim that `EarnedCard` already renders one was incorrect; `hint.svg` is a new, dedicated asset exported from the frame. |

## Wire-out

LP bank wire-out (#1757); behaviour in [withdrawals.md](../product-specs/withdrawals.md#bank-wire-withdrawals-lp-app). No Figma frames exist for it; it is built from the LP theme and `@pipeline/ui` components, using the funded home `6701-97136`, the funding modal `6701-97113` and the withdraw page `1498-100351` as style reference only.

| Piece | File | Notes |
| --- | --- | --- |
| `WireOutSection` | `components/withdraw/WireOutSection.tsx` | `Card variant="plain"` (`wire-out-section`): heading "Withdraw to a bank account", the verbatim docs paragraph (`wire-out-description`), `Button primary-dark m` "Request bank wire-out" (`wire-out-open`), blocked reason caption (`wire-out-blocked-reason`); below it "Your bank wire-outs" (`wire-out-list`, rows `wire-out-row-<id>`), hidden when empty. Mounted on the withdraw direction after the steps card when connected and the minter is configured. |
| `WireOutModal` | `components/withdraw/WireOutModal.tsx` | `ModalDialog` "Withdraw to a bank account" (`wire-out-modal`): `TokenInput` PLUSD with 25% / 50% / 75% / Max chips (`balanceChipAmount`), `InlineError` "Insufficient balance", `StepsCard` (`wire-out-steps-card`). Toast id `wire-out-tx`: "Sending…", success "Wire-out of {amount} PLUSD requested", danger with "Details" into the page `ErrorDetailsDialog`. Success closes the modal, adds the id to the section's just-submitted ids, refetches the audit log and the balance. |
| `useWireOutFlow` / `useWireOutGate` | `components/withdraw/useWireOutFlow.ts` | Steps (Stellar: Request wire-out; EVM: Allow Pipeline to use PLUSD, Request wire-out), `disabledReason` priority, errors via the `wireOut` context. Request step hint: "The PLUSD moves into escrow until the Trustee settles or cancels the request." |
| `renderWireOutRow` | `components/activity/renderWireOutRow.tsx` | `ActivityRow` title "Withdraw funds", time from the audit log, amount `TwoLineAmount` `−{amount} PLUSD` over `Bank transfer · {status}`. Pending: `clock-pending` / warning, muted; Settled: `check-circle` / success; Cancelled: `arrow-down-circle` / neutral, muted. Unresolved reads show "—". |
| `useActivityFeed` | `components/activity/useActivityFeed.ts` | Merges `useRequests()` with `useWireOutRequests()` by served time (newest first, each list's order preserved, requests first on ties), slices after the merge, reads contract values once per list. |

Home `RecentActivityCard` and `/transactions` ("All" and "Sell" tabs) render the merged feed. Loading and error states stay driven by `useRequests`; a failed audit-log read just omits wire-out rows.

## Seams and who wires them

| Seam | Default | Wired by |
| --- | --- | --- |
| `FundingDetailsModal.details` | every value renders `—` | #1285 (or a new backend issue — see Open Questions on issue #1283) |
| `FundingDetailsModal.onContactSupport` | no-op | unassigned — no destination exists in the design (tech debt) |
| `AddUsdCard.variant` | required, no default | #1282's state machine |
| `AddUsdCard.usdBalanceLabel` | `—` | #1285 |
| `AddUsdCard.onAddFunds` | no-op | #1424 (wired on `/` for the `unlocked` variant — opens `FundingDetailsModal` with no `details`) |
| `AddUsdCard.onWithdraw` | no-op | #1285 (the LP wire-out request itself is on the withdraw page, #1757; see [Wire-out](#wire-out)) |
| `AddUsdCard.onStartVerification` | no-op | #1422 (home state 2 — `openAccountSetup()`) |
| `AddUsdCard.onViewStatus` | no-op | #1423 (home state 3 — `navigate({ to: "/account", search: { state: undefined } })`); reused as-is by #1426 (home state 6, `declined` variant) |

**Wire attribution is parked, not resolved.** The trustee's
`POST /v1/lps/{id}/bank-deposits` (#1413, which replaced `POST /v1/lp-ledger/deposits`) takes the
LP from the request path and there is no unidentified-wire matching queue (TD-73), yet the designed
modal shows no reference/memo "include this code" line — and that endpoint now *requires* a unique
`payment_reference` per wire (it is hashed into the minter's `ref_hash`), so whatever the LP puts on
the transfer is the only string tying it to a statement line. Raised on epic #1247 for the next
design/backend sync (2026-09-22 approval comment on issue #1283); if a memo code is added, the
modal's content model becomes per-LP data (a fetch), not a static constant — a follow-up issue.

## `/test?tab=auth` preview seam

`packages/frontend/src/routes/test.tsx` → `AuthTab`, a `Wire transfers (#1283)` block placed after
the existing Account-page preview links: a `Button variant="secondary"` labelled
`Open Funding details modal` (opens the modal with `details={FUNDING_DETAILS_PLACEHOLDER}`, so QA
can Figma-compare a fully populated modal), and the six `AddUsdCard` variants rendered inline in
fixed `w-[313px]` boxes with their variant id as a caption. `onAddFunds` opens the same modal;
`onWithdraw`/`onStartVerification`/`onViewStatus` each reveal a stand-in confirmation line by
`data-testid` naming the owning issue. See [Diagnostics preview
seam](./auth-components.md#diagnostics-preview-seam).

## Out of scope

| Concern | Owner |
| --- | --- |
| Deciding which card variant renders for a given account state | epic #1419 (`deriveHomeState`) |
| Mounting `AddUsdCard` into the home grid for state 5 | #1425 (shipped for state 6 by #1426) |
| A real trust-account USD balance, and the Withdraw flow behind the seam | #1285 (the wire-out path is #1757 on the withdraw page; `AddUsdCard.onWithdraw` stays with #1285) |
| Recording a received wire (trustee side) | #1413 (backend, shipped), #1272 (UI), epic #1269 |
| Any network call, persistence, or auth on either surface | #1254 / #1265 / #1285 |
| Real source for trust-account wire details | #1285 (folded), or a new backend issue |

## Accessibility

The modal is `role="dialog" aria-modal="true"` with `aria-labelledby` resolving to the `Funding
details` heading; Escape, the `×`, and the scrim each dismiss it, a click inside the panel does
not. `AddUsdCard` is `role="region"` with `aria-labelledby` resolving to its own visible heading on
every variant. Every action is a real, focusable `<button>`; clicking any of them with nothing
wired never throws (the inert-seam contract).

## No mobile frames

No mobile frames exist for either surface — the whole V1.0 family is desktop-only (same call as
TD-104). The card is width-driven by its grid slot and the modal already caps at
`calc(100vw - 32px)`. Logged as tech debt, no invented mobile layout.
