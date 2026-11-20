# User Stories: #1819 — Home: show the "Transfers unlocked / Add Funds" card for every signed-in, wallet-connected, KYB-passed LP

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1819](https://github.com/eq-lab/pipeline/issues/1819)
Spec: [docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md) (states 4a / 4b),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#home-route),
[docs/frontend/bank-transfers.md](../../frontend/bank-transfers.md#addusdcard)
Figma (desktop): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97494&m=dev
— node `6701:97494` (`card-horizontal`: "Add USD" / "Use a bank transfer" / "Transfers unlocked" / `Add Funds`)

These states render only on the desktop (`md+`) grid. Mobile keeps today's `isConnected`-only stack
unchanged (decision recorded on #1421, reapplied through #1460).

The card itself shipped with state 4 (#1424) and is unchanged; this issue widens where it renders.
No Figma frame draws the two new combinations as a whole: 4a reuses state 3's grid geometry
(`6701:98417`) with one card swapped, 4b reuses state 5's grid geometry (`6701:97136`) with the
`unlocked` card standing in for `funded` (#1820) and the compact marketing Stake card standing in
for the compact staked-balance card (#1425, TD-161). QA compares the card against node `6701:97494`
and the grid occupancy against those frames.

Deliberate deviations, expected by QA:

- 4b shows no staked-value line and no `Unstake` button on the home grid (both on `/stake`) until
  #1425 ships — user decision 2026-11-02, option (a).
- The Add Funds modal still opens with every row `—` until #1817 wires `GET /v1/lps/me/payment-details`.

---

## Story 1: A verified LP with an empty wallet sees "Transfers unlocked" (state 4a)

**Persona:** An LP who signed in, passed KYB, connected a wallet and holds neither PLUSD nor sPLUSD.

**Pre-conditions:**
- A valid session exists.
- `GET /v1/lps/me` resolves with `kyb_status: "Passed"`.
- A wallet is connected (EVM or Stellar view).
- PLUSD and sPLUSD both render as zero at two decimal places.
- Desktop viewport (≥768px wide).

**Steps:**
1. Open `/`.

**Expected:**
- The col 3–4 row 2 stack (`home-add-usd-stack`, `data-node-id="6701:97493"`) holds the
  `AddUsdCard` with `data-variant="unlocked"` and `data-node-id="6701:97494"`: eyebrow "Add USD",
  heading "Use a bank transfer", caption "Transfers unlocked", circular `Add Funds` enabled. Below
  it the compact Earnings card.
- The hero is the `get-plusd` Total Balance card with the served `$0.00`.
- The col 1–2 stack holds the compact Buy/Sell card (Buy enabled, Sell disabled) and the compact
  Stake card (disabled, "Nothing to Stake").
- Recent activity (`padding="md"`) and the FAQ strip are unchanged from state 3.

## Story 2: Add Funds opens the funding details modal (4a and 4b)

**Persona:** Story 1's LP.

**Steps:**
1. Click `Add Funds` on the card.

**Expected:**
- `FundingDetailsModal` opens (`funding-details-modal`); every bank row renders `—` (no served
  details until #1817). Dismissing it returns focus to the grid.

## Story 3: A verified LP holding sPLUSD and no PLUSD sees "Transfers unlocked" (state 4b)

**Persona:** An LP who signed in, passed KYB, connected a wallet, staked everything (sPLUSD > 0,
PLUSD = 0).

**Pre-conditions:** as Story 1, but sPLUSD renders non-zero and PLUSD renders zero.

**Steps:**
1. Open `/`.

**Expected:**
- `home-add-usd-stack` has `data-node-id="6701:97288"` and holds the `unlocked` card (same copy as
  Story 1) above the compact Earnings card, which shows the served total PnL when `GET /v1/pnl`
  serves one.
- The hero is the connected Total Balance card: the sPLUSD position in PLUSD (`convertToAssets`
  read, `—` while unavailable), the unrealized PnL line and the chart. It is **not** the
  "Stake PLUSD or Add USD to start earning" sentence.
- `home-balances-stack` has `data-node-id="6701:97257"`: the compact Buy/Sell card with the default
  "Get PLUSD" copy (Sell disabled) and the compact Stake card with its APY copy (Stake disabled).
- No staked-value line and no `Unstake` on the grid (TD-161); `/stake?tab=unstake` still works.

## Story 4: A verified LP holding both PLUSD and sPLUSD (state 4b, balance mode)

**Persona:** Story 3's LP who also holds PLUSD.

**Pre-conditions:** as Story 3, but PLUSD also renders non-zero.

**Steps:**
1. Open `/`.

**Expected:**
- Same grid as Story 3, except the compact Buy/Sell card is in balance mode: "PLUSD Balance" with
  the served PLUSD amount, Buy and Sell both enabled (the state-4 tinted-Buy / ink-muted-Sell pair).
- The compact Stake card's `Stake` is enabled.
- The `unlocked` card is present and enabled.

## Story 5: State 4 is unchanged

**Persona:** An LP who signed in, passed KYB, connected a wallet, holds PLUSD and no sPLUSD.

**Steps:**
1. Open `/`.

**Expected:**
- Exactly the #1424 grid: hero `stake-or-add-usd` (`6701:97451`), balance-mode Buy/Sell, enabled
  Stake, `unlocked` card in the `6701:97493` stack. Nothing from this issue changes it.

## Story 6: Undesigned `Passed` combinations keep the legacy layout

**Persona:** A `Passed` LP with the wallet **disconnected**; separately, a connected LP whose
`GET /v1/lps/me` read failed.

**Steps:**
1. Open `/`.

**Expected:**
- No `AddUsdCard` on the grid; the pre-#1419 wallet-connection-driven layout renders (Connect
  Wallet promo for the disconnected LP, the full StakeCard grid for the failed read). An in-flight
  LP read shows the loading skeleton (#1576).

## Story 7: Mobile is unchanged

**Persona:** Any of the LPs above on a viewport narrower than 768px.

**Steps:**
1. Open `/`.

**Expected:**
- The mobile stack renders per `isConnected` and the mobile balance state only; no `AddUsdCard` is
  added on mobile.
