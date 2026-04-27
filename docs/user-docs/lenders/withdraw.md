---
title: Withdraw
order: 8
section: For Lenders
---

# Withdraw

Withdraw by unstaking sPLUSD to PLUSD, submitting the PLUSD to the withdrawal queue, waiting for Relayer to fund the entry from the Capital Wallet, and claiming USDC in an atomic burn-and-pay transaction.

{% include diagram.html src="d5-withdraw-settle.svg" caption="Withdraw → settle — FIFO queue, auto-funded by Relayer from the Capital Wallet's pre-approved allowance; claim burns PLUSD and pays USDC atomically." %}

## How the flow works

<ol class="steps">
  <li>Unstake sPLUSD by calling <code>sPLUSD.redeem(shares)</code> — PLUSD returns to the lender (skip this step if you already hold PLUSD).</li>
  <li>Call <code>WithdrawalQueue.requestWithdrawal(amount)</code> — PLUSD moves into escrow, a <code>queue_id</code> is assigned, and the caller must still be whitelisted with a fresh screen.</li>
  <li>Relayer observes the request and calls <code>fundRequest(queueId)</code> under the FUNDER role in strict FIFO order.</li>
  <li>USDC is pulled from the Capital Wallet to the queue via a pre-approved allowance cosigned at deployment — Relayer never custodies USDC itself.</li>
  <li>The queue entry moves from Pending to Funded.</li>
  <li>The lender calls <code>claim(queueId)</code> — PLUSD burns and USDC transfers to the lender in the same transaction.</li>
</ol>

<div class="callout info">
<strong>Destination rule.</strong> The USDC payout always goes to the original deposit address on record. A different destination requires a manual path with Trustee and Team co-signature — not the auto flow. The MPC policy on the Capital Wallet enforces this.
</div>

## Caps and queueing

Relayer funds up to $5M per `fundRequest` call and up to $10M per rolling 24 hours. Above-envelope requests route to the team and trustee signing queue for manual co-signature. MVP has no partial fills and no lender-initiated cancellation once PLUSD enters escrow.

## What can delay your withdrawal

- Capital Wallet USDC buffer below 15% (band 10–20%) triggers a Trustee-instructed USYC redemption against the Hashnote rail before funding — typically about a day, longer for large amounts.
- Queue depth above your position — strict FIFO means older requests settle first.
- Your wallet's KYC freshness expired between request and claim — unlikely unless you stop using the app for 90 days mid-queue.

## Shutdown-mode exit

If the protocol enters shutdown, the auto flow halts and withdrawals switch to the `claimAtShutdown` path at a fixed recovery rate. See [Defaults and Losses](/defaults-and-losses/) for the full mechanics, including how the recovery rate is set and ratcheted.

## Related pages

- [Lender Dashboard](/lenders/dashboard/)
- [Risks](/risks/)
- [Defaults and Losses](/defaults-and-losses/)
