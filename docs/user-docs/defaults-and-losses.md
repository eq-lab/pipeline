---
title: Default management
order: 12
section: Potential risks
---

# Default management

Pipeline finances real commodity deals. Some of them will go bad. This page describes what happens when they do.

## Loan states

Every loan moves through four states in fixed order: Performing, Watchlist, Default, Closed.

The Trustee can promote a loan into Watchlist and demote it back to Performing as conditions change. The Trustee cannot mark a loan as Default. Only RISK_COUNCIL can propose that transition, and the call runs through a 3-day timelock. GUARDIAN can cancel during the window.

{% include chart.html src="c3-ccr-ladder.svg" caption="CCR thresholds. Watchlist at 130, Maintenance margin call at 120, Margin call at 110. Not live protocol data." %}

A loan's collateral coverage ratio (CCR) is collateral value divided by outstanding senior principal. When CCR crosses 130, 120, or 110, the Trustee and the Originator receive staged notifications and the Originator has a defined window to post additional margin. A sustained breach, or a missed repayment past the payment-delay thresholds (amber over 7 days late, red over 21 days late), is the typical route to a Default proposal.

Closure authority by reason:

| Closure reason | Who can close | Delay |
|---|---|---|
| ScheduledMaturity | Trustee | 0 |
| EarlyRepayment | Trustee | 0 |
| Default | RISK_COUNCIL only | 3 days |
| OtherWriteDown | RISK_COUNCIL only | 3 days |

A write-down closure is not reversible. Once a loan closes with Default or OtherWriteDown, the recorded loss is final and feeds the waterfall.

## Loss waterfall

The waterfall differs between MVP and post-MVP.

**MVP** (two layers):

1. Equity tranche (first-loss, off-chain)
2. Shutdown: recovery rate on the WithdrawalQueue

**Post-MVP** (three layers):

1. Equity tranche (first-loss, off-chain)
2. sPLUSD share-price writedown
3. IOU tokens (Pipeline Recovery Tokens)

In MVP there is no sPLUSD writedown step. Any loss past the equity tranche triggers shutdown.

## Shutdown (MVP)

When the loss exceeds the equity tranche, RISK_COUNCIL initiates shutdown by setting a recovery rate on the WithdrawalQueue.

The Trustee proposes a recovery rate `r` (for example, 0.85) reflecting the recoverable value per dollar of outstanding PLUSD. RISK_COUNCIL executes via timelocked call. 3-day delay, GUARDIAN can cancel.

From that block on, every claim pays out USDC at `face * r` instead of `face * 1.0`. The rate applies the same way to PLUSD direct-redeem and sPLUSD-unstake-then-redeem. There is no path to redeem at face value while the rate is below 1.

The recovery rate ratchets up only. As recoveries arrive and the Trustee tops up the Withdrawal Queue Wallet, RISK_COUNCIL adjusts the rate up under the same 3-day timelock. When the rate reaches 1.0, normal economics resume.

There is no separate shutdown contract. The recovery rate on the WithdrawalQueue is the entire mechanism.

## IOUs (post-MVP)

After the audit and hardening period, the post-MVP waterfall replaces the MVP shutdown. Losses now flow through three layers: equity tranche, then sPLUSD writedown, then IOU tokens.

If the loss exceeds the equity tranche, the remainder writes down sPLUSD share price. sPLUSD holders absorb their share of the loss as the price they pay for the senior coupon. PLUSD holders are unaffected as long as the cushion is enough.

If the loss exceeds the equity tranche AND the sPLUSD cushion, the residual is passed to PLUSD holders as IOU tokens (Pipeline Recovery Tokens, PRT).

RISK_COUNCIL declares the bad-debt amount `D` via timelocked call. At the execution block, every PLUSD holder's balance and every sPLUSD holder's PLUSD-equivalent (`shares * pricePerShare`) is reduced pro-rata by their share of `D`. Each holder receives 1 PRT for every $1 of reduction.

PRT is a standard ERC-20. No whitelist. No yield accrual. 1 PRT = $1 face claim against the Recovery Pool.

As the Trustee deposits recovered USDC into the Recovery Pool contract, the redemption rate becomes `pool.balance / totalSupply(PRT)`, capped at 1.0. A holder calls `RecoveryPool.redeem(amount)` and receives `amount * currentRate` USDC. Their PRT burns. The rate ratchets up only. A holder who redeems at 0.5 cannot retroactively claim if the rate later reaches 0.7.

PRT is freely transferable. A holder who needs cash now can sell PRT on the secondary market. A holder who wants recovery upside can hold and redeem later.

PLUSD and sPLUSD continue to operate normally on the post-haircut balances. They earn yield, withdraw, and trade as before.

## History

No defaults have occurred in the protocol's history. At MVP launch this is trivially true because the protocol is not yet operational. Future events will appear here with the on-chain transaction, the originator involved, the principal and recovery amounts, and the dollar impact on holders.

## Related

- [Potential risks](/risks/)
- [Emergency response](/security/emergency-response/)
- [Supply safeguards](/security/supply-safeguards/)
