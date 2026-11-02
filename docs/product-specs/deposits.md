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

### Voucher validity

The voucher the API serves for a request is valid for 24 hours. On Stellar the response carries the signed `deadline` (u64 unix seconds, string); on EVM the signature does not cover a deadline, so none is served today and the validity is not enforced (backend follow-up #1798).

The LP app treats a voucher whose served `deadline` has passed as absent: the hook reports `pending` (never `ready`, never `failed`), hides the voucher data and signature, and refetches. While a voucher with a deadline is ready, the hook schedules a refetch for the moment the deadline passes, so a tab left open goes back to pending and then ready with the fresh voucher. The served `deadline` is the only clock; the app holds no 24-hour constant and shows no countdown.

If a Stellar claim still fails with the deadline-expired contract error (`Error(Contract, #4)`, for example under clock skew), the app resets the voucher query once per request id and shows "The voucher expired or did not match the request. Your app fetches a fresh voucher." A second failure for the same request keeps the error visible. A bad signature is a host crypto error, not a voucher expiry, and is never retried.

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

## LP Funding Details

`GET /v1/lps/me/payment-details?chain_id=<id>` (LP session; `LpBankDeposits` group, Issue #1815, which settles #1311 and #1700; chain-aware since #1824) answers `200 OK` with the trust account's receiving bank details, a **newly issued** payment reference for the LP to quote on the wire, and the chain and settlement address the PLUSD will be minted to:

```json
{
  "company_name": "",
  "bank_name": "",
  "bank_address": "",
  "account_number": "",
  "iban": "",
  "swift_bic_code": "",
  "payment_details": "PL-7K3M-Q9TX-H2CD",
  "chain_id": 1,
  "receiver_address": "G…"
}
```

`HEAD` on the same path answers `405 Method Not Allowed` with `Allow: GET` and never touches the DB, so a probe or prefetch cannot mint a reference (axum would otherwise serve `HEAD` through the `GET` handler).

By user decision this is a `GET` with a side effect: every successful call issues and stores a new reference, and nothing is reused. The response carries `Cache-Control: no-store`, so no HTTP cache serves one LP's reference again. The client calls it exactly once each time it shows the funding details (one modal open), with automatic refetching and retries off (`staleTime: Infinity`, and `refetchOnWindowFocus`, `refetchOnMount` and `retry` all off), so the history holds only references that were actually shown. Client wiring is #1817.

- **Bank details.** One system-wide record (`system_configuration`, type `system_bank_details`), seeded empty and set by hand in the DB. There is no write endpoint. The DB enforces that the record is an object with all six keys as strings. Values are served verbatim, and an empty field is served as `""`, which the client renders as `—`.
- **Chain.** `chain_id` is required (`RequiredChain`): missing, malformed or not in `CHAINS` is `400`. The chain's kind picks the settlement address: Stellar uses `lps.stellar_address`, EVM uses `lps.evm_address`. The response echoes `chain_id` and that `receiver_address`.
- **Access.** The LP needs a linked settlement address **of the requested chain's kind** (see [kyb-lp-verification.md](./kyb-lp-verification.md) § Settlement Address) **and** `kyb_status = Passed`. Otherwise the response is `409`, naming every unmet precondition and the kind, and no reference is issued. No LP for the caller (including a trustee token) is `404`. A missing or malformed bank-details record is `500`, and no reference is issued. `Passed` is terminal and the address is fixed once `Passed` holds one, so the gate cannot stop being true between the check and the insert.
- **Reference.** Every successful call inserts a row into `lp_requested_bank_details` (`lp_id`, `chain_id`, `receiver_address`, `payment_details`, `created_at`). Rows issued before #1824 have `chain_id NULL`, with `receiver_address` backfilled from `lps.stellar_address`; the migration cannot tell which configured chain is the Stellar one. Every new row must carry both, enforced by `NOT VALID` CHECK constraints that must never be validated. The full history is kept, earlier references stay valid and still belong to that LP, and `lp_id` is not unique. The format is `PL-XXXX-XXXX-XXXX`: a fixed `PL-` prefix and 12 symbols of the Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no `I`, `L`, `O`, `U`), 60 bits from the OS CSPRNG, 17 characters. It is random, not derived from the LP id, so it reveals neither the LP nor how many references were requested. It fits the 18-character UK Faster Payments / BACS reference field and a single 35-character SWIFT field-70 line, and the charset is a subset of `[A-Z0-9-]`. It is unique across every reference ever issued (`UNIQUE` plus a `^[A-Z0-9-]{1,140}$` CHECK); on a collision the handler draws again, up to 3 attempts, then answers `500`.
- **Wire matching (follow-up).** Attributing an arriving wire finds the LP by **any** reference ever issued to it, comparing with `-` and whitespace removed, since a bank may strip the hyphens. Not part of #1815.
- **Not the per-wire reference.** The issued reference is **not** `lp_bank_deposits.payment_reference`, which is the bank's per-wire reference, unique per deposit and hashed into the minter's single-use `ref_hash`. An LP may quote one issued reference on more than one wire.
- **Deploy prerequisite.** The seeded `system_bank_details` row is all empty strings, and an eligible LP is still issued a reference against blank details. There is no deploy checklist or runbook in `docs/`, so this is recorded here: fill `system_configuration.system_bank_details` with the real trust-account details before #1817 (Funding details modal) ships.
- **Known gap.** There is no rate limit or per-LP cap on how many references an eligible LP can request (TD-159).

---

## Stellar PLUSD Mint Leg

The Stellar leg has no `DepositManager`: an LP wires fiat/USDC to the bank, the Trustee records it as an LP bank deposit (`POST /v1/lps/{id}/bank-deposits`, #1413), and then mints the PLUSD leg from the Trustee dashboard (#1449) by invoking the yield minter **directly** — not through the executor proxy the LoanRegistry writes use, because the minter self-checks `caller.require_auth()` plus the access manager's `can_call`: `record_wire_in(caller: Address, receiver: Address, amount: i128, value_date: u64, ref_hash: BytesN<32>) -> u32`, five positional args in that order. `caller` is the Trustee's connected wallet and must hold `CASH_REPORTER` with execution delay 0 (the method requires `immediate`). `amount` is the served plain-dollar string scaled to the contract's 7 decimals; `value_date` is `occurred_at` in Unix seconds; `ref_hash` is the served `sha256(payment_reference)` and is single-use on-chain — the zero hash is refused (`MissingRef`) and a replay traps (`RefHashSeen`). `receiver` is the LP's `stellar_address` when `address_linked_at` is non-null, otherwise the dedicated Pipeline capital wallet (`VITE_STELLAR_CAPITAL_WALLET_ID`, amended 2026-10-09) — not the USDC custody account (`VITE_STELLAR_USDC_CUSTODY_ID`), which is the Deposit Manager's custody account for LP USDC deposits and must hold nothing else; the receiver must hold an authorized PLUSD trustline on the current issuer. The PLUSD issuer is auth-required, so the capital wallet and any LP settlement wallet need an authorized trustline before minting; without one `record_wire_in` traps with PLUSD `Error(Contract, #13)` ("trustline entry is missing"), which the Trustee UI reads as "The receiver has no authorized PLUSD trustline." Either way the mint is a `Direct` wire that stakes shares to the receiver. Passing the minter's own address would escrow instead (`assign_wire_in` / `return_wire_in`) — out of scope here. Per-tx and per-window mint budgets still apply. The minter emits `WireIn`, the indexer records it (#1416) and the relayer joins it on `ref_hash` to flip `is_minted`, which stays the single source of truth for the minted state — no client-side flag. See [trustee-flows.md](../frontend/trustee-flows.md) for the Trustee UI states.

## Security Considerations

- **Verifier compromise is bounded to KYT bypass, not unbacked minting.** PLUSD is minted only against a real request whose USDC already reached the custodian; the voucher is bound to `(requestId, user, amount)`.
- **The API never writes to `DepositManager`.** It only signs vouchers; compromise response is `setVerifier` rotation, which invalidates all unclaimed vouchers.
- **Owner-only claim and single use.** Only the requester can claim, once (`claimed` flag).
- **Custody isolation.** The contract holds no USDC; the custodian is a separate MPC address.
- **Rate limits and pause.** Per-transaction and per-window limits bound inflow; a restricted `pause()` freezes requests and claims.
