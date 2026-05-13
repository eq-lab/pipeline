---
title: Investor protection
order: 29
section: Security & Transparency
---

# Investor protection

On every Pipeline loan, average overcollateralization is 20% and the Originator commits first-loss capital. That capital takes the hit before lenders feel a thing.

## Overcollateralization

Every Pipeline loan is structured with cargo value exceeding outstanding principal — typically around 20%, with tighter cushions on higher-risk deals. The cushion is maintained daily against independent price assessments; LTV breaches trigger margin calls with a defined cure window. A loss only reaches the equity tranche if recovery proceeds fall short of principal even after this cushion is exhausted.

## The equity tranche

Every loan is split into two tranches:

| Tranche | Funded by | Sized | Loss order |
|---|---|---|---|
| **Equity** | Originator (first-loss) | Up to 30% of facility | First |
| **Senior** | Pipeline lenders via sPLUSD | ~85% of facility | Second |

The equity tranche is funded ahead of senior draw. It sits in escrow until the loan repays cleanly. If a loss occurs — partial recovery, full default, fraud, force majeure beyond the covered window — the equity tranche absorbs it before any senior dollar is impaired.

## How loss absorption works

#### Loss within equity tranche

On a $20M facility with $3M equity ($17M senior), a loss up to $3M is absorbed entirely by the Originator. Senior lenders are made whole.

#### Loss exceeding equity tranche

Same facility, $4M loss: equity tranche fully exhausted, $1M residual flows to the next protection layer. Senior not yet impaired.

#### Why up to 30%

The asset class has historic loss rates below 0.3%. Even severe single-deal events — fraud, geopolitical disruption, force majeure — typically resolve at recoveries above 60% of facility value once collateral is seized and resold. An up to 30% buffer covers virtually every realistic single-deal loss scenario observed in commodity trade finance over the last two decades.

## Why this is stronger than third-party-only lending

In third-party-only lending, the Originator earns a fee for sourcing the deal but has no capital at risk if the deal fails. The incentive is volume, not selection quality. Pipeline puts the Originator's own money in the first-loss position on every deal they bring.

## Beyond the equity tranche — PLIOU

In the rare case where a loss is severe enough to chew through the equity tranche on a defaulted facility and leave a residual gap, Pipeline has a second contingent layer: PLIOU.

PLIOU is a contingent loss-absorption token. Not part of normal protocol operation. Exists only when a default has been declared, the equity tranche is exhausted, and a residual principal gap remains. In that scenario, The Trust Company may issue PLIOU — a tradable claim sold for PLUSD at a discount to par. The sale absorbs the residual loss in an orderly way and removes excess PLUSD supply from the market. PLIOU is redeemed at par from future protocol revenue (100% of platform performance fees plus a 50bps annualised diversion of the senior coupon) over a 60-month horizon, capped at 10% of PLUSD supply at issuance.

<div class="callout info">
  <h4>PLIOU availability</h4>
  <p>The PLIOU mechanism is part of Pipeline's protocol design and is documented in the White Paper and Credit Policy. The on-chain implementation will be available beyond MVP. Lenders depositing today are protected by the equity tranche described above; the PLIOU layer activates as the next defence when the smart-contract surface is shipped.</p>
</div>

## Beyond PLIOU — terminal mode

If a loss is so severe that it threatens lender principal beyond what the equity tranche and PLIOU can absorb — a scenario without precedent in this asset class — the Risk committee can engage the terminal-mode mechanism. In MVP this is an exchange coefficient less than 1.0 on the WithdrawalQueue, set by RISK_COUNCIL under the 3-day timelock. Every PLUSD holder receives the same USDC fraction `face_value × coefficient`, the rate ratchets up only as recoveries land, no race and no queue jump. See [Default management](/risks/default-management/).

## Concentration limits as protection

Even with the equity tranche, Pipeline limits exposure to any single facility, borrower, offtaker, Originator, commodity, or corridor. Hard concentration ceilings published in [Credit policy overview](/risks/credit-policy/). A single deal cannot represent more than a small fraction of pool capital, so even a complete loss on one facility produces only a small mark on share price.
