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

The lender calls `claimWithdrawal`. It reverts `WithdrawalQueueTooEarly` until `queued[requestId] <= claimableAmount()`, that is until the asset holder's USDC balance (plus prior claims) covers every earlier request. The lender retries after the Trustee tops up the asset holder; funds are delayed, never lost. On Stellar the equivalent call is `claim_request(request_id, signature, deadline)`; it fails with `Error(Contract, #2)` (`TooEarly`) until the view `claimable(request_id)` is true.

### Voucher validity

The voucher the API serves for a request is valid for 24 hours. On Stellar the response carries the signed `deadline` (u64 unix seconds, string); on EVM the signature does not cover a deadline, so none is served today and the validity is not enforced (backend follow-up #1798).

The LP app treats a voucher whose served `deadline` has passed as absent: the hook reports `pending` (never `ready`, never `failed`), hides the voucher data and signature, and refetches. While a voucher with a deadline is ready, the hook schedules a refetch for the moment the deadline passes, so a tab left open goes back to pending and then ready with the fresh voucher. The served `deadline` is the only clock; the app holds no 24-hour constant and shows no countdown.

If a Stellar claim still fails with the deadline-expired contract error (`Error(Contract, #4)`, for example under clock skew), the app resets the voucher query once per request id and shows "The voucher expired or did not match the request. Your app fetches a fresh voucher." A second failure for the same request keeps the error visible. A bad signature is a host crypto error, not a voucher expiry, and is never retried.

### Queue position, payable now and recovery rate (LP app)

Behaviour source: `docs/user-docs/lenders/withdraw.md` (Flow, Paid in order, Queue aggregates, Delays, During shutdown), `docs/user-docs/lenders/dashboard.md` and `docs/user-docs/risks/default-management.md`. The LP app shows these values from the queue contract, exactly as returned. It computes no metric; the only comparison is the recovery rate against its own unit, to decide whether the recovery notice shows. A value that is not available renders "—". All reads follow the connected wallet's chain.

| Value                                                 | Stellar (`VITE_STELLAR_WITHDRAWAL_QUEUE_ID`)                           | EVM (`VITE_WITHDRAWAL_QUEUE_ADDRESS`)                                                                                                 | Served by API                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Request list, status, amount, `request_id`            | `GET /v1/requests`                                                     | same                                                                                                                                  | yes, used as is                                                                                                    |
| Position                                              | `withdrawal_request_queued(u128) -> i128` (PLUSD, 7 dp)                | `withdrawalRequestQueued(uint256) -> uint256` (PLUSD decimals)                                                                        | no                                                                                                                 |
| Payable now                                           | `claimable(u128) -> bool`                                              | `isClaimable(uint256) -> bool`                                                                                                        | no                                                                                                                 |
| Total queued / total claimed (dashboard Panel C only) | `total_queued()` / `total_claimed()`                                   | `queueMetadata() -> (totalQueued, totalClaimed)`                                                                                      | no. `/v1/withdrawal-queue` `in_queue_usd` is the unclaimed sum, a different number, and stays as the In Queue card |
| Recovery rate                                         | `rate() -> i128`, 6 dp (`1_000_000` = 1.0)                             | no public getter on the deployed proxy; `convertToAssets(10^plusdDecimals)`, the contract's USDC payout for 1 PLUSD, at USDC decimals | no                                                                                                                 |
| Payout on the claim step                              | return value of a `claim_request` simulation from the lender's address | `convertToAssets(request.amount)`                                                                                                     | no                                                                                                                 |
| Queue paused                                          | `paused() -> bool`                                                     | `paused() -> bool`                                                                                                                    | no                                                                                                                 |
| Voucher expired                                       | served `deadline` (see Voucher validity)                               | not served (#1798)                                                                                                                    | yes                                                                                                                |

The API does not serve position, payable now, queue totals or the rate, so the LP reads them from the contracts. Serving them is tracked as backend issue #1801. If a later EVM deploy adds a rate getter, switch to it.

Rules:

- **Claim gating.** Claim is disabled while `claimable` / `isClaimable` is exactly `false` or the queue is paused. An unknown value (`undefined`) keeps the previous behaviour, so a failed read never blocks a claim.
- **Payout is contract-only.** "Pays X USDC = Y PLUSD × rate" shows X from the contract (simulation / `convertToAssets`), never a client product. X is "—" until it resolves or when the simulation fails.
- **Claim toast.** With a recovery rate below 1 the success toast reads `Claimed {X} USDC` from the contract payout captured before submit (or "USDC claimed" when none was captured). At rate 1 the copy is unchanged.
- **Request step hint.** "A request cannot be cancelled. Your PLUSD stays in the queue until it is claimed." shows on the withdraw request step while it is idle.
- **Claim-step hint priority** (first match wins, copy verbatim from the Delays list):
  1. Queue paused: "The withdrawal queue is paused. Check the status page before retrying."
  2. Voucher expired: "The voucher expired before you claimed. Your app fetches a new one."
  3. No ready voucher (request `PendingVerification` / `VerificationFailed`, or voucher pending / failed): "No voucher yet. Screening is still running, or the request did not screen clean."
  4. Not payable: "The withdrawal custody account is short. Claims for your position wait until it is funded."
  5. Recovery rate below 1: "Pays {X} USDC = {Y} PLUSD × {rate}".
- **`TooEarly` mapping.** Stellar `Error(Contract, #2)` maps to the custody-short copy only for the withdraw `claim_request` call (`toUserError(err, { context: "withdrawClaim" })`), because `#2` collides with other contracts' codes (for example `get_request` on an unknown id). EVM `WithdrawalQueueTooEarly()` maps to the same copy globally. `InvalidRate` / `AlreadyInShutdown` are admin-only and not mapped.
- **Surfaces.** The withdraw page shows an always-visible info block above the steps card ("Paid in order. Requests are paid first in, first out." with a Learn more button that opens the "Withdrawal queue" modal carrying the rest of the copy), then a status block only when the lender has a request with a position (a compact row: green "Payable now", yellow "Not payable yet" or white "—" while unknown, and Your position; no queue totals), a "Recovery rate" row after Network fee in the conversion card (rate verbatim plus a yellow warning icon that opens a modal with the During shutdown copy) only when the rate is below 1, the pending `Withdraw` rows on Home and `/transactions` ("Position {pos} PLUSD · Payable now" or "Not payable yet"; completed rows show no meta), and two more Panel C summary cards (Total queued, Total claimed), the only place the queue totals appear. Component detail is in [dashboard-components.md](../frontend/dashboard-components.md#deposit-and-withdraw-route).

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
