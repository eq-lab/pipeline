# Bank transfers (LP wire transfers)

The LP side of wire transfers for epic #1247 (V1.0, issue #1283). Trustee-side recording is epic
#1269 / #1276; the LP-visible pending bank deposit is `pending_bank_deposits` on `GET /v1/lps/me` (#1285, wired by #1820) and the Withdraw flow is #1757. A new area doc
rather than a section in `auth-components.md` (scope: authentication modals) or
`dashboard-components.md` (already 1580+ lines) — this feature spans a modal and a card and keeps
growing through #1282, #1285, and #1276, the same reasoning `account-page.md` records for its own
existence.

**Presentational, except the funding modal.** `AddUsdCard` makes no network call and has no auth;
every side-effecting action is a named, no-op-by-default seam — see [Seams and who wires
them](#seams-and-who-wires-them). `FundingDetailsModal` is wired on `/` to the authenticated
`GET /v1/lps/me/payment-details` since #1817 (the modal itself stays presentational: it takes a
`view`).

**`FundingDetailsModal` is now also reachable from `/` (state 4, #1424), beyond `/test?tab=auth`.**
`AddUsdCard` is mounted on `/`: the `"locked"` variant ships from #1421 (zero state), `"verify"`
from #1422 (unverified state), `"verifying"` from #1423 (KYB-pending state), `"unlocked"` from
#1424 (state 4, `kyb_status: "Passed"` with PLUSD held and sPLUSD zero), and `"declined"` from
#1426 (state 6, `kyb_status: "ChangesRequested"` or `"Failed"`, gated on status alone) — its
`onAddFunds` opens `FundingDetailsModal`, which fetches the served bank details and a fresh payment
reference (#1817). The variant for a given account state is decided by `deriveHomeState` in
`packages/frontend/src/components/homeState.ts`, not in this file — see
`docs/frontend/dashboard-components.md#home-route`. The pending bank deposit behind the `usdBalanceLabel` seam is
`pending_bank_deposits` (#1285, wired by #1820) and the Withdraw flow behind its seam is #1757's; the `"funded"` variant is still not wired to any route.

## FundingDetailsModal

`packages/frontend/src/components/FundingDetailsModal.tsx` +
`packages/frontend/src/components/useFundingDetailsModal.ts` — the static "Funding details" wire
transfer modal, Figma node `6701-97113` (no Figma for the #1817 additions, see below). Not a form:
no inputs, no amount, no submit.

Shell follows `FirstConnectionModal.tsx`'s recipe (confirmed byte-identical via
`get_variable_defs` against the frame's own bound tokens, not the codegen's stale Tailwind
fallbacks — see [Figma → token mapping](#figma--token-mapping)), **not** `AuthModalShell`, which is
a full-viewport two-pane frame with no scrim: `createPortal` into `document.body`, scrim
`fixed inset-0 z-[9999] flex items-center justify-center` at `rgba(56,55,53,0.6)`, panel
`width: 420`, `maxWidth: calc(100vw - 32px)`, `backgroundColor: #f8f7f6`, `borderRadius: 4`,
`padding: 24`, close `×` at `absolute top-4 right-4 h-8 w-8` (the same inline glyph
`FirstConnectionModal` already ships), scrim click and Escape both dismiss.

Anatomy: `Funding details` heading (`<h2>`, Besley 28/36, `aria-labelledby` via `React.useId()`) →
six label/value rows (label ink-muted, value ink, body 16/22; each value is a click-to-copy
button, see below; rows stacked `gap-3`, panel sections `gap-5`) → a note row (`Transfers may take
from the same day up to 5 business days`, ink-muted **caption 12/16 so it fits one line** — live
review 2026-11-03, to keep the panel inside `min(80vh, 90dvh)` without a vertical scrollbar — with
a trailing info glyph that is an `InfoTooltip`, see below) → a centred
caption footer, `Need help? Contact Support`, the latter an `<a href="mailto:support@pipeline.one">`
(`SUPPORT_EMAIL`, exported from the modal; closes TD-89 — decision 2026-11-03: the link opens the
LP's mail client). There is **no** copy-all button (removed in the 2026-11-03 live review).

**Glyphs (`components/FundingDetailsGlyphs.tsx`, live review 2026-11-03).** `InfoGlyph` is an
inline SVG traced from the frame `6701-97134` export (the 20×20 info circle at `#383538` 30 %).
There is no copy glyph anywhere in the modal any more (removed on the user's request the same
day; the earlier `copy.svg` CSS mask had rendered as a solid square), and `assets/copy.svg` /
`assets/hint.svg` were deleted. `InfoTooltip` (`components/InfoTooltip.tsx`) is a 24×24 button
(`aria-label`, `aria-describedby`) around `InfoGlyph` with a `role="tooltip"` bubble (ink
background, on-dark caption text, `whitespace-pre-line`) shown on hover and focus-within. The
bubble is positioned against the **row** (every row and the note row is `relative`; the tooltip
wrapper deliberately is not), `bottom-full` above it, `left-0` for `align="start"` or `right-0` for
`align="end"`, `w-max max-w-full` — so it can never be wider than the row. That matters because an
invisible (`opacity-0`) absolutely positioned bubble still counts toward scroll width: the earlier
icon-anchored 280px bubble was one of two things giving the panel a horizontal scrollbar (the
other was a `-mr-2` on the row buttons, also removed). The panel is `overflow-x-hidden
overflow-y-auto` as a guard.

**Layout since #1817 (no Figma; built from the row pattern and the LP theme), top to bottom:** heading
→ unavailable notice (only when unavailable) → six bank rows → `Payment reference` row (label
followed by an `InfoTooltip align="start"` whose text is the instruction sentence — there is no
instruction caption any more) → 1px `--color-pipeline-line` divider → `Network` row (plain, not copyable) →
`Receiving wallet` row (label followed by an `InfoTooltip align="start"` whose text is the
destination sentence; value is the served address through `truncateAddress`, `GCGQVO…GQ5C`, with
the full address as the button `title`) → note row with its `InfoTooltip align="end"` (text:
`Domestic transfers: Same day or within 1 business day` / `International transfers: 1–5 business
days`, two lines) → `Need help? Contact Support`.

**Per-row copy (`CopyableRow`, live review 2026-11-03).** Every value in the six bank rows, the
`Payment reference` row and the `Receiving wallet` row is one `<button type="button">`
(`aria-label="Copy {label}"`, `data-testid="funding-details-copy-{slug}"`) holding just the value
text — no icon — with `cursor-pointer`, `select-none` and `touch-manipulation`. A click or tap
writes that row's value (the **full** address for the wallet row) through the shared
`useCopyToClipboard`; on success the confirmation is a **toast outside the dialog**
(`useOptionalToast().show({ id: "funding-details-copied", tone: "success", title: "{label}
copied", durationMs: 2000 })` — an in-row caption widened the row and gave the modal a horizontal
scrollbar, so nothing is rendered inside the dialog on copy; the fixed `id` makes rapid copies
replace one toast instead of stacking). The toast stack sits at `z-[10000]`, above the app's
`z-[9999]` modal scrims. `useOptionalToast` returns `null` outside a `ToastProvider`, so the modal
also renders provider-free (tests, previews) and simply skips the toast. **Hold to copy on touch
screens:** `onPointerDown` with `pointerType === "touch"` arms a 500 ms timer (`HOLD_TO_COPY_MS`);
when it fires the row copies and the release `click` is swallowed so nothing copies twice;
`pointerup` / `pointercancel` / `pointerleave` before 500 ms disarm it and the tap's own click copies
instead. Mouse presses never arm the hold. `contextmenu` is suppressed while a hold is armed or just
fired and `-webkit-touch-callout: none` keeps iOS from showing its own callout. Hover:
`rgba(56,55,53,0.08)` background; disabled while not ready (default cursor, no hover). The modal
mounts a single `useCopyToClipboard`; `useFundingDetailsModal.ts` keeps only the Escape listener
and the body-scroll lock.

- **Chain.** `onAddFunds` captures `useActiveChain()` (`{ kind, chainId }`) with an incrementing
  `openId`; the modal never re-fetches if the wallet view changes while open and has no chain
  picker (a picker would mint a reference per toggle). `Network` is `chainDisplayName(kind,
  response.chain_id)` and `Receiving wallet` is `response.receiver_address`, both as served.
- **One fetch per open.** `usePaymentDetails` uses key `["lp-payment-details", openId, chainId]`
  with `staleTime: Infinity`, the default `gcTime`, `retry: false` and refetch on mount, focus and
  reconnect all off, enabled only while open and authenticated: every 200 mints a reference, so a
  hidden second request would issue one the LP never sees. Re-opening is the only retry.
- **States.** Loading: every value cell is `—`, the rows container is `aria-busy`, every row copy
  button disabled. Unavailable `409` (no linked settlement address of that chain kind, or KYB not
  passed): notice with a `Go to Account` button. Any other failure, including a `503` (bank details not configured): generic notice. Rows stay `—`
  and every row copy button stays disabled; nothing crashes and no scratch value is ever shown.
- **Mint lands as sPLUSD** (`docs/user-docs/lenders/deposit.md`), so the destination caption says
  sPLUSD.

`useFundingDetailsModal.ts` owns the Escape listener via `stopImmediatePropagation` (the
`useErrorDetailsDialog.ts` pattern — this modal will eventually open over a home page that may
itself host a dialog) and the body-scroll lock. Clipboard writes go through `@pipeline/ui`'s
`useCopyToClipboard` (feature-detected `navigator.clipboard`, `execCommand` fallback, silent
no-op on rejection).

```ts
export interface FundingDetailsModalProps {
  open: boolean;
  onDismiss: () => void;
  view?: FundingDetailsView;                   // omitted → { status: "loading" }, every value "—"
  onOpenAccount?: () => void;                  // "Go to Account" on the not-linked notice
}
```

### fundingDetails

`packages/frontend/src/components/fundingDetails.ts` — pure data, no React.

- `FUNDING_DETAIL_LABELS` — the six labels in frame order: `Company Name`, `Bank Name`,
  `Bank Address`, `Account Number`, `IBAN`, `SWIFT / BIC code`.
- `PAYMENT_REFERENCE_LABEL` — `Payment reference`.
- `displayValue(v)` — `—` for empty, null or missing, else the value verbatim (no trimming).
- `FundingDetailsView` — `loading`, `ready` (seven `rows`, `paymentReference`, `network`,
  `receiverAddress`) or `unavailable` (`reason: "not-linked" | "error"`, `chainName`).
  `toFundingDetailsView(response, kind)` maps the payload (`swift_bic_code` → `SWIFT / BIC code`,
  `payment_details` → `Payment reference`); `toUnavailableView(error, chainName)` maps an
  `ApiError` 409 to `not-linked` and anything else to `error`.
- The former scratch placeholder (real-looking bank values) is gone from production code. Preview
  fixtures live in `packages/frontend/src/routes/test/-fundingDetailsFixture.ts` with obviously fake
  values (`Example Trust LLC`, `XX00 TEST …`, `PL-0000-0000-0000`).

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
carries no height of its own), and — since #1819 — for every other signed-in, wallet-connected
`Passed` combination too: states 4a `"passed-empty"` and 4b `"passed-staked"` of
`docs/product-specs/home-screen-states.md` mount the identical card in the same slot. `declined` ships on `/` for home state 6 (#1426, Figma frame
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
`Transfers may take from the same day up to 5 business days` · `{label} copied` (toast) · `Need help?` ·
`Contact Support`.

Added by #1817: `Payment reference` · `Add this reference to your transfer’s reference or remittance
field. Without it we can’t match your transfer to your account.` · `Network` · `Receiving wallet` ·
`Your transfer is credited to this wallet as sPLUSD.` (tooltip) · `Domestic transfers: Same day or
within 1 business day` / `International transfers: 1–5 business days` (tooltip) · `Copy {label}`
(one aria-label per copyable row) / `About the payment reference` / `About the receiving wallet` /
`Transfer timing` (aria-labels) · `Bank details need a {chainName} wallet
linked to your account. Link it on your Account page, or switch to a wallet you have already
linked.` · `Go to Account` · `Bank details are unavailable right now. Close this window and try
again, or contact support.`

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
| A shared hint-icon component | **Does not exist** outside this modal; `InfoGlyph` + `InfoTooltip` (`components/`) are the modal's own, traced from the frame. `IconButton`'s tooltip is top-bar specific (below the button, nowrap). |

## Seams and who wires them

| Seam | Default | Wired by |
| --- | --- | --- |
| `FundingDetailsModal.view` | `{ status: "loading" }`, every value `—` | wired by #1817 on `/` from `GET /v1/lps/me/payment-details?chain_id=<id>` (#1815, chain-aware since #1824); one call per modal open, see [FundingDetailsModal](#fundingdetailsmodal) |
| `FundingDetailsModal.onOpenAccount` | no-op | #1817 (`/` closes the modal and navigates to `/account`) |
| `AddUsdCard.variant` | required, no default | #1282's state machine |
| `AddUsdCard.usdBalanceLabel` | `—` | #1820 (reads `pending_bank_deposits` on `GET /v1/lps/me`, #1285) |
| `AddUsdCard.onAddFunds` | no-op | #1424 (wired on `/` for the `unlocked` variant — opens `FundingDetailsModal`, #1817) |
| `AddUsdCard.onWithdraw` | no-op | #1757 (wire-out) |
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

**Update (#1815, #1817).** The backend issues a reference on every request for the LP to quote and
keeps every issued reference against the LP; the seventh `Payment reference` row shipped in #1817.
Wire matching by issued reference shipped in the backend (#1839); see [deposits.md](../product-specs/deposits.md#wire-matching-by-payment-reference). The Trustee console lookup, chip and mint-chain rule shipped in #1887 (see [trustee-flows.md](./trustee-flows.md#match-an-incoming-wire-by-reference)).

## `/test?tab=auth` preview seam

`packages/frontend/src/routes/test.tsx` → `AuthTab`, a `Wire transfers (#1283)` block placed after
the existing Account-page preview links: four `Button variant="secondary"` openers,
`Open Funding details: ready | loading | not linked | error` (each opens the modal with the
matching fixture view from `routes/test/-fundingDetailsFixture.ts`, no network), and the six `AddUsdCard` variants rendered inline in
fixed `w-[313px]` boxes with their variant id as a caption. `onAddFunds` opens the same modal;
`onWithdraw`/`onStartVerification`/`onViewStatus` each reveal a stand-in confirmation line by
`data-testid` naming the owning issue. See [Diagnostics preview
seam](./auth-components.md#diagnostics-preview-seam).

## Out of scope

| Concern | Owner |
| --- | --- |
| Deciding which card variant renders for a given account state | epic #1419 (`deriveHomeState`) |
| Mounting `AddUsdCard` into the home grid for state 5 | #1425 (shipped for state 6 by #1426) |
| Wiring the pending bank deposit into the card; the Withdraw flow behind the seam | #1820; #1757 |
| Recording a received wire (trustee side) | #1413 (backend, shipped), #1272 (UI), epic #1269 |
| Network call, persistence, or auth on `AddUsdCard` | #1254 / #1265 / #1820 |
| Linking a settlement address (challenge, sign, verify) | #1825 |
| Filling `system_configuration.system_bank_details` | ops, per environment (`deposits.md#filling-the-bank-details`) |

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
