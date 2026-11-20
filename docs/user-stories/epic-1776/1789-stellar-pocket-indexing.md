# User story: #1789 — Index the Stellar Pocket; pocket state in the loan book; recoveries in LP PnL and cumulative yield

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1789
**Status:** Initial

---

## Overview

The worker indexes the five business events of the Stellar Pocket, a view seed fills pockets of loans defaulted before the key was set, and the API serves the folded pocket state in `GET /v1/loan-book`, a wallet's claims in `GET /v1/requests` and `GET /v1/pnl`, recovered interest in the dashboard cumulative yield, and the five events in the audit log. Spec: `docs/references/backend.md#stellar-pocket-indexing`.

Personas: operator (worker logs, env keys), Trustee (loan book, audit log, dashboard), LP (requests, PnL). The pocket keys are `CHAIN_<id>_STELLAR_INDEXER_POCKET_ADDRESS` (worker) and `CHAIN_<id>_STELLAR_API_POCKET_ADDRESS` (API); both are optional and unset ships dark. Stories 2 to 7 need a testnet loan drawn, defaulted and partly recovered, which does not exist yet (loan registry `next_loan_id() = 0` at the time of writing); they run in the epic QA pass #1778.

---

## Story 1 — The pocket key is set and the indexer is enabled

**Given** the testnet pocket id from `.env.example` set as `CHAIN_99000001_STELLAR_INDEXER_POCKET_ADDRESS` together with `…_LOAN_REGISTRY_ADDRESS`

**When** the worker starts

**Then:**

- It logs "Stellar Pocket indexer enabled" with the pocket id
- It does not log "pocket view seed disabled"
- Setting the same id as `MINTER_ADDRESS` or `LOAN_REGISTRY_ADDRESS` fails startup with an error naming `POCKET_ADDRESS`
- With the key unset the worker polls no pocket events and `GET /v1/loan-book` has `pocket: null` on every loan

---

## Story 2 — A default produces `PocketOpened` and the loan-book `pocket`

**Given** both pocket keys set and a loan that the Trustee defaults after the indexer started

**When** the Trustee calls `GET /v1/loan-book?chain_id=99000001`

**Then:**

- `contract_logs` has one `PocketOpened` row (`loan_id`, `amount`, `snapshot_ledger`, `supply_at_snapshot`)
- The loan's `pocket` has `complete: true`, `opened` equal to the carved-out amount and `held` equal to `opened`
- `supply_at_snapshot` is the raw sPLUSD share count, unscaled
- A loan that is not defaulted has `pocket: null`

---

## Story 3 — A carved-out repayment gives `PocketReleased`, yield and an audit row

**Given** the defaulted loan of Story 2 and a Minter `repay` for it

**When** the Trustee reads `GET /v1/audit-log`, `GET /v1/loan-book` and `GET /v1/dashboard/summary`

**Then:**

- A `PocketReleased` row exists; the audit action reads "Pocket recovery released — … principal, … interest" with scope `Loan #<id>` and an empty `reference`
- The loan's `pocket.held` dropped by the released principal and `released_total` rose by released plus interest
- `cumulative_yield_total` rose by the recovered interest at the repayment's timestamp (recovered principal does not count)
- After `CashRepaymentReversed` a `PocketUnreleased` row exists and the yield contribution is gone again

---

## Story 4 — A claim gives `pocket_claims`, `pocket_recovered` and the totals

**Given** an LP wallet that held sPLUSD at the snapshot and claims on the pocket

**When** the LP calls `GET /v1/requests?wallet=<G…>&chain_id=99000001` and `GET /v1/pnl?wallet=<G…>&chain_id=99000001`

**Then:**

- `pocket_claims` has an item `{chain_id, loan_id, amount, tx_hash, created_at}` with `amount` in raw PLUSD
- `requests[]` has no new `type`
- `pocket_recovered` equals the sum of the wallet's claims
- `total_realized_pnl` equals Σ `positions[].realized_pnl` plus `pocket_recovered`, and `total_pnl` equals `total_unrealized_pnl` plus `total_realized_pnl`
- A different wallet sees `pocket_claims: []` and `pocket_recovered: "0"`

---

## Story 5 — A zero claim is stored and audited, but not served as a claim

**Given** a wallet that held nothing at the snapshot and calls `claim`

**When** the operator and the LP read the data

**Then:**

- `contract_logs` has a `PocketClaimed` row with `paid_zero: true`
- The audit log shows "Pocket claim — nothing claimable"
- The wallet's `pocket_claims` and `pocket_recovered` do not include it

---

## Story 6 — A write-down gives `PocketBurned` and `burned_total`

**Given** the defaulted loan of Story 2

**When** the Trustee writes the loan down by an amount larger than the pocket still holds

**Then:**

- A `PocketBurned` row exists with `amount` (requested) and `burned` (what the pocket held)
- The audit action reads "Pocket write-down — {burned} burned of {amount}"
- `pocket.burned_total` rose by `burned`, not by `amount`, and `pocket.held` dropped by `burned`

---

## Story 7 — The view seed after a late key set gives `complete: false`

**Given** a loan defaulted before the pocket key was set, with the worker running with both keys

**When** the seed loop has run once (within 60 seconds)

**Then:**

- `pocket_seeds` has one row for the loan with `as_of_ledger` equal to the simulate `latestLedger`
- The loan's `pocket` has `complete: false` and `opened: null`, with totals equal to the seed
- Events after `as_of_ledger` are applied on top; events at or below it are not double counted
- A defaulted loan with no pocket yet (`NoPocket`) stays a candidate and logs only at debug level
- Claims emitted before the key was set are missing from `pocket_claims`, while `claimed_total` is right

---

## Story 8 — EVM Hoodi numbers are unchanged

**Given** an EVM chain (Hoodi) and a Stellar chain with no pocket keys

**When** the same loan-book, requests, PnL and dashboard calls are made before and after the release

**Then:**

- `cumulative_yield_total` is identical on EVM and on Stellar without the API key (carved-out interest still excluded)
- `/v1/pnl` has `pocket_recovered: null` and the same `total_realized_pnl` and `total_pnl` strings
- `/v1/requests` has `pocket_claims: []`
- Loan-book entries have `pocket: null`

---

## Story 9 — The folds equal `pocket(loan_id)` on testnet

**Given** a testnet loan that has been drawn and defaulted, with both keys set (QA pass #1778)

**When** the QA runner compares the loan-book `pocket` with the contract

**Then:**

- `stellar contract invoke --id <pocket> --network testnet --send=no -- pocket --loan_id <id>` returns `held`, `released_total`, `burned_total`, `claimed_total` and `supply_at_snapshot` that equal the loan-book `pocket` fields at 7 decimals (the API serves 6 decimals, rounded down), and `snapshot_ledger` equal
- The unit tests in `packages/shared/tests/pocket_fold.rs` replay the contract's own scenarios as event sequences; this story is the live confirmation
