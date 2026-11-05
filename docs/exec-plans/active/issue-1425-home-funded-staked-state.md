# Issue #1425: Home state 5: wallet connected, KYB passed, bank transfer received, PLUSD = 0, sPLUSD > 0

Source: https://github.com/eq-lab/pipeline/issues/1425

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97136&m=dev
— frame `6701:97136` (" PLUSD = 0, sPLUSD > 1, Bank transfer received")
Branch / worktree: `feat/home-state-funded-staked` at
`/Users/luiza/Projects/pipeline-feat-home-state-funded-staked`

## Scope

Add the sixth `deriveHomeState` branch — `"funded-staked"` (state 5 of
`docs/product-specs/home-screen-states.md`) — and render its desktop grid pixel-exact to Figma
frame `6701:97136`.

In scope:

- `deriveHomeState` gains `"funded-staked"`: signed in · wallet connected · `lpRead === "loaded"` ·
  `kyb_status === "Passed"` · PLUSD display-zero · sPLUSD **not** display-zero. Evaluated after
  `"plusd-held"` and before the `"legacy"` fallback.
- A sixth desktop grid branch in `packages/frontend/src/routes/index.tsx`.
- `PortfolioPlaceholderCard`: new compact variant (node `6701:97247`) whose sub-line is the served
  unrealized-PnL label rendered at Body 16/22 in the positive token, replacing the
  `stake-or-add-usd` sentence.
- `StakeCard layout="compact"`: new **staked-balance** mode (node `6701:97273`) — eyebrow
  `Staked PLUSD`, the served share balance at Heading 20, the sPLUSD-icon sub-line, and a two-button
  row `Stake More` (118×40, brand) + `Unstake` (94×40, secondary). Same content as the already
  shipped `mobileHomeState="splusd"` State C card (Figma `1497:95217`), in the 313×164 compact frame.
- `EarnedCard layout="compact"`: the served-PnL rendering (node `6701:97304`) — label `Earned`
  instead of `Earnings`, the value in the positive token (already implemented for `+`-prefixed
  labels), and the 20px `hint` glyph (node `6701:97314`) which states 1–4 keep hidden.
- `AddUsdCard variant="funded"` (node `6701:97289`) mounted on `/` for the first time. The
  component already exists and needs no change; only the mounting, the `usdBalanceLabel` binding
  (see Open Question 1) and `onWithdraw` (Open Question 2) are new.
- `RecentActivityCard` keeps its existing wiring — with activity present `useRequests` populates the
  rows and the `View All` link (node `6701:97327`, 126×48). No change expected.
- Spec updates: `docs/product-specs/home-screen-states.md`,
  `docs/frontend/dashboard-components.md#home-route`, `docs/frontend/bank-transfers.md`.
- A user-stories doc at `docs/user-stories/epic-1419/1425-home-funded-staked-state.md`.

Out of scope:

- **Mobile.** No mobile frame exists for this state, and the mobile stack already renders the
  designed State C layout (`deriveMobileHomeState` → `"splusd"`). It stays on its existing
  `isConnected` rendering, unchanged — the same decision as #1421/#1422/#1423/#1424.
- **The composite Total-Balance number.** The frame's `$2,000.00` carries the Figma dev annotation
  "Total balance: PLUSD + sPLUSD + USD balance" on node `I6701:97247;1100:72482;6539:2329`. No
  endpoint serves a combined total and summing client-side is the derived metric the project
  forbids; per the #1424 decision log (2026-10-12) the heading keeps the served
  `formatBigintCurrency(splusdSharesActive)` binding and a backend total is a follow-up. The
  composite graph and merged activity feed remain #1282 / #1313 / #1314.
- **Real trust-account USD data and the bank Withdraw flow** — #1285.
- State 6 (KYB problem, #1426) and state 7 (wallet-only visitor, #1460); the header / Account
  changes of #1458 and the Add-email screen of #1459.
- Any client-side derived metric: nothing new is summed, scaled or normalized in the frontend.

## Assumptions and Risks

- **"Bank transfer received" is not a served signal.** `GET /v1/lps/me` (`LpResponse` in
  `packages/frontend/src/api/lps.ts`) carries no trust-account balance and no transfer flag, and
  nothing in `/v1/pnl`, `/v1/positions/history`, `/v1/financial-position`, `/v1/stats` or
  `/v1/requests` does either — those are wallet/vault-scoped. #1285 ("Backend: LP trust-account USD
  balance + bank withdraw") is still open. The state therefore cannot be gated on it; see Open
  Question 1.
- **Shared-component churn.** `StakeCard` and `EarnedCard` are also used by the zero / unverified /
  kyb-pending / plusd-held branches, the legacy branch and the mobile stack. Every new behaviour
  must be additive and opt-in by prop, with the existing snapshots and tests untouched. In
  particular, the `Earned` label and hint glyph change applies to `layout="compact"` **only** — the
  default layout that mobile and the legacy grid render keeps `Earnings`.
- **The staked-balance bindings are already shipped, including their labelling quirk.** Figma
  `1497:95217` (desktop/mobile State C) and this frame's `6701:97273` carry byte-identical copy
  ("Staked PLUSD" / `1,000.00` / `1,042.80 sPLUSD · $1,021.30`), so the new compact mode reuses the
  existing `mobileSplusdShares` / `mobileSplusdInPlusd` / `splusdUsdValue` props verbatim rather
  than re-deriving them. The sub-line labels the PLUSD-equivalent with the word "sPLUSD", which is
  what ships today and what `dashboard-components.md` documents; do not "fix" it here.
- **`fill/brand` resolves to `#000080`,** not the codegen's stale `#8fb2a4` literal — i.e.
  `Button variant="primary-blue"` / `--color-pipeline-brand`, unchanged. `radius/radius-s` and
  `radius/radius-xxl` both resolve to **4** (`get_variable_defs` on `6701:97257` / `6701:97288`);
  the 8px/24px literals in `get_design_context` are stale fallbacks. `content-test/positive` is
  `#208000` = `--color-pipeline-chart-positive`, the token `EarnedCard` already uses.
- **TD-121 still applies.** An unresolved balance reads as displayed-zero, so a `Passed` LP who
  actually holds sPLUSD renders `"legacy"` for the moment before the balance resolves. No loading
  state is designed; do not invent one.
- **`formatRawDecimalUSD` defaults absent data to `$0.00`,** not `—`. The Total Balance sub-line and
  the Earned value therefore read `$0.00 earning` / `$0.00` before `GET /v1/pnl` answers. That is
  the shipped behaviour of the same bindings on mobile and the legacy grid; this issue does not
  change it (noted so QA does not file it twice).
- **Open Questions below gate the frontend flow.** All three change what renders; do not start the
  `AddUsdCard` mounting or the Buy/Sell row before they are answered.

## Open Questions

1. **How is the USD Balance card bound, given nothing serves a trust-account balance?** The frame
   shows `AddUsdCard variant="funded"` — eyebrow `USD Balance`, heading `$1,000.00`, caption
   `on Trust account`. No endpoint serves that number and no field flags "bank transfer received"
   (#1285 is open). Proposal: do **not** gate the state on it — derive state 5 from
   `Passed` + PLUSD display-zero + sPLUSD non-zero only — and mount `variant="funded"` with no
   `usdBalanceLabel`, so the heading renders `—` (the same precedent as the all-`—`
   `FundingDetailsModal`, decision 4 of #1424). Confirm, or should `/` keep
   `variant="unlocked"` ("Add USD / Use a bank transfer / Transfers unlocked") until #1285 serves
   a balance?
2. **What does the `funded` card's `Withdraw` link do?** The USD withdrawal flow is #1285 and does
   not exist. `/deposit?direction=withdraw` is the PLUSD→USDC swap, not a bank withdrawal, so it is
   the wrong target. Options: (a) render it with no handler (inert, the component's default seam),
   (b) open the same `FundingDetailsModal`, (c) hide it until #1285 lands — which breaks
   Figma-exactness. Which?
3. **How should `Sell` render while PLUSD is zero?** The shipped rule disables Sell at display-zero
   (#1186), and `Button variant="secondary"` paints disabled at `opacity-[0.32]`; the frame draws
   Sell (node `6701:97272`) at full opacity in ink-muted, pixel-identical to state 4's *enabled*
   Sell. Keep the disabled 32% treatment (honest, consistent with states 1–3) and accept a Figma
   delta, or keep the button disabled for interaction while overriding the opacity in the compact
   balance mode so it matches the frame?

## Implementation Steps

Figma node ids below are from `get_metadata` / `get_design_context` on frame `6701:97136`
(2026-10-12); geometry is quoted against the 1136px content box.

1. **`packages/frontend/src/components/homeState.ts`** — extend `HomeState` with
   `"funded-staked"` and add the branch directly after the `"plusd-held"` check:

   ```
   isConnected && lpRead === "loaded" && kybStatus === "Passed" && plusdIsZero && !splusdIsZero
   ```

   Nothing else changes; the file's single spec-pointer header stays its only comment.

2. **`packages/frontend/src/components/homeState.test.ts`** — add a
   `deriveHomeState — funded-staked (#1425)` block: the positive case; `plusdIsZero: false` →
   `"plusd-held"`; `splusdIsZero: true` → `"legacy"`; `isConnected: false` → `"legacy"`;
   `lpRead` `"unknown"` / `"error"` / `"absent"` → `"legacy"` / `"unverified"` as the existing rules
   dictate; `hasSession: false` → `"zero"`; and the neighbouring-`kybStatus` sweep
   (`NotStarted` / `UnderReview` / `ChangesRequested` / `Failed` / `InProgress` → `"legacy"`).

3. **`packages/frontend/src/components/PortfolioPlaceholderCard.tsx`** — add
   `"earning"` to `PortfolioPlaceholderCardVariant` and `NODE_IDS` (`6701:97247`). It joins the
   compact family (`isCompact`, `padding="md"`, `h-[274px]`, Body 16/22 primary-ink eyebrow
   "Total Balance", heading `balanceLabel` at Heading M 28/36, 4px gap). Its sub-line is
   `unrealizedPnlLabel` rendered at **Body 16/22** (not the `balance` variant's Caption 12/16) in
   `--color-pipeline-chart-positive` when the label starts with `+`, otherwise
   `--color-pipeline-ink` — the same `+`-prefix rule `EarnedCard.pnlValueClasses` already uses.
   Node `I6701:97247;1100:72482;6539:2331`. No link, no Connect-wallet / Get-PLUSD control. The
   chart block, tabs and axes are the shared compact rendering, unchanged.

4. **`packages/frontend/src/components/StakeCard.tsx`** — in the `layout === "compact"` branch, add a
   staked-balance mode keyed on the existing `mobileHomeState === "splusd"` prop (so the compact
   card reuses the State C contract rather than inventing a second one). Card: `h-[164px]`,
   `padding="md"`, `flex-col justify-between`, `data-node-id="6701:97273"`. Header
   (`6701:97274`): eyebrow `Staked PLUSD` Body 16/22 primary ink (`6701:97275`); heading
   `formatBigintNumber(mobileSplusdShares, splusdDecimals)` at Heading 20 (`6701:97280`); sub-line
   (`6701:97281`) = `CoinIcon token="splusd"` at 16px + Caption 12/16 ink-muted
   `` `${formatBigintNumber(mobileSplusdInPlusd, splusdDecimals)} sPLUSD${splusdUsdValue ? ` · ${splusdUsdValue}` : ""}` ``
   — byte-identical to the shipped State C sub-line. Buttons row (`6701:97285`), 8px gap:
   `Button variant="primary-blue" size="m"` labelled `Stake More` (`6701:97286`, 118×40) then
   `Button variant="secondary" size="m"` labelled `Unstake` (`6701:97287`, 94×40). Note the order
   is the reverse of the legacy State C card (Unstake link left, circular CTA right). The existing
   compact marketing mode (`Stake PLUSD` / `Earn … p.a.` / single CTA) must be untouched when
   `mobileHomeState` is not `"splusd"`.

5. **`packages/frontend/src/components/EarnedCard.tsx`** — in the `isCompact` branch only: when
   `earnedPnlLabel !== undefined`, render the label as `Earned` (node `6701:97306`) and append a
   right-hand icon box (`6701:97313`, `flex items-center p-2`) holding `hint.svg` at 20×20 —
   import it as `import hintUrl from "../assets/hint.svg?url"` and render
   `<img src={hintUrl} alt="" width={20} height={20} />`, the same way `FundingDetailsModal.tsx`
   already does. Decorative only: no tooltip, no handler. With no `earnedPnlLabel` the compact card
   keeps `Earnings` / `Tracked once you stake` and renders no icon, exactly as states 1–4 ship
   (their `Earned Icon` frame is `hidden` in Figma — e.g. `6701:97517` on the state-4 frame).
   The default (non-compact) layout is unchanged.

6. **`packages/frontend/src/routes/index.tsx`** — add a `homeState === "funded-staked"` branch
   after `"plusd-held"`, built from the `"plusd-held"` branch with four swaps. Grid classes
   (`grid w-full grid-cols-7 gap-4`) and `data-testid`s stay as in the sibling branches:

   | Slot | Grid position | Content |
   | --- | --- | --- |
   | Portfolio | `col-span-4 row-start-1` | `PortfolioPlaceholderCard variant="earning"` with `balanceLabel={splusdBalanceFormatted}` and `unrealizedPnlLabel={earningPnlFormatted}` (new const, see below), plus the existing chart props. Node `6701:97247`, 642×274 at (32,32). |
   | Recent activity | `col-span-3 col-start-5 row-span-2 row-start-1` | `RecentActivityCard padding="md"` inside the existing absolute wrapper — unchanged. Node `6701:97315`, 477.71×634 at (690.29,32). |
   | Balances | `col-span-2 col-start-1 row-start-2`, `data-node-id="6701:97257"` | `StartHereCard layout="compact" compactVariant="balance" compactBalanceLabel={plusdFormattedActive}` (node `6701:97258`) + `StakeCard layout="compact" mobileHomeState="splusd"` with `mobileSplusdShares`, `mobileSplusdInPlusd`, `splusdUsdValue`, `splusdDecimals` (node `6701:97273`). |
   | AddUsd | `col-span-2 col-start-3 row-start-2`, `data-node-id="6701:97288"` | `AddUsdCard variant="funded" className="flex-1"` (node `6701:97289`, 313.14×246) + `EarnedCard layout="compact" earnedPnlLabel={earnedPnlLabel}` (node `6701:97304`, 313.14×82). |
   | QnaSection | `col-span-7 col-start-1 row-start-3` | FAQ strip 1136×89, node `6701:97248` — unchanged. |

   Route-level additions: one new const
   `formatRawDecimalUSD(pnl.data?.total_unrealized_pnl, activeDecimals, { signed: true, suffix: "earning" })`
   for the Total Balance sub-line (the frame reads `+$42.80 earning`; the existing
   `unrealizedPnlFormatted` keeps its `"unrealized"` suffix for mobile and the legacy grid, which
   are untouched). `earnedPnlLabel` already resolves in this state —
   `deriveMobileHomeState` returns `"splusd"` whenever sPLUSD is non-zero — so no new PnL wiring is
   needed for the Earned card. `onStake`, `onUnstake`, `onBuy`, `onSell`, `sellDisabled` and
   `onAddFunds` are the existing handlers; `onAddFunds` keeps opening `FundingDetailsModal` with no
   `details`. `onWithdraw` and `usdBalanceLabel` follow Open Questions 1 and 2.

7. **Figma verification** (required) — re-run `get_screenshot` / `get_design_context` on
   `6701:97136`, `6701:97247`, `6701:97257`, `6701:97288`, `6701:97315` and compare against the
   rendered desktop grid. Geometry to confirm: row 1 = 274, row 2 = 344 in both stacks
   (164 + 16 + 164 on the left, 246 + 16 + 82 on the right), columns 642.28 / 477.71 / 313.14 inside
   the 1136px content box, Add Funds circle 128×128 bottom-right of its card with the `Withdraw`
   link bottom-left, `Stake More` 118×40 + `Unstake` 94×40, `Buy` / `Sell` 61×40 each at 8px gap,
   `View All` 126×48, FAQ strip 1136×89.

8. **Lint / build / test gate** — `npx tsx scripts/lint-docs.ts`,
   `yarn workspace @pipeline/frontend lint`, `yarn workspace @pipeline/frontend build`,
   `TZ=UTC yarn workspace @pipeline/frontend test`, plus `cargo clippy --all -- -D warnings` and
   `cargo test --all` (no Rust is touched; run them per the coder gate).

## Test Strategy

- **Unit — `packages/frontend/src/components/homeState.test.ts`**: the derivation cases of step 2,
  including every neighbouring combination that must fall through to `"legacy"`.
- **Component — `StakeCard.test.tsx`**: new tests for `layout="compact"` +
  `mobileHomeState="splusd"` — the `Staked PLUSD` eyebrow, the formatted share heading, the
  sPLUSD sub-line with and without `splusdUsdValue`, Stellar decimals (`splusdDecimals={7}`, the
  #688 scale guard), both buttons present and enabled, and `onStake` / `onUnstake` firing from the
  right one. Plus a regression assertion that compact **without** `mobileHomeState="splusd"` still
  renders `Stake PLUSD` / `Earn … p.a.` / the single CTA, and that the default layout's State C
  rendering is unchanged.
- **Component — `EarnedCard.test.tsx`**: compact with a `+`-prefixed label renders `Earned`, the
  positive token and the hint image; compact with no label still renders `Earnings` /
  `Tracked once you stake` and **no** image; the default layout with a label still renders
  `Earnings` (the existing three tests must keep passing untouched).
- **Component — `PortfolioPlaceholderCard.test.tsx`**: the `earning` variant renders the
  `Total Balance` eyebrow, the served heading, the PnL sub-line at Body size with the positive
  token for a `+` label and ink for a `-`/zero label, and renders no link, no `Connect wallet` and
  no `Stake PLUSD or Add USD to start earning` sentence.
- **Route — `packages/frontend/src/routes/-index.test.tsx`** (follow the existing
  #1421/#1422/#1423/#1424 route tests): with a session, connected wallet, `kyb_status: "Passed"`,
  zero PLUSD and non-zero sPLUSD, assert the grid renders `data-variant="earning"`, the compact
  PLUSD-balance card, the compact staked card with `Stake More` + `Unstake`, the `funded`
  `AddUsdCard` (`data-variant="funded"`) and the compact `EarnedCard` with its served value;
  clicking `Add Funds` opens the funding-details modal; `Stake More` navigates to
  `/stake?tab=stake` and `Unstake` to `/stake?tab=unstake`. Then assert each neighbouring
  combination still renders its existing branch: PLUSD non-zero → `"plusd-held"`, sPLUSD zero →
  `"kyb-pending"` or `"legacy"` as applicable, disconnected → `"legacy"`, `UnderReview` →
  `"kyb-pending"`, unresolved `lpRead` → `"legacy"`.
- **Mobile regression**: at <768px an LP in this state still gets the existing mobile stack
  (`deriveMobileHomeState` → `"splusd"`): no `Earned` label, no hint glyph, no compact staked card
  with rectangular buttons.
- **Figma verification** (required, frame `6701:97136`): step 7 above.
- **Suite**: `/test-fast` (lint + unit + integration) must be green before the PR.

## Docs to Update

- `docs/product-specs/home-screen-states.md` — flip state 5 to Implemented (#1425); add its
  precedence paragraph (all six conditions, which neighbouring combinations fall through to
  `"legacy"`, and the explicit statement that "bank transfer received" is **not** an independently
  served input — the resolution of Open Question 1); extend the card-composition section to a
  states 1–5 table covering the staked card, the `funded` AddUsdCard and the `Earned` label swap;
  record that the Total Balance heading keeps the served sPLUSD binding despite the frame's
  `$2,000.00` and its "PLUSD + sPLUSD + USD balance" dev annotation, carrying forward the #1424
  decision.
- `docs/frontend/dashboard-components.md#home-route` — the sixth branch table (slot / grid position
  / content with Figma node ids); the new `PortfolioPlaceholderCard` `earning` variant; the
  `StakeCard` compact staked-balance mode; the `EarnedCard` compact served-PnL rendering; and the
  `deriveHomeState` paragraph (new union member and precedence clause).
- `docs/frontend/bank-transfers.md` — the `funded` variant is no longer preview-only: update the
  "`funded` variant is still not wired to any route" sentence, the `AddUsdCard` variant list, and
  the Seams table rows for `AddUsdCard.onWithdraw` and `usdBalanceLabel` per the answers to Open
  Questions 1 and 2.
- `docs/user-stories/epic-1419/1425-home-funded-staked-state.md` — new, modelled on
  `1424-home-plusd-held-state.md`: the state-5 grid, the staked card's two CTAs, the `funded`
  AddUsdCard and its Withdraw link, the Earned card, the neighbouring fall-through states, the
  deliberate frame deviations, and mobile unchanged.
- `docs/exec-plans/tech-debt-tracker.md` — add an entry if Open Question 1 or 2 is resolved as a
  known gap (a `—` USD balance, or an inert Withdraw link, both pending #1285).
