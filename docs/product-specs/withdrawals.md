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
  4. Not payable (`payableNow === false`): "The withdrawal custody account is short. Claims for your position wait until it is funded."
  5. Payable (`payableNow === true`, nothing above applies): "Payable now." followed, when the payout is known, by "Pays {X} USDC." (under a recovery rate below 1: "Pays {X} USDC = {Y} PLUSD × {rate}", X "—" until it resolves). An unknown `payableNow` shows no hint.
- **`TooEarly` mapping.** Stellar `Error(Contract, #2)` maps to the custody-short copy only for the withdraw `claim_request` call (`toUserError(err, { context: "withdrawClaim" })`), because `#2` collides with other contracts' codes (for example `get_request` on an unknown id). EVM `WithdrawalQueueTooEarly()` maps to the same copy globally. `InvalidRate` / `AlreadyInShutdown` are admin-only and not mapped.
- **Surfaces.** The withdraw page shows an always-visible info block above the steps card ("Requests are paid in order." with a Learn more button that opens the "Withdrawal queue" modal carrying the rest of the copy), then a status block only when the lender has a request (two plain rows: "Your request", the request's own PLUSD amount as served by `GET /v1/requests`, and "Queue position", the contract read, both ordinary right-aligned values with no chips (payability is shown only as the claim-step hint under step 3); no queue totals; the Learn more modal also explains that the position is the total PLUSD requested up to and including the request), a "Recovery rate" row after Network fee in the conversion card (rate verbatim plus a yellow warning icon that opens a modal with the During shutdown copy) only when the rate is below 1, and two more Panel C summary cards (Total queued, Total claimed), the only place the queue totals appear. Component detail is in [dashboard-components.md](../frontend/dashboard-components.md#deposit-and-withdraw-route).

### Asset-holder top-ups

The Trustee and Team top up the asset holder from the Capital Wallet under the standard cosigner quorum, sized to cover near-term queue obligations. If the Capital Wallet is short, the Trustee redeems USYC first. Top-ups above the cosigner per-transfer cap surface in the Trustee tooling signing queue for the full quorum.

### Treasury Wallet redemption and off-ramp

The Treasury Wallet redeems protocol fees through the same request and claim mechanics. Authorisation requires Team operator A to initiate, Team operator B (distinct session) to confirm, and the Trustee to co-sign. The USDC off-ramp to a bank account uses the foundation multisig's pre-approved bank account list only (free-text destinations are not permitted) with the same two-operator plus Trustee approval.

---

## Designed v2.3 model (not deployed on EVM)

The designed queue keeps `Entry { queueId, lp, amount, status: Pending | Claimed | AdminReleased }` with `totalRequested` / `totalClaimed` / `totalClaimable` aggregates, a `claim(queueId, ClaimAttestation, sig)` that checks a `kytAttestor` signature, nonce and deadline, re-checks `WhitelistRegistry.isAllowed`, enforces `claimAmount <= totalClaimable`, pulls USDC from a Withdrawal Queue Wallet and burns PLUSD, plus `adminRelease(queueId)` for sanctioned entries. None of it exists in `hoodi-v5`; the interface is in [smart-contracts-interfaces.md](./smart-contracts-interfaces.md).

---

## Bank wire withdrawals (LP app)

Sources: `user-docs/lenders/withdraw.md` (Bank wire withdrawals), `dashboard.md`, `onboarding.md` (Re-screening), `security/capital-safeguards.md`. Issue #1757, epic #1795; Trustee settle and cancel are #1764. The lender requests a wire-out of PLUSD from `/deposit?direction=withdraw`; the PLUSD moves into escrow in the Minter, the Trustee settles (burned) or cancels (returned). **The lender cannot cancel.** No bank account is collected or shown: the Trustee wires to the account on the KYB file.

**Contract calls.** Stellar Minter (`VITE_STELLAR_YIELD_MINTER_ID`): `request_wire_out(lp: Address, amount: i128) -> u32` (LP signs, 7 dp, no minimum; order: `require_auth`, `when_not_paused` `#1000`, `require_positive` `#6`, `plusd_authorized` `#16`, SAC transfer with `#13` no trustline / `#10` balance), `wire_out(id: u32) -> { lp, amount, requested_at, status, ref_hash }` (`Pending` / `Settled` / `Cancelled`), `paused()`. EVM `PipelineMinter` (`VITE_EVM_MINTER_ADDRESS`): `PLUSD.approve(minter, amount)`, `requestWireOut(uint256) returns (uint256)`, `wireOut(uint256) -> (lp, uint8 status 0/1/2, amount)`, `paused()`; reverts `EnforcedPause`, `MinterInvalidAmount`, `ERC20InsufficientBalance`. Bindings live in `@pipeline/wallet-connect` (reused by #1764).

**Placement.** The withdraw page (`/deposit?direction=withdraw`) has two tabs at the top of the conversion card (`SegmentedTabs`, `withdraw-tabs`): "Withdraw" (the USDC queue flow) and "Bank" (this flow). The tab is the `?tab=withdraw|bank` search param (default `withdraw`, honoured only on the withdraw direction; the deposit direction shows no tabs); selecting a tab replaces the URL. `/withdraw` redirects to `/deposit?direction=withdraw&tab=withdraw`. The Bank tab shows the PLUSD amount input, the bank output ("USD to your bank account", "Exchange rate 1 PLUSD = 1 USD", "Network fee" as served), a one-line info ("Your PLUSD stays in escrow until the Trustee sends the wire." with "Learn more" opening the docs paragraph above verbatim), the wire-out steps and the "Your bank wire-outs" list; it has no queue block and no recovery-rate row.

**Gates** (first failing wins, the request step is disabled and the reason shows as its hint): minter unconfigured for the chain ("Bank wire-outs are not available on this network."); not a signed-in LP with `kyb_status === "Passed"` ("Complete KYB to withdraw to a bank account", decision 2026-10-30); paused ("Bank wire-outs are paused. Check the status page before retrying."); address not authorised to hold PLUSD, Stellar only, includes a missing trustline ("Your address must be authorised to hold PLUSD to request a bank wire-out."); empty or zero amount; amount above balance ("Insufficient balance"). EVM unauthorised addresses are caught by the revert mapping.

**Value sources.** Ids and request time: `GET /v1/audit-log?chain_id=<active chain>` (public, newest first), keeping `WireOutRequested` rows whose `details.lp` equals the connected address (case-insensitive on EVM), cached and polled 30 s; filtering served rows is selection, not a computed metric. A wallet-scoped endpoint is the recommended backend follow-up. Amount and status come from the contract read ("—" while loading or on error), status mapped 1:1, never derived from events. Balance, decimals and authorisation come from the withdraw flow. Chain follows `useWalletView().kind`.

**Just-submitted ids.** The indexer lags, so the returned id (Stellar return value, else `wire_out_requested` topic; EVM receipt log) is kept in component state, rendered through the contract read with "—" for the time, and dropped once the served list has it.

**Errors.** `toUserError(err, { context: "wireOut" })` only, never the global table: Soroban `#16`, `#6`, `#10` (SAC balance in this call, not Minter `NonExistentWireOut`), `#1000`; EVM named errors. See [error-handling.md](../frontend/error-handling.md#the-mapping-layer-touserror).

**Environment.** Both minter vars must be set on the LP container; the Minter's `addresses_config().plusd` must equal the PLUSD the lender holds, else the transfer fails (deployment fix).

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
