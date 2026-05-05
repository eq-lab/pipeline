---
title: Withdraw
order: 9
section: For Lenders
---

# Withdraw

Withdraw by unstaking sPLUSD to PLUSD, escrowing the PLUSD into the WithdrawalQueue, and claiming USDC yourself. The claim transaction burns your PLUSD and pulls USDC from the Withdrawal Queue Wallet via the queue contract's pre-approved allowance. Atomic, in a single call, with no off-chain signer in the critical path.

{% include diagram.html src="d5-withdraw-settle.svg" caption="Withdraw to settle. FIFO escrow, user-pulled claim from the Withdrawal Queue Wallet via pre-approved allowance. Claim burns PLUSD and pays USDC atomically." %}

## Flow

<ol class="steps">
  <li>Unstake sPLUSD by calling <code>sPLUSD.redeem(shares)</code>. PLUSD returns to your wallet. Skip if you already hold PLUSD.</li>
  <li>Call <code>WithdrawalQueue.requestWithdrawal(amount)</code>. Your PLUSD moves into the queue's escrow, a <code>queue_id</code> is assigned, and the queue's <code>totalRequested</code> aggregate increases. You must still be whitelisted with a fresh KYB screen.</li>
  <li>Call <code>WithdrawalQueue.claim(queueId)</code> yourself when you're ready. The queue contract checks <code>claimAmount ≤ totalClaimable</code>, calls <code>USDC.transferFrom(WithdrawalQueueWallet, you, amount)</code> against the queue's standing allowance from the Withdrawal Queue Wallet, burns your escrowed PLUSD, and increments <code>totalClaimed</code>. All in the same transaction.</li>
</ol>

<div class="callout info">
<strong>Self-pulled.</strong> No Relayer signature, no off-chain step, no waiting for an external party to fund your entry. The Withdrawal Queue Wallet is topped up periodically by the Trustee and Team from the Capital Wallet under the 3-of-5 cosigner quorum. As long as the wallet has USDC and the queue has allowance against it, you can claim immediately.
</div>

## Queue aggregates

The WithdrawalQueue tracks three numbers that bound everything:

| Aggregate | What it is |
|---|---|
| `totalRequested` | Cumulative PLUSD escrowed across all withdrawal requests ever submitted |
| `totalClaimed` | Cumulative USDC paid out (equals cumulative PLUSD burned via claim) |
| `totalClaimable` | Currently outstanding obligations: `totalRequested - totalClaimed` |

The safety invariant on every claim is `require(claimAmount ≤ totalClaimable)`. This is independent of the allowance from the Withdrawal Queue Wallet. Even if allowance is set to `MAX_UINT`, the queue physically refuses to pull more than it owes. Allowance is the permission ceiling. The aggregate ledger is the spending discipline.

## Delays

- **Withdrawal Queue Wallet underfunded.** If the Wallet's USDC balance falls below the queue's outstanding obligations, claims revert until the next Trustee and Team top-up. Top-ups are routine. The Trustee monitors the wallet's balance against the queue's `totalClaimable` and triggers a top-up before it bites.
- **Capital Wallet itself is short** (for example, 15% USDC buffer depleted). The Trustee instructs a USYC sale against the Hashnote redemption rail before topping up the Withdrawal Queue Wallet. Typically about a day, longer for large amounts.
- **Your KYB screen expired** between request and claim. Unlikely unless you stop using the app for 90 days mid-queue.
- **GUARDIAN paused** the WithdrawalQueue contract. Check the status page before retrying.

## During shutdown

If the protocol has set an exchange coefficient on the WithdrawalQueue (see [Default management](/defaults-and-losses/)), every claim pays out USDC at `face_value * coefficient` instead of `face_value * 1.0`. The coefficient applies the same way to PLUSD direct-redeem and sPLUSD-unstake-then-redeem. The coefficient ratchets up only as recoveries land. Once `coefficient = 1.0`, normal economics resume.

There is no separate "shutdown mode". The protocol continues operating with the haircut applied at the queue.

## Related

- [Lender Dashboard](/lenders/dashboard/)
- [Potential risks](/risks/)
- [Default management](/defaults-and-losses/)
