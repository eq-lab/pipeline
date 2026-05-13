---
title: Default management
order: 35
section: Risk management
---

# Default management

If a loan defaults, Pipeline is designed to manage the event through multiple layers of protection. The equity tranche absorbs first-loss risk, while the mechanisms below address escalating levels of severity.

## Loan states

Every loan moves through four states in fixed order: Performing, Watchlist, Default, Closed.

The Trustee can promote a loan into Watchlist and demote it back to Performing as conditions change. The Trustee cannot mark a loan as Default. Only RISK_COUNCIL can propose that transition, and the call runs through a 3-day timelock. GUARDIAN can cancel during the window.

A loan's collateral coverage ratio (CCR) is collateral value divided by outstanding senior principal. When CCR crosses 130, 120, or 110, the Trustee and the Originator receive staged notifications and the Originator has a defined window to post additional margin. A sustained breach, or a missed repayment past the payment-delay thresholds (amber over 7 days late, red over 21 days late), is the typical route to a Default proposal.

{% include chart.html src="boss-ccr-thresholds.png" caption="CCR thresholds. Margin call below 110, maintenance margin call below 120, watchlist below 130, healthy at or above 130." %}

Closure authority by reason:

| Closure reason | Who can close | Delay |
|---|---|---|
| ScheduledMaturity | Trustee | 0 |
| EarlyRepayment | Trustee | 0 |
| Default | RISK_COUNCIL only | 3 days |
| OtherWriteDown | RISK_COUNCIL only | 3 days |

A write-down closure is not reversible. Once a loan closes with Default or OtherWriteDown, the recorded loss is final and feeds the waterfall.

## Single-facility default

### Triggers

A loan is declared in default when one of the following fires:

- Missed scheduled payment beyond the cure window
- Material covenant breach uncured within the contractual window
- Collateral seizure, fraud discovery, or CMA breach
- Force majeure beyond the covered insurance window
- Sanctions hit on a counterparty

### Declaration

RISK_COUNCIL calls `setDefault` on LoanRegistry (3-of-5, 3-day timelock, GUARDIAN-cancelable). Lifecycle state moves to "in default" and the workout commences.

### Workout

1. Counsel issues default notices and reservation-of-rights letters.
2. Collateral Trust enforces the security package — bills of lading, warehouse receipts, CMA agreements.
3. Pre-onboarded liquidators move cargo to recovery sale through the Partner Liquidation Network.
4. Recovered proceeds flow back to LoanRegistry; the loss waterfall applies.

## Loss waterfall

The waterfall differs between MVP and post-MVP.

**MVP** — two layers:

| Layer | Source | Mechanic |
|---|---|---|
| **1. Equity tranche** | Originator first-loss capital (up to 30% of facility) | Absorbed in full before any senior dollar is touched. Held off-chain in escrow at funding. |
| **2. Recovery on the WithdrawalQueue** | RISK_COUNCIL-set exchange coefficient | Every claim pays out at `face_value × coefficient` where `coefficient < 1.0`. Applies identically to PLUSD direct-redeem and sPLUSD-unstake-then-redeem. Ratchets up only as recoveries land. |

In MVP there is no sPLUSD share-price writedown step, and no separate ShutdownController/RecoveryPool engagement. Any loss past the equity tranche flows through the WithdrawalQueue coefficient. PLUSD and sPLUSD continue to operate normally; the haircut applies at the queue.

**Post-MVP** — three layers, added after the audit and hardening period:

| Layer | Source | Mechanic |
|---|---|---|
| **1. Equity tranche** | Originator first-loss capital | Absorbed in full before any senior dollar is touched. |
| **2. sPLUSD share-price writedown** | Pro-rata haircut on sPLUSD share price | Residual loss reduces share price across all sPLUSD holders proportionally. PLUSD holders unaffected as long as the cushion is enough. |
| **3. Pipeline Recovery Tokens (PRT)** | Tradable ERC-20 IOU issued to PLUSD holders pro-rata | If loss exceeds equity AND sPLUSD cushion: every holder's PLUSD-equivalent balance is reduced pro-rata, and 1 PRT is issued for every $1 of reduction. 1 PRT = $1 face claim against the Recovery Pool. Freely transferable. Redemption rate is `pool.balance / totalSupply(PRT)`, capped at 1.0, ratchets up only. |

## Recovery mechanics in MVP

Pipeline's recovery in MVP is the WithdrawalQueue exchange coefficient. No race, no queue jump, no manager discretion at the redemption rate.

### Trigger and execution

RISK_COUNCIL proposes a recovery rate `r` (for example, 0.85) reflecting the recoverable value per dollar of outstanding PLUSD. RISK_COUNCIL executes via timelocked call — 3-day delay, GUARDIAN-cancelable.

From that block on, every claim through the WithdrawalQueue pays out USDC at `face × r` instead of `face × 1.0`. There is no path to redeem at face value while the coefficient is below 1.0.

### Ratchet up

As recoveries arrive and the Trustee tops up the Withdrawal Queue Wallet, RISK_COUNCIL adjusts the coefficient up under the same 3-day timelock. When the rate reaches 1.0, normal economics resume. The coefficient never moves down.

There is no separate shutdown contract in MVP. The recovery coefficient on the WithdrawalQueue is the entire mechanism.

## PRT mechanics (post-MVP)

If loss exceeds the equity tranche AND the sPLUSD cushion, the residual is passed to PLUSD holders as Pipeline Recovery Tokens.

RISK_COUNCIL declares the bad-debt amount `D` via timelocked call. At the execution block, every PLUSD holder's balance and every sPLUSD holder's PLUSD-equivalent (`shares × pricePerShare`) is reduced pro-rata by their share of `D`. Each holder receives 1 PRT for every $1 of reduction.

PRT is a standard ERC-20. No whitelist. No yield accrual. 1 PRT = $1 face claim against the Recovery Pool.

As the Trustee deposits recovered USDC into the Recovery Pool, the redemption rate becomes `pool.balance / totalSupply(PRT)`, capped at 1.0. A holder calls `RecoveryPool.redeem(amount)` and receives `amount × currentRate` USDC. Their PRT burns. The rate ratchets up only.

PRT is freely transferable. A holder who needs cash now can sell PRT on the secondary market. A holder who wants recovery upside can hold and redeem later. PLUSD and sPLUSD continue to operate normally on the post-haircut balances.
