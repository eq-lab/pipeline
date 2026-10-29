---
title: Withdraw
order: 16
section: For Lenders
---

# Withdraw

Unstake sPLUSD to PLUSD if needed, request a withdrawal, then claim USDC. The request moves your PLUSD into the withdrawal queue. Pipeline screens the request and issues a signed voucher. The claim burns your PLUSD and pays USDC from the withdrawal custody account to your address.

{% include diagram.html src="d5-withdraw-settle.png" caption="Withdraw to settle. PLUSD is held in the queue. Requests are paid in order. The claim needs a voucher and enough USDC in the withdrawal custody account, then burns PLUSD and pays USDC in one step." %}

## Flow

<ol class="steps">
  <li>Unstake sPLUSD. PLUSD returns to your wallet at the current share price. Skip this if you already hold PLUSD.</li>
  <li>Request a withdrawal of an amount of PLUSD. Your PLUSD moves into the queue and you get a request number. The queue records your position: the total PLUSD requested up to and including your request. Your address must be authorised to hold PLUSD.</li>
  <li>Pipeline screens the request off-chain. On a clean result it signs a voucher for your request number, address and amount. The voucher is valid for 24 hours. Your app fetches it when ready.</li>
  <li>Claim with the voucher. The queue checks the voucher and its deadline. It checks that the USDC in the withdrawal custody account, plus everything already claimed, covers every request up to yours. It then pays USDC from the withdrawal custody account to the address on the request and burns your PLUSD. All in the same transaction.</li>
</ol>

<div class="callout info">
<strong>Paid in order.</strong> Requests are paid first in, first out. A request can be claimed once the withdrawal custody account holds enough USDC to cover it and every earlier unclaimed request. Until then the claim is refused as too early. Your PLUSD stays in the queue. Nothing is lost.
</div>

A request cannot be cancelled. Your PLUSD stays in the queue until it is claimed.

### Bank wire withdrawals

You can also withdraw to a bank account. You request a wire-out of an amount of PLUSD. The PLUSD moves into escrow. When the wire is sent, the Trustee settles the request and the PLUSD is burned. The Trustee can cancel the request instead, and the PLUSD returns to you. Your address must be authorised to hold PLUSD to request or to receive it back.

## Compliance re-check at claim

Each claim needs a fresh voucher. Pipeline screens the request before it signs one. If the screen is not clean, no voucher is issued, the claim cannot go through, and your PLUSD stays in the queue. The Trustee decides what happens next off-chain.

## Queue aggregates

The queue keeps two running totals.

| Aggregate | What it is |
|---|---|
| Total queued | PLUSD placed in the queue across all requests ever made |
| Total claimed | PLUSD burned through claims |

Each request stores the total queued at the moment it was made. That number is its position. A request is payable when its position is no more than total claimed plus the USDC in the withdrawal custody account. The queue pays only from that account and only up to the allowance the account has given it.

## Delays

- No voucher yet. Screening is still running, or the request did not screen clean.
- The withdrawal custody account is short. Claims for your position wait until it is funded.
- The voucher expired before you claimed. Your app fetches a new one.
- The withdrawal queue is paused. Check the status page before retrying.

## During shutdown

The protocol administrator can set a recovery rate below 1 on the withdrawal queue, once. After that, every claim pays USDC equal to the PLUSD burned times that rate. The rate applies to every claim made after it is set, whatever the request date. It cannot be changed afterwards. See [Default management](/risks/default-management/).

There is no separate shutdown mode. The protocol keeps operating with the rate applied at the queue.

## Related

- [Lender Dashboard](/lenders/dashboard/)
- [Potential risks](/risks/)
- [Default management](/risks/default-management/)
