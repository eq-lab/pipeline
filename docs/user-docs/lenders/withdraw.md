---
title: Withdraw
order: 16
section: For Lenders
---

# Withdraw

Withdraw by unstaking sPLUSD to PLUSD if needed, escrowing PLUSD into the WithdrawalQueue, and claiming USDC yourself. The claim re-screens your address, burns your PLUSD, and pulls USDC from the Withdrawal Queue Wallet via the queue contract's standing allowance. Single call, no off-chain signer in the critical path.

{% include diagram.html src="d5-withdraw-settle.svg" caption="Withdraw to settle. User-pulled claim from the Withdrawal Queue Wallet via standing allowance. Claim re-checks compliance, burns PLUSD, and pays USDC atomically." %}

## Flow

<ol class="steps">
  <li>Unstake sPLUSD by calling <code>sPLUSD.redeem(shares)</code>. PLUSD returns to your wallet. Skip if you already hold PLUSD.</li>
  <li>Call <code>WithdrawalQueue.requestWithdrawal(amount)</code>. Your PLUSD moves into the queue's escrow and a <code>queue_id</code> is assigned. The queue's <code>totalRequested</code> aggregate increases. The PLUSD transfer to the queue triggers <code>PLUSD._update</code>, which checks your whitelist entry and the 90-day freshness window. A stale or revoked entry reverts the request.</li>
  <li>The Relayer detects your request and runs KYT on your address off-chain. On a clean result, the Relayer signs a claim attestation and serves it via API. Your frontend fetches the attestation when ready.</li>
  <li>Call <code>WithdrawalQueue.claim(queueId, attestation, signature)</code> yourself when you're ready. The queue verifies the signature against the configured attestor address, re-checks <code>WhitelistRegistry.isAllowed(you)</code> as a backstop, checks <code>claimAmount ≤ totalClaimable</code>, calls <code>USDC.transferFrom(WithdrawalQueueWallet, you, amount)</code> against the standing allowance, burns your escrowed PLUSD, and increments <code>totalClaimed</code>. All in the same transaction.</li>
</ol>

<div class="callout info">
<strong>Self-pulled.</strong> No Relayer signature, no off-chain step, no waiting for an external party to fund your entry. The Withdrawal Queue Wallet is topped up periodically by the Trustee and Team from the Capital Wallet under the 3-of-5 cosigner quorum. As long as the wallet has USDC, the queue has allowance against it, and your address is still whitelisted, you can claim immediately.
</div>

## Compliance re-check at claim

Whitelist entries can be revoked between request and claim if a sanctions hit lands on your address (passive re-screening, OFAC list update, manual revoke). The `claim` re-check catches this. If revoked, the claim reverts and your escrowed PLUSD stays in the queue pending ADMIN disposition.

If your whitelist entry's freshness window expires (no clean screen in 90 days), the request itself reverts at `PLUSD._update`. Re-enrol via the standalone enrolment endpoint (see [Onboarding](/lenders/onboarding/)) to refresh, then retry the request.

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
- **Your compliance screen expired** between request and claim. Unlikely unless you stop using the app for 90 days mid-queue. Re-enrol to refresh.
- **Sanctions hit on your address** between request and claim. The claim reverts. Contact compliance.
- **GUARDIAN paused** the WithdrawalQueue contract. Check the status page before retrying.

## During shutdown

If the protocol has set an exchange coefficient on the WithdrawalQueue (see [Default management](/risks/default-management/)), every claim pays out USDC at `face_value * coefficient` instead of `face_value * 1.0`. The coefficient applies the same way to PLUSD direct-redeem and sPLUSD-unstake-then-redeem. The coefficient ratchets up only as recoveries land. Once `coefficient = 1.0`, normal economics resume.

There is no separate "shutdown mode". The protocol continues operating with the haircut applied at the queue.

## Related

- [Lender Dashboard](/lenders/dashboard/)
- [Potential risks](/risks/)
- [Default management](/risks/default-management/)
