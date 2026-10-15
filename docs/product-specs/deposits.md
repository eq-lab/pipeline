# Deposits and PLUSD Minting

## Overview

A lender deposits USDC on EVM with `PipelineDepositManager.requestDeposit(amount)`: the contract enqueues a request and sends the USDC straight to the **custodian** (an MPC custody address). The API screens the request (KYT) and serves a verifier signature (voucher). The lender calls `claimDeposit(requestId, verifierSignature)` and PLUSD is minted 1:1 to the lender. The deployed contract surface, `VerifiedRequests` EIP-712 signature, rate limiter and voucher API are specified in [evm-requests-queue.md](./evm-requests-queue.md).

On Stellar there is no `DepositManager` queue: the PLUSD mint leg is a Trustee wire-in (see the last section).

`WhitelistRegistry` gates PLUSD transfers via `PLUSD._update`. See `lp-onboarding.md` for the three paths to whitelist enrolment.

---

## Behavior (EVM, deployed)

1. The lender calls `USDC.approve(DepositManager, amount)`, then `requestDeposit(amount)`. The deposit UI presents these as one user action over two transactions.
2. `requestDeposit` reverts below `minDeposit` and when the rate limiter's per-transaction or window limit is exceeded; there is no on-chain queue for over-limit deposits, the lender retries when headroom reopens.
3. The indexer records `DepositRequested`; the API runs KYT on the lender and serves the voucher (`GET /v1/deposits/{request_id}/voucher?wallet=&chain_id=`) once screening passes. Hard-fail and unscreened requests get no voucher and are dispositioned off-chain by the Trustee.
4. The lender calls `claimDeposit`; the contract verifies the voucher and mints PLUSD to the caller. The frontend polls the voucher endpoint until it is ready.

---

## Designed v2.3 model (not deployed on EVM)

The designed model parks USDC in an **Intake Wallet** and writes a per-lender ticket (`deposit(amount)`, `Pending -> Claimed | Refunded`). The Relayer signs an EIP-712 `ClaimAttestation { actionId, holder, amount, approvedAt, deadline, nonce }` with a `kytAttestor` key; `claim(depositId, att, sig)` verifies it, writes the `WhitelistRegistry` entry, moves USDC from the Intake Wallet to the Capital Wallet and mints PLUSD. Additional designed features: per-lender and global 24h caps, a `maxTotalSupply` ceiling reserving `outstandingTickets`, a 30-day `claimWindow` with a lender `refund(depositId)`, and Trustee `markRefunded` after a KYT soft-fail refund. None of these exist in `hoodi-v5`; the interfaces are in [smart-contracts-interfaces.md](./smart-contracts-interfaces.md).

---

## UI: Network Fee Estimate

The `/deposit` page shows a "Network fee" row in the Details section of the deposit card. The fee is an ETH-denominated estimate, decoupled from the user's typed amount:

- **Fixed representative amount:** `max(1000 USDC, minDeposit)` is used for the gas simulation, not the user's input. This keeps the displayed fee stable while the user types.
- **Refresh cadence:** The estimate is refreshed once per minute (`refetchInterval: 60_000 ms`).
- **Format:** Fee is displayed as `~0.00053 ETH` (ETH only, no USD equivalent — no ETH/USD price source is wired up).
- **Loading / not configured:** When the contract address is the zero address, the wallet is disconnected, or the estimate has not yet resolved, the row shows `—`.
- **Fallback:** If the gas simulation reverts (e.g., the connected wallet lacks USDC allowance), a curated constant of ~250,000 gas is used, multiplied by live `gasPrice`.

---

## API Contract

The deployed `requestDeposit` / `claimDeposit` surface, `Request` struct, events and voucher endpoint are in [evm-requests-queue.md](./evm-requests-queue.md). The designed `IDepositManager` interface is in [smart-contracts-interfaces.md](./smart-contracts-interfaces.md).

---

## Data Model

Per-chain on-chain state lives in the contract (`requests[requestId]`, `nextRequestId`, `minDeposit`, `custodian`, rate-limiter window counters); the API reads it through the indexer, never directly. Amounts are USDC base units (6 decimals) and PLUSD is minted 1:1.

---

## Stellar PLUSD Mint Leg

The Stellar leg has no `DepositManager`: an LP wires fiat/USDC to the bank, the Trustee records it as an LP bank deposit (`POST /v1/lps/{id}/bank-deposits`, #1413), and then mints the PLUSD leg from the Trustee dashboard (#1449) by invoking the yield minter **directly** — not through the executor proxy the LoanRegistry writes use, because the minter self-checks `caller.require_auth()` plus the access manager's `can_call`: `record_wire_in(caller: Address, receiver: Address, amount: i128, value_date: u64, ref_hash: BytesN<32>) -> u32`, five positional args in that order. `caller` is the Trustee's connected wallet and must hold `CASH_REPORTER` with execution delay 0 (the method requires `immediate`). `amount` is the served plain-dollar string scaled to the contract's 7 decimals; `value_date` is `occurred_at` in Unix seconds; `ref_hash` is the served `sha256(payment_reference)` and is single-use on-chain — the zero hash is refused (`MissingRef`) and a replay traps (`RefHashSeen`). `receiver` is the LP's `stellar_address` when `address_linked_at` is non-null, otherwise the dedicated Pipeline capital wallet (`VITE_STELLAR_CAPITAL_WALLET_ID`, amended 2026-10-09) — not the USDC custody account (`VITE_STELLAR_USDC_CUSTODY_ID`), which is the Deposit Manager's custody account for LP USDC deposits and must hold nothing else; the receiver must hold an authorized PLUSD trustline on the current issuer. The PLUSD issuer is auth-required, so the capital wallet and any LP settlement wallet need an authorized trustline before minting; without one `record_wire_in` traps with PLUSD `Error(Contract, #13)` ("trustline entry is missing"), which the Trustee UI reads as "The receiver has no authorized PLUSD trustline." Either way the mint is a `Direct` wire that stakes shares to the receiver. Passing the minter's own address would escrow instead (`assign_wire_in` / `return_wire_in`) — out of scope here. Per-tx and per-window mint budgets still apply. The minter emits `WireIn`, the indexer records it (#1416) and the relayer joins it on `ref_hash` to flip `is_minted`, which stays the single source of truth for the minted state — no client-side flag. See [trustee-flows.md](../frontend/trustee-flows.md) for the Trustee UI states.

## Security Considerations

- **Verifier compromise is bounded to KYT bypass, not unbacked minting.** PLUSD is minted only against a real request whose USDC already reached the custodian; the voucher is bound to `(requestId, user, amount)`.
- **The API never writes to `DepositManager`.** It only signs vouchers; compromise response is `setVerifier` rotation, which invalidates all unclaimed vouchers.
- **Owner-only claim and single use.** Only the requester can claim, once (`claimed` flag).
- **Custody isolation.** The contract holds no USDC; the custodian is a separate MPC address.
- **Rate limits and pause.** Per-transaction and per-window limits bound inflow; a restricted `pause()` freezes requests and claims.
