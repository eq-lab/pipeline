---
title: Defaults & losses
order: 12
section: Risk & losses
---

# Defaults & losses

Pipeline finances real commodity deals; some of them will eventually go bad.
This page explains how defaults are declared, how losses are absorbed, and
what happens if a loss exceeds the protections in place.

The audience for this page is lenders and auditors who want to understand,
before capital is at stake, exactly what the protocol does on the bad days.
Nothing below is theoretical comfort language. The mechanisms described
are the ones that will actually run.

## What a default is

Every loan sits in one of four states and moves through them in a fixed
order:

```
Performing → Watchlist → Default → Closed
```

The Trustee can promote a loan into Watchlist and demote it back to
Performing as conditions change. The Trustee **cannot** mark a loan as
`Default`. Only the RISK_COUNCIL Safe (3/5) can propose that transition,
and the call runs through a 24h AccessManager timelock before ADMIN
executes it. GUARDIAN can cancel the scheduled transition at any point
inside that 24h window.

{% include chart.html src="c3-ccr-ladder.svg" caption="Collateral coverage thresholds — Watchlist at 130%, Maintenance margin call at 120%, Margin call at 110%. Not live protocol data." %}

A loan's collateral coverage ratio (CCR) is collateral value divided by
outstanding senior principal. When CCR crosses each threshold — 130%,
120%, 110% — the Trustee and the Originator receive staged notifications
and the Originator has a defined window to post additional margin. A
sustained breach, or a missed repayment past the payment-delay
thresholds (amber at more than 7 days late, red at more than 21 days
late), is the typical route to a `Default` proposal.

Closure reasons are split by authority:

| Closure reason      | Who can close      |
|---------------------|--------------------|
| `ScheduledMaturity` | Trustee            |
| `EarlyRepayment`    | Trustee            |
| `Default`           | RISK_COUNCIL only  |
| `OtherWriteDown`    | RISK_COUNCIL only  |

A write-down closure is not reversible. Once a loan is closed with
`Default` or `OtherWriteDown`, the recorded loss is final and flows into
the waterfall below.

The split matters. The Trustee holds a single key and has the
operational bandwidth to close loans at maturity without a timelock.
But write-downs change the vault's share price and therefore every
lender's position, so they are gated behind a multisig with its own
delay. A single compromised Trustee key cannot manufacture a loss; it
can mis-label a scheduled maturity or lie about a repayment, but those
are data-integrity issues that do not move USDC or the sPLUSD share
price. The LoanRegistry is not a NAV source — sPLUSD share price moves
only on actual repayment events flowing through the Capital Wallet.

## Loss waterfall

<div class="callout risk">
<strong>MVP scope.</strong> The MVP's only on-chain response to a loss
exceeding the equity tranche is protocol-wide shutdown. Per-loan loss
handling without shutdown — surgical writedowns, tranche-specific
haircuts, partial IOUs — is post-MVP.
</div>

Losses are absorbed in three layers. The first two are live in MVP; the
third is a planned addition.

1. **Originator equity tranche (first-loss).** Every loan is split into
   a Senior tranche, funded by lenders, and an Equity tranche, funded by
   the Originator and held off-chain against the deal. The Equity
   tranche takes the first loss. If realised losses stay within the
   Equity tranche, PLUSD and sPLUSD holders are whole — lenders see no
   hit to share price.

2. **sPLUSD share-price writedown.** If the loss exceeds the Equity
   tranche, the remainder is absorbed at the vault level: the sPLUSD
   share price writes down. sPLUSD holders take their pro-rata share of
   the residual loss. This is the mechanism by which stakers bear
   credit risk in return for carry. PLUSD holders are shielded as long
   as the sPLUSD cushion absorbs the entire excess.

3. **IOU to PLUSD (deferred post-MVP).** Losses that exceed the combined
   Equity tranche and sPLUSD cushion would issue an IOU token to PLUSD
   holders for the residual, redeemable against future recoveries.
   **This layer is not implemented in MVP.** At MVP, a loss severe
   enough to chew through both prior layers does not issue an IOU — it
   routes to shutdown.

At MVP, the practical response to a severe loss is protocol-wide
shutdown, not a surgical per-loan resolution. If a single loan's loss
would eat past the sPLUSD cushion, RISK_COUNCIL's realistic lever is to
propose shutdown at a recovery rate that reflects what USDC is actually
recoverable, and let every holder exit at the same per-unit haircut.

This is a deliberate MVP trade-off. A per-loan IOU layer adds a second
accounting track — tracking residual claims per holder per defaulted
loan — and a second redemption surface. That is material code the team
has chosen not to ship before a security budget is established for it.
Until the post-MVP IOU layer lands, the protocol prefers the simpler,
auditable behaviour: one loss threshold, one terminal mode, one rate.

## Shutdown — the terminal wind-down

{% include diagram.html src="d7-shutdown.svg" caption="Shutdown — one-way entry at a fixed recovery rate, three exit paths (direct PLUSD, sPLUSD two-step, queued LP), rate ratchets up only." %}

Shutdown is a one-way terminal declaration. It is not a pause — pause is
reversible; shutdown is a programmatic wind-down at a fixed recovery
rate. The eight on-chain steps:

<ol class="steps">
<li>RISK_COUNCIL calls <code>proposeShutdown(recoveryRateBps)</code>. The rate is chosen to match the RecoveryPool USDC balance actually available at execution — there is no pre-fund, so the number honestly reflects what is in the pool.</li>

<li>A 24h AccessManager delay runs. GUARDIAN can cancel the proposed shutdown at any point inside that window.</li>

<li>ADMIN calls <code>executeShutdown()</code>. <code>isActive</code> flips to true, <code>recoveryRateBps</code> is fixed, and <code>totalSupplyAtEntry</code> is snapshotted. Normal deposits and the standard withdrawal queue are frozen.</li>

<li>PLUSD holders exit directly via <code>redeemInShutdown(amount)</code>. Each PLUSD redeemed pays <code>amount × rateBps / 10_000</code> USDC out of RecoveryPool. First-come is not first-served in the payout sense — everyone gets the same per-unit rate.</li>

<li>sPLUSD holders exit in two steps: <code>sPLUSD.redeem(shares)</code> to get PLUSD (the vault stays unpaused post-shutdown specifically to keep this open), then <code>PLUSD.redeemInShutdown</code> for USDC at the frozen rate.</li>

<li>LPs with a pre-shutdown withdrawal queue entry call <code>claimAtShutdown(queueId)</code>. The same haircut applies symmetrically to Pending and Funded entries, so early requesters do not get a better rate than later ones. This closes the queue-jump exploit class.</li>

<li>Per-unit payout math: every PLUSD redeemed during shutdown — direct, via sPLUSD, or via the queue — pays the same USDC fraction. There is no race and no queue jump. The rate is the only variable, and it is fixed at execution.</li>

<li>As the Trustee repatriates more USDC to RecoveryPool over weeks or months, RISK_COUNCIL can call <code>adjustRecoveryRateUp</code> under a 24h timelock. The rate can only go <strong>up</strong>, never down. Holders who already exited at a lower rate do not get retroactive top-ups; holders who wait benefit from any upward adjustments before they redeem.</li>
</ol>

The monitoring invariant across the wind-down is that
`recoveryRateBps × outstandingPlusd / 10_000` never exceeds
`RecoveryPool.balance() + pendingTrusteeInflows`. If Watchdog observes
that invariant breaking, GUARDIAN can pause the redemption surfaces
while the discrepancy is investigated.

There is no path for PLUSD or sPLUSD share price to move post-shutdown.
The recovery rate is the only lever.

A few properties worth stating explicitly:

- **Shutdown is one-way.** `isActive` is never reset. There is no
  resume-normal-operations path. If shutdown was declared in error,
  the remedy is to ratchet the recovery rate up to par and let holders
  redeem at 100%.
- **No forced conversion.** sPLUSD holders are not auto-converted to
  PLUSD at execution. They redeem voluntarily in two steps at the time
  of their choosing, so their sPLUSD continues to accrete any
  repayments that land between shutdown entry and their exit.
- **No queue jump.** Holders who queued for withdrawal before shutdown
  do not get a better rate than holders who redeem directly
  post-shutdown. The haircut is symmetric.
- **RecoveryPool is the only USDC source.** PLUSD redemptions draw
  from RecoveryPool and only RecoveryPool. Any USDC the Trustee
  repatriates as loans wind down is routed into RecoveryPool first.

## Historical events

No defaults or shutdowns have occurred in the protocol's history. At
MVP launch this is trivially true because the protocol is not yet
operational. Future events will appear here with dates, affected loans,
loss amounts, and realised outcomes for each tranche. This page exists
to be updated, not to pretend losses are impossible.

The commitment is specific: every `Default` or `OtherWriteDown`
closure, and every shutdown proposal (whether executed or cancelled),
will be listed with the on-chain transaction, the originator involved,
the principal and recovery amounts, and the dollar impact on sPLUSD
share price. Cancelled shutdown proposals will be listed alongside the
reason and the GUARDIAN member who cancelled. Losses are a fact of
credit; opacity about them is a choice, and this page is where that
choice goes the other way.

## Related reading

- [Risks](/pipeline/risks/)
- [Emergency response](/pipeline/security/emergency-response/)
- [Supply safeguards](/pipeline/security/supply-safeguards/)
