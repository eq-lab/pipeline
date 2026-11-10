# Cash reporter bookings

> How the Trustee app books incoming wires, repayments and bank income on the Stellar minter, and how it gates them on the Cash reporter role. UI flow: [trustee-flows.md](../frontend/trustee-flows.md#cash-reporter-bookings). Source of truth: `docs/user-docs/how-it-works/capital-layer.md` (cash-book table), `docs/user-docs/governance/fiduciary-trustee.md`, `docs/user-docs/governance/multisig-roles.md`, `docs/user-docs/security/capital-safeguards.md` (Deposit manager and minter).

---

## Role

Repayments, incoming wires and bank income are booked by a separate role, the Cash reporter, not by the Trustee. On the Stellar minter the AccessManager maps `record_income`, `record_wire_in` and `repay` to `CASH_REPORTER`. `record_expense` and `close_loan` stay with the Trustee role and are not part of this spec.

| Function | Signature | Copy when the wallet lacks the role |
|---|---|---|
| `record_wire_in` | `(caller: Address, receiver: Address, amount: i128, value_date: u64, ref_hash: BytesN<32>) -> u32` | Only the Cash reporter can book incoming wires. |
| `repay` | `(caller, loan_id: u32, repayment, value_date: u64, ref_hash, sale_id: u32) -> u32` | Only the Cash reporter can book repayments. |
| `record_income` | `(caller: Address, delta: i128, value_date: u64, ref_hash: BytesN<32>) -> ()` | Only the Cash reporter can book bank income. |

Wire and repayment details: [deposits.md](./deposits.md#stellar-plusd-mint-leg), [loan-repay-minter.md](./loan-repay-minter.md). Wallet-to-minter caller auth is `caller.require_auth()` plus the AccessManager's `can_call`.

## Gating rule

- The app reads `AccessManager.can_call(wallet, minter, fn)` for the connected Stellar wallet. A booking is enabled only when `immediate` is true, which means execution delay 0.
- It fails closed: disabled while the read is pending ("Checking this wallet's Cash reporter role…"), on a read error ("Could not verify this wallet's Cash reporter role."), and with a delay ("This wallet holds the Cash reporter role with a {h} h delay; the minter accepts only immediate calls."). Being a Trustee never enables a booking.
- No `can_call` read runs on EVM sessions.

## `record_income`

- `delta` is the amount in USD at 7 decimals and must be greater than 0 (negative reverts `#6`). The app takes at most 2 decimals.
- `value_date` is the UTC-midnight Unix seconds of the entered date, not in the future.
- `ref_hash = sha256(reference.trim())` over UTF-8, the same derivation as the backend's wire `reference_hash`. The zero hash reverts `#28` (`MissingRef`). The consumed set is shared with wires, so one bank reference can be booked once across wires and income.
- The app reads `ref_hash_seen(ref_hash)` before the signature request (also for Mint PLUSD) and refuses a consumed reference without prompting the wallet.
- The call mints `delta` PLUSD to sPLUSD through `am.execute(PLUSD, mint, ...)`, counts against the per-tx and per-window mint limits (served config: 1,000,000 per tx, 10,000,000 per 24 h), and returns nothing. The app shows the transaction hash; the indexed `CashRecorded` appears in the Audit Log as "Cash recorded — Income $X".
- Minter error codes collide with nested PLUSD and AccessManager codes, so the app adds no code-specific copy beyond the pre-checks.

## EVM

Read-only. `@pipeline/wallet-connect` has only calldata encoders for the EVM minter and no write client or AccessManager read (TD-152, #1573). Mint PLUSD, Record Coupon / Repayment and Bank income stay disabled with their existing reasons.

## Verified on Stellar testnet, 2026-11-09 (simulation, nothing submitted)

| Check | Result |
|---|---|
| Role map | `record_income`, `record_wire_in`, `repay` map to `CASH_REPORTER`; `record_expense` to `TRUSTEE` |
| `can_call` for the three functions | `{immediate: true, delay: 0}` for both configured trustee wallets |
| `record_income` with the zero hash / `delta < 0` | `Error(Contract, #28)` / `Error(Contract, #6)` |
| `record_income` or `record_wire_in` with valid input | `Error(Contract, #1)` raised by the AccessManager on the nested `PLUSD.mint` |
| `ref_hash_seen(0x00…)` | `false` |

The last row is BUG-32: the minter lacks the PLUSD `MINTER` role (`can_call(minter, PLUSD, mint).immediate = false`), so no mint completes on testnet until ops grants it. The gating and pre-checks are verifiable now.

## Deferred

Two-signer (2-of-2) Cash reporter signing (build, collect two signatures, submit, show "awaiting second signature") waits on ops/contracts confirming how the 2-of-2 is realised per chain. Follow-up issue: "Trustee: two-signer (2-of-2) Cash reporter signing for wire-in, repayment and bank-income bookings", which also decides whether a Cash-reporter-only wallet may sign in to the console.
