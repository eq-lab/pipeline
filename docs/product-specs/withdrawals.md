# Withdrawals

## Overview

On EVM a lender exits by redeeming sPLUSD for PLUSD if needed, calling `PipelineWithdrawalQueue.requestWithdrawal(amount)` (PLUSD is escrowed in the queue), and, once the request is funded and the API has served a verifier signature (voucher), calling `claimWithdrawal(requestId, verifierSignature)`. The claim pays USDC from the **asset holder** (an MPC address) to the lender and burns the escrowed PLUSD. The deployed contract surface, `VerifiedRequests` EIP-712 signature, FIFO funding, shutdown rate and voucher API are specified in [evm-requests-queue.md](./evm-requests-queue.md).

---

## Behavior (EVM, deployed)

### Step 1: sPLUSD to PLUSD

If the lender holds sPLUSD, they call `sPLUSD.redeem(shares, receiver, owner)` (ERC-4626) to receive PLUSD at the current share price. Skip this step if the lender already holds PLUSD. The deposit UI presents the redeem and the request as separate steps.

### Step 2: requestWithdrawal

The lender calls `PLUSD.approve(WithdrawalQueue, amount)` then `requestWithdrawal(amount)`. The queue escrows the PLUSD and records a cumulative `queued` watermark for the request.

### Step 3: voucher

The indexer records `WithdrawalRequested`; the API runs KYT and serves the voucher (`GET /v1/withdrawals/{request_id}/voucher?wallet=&chain_id=`). A hard-fail request gets no voucher and is dispositioned off-chain by the Trustee. The frontend polls until the voucher is ready.

### Step 4: claimWithdrawal

The lender calls `claimWithdrawal`. It reverts `WithdrawalQueueTooEarly` until `queued[requestId] <= claimableAmount()`, that is until the asset holder's USDC balance (plus prior claims) covers every earlier request. The lender retries after the Trustee tops up the asset holder; funds are delayed, never lost.

### Voucher validity

The voucher the API serves for a request is valid for 24 hours. On Stellar the response carries the signed `deadline` (u64 unix seconds, string); on EVM the signature does not cover a deadline, so none is served today and the validity is not enforced (backend follow-up #1798).

The LP app treats a voucher whose served `deadline` has passed as absent: the hook reports `pending` (never `ready`, never `failed`), hides the voucher data and signature, and refetches. While a voucher with a deadline is ready, the hook schedules a refetch for the moment the deadline passes, so a tab left open goes back to pending and then ready with the fresh voucher. The served `deadline` is the only clock; the app holds no 24-hour constant and shows no countdown.

If a Stellar claim still fails with the deadline-expired contract error (`Error(Contract, #4)`, for example under clock skew), the app resets the voucher query once per request id and shows "The voucher expired or did not match the request. Your app fetches a fresh voucher." A second failure for the same request keeps the error visible. A bad signature is a host crypto error, not a voucher expiry, and is never retried.

### Asset-holder top-ups

The Trustee and Team top up the asset holder from the Capital Wallet under the standard cosigner quorum, sized to cover near-term queue obligations. If the Capital Wallet is short, the Trustee redeems USYC first. Top-ups above the cosigner per-transfer cap surface in the Trustee tooling signing queue for the full quorum.

### Treasury Wallet redemption and off-ramp

The Treasury Wallet redeems protocol fees through the same request and claim mechanics. Authorisation requires Team operator A to initiate, Team operator B (distinct session) to confirm, and the Trustee to co-sign. The USDC off-ramp to a bank account uses the foundation multisig's pre-approved bank account list only (free-text destinations are not permitted) with the same two-operator plus Trustee approval.

---

## Designed v2.3 model (not deployed on EVM)

The designed queue keeps `Entry { queueId, lp, amount, status: Pending | Claimed | AdminReleased }` with `totalRequested` / `totalClaimed` / `totalClaimable` aggregates, a `claim(queueId, ClaimAttestation, sig)` that checks a `kytAttestor` signature, nonce and deadline, re-checks `WhitelistRegistry.isAllowed`, enforces `claimAmount <= totalClaimable`, pulls USDC from a Withdrawal Queue Wallet and burns PLUSD, plus `adminRelease(queueId)` for sanctioned entries. None of it exists in `hoodi-v5`; the interface is in [smart-contracts-interfaces.md](./smart-contracts-interfaces.md).

---

## UI: Network Fee Estimate

The `/deposit` page (withdraw direction) shows a "Network fee" row in the Details section of the conversion card. The fee is an ETH-denominated estimate, decoupled from the user's typed amount:

- **Fixed representative amount:** 1000 PLUSD is used for the gas simulation, not the user's input. This keeps the displayed fee stable while the user types.
- **Refresh cadence:** The estimate is refreshed once per minute (`refetchInterval: 60_000 ms`).
- **Format:** Fee is displayed as `~0.00042 ETH` (ETH only, no USD equivalent — no ETH/USD price source is wired up).
- **Loading / not configured:** When the contract address is the zero address, the wallet is disconnected, or the estimate has not yet resolved, the row shows `—`.
- **Fallback:** If the gas simulation reverts (e.g., the connected wallet lacks PLUSD balance), a curated constant of ~180,000 gas is used, multiplied by live `gasPrice`.

---

## API Contract

The deployed `requestWithdrawal` / `claimWithdrawal` surface, events and voucher endpoint are in [evm-requests-queue.md](./evm-requests-queue.md). The designed `IWithdrawalQueue` interface is in [smart-contracts-interfaces.md](./smart-contracts-interfaces.md).

---

## Data Model

Per-request state is `requests[requestId] { amount, user, timestamp, claimed }` plus `queued[requestId]`; queue-wide `queueMetadata()` returns `(totalQueued, totalClaimed)`. PLUSD is burned only at claim, when the USDC leaves the asset holder, so the PLUSD backing invariant holds through the whole lifecycle. Under the shutdown rate the payout is `amount * rate / RATE_ONE` USDC for the full amount burned.

---

## Security Considerations

- **Verifier compromise is bounded to KYT bypass on real escrowed positions.** A voucher exists only for an enqueued request and is bound to `(requestId, user, amount)`; already-claimed requests cannot be replayed.
- **Owner-only claim, payout to the requester.** There is no redirect parameter.
- **Asset-holder isolation.** An exploit of the queue can drain at most the USDC topped up to the asset holder, not the Capital Wallet.
- **PLUSD burned with the USDC payout, one-way queue.** No cancel; escrowed PLUSD stays until claimed.
- **Pause and shutdown.** A restricted `pause()` freezes requests and claims; `setShutdownRate` is one-way and fixes the payout ratio.
- **Custody-side circuit breaker.** The asset holder's hardware breaker revokes the queue's allowance independently of any on-chain action.
