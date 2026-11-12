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

On Stellar the voucher endpoint's wallet check reads only `lp_profiles.on_chain_allowed` (`is_on_chain_allowed`), so a KYB `Passed` LP's linked settlement address authorised through the relayer's linked route also clears the Stellar withdrawal voucher check without wallet Sumsub, a consequence of #1889 (product decision 2026-11-12: KYB `Passed` replaces wallet Sumsub on the linked route). A real `WithdrawalRequested` and, with Elliptic on, KYT are still required. Whether that stays is open decision [#1890](https://github.com/eq-lab/pipeline/issues/1890).

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

On Stellar, an LP's wire-outs (`WireOutRequested` / `WireOutSettled` / `WireOutCancelled`) are listed under an optional `wire_outs` key of `GET /v1/requests`, present only when an in-scope chain has a minter address; see [minter-cash-book.md](./minter-cash-book.md).

The destination of a bank wire-out is the LP's settlement bank account ([kyb-lp-verification.md](./kyb-lp-verification.md#settlement-bank-account)). The Trustee reads it from the cash-book row (`bank_account`) or the LP detail (`settlement_bank_account_details`). The LP reads only the masked `settlement_bank_account` on `GET /v1/lps/me`. The public `GET /v1/requests` never carries bank data.

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

---

## Stellar queue read model (#1791)

The Stellar WithdrawalQueue emits `RateSet { new_rate }` at most once, from `set_rate` (owner-only, `0 < new_rate < RATE_ONE`, `RATE_ONE = 1_000_000`), which puts the queue into shutdown. The worker stores it as `WithdrawalRateSet` with `params.new_rate` as the raw 6-dp integer string. A claim pays `floor(amount * rate / 1e6)` USDC and burns `amount` PLUSD; no event carries the USDC paid.

- **`GET /v1/requests`, Stellar `Withdraw` rows only** (EVM rows and every other type are unchanged; both fields are omitted when they do not apply). Both are raw integers at token decimals (7 on Stellar), like `amount`.
  - `queued_through` is the event's cumulative `queued`: the PLUSD queue offset including this request (`withdrawal_request_queued(id)` on chain). `queued_ahead = queued_through - amount`.
  - `usdc_paid` appears once the request is claimed: `floor(amount * rate_at_claim / 1e6)`. The rate is the one in force at the claim on the request's own queue contract: a claim ordered before that contract's `WithdrawalRateSet` by `(block_number, log_index)` pays at `1e6`.
- **`GET /v1/withdrawal-queue`.**
  - `in_queue_usd` values each queued request at its own queue contract's rate (`floor(amount * rate / 1e6)` per row, then summed). It is 1:1 until a `WithdrawalRateSet` exists, and always 1:1 on EVM. `items[].amount` stays the raw requested amount.
  - `summary.rate` is the raw 6-dp integer string `rate()` returns (`"1000000"` = 1:1). It is served only for a single Stellar chain scope (`chain_id` of a Stellar chain) and is `null` for EVM, the union and an unconfigured chain.
  - `summary.total_queued` and `summary.total_claimed` are PLUSD base-6 decimal strings, `null` outside the same scope. `total_queued = MAX(queued)` over `WithdrawalRequested`, `total_claimed = SUM(amount)` over `RequestClaimed`, both over one contract, each normalised once from the raw sum (`total_queued() / 10`, truncated).
- **Scope key.** The existing optional `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` is the queue contract the rate and totals are scoped to; no new key. Unset or malformed (a warning, never a boot failure), `rate` falls back to the latest `WithdrawalRateSet` on the chain (or `1000000`) and the totals are `null`. The key must name the queue contract the worker indexes: a stale or different id scopes the rate and totals to a contract with no rows and serves zeros.
- **Known limits.** A `rate_set` emitted before the worker indexed the contract is lost once it leaves RPC retention (about 7 days), so the API would serve `1000000` for a queue in shutdown; rewind the Stellar cursor while it is in retention. `total_claimed` undercounts if early `RequestClaimed` history was never indexed.
- **Payable now** stays a frontend `claimable(id)` read: it needs the custodian USDC balance, which is not indexed. The paused flag, a pre-claim payout preview and EVM parity are tracked in #1801.

---

## Bank wire withdrawals (Trustee console)

Sources: `docs/user-docs/lenders/withdraw.md` §"Bank wire withdrawals", `docs/user-docs/governance/fiduciary-trustee.md`, and the "Lender wire out" row of `docs/user-docs/how-it-works/capital-layer.md`. Issue #1764 adds the Cash Management → Bank wire-outs tab (`docs/frontend/trustee-flows.md#cash-management--bank-wire-outs`). Stellar only; EVM is read-only with no request.

- **List.** `GET /v1/cash-book?chain_id=` `wire_outs[]` ([minter-cash-book.md](./minter-cash-book.md)): `id`, `status` (`Pending | Settled | Cancelled`), `lp`, `lp_id?`, `lp_legal_name?`, `amount`, `requested_at`, `settled_at?`, `value_date?`, `ref_hash?`, `cancelled_at?`, shown as served. Each `Pending` row is confirmed on-chain with `wire_out(id)`.
- **Settle.** `settle_wire_out(id: u32, amount: i128, value_date: u64, ref_hash: BytesN<32>)`.
  - The contract settles only the full requested amount (`#17` otherwise), so the app pre-fills the on-chain 7-decimal amount, checks equality before signing and sends that raw value, never the cash book's 6-decimal one.
  - `ref_hash = sha256(trimmed reference)`, single-use: `ref_hash_seen` is read before signing (`#7` as a fallback). The all-zero hash is refused because the contract would skip it silently.
  - The contract burns the escrowed PLUSD and takes the cash out of `bank_cash` (`#8` when short).
- **Cancel.** `cancel_wire_out(id: u32)` returns the escrowed PLUSD to the lender and needs `PLUSD.authorized(lp)` (`#16` otherwise), checked before signing.
- **Gating.** Both are `TRUSTEE`, called through `AccessManager.execute`; the app requires `can_call(wallet, minter, fn)` to be `immediate` and never schedules.
- **Wrong status** is `#14` and an unknown id `#10`; both are re-checked with `wire_out(id)` before signing.
- **Destination bank account** is not served until #1812; the settle dialog shows "—" and never guesses one.
