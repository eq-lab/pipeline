# User story: #1759 — withdrawal queue position, payable-now state, queue aggregates and the recovery rate

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1759
**Status:** Initial

---

## Overview

Withdrawals are paid first in, first out (`docs/user-docs/lenders/withdraw.md`: Flow, Paid in order, Queue aggregates, Delays, During shutdown). The LP app shows, from the queue contract and exactly as returned, each request's position and whether it is payable now, the recovery rate when it is below 1, and (on the Protocol Dashboard only) the queue's total queued and total claimed. The API serves none of these today, so the LP reads them from the contracts; serving them is tracked as backend issue #1801. Spec: `docs/product-specs/withdrawals.md#queue-position-payable-now-and-recovery-rate-lp-app`.

All checks use the real API and contracts on staging (Stellar testnet, then Hoodi), no localStorage mocks. Open DevTools Network before starting; Soroban reads appear as `simulateTransaction` calls to the RPC, EVM reads as `eth_call`. Compare every shown value with a direct contract read. While RPC is blocked the values render "—" and Claim keeps its previous behaviour.

---

## Story 1 — Position and payable now on the withdraw page

**Given** a Stellar wallet is connected with a withdrawal request in flight

**When** the lender opens `/deposit?direction=withdraw`

**Then:**

- On every withdraw visit (not on deposit) a white block sits below the conversion card (above the steps); with a withdrawal request a second white block follows it, separated by a thin 2px seam like the two token cards of the converter
- The first block is one line of running text with a small info icon: "**Paid in order.** Requests are paid first in, first out." followed directly by an underlined "Learn more" link with an arrow icon, wrapping naturally in muted 16px text
- Learn more opens a "Withdrawal queue" modal with the full "Paid in order" copy; the Close button, Escape and a backdrop click close it and focus returns to the link
- With a withdrawal request, the second block shows "Your position" with the amount in bolder text, equal to `withdrawal_request_queued(request_id)` formatted as PLUSD, followed by a status chip; with no request only the first block shows
- The chip reads "Payable now" (green, check icon) when `claimable(request_id)` is true, "Not payable yet" (pale yellow, clock icon) when false, and "—" (grey) while the read is pending or failed
- The withdraw page does not show "Total queued" or "Total claimed"; they live on the Protocol Dashboard Panel C only
- Step 2 shows "A request cannot be cancelled. Your PLUSD stays in the queue until it is claimed." while idle

---

## Story 2 — Custody account short: hint and Claim disabled

**Given** a withdrawal request is `PendingClaim` with a ready voucher and `claimable(request_id)` is false

**When** the lender looks at the claim step

**Then:**

- The hint reads "The withdrawal custody account is short. Claims for your position wait until it is funded."
- Claim is disabled and "Payable now" shows "Not yet"
- After the custody account is funded, within about 15 seconds "Payable now" shows Yes, the hint disappears and Claim is enabled
- A claim that still fails with `Error(Contract, #2)` shows the same custody-short message (a race), not the generic error

---

## Story 3 — Queue paused

**Given** the withdrawal queue is paused (`paused()` true)

**When** the lender opens the withdraw page with a pending request

**Then:**

- The claim step hint reads "The withdrawal queue is paused. Check the status page before retrying."
- Claim is disabled, and this hint outranks every other waiting reason

---

## Story 4 — No voucher yet or verification failed

**Given** a withdrawal request is `PendingVerification` or `VerificationFailed`, or its voucher is not ready

**When** the lender looks at the claim step

**Then:**

- The hint reads "No voucher yet. Screening is still running, or the request did not screen clean."
- The hint clears once a voucher is ready

---

## Story 5 — Voucher expired (Stellar)

**Given** a Stellar request is `PendingClaim` and the served voucher `deadline` has passed

**When** the deadline passes while the page is open

**Then:**

- The claim hint reads "The voucher expired before you claimed. Your app fetches a new one." until the refetched voucher arrives (#1760)
- Claim becomes actionable again with the new voucher

---

## Story 6 — Pending rows on Home and /transactions

**Given** a wallet has a pending (not yet claimed) withdrawal

**When** the lender opens Home and `/transactions` (Sell tab)

**Then:**

- The pending Sell row shows a third line "Position {pos} PLUSD · Payable now" or "Position {pos} PLUSD · Not payable yet", matching the contract reads
- Completed Sell rows, Buy rows and Stake rows show no such line

---

## Story 7 — Panel C totals match the contract

**Given** the Protocol Dashboard is open with a Stellar or EVM wallet connected

**When** the Withdrawal Queue panel loads

**Then:**

- Six summary cards show: In Queue, Requests, Estimated wait, Liquid Cover, Total queued, Total claimed
- Total queued and Total claimed match `total_queued()` / `total_claimed()` (Stellar) or `queueMetadata()` (EVM), in compact USD, and differ from In Queue, which is the served unclaimed sum
- At 1280 px the six cards do not overflow; on mobile the row scrolls horizontally
- A blocked RPC shows "—" in those two cards without turning the panel into an error state

---

## Story 8 — Recovery rate below 1

Needs a testnet admin to call `set_rate` (below 1_000_000) or a dedicated deployment with a rate set.

**Given** the queue's recovery rate is below 1

**When** the lender opens the withdraw page with a payable `PendingClaim` request

**Then:**

- The conversion card has a "Recovery rate" row after "Network fee" showing the rate (e.g. "0.85") and a small yellow warning icon; there is no separate yellow notice
- Clicking the icon opens a "Recovery rate" modal with the "During shutdown" copy from the lender withdraw docs; the Close button, Escape and a backdrop click close it and focus returns to the icon
- The claim hint reads "Pays {X} USDC = {Y} PLUSD × {rate}", where X equals the `claim_request` simulation return value (never a client product)
- After claiming, the success toast reads "Claimed {X} USDC" with that contract payout, not the PLUSD amount
- At rate 1 the Recovery rate row and the Pays hint are absent and the toast keeps its previous copy

---

## Story 9 — EVM parity on Hoodi

**Given** an EVM wallet is connected on Hoodi with a pending withdrawal

**When** the lender repeats Stories 1, 2, 3, 6 and 7

**Then:**

- Values equal `withdrawalRequestQueued`, `isClaimable`, `queueMetadata` and `paused` on the queue proxy
- The recovery rate comes from `convertToAssets(10^plusdDecimals)` (the deployed proxy has no rate getter) and the payout X from `convertToAssets(request.amount)`
- A claim reverting with `WithdrawalQueueTooEarly()` shows the custody-short message
