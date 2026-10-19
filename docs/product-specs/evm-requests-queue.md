# EVM Verified Requests Queue (Deposits and Withdrawals)

## Overview

On EVM, deposits and withdrawals share one mechanism: a **request** is enqueued on-chain, the Relayer-run API screens it (KYT) and serves a **verifier signature** (voucher), and the lender submits that signature to a **claim** call. Deployed in `pipeline-contracts` `hoodi-v5` (`src/PipelineDepositManager.sol`, `src/PipelineWithdrawalQueue.sol`, `src/requestsQueue/VerifiedRequestsQueueUpgradeable.sol`); both contracts are UUPS proxies under an OpenZeppelin `AccessManager` authority. Behavior shared with Stellar (UI steps, polling) is in [wallet-flows.md](../frontend/wallet-flows.md). Contract addresses are deployment configuration, not spec.

The attestation-based design (`ClaimAttestation`, Intake Wallet ticket book, `refund`, `markRefunded`) described in [deposits.md](./deposits.md) and [withdrawals.md](./withdrawals.md) is the designed v2.3 model and is not deployed on EVM.

---

## Shared queue (`VerifiedRequestsQueue`)

| Item | Behavior |
|---|---|
| `Request` | `{ amount, user, timestamp (uint88), claimed }`, keyed by a sequential `requestId` starting at 0 (one counter per contract). |
| Enqueue | Internal; `amount == 0` reverts `VerifiedRequestsQueueZeroAmount`. Emits `RequestEnqueued(requestId, user, amount, timestamp)`. |
| Claim | `msg.sender` must equal `request.user` (`VerifiedRequestsInvalidSender`); unknown id or zero amount reverts `VerifiedRequestsInvalidRequestId`; replay reverts `VerifiedRequestsQueueAlreadyClaimed`; a signature not recovering to `verifier` reverts `VerifiedRequestsInvalidSignature`. Emits `RequestClaimed(requestId, user, amount)`. |
| Views | `requests(id)`, `nextRequestId()`, `verifier()`, `domainSeparator()`, `verifySignature(id, sig)` (false when the request does not exist). |
| `setVerifier(address)` | Restricted (AccessManager). Zero address or unchanged value reverts. Emits `VerifierSet`. |

### Verifier signature

EIP-712 typed data, signed by the single `verifier` address:

```
VerifiedRequests(uint256 requestId, address user, uint256 amount)
```

The domain is `("PipelineDepositManager", "v1")` on the DepositManager and `("PipelineWithdrawalQueue", "v1")` on the WithdrawalQueue, with the chain id and the contract's own address as `verifyingContract`. The signature carries no deadline and no nonce: it is bound to one request, one user and one amount, and single use is enforced by the `claimed` flag. Rotating the verifier invalidates every unclaimed voucher.

---

## DepositManager (`PipelineDepositManager`)

| Function | Access | Behavior |
|---|---|---|
| `requestDeposit(uint256 amount) -> requestId` | public, `whenNotPaused` | Checks `amount >= minDeposit` (`DepositManagerLessThanMinAmount`), applies the rate limiter, enqueues the request, then `USDC.safeTransferFrom(msg.sender, custodian, amount)` (needs a prior `approve`). Emits `DepositRequested(requestId, user, amount)`. |
| `claimDeposit(uint256 requestId, bytes verifierSignature) -> amount` | public (request owner), `whenNotPaused` | Verifies the voucher, then mints `amount` PLUSD 1:1 to the caller (`PLUSD.mint`). |
| `usdc()` / `plUsd()` / `minDeposit()` / `custodian()` | view | Configured assets, minimum and USDC destination. |
| `setCustodian` / `setMinDeposit` / `setVerifier` | restricted | Parameter setters; unchanged value or zero address reverts. Emit `CustodianSet` / `MinDepositSet` / `VerifierSet`. |
| `pause()` / `unpause()` | restricted | Freezes both `requestDeposit` and `claimDeposit`. |

USDC moves to the **custodian** (an MPC custody address, not a contract-held balance) at request time, before screening. PLUSD is minted only at claim. There is no on-chain refund path: a request that is never voucher-approved stays unclaimed and is dispositioned off-chain by the Trustee.

### Rate limiter

`requestDeposit` is gated by `RateLimiter` (`txLimit`, `windowLimit`, `window`, `shift`): the amount must be `<= txLimit` (`RateLimiterExceedsTxLimit`) and the cumulative amount in the current fixed window `<= windowLimit` (`RateLimiterExceedsWindowLimit`). Window index is `(timestamp + shift) / window`; the cumulative counter resets when the index changes. Views: `rateLimitConfig()`, `lastMintTimestamp()`, `windowCumulativeMint()`. There is no per-lender cap and no supply ceiling. Limits are raised or lowered by restricted `increase*` / `decrease*` setters.

---

## WithdrawalQueue (`PipelineWithdrawalQueue`)

| Function | Access | Behavior |
|---|---|---|
| `requestWithdrawal(uint256 amount) -> (requestId, queued)` | public, `whenNotPaused` | Enqueues the request, adds `amount` to the cumulative `totalQueued` and records it as that request's `queued` watermark, then escrows `amount` PLUSD in the queue (`transferFrom`, needs a prior `approve`). Emits `WithdrawalRequested(withdrawer, requestId, amount, queued)`. |
| `claimWithdrawal(uint256 requestId, bytes verifierSignature) -> amount` | public (request owner), `whenNotPaused` | Verifies the voucher; reverts `WithdrawalQueueTooEarly` while the request is not yet funded; pays `convertToAssets(amount)` USDC from `assetHolder` to the caller and burns the escrowed PLUSD. |
| `isClaimable(id)` / `claimableAmount()` / `queueMetadata()` / `withdrawalRequestQueued(id)` | view | `isClaimable` is `!claimed && queued[id] <= claimableAmount()`; `queueMetadata` returns `(totalQueued, totalClaimed)`. |
| `usdc()` / `plUsd()` / `assetHolder()` | view | Configured assets and the USDC source. |
| `setAssetHolder` / `setVerifier` / `setShutdownRate` / `pause` / `unpause` | restricted | `setAssetHolder` emits `AssetHolderSet`. |

- **Strict FIFO funding.** `claimableAmount() = totalClaimed + convertToShares(USDC.balanceOf(assetHolder))`. A request is claimable once its cumulative `queued` watermark is covered, so earlier requests are funded before later ones; there are no partial fills.
- **Settlement source.** `assetHolder` is an MPC address that holds the USDC and grants the queue a standing allowance; the Trustee tops it up. A claim before the top-up reverts `WithdrawalQueueTooEarly` and is retried, not lost.
- **Shutdown rate.** `convertToAssets` applies `rate / RATE_ONE` (`RATE_ONE = 1_000_000`). The rate is `RATE_ONE` (1:1) until a restricted one-way `setShutdownRate(r)` (`0 < r < RATE_ONE`) emits `Shutdown(r)`; after that, claims pay `amount * r / RATE_ONE` USDC for the full burned PLUSD.
- **No cancel.** Escrowed PLUSD stays until `claimWithdrawal`.

---

## Voucher API

`GET /v1/deposits/{request_id}/voucher` and `GET /v1/withdrawals/{request_id}/voucher`, with `wallet=<0x…>` and `chain_id=<chain id>` (required on both routes: missing, malformed, or not in `CHAINS` is `400` with `chain_id is required` / `invalid chain_id: <v>` / `unknown chain_id: <id> (configured: …)`, with no default-chain fallback; the wallet format is checked against the kind of the configured chain, so a `0x` wallet on a Stellar chain is `400`; a configured chain with no signer config is `400` `voucher signing not configured for chain <id>`). Response `{ request_id, amount, user, signature }`; `deadline` is absent on EVM.

| Status | Meaning |
|---|---|
| `200` | Voucher signed with the chain's configured EVM verifier key and domain. |
| `400` | Voucher signing is not configured for `chain_id`, or the wallet is invalid. |
| `404` | The indexer has not seen the request for that wallet yet (client keeps polling). |
| `403` | KYT screening not passed (when Crystal is enabled), or, for deposits, the profile is not yet whitelisted on-chain. |
| `409` | The request is already claimed (`RequestClaimed` indexed). |

The signer key must equal the contract's `verifier()`; the signed `(requestId, user, amount)` is taken from the indexed request, never from the client.

---

## Security Considerations

- **Verifier compromise is bounded to KYT bypass on real requests.** A voucher exists only for an enqueued request owned by the claimer; PLUSD mints only against USDC already sent to the custodian, and payouts only against escrowed PLUSD.
- **Owner-only claim.** Payouts and mints always go to the original requester; there is no redirect parameter.
- **Replay.** One-shot via the `claimed` flag; vouchers are bound to the contract domain, request id, user and amount.
- **Pause.** Restricted `pause()` freezes requests and claims on each contract independently.
- **Custody isolation.** Neither contract holds USDC; the custodian and `assetHolder` are separate MPC addresses.
