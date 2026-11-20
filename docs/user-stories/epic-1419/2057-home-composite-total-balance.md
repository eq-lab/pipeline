# User Stories: #2057 — Home: Total Balance headline and graph on the served composite total_balance

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#2057](https://github.com/eq-lab/pipeline/issues/2057)
Spec: [docs/product-specs/lp-total-balance.md](../../product-specs/lp-total-balance.md),
[docs/product-specs/home-screen-states.md](../../product-specs/home-screen-states.md),
[docs/frontend/dashboard-components.md](../../frontend/dashboard-components.md#portfolioplaceholdercard)
Figma (styles only): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6701-97136&m=dev
— node `6701:97136` (state 5, funded Total Balance card)

The card chrome is unchanged. The only visible addition is the ` · incl. PLUSD` suffix inside the
existing `Total Balance` eyebrow. The suffix wording is the planner's choice and is reviewable on the PR.

---

## Story 1: The headline equals the last bucket

**Persona:** A signed-in LP with a connected wallet whose `GET /v1/positions/history` serves `total_balance`.

**Steps:**
1. Open `/` and read the Total Balance heading (mobile and desktop).
2. Hover the last bar of the chart.

**Expected:**
- The heading is the last served bucket's `total_balance` formatted as USD (for example
  `$1,500.25`), identical to that bar's tooltip value.
- It is not the sPLUSD value; the Stake card still shows its own `convertToAssets` value.
- Switching the period tab keeps the heading and chart on screen while the new window loads.

## Story 2: The total is labelled "incl. PLUSD" when PLUSD is served

**Persona:** Story 1's LP.

**Expected:**
- When the last bucket carries `plusd_balance` (including `0.000000`), the eyebrow reads
  `Total Balance · incl. PLUSD`.
- Without `plusd_balance` the eyebrow reads `Total Balance`.
- A PLUSD-only wallet (state 4) shows the served total with the suffix instead of `$0.00`.

## Story 3: A bucket without the composite is a gap

**Persona:** An LP whose history has a bucket lacking `total_balance`.

**Expected:**
- That bucket draws no bar, and its tooltip reads `—`.
- If it is the last bucket, the headline reads `—`, never the `splusd_value`.

## Story 4: A missing `total_balance` stat draws no Y axis

**Persona:** An LP whose response omits the `total_balance` stat (backend #1960).

**Expected:**
- Bars render without a Y axis.
- No `splusd_value.max` fallback is used.

## Story 5: A zero wallet shows `$0.00`; a non-zero wallet without a composite shows `—`

**Persona:** A connected LP with no served history.

**Expected:**
- When PLUSD and sPLUSD both read zero on chain, the heading is `$0.00`.
- When either is non-zero on chain, the heading is `—`, never a false `$0.00`.

## Story 6: No-wallet states are unchanged

**Persona:** A visitor with no wallet, an unverified LP, or a disconnected `kyb-problem` LP.

**Expected:**
- The mobile Connect Wallet promo, states 1 and 2 and the disconnected `kyb-problem` card render
  as before: `$0.00` zero heading, placeholder chart, no `incl. PLUSD` suffix.
