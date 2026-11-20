# User story: #1790 — Minter cash book read model: wire-ins, wire-outs, ramps, bank_cash and in_flight from indexed events

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1790
**Status:** Initial

---

## Overview

The API folds the Stellar minter events stored in `contract_logs` into `bank_cash` and `in_flight`, serves them with the wire-in, wire-out and ramp lists on `GET /v1/cash-book` (Trustee-only), lists an LP's own wire-outs on `GET /v1/requests`, and can feed the Stellar part of `GET /v1/capital-allocation` behind a per-chain switch. Spec: `docs/product-specs/minter-cash-book.md`.

Checks run on pipeline-test (Stellar testnet 99000001 and Hoodi 560048). Amounts compare as `floor(onchain / 10)` against `stellar contract invoke … -- bank_cash` / `in_flight` (simulated), read while `as_of_ledger` is at or past the last minter transaction.

---

## Story 1 — The operator emits a snapshot after the worker rollout

**Given** the worker image that indexes `MinterSnapshot` is live on the network and `CHAIN_99000001_STELLAR_API_MINTER_ADDRESS` is set on the API

**When** the operator calls the permissionless `snapshot()` on the testnet minter once

**Then:**

- `contract_logs` has a `MinterSnapshot` row for the minter with `params.ledger`, `bank_cash`, `in_flight`, `outstanding_total`, `unabsorbed_total`, `total_assets` and `read_failed`
- The worker log has no "minter event recognised by name but not decodable" warning for it

---

## Story 2 — Before any snapshot the totals are partial

**Given** no `MinterSnapshot` row exists for the minter

**When** a trustee calls `GET /v1/cash-book?chain_id=99000001`

**Then:**

- `summary.complete` is `false` and `summary.checkpoint_ledger` is absent
- `summary.bank_cash` and `summary.in_flight` are still dollar strings, never `null`

---

## Story 3 — The cash book matches on-chain values

**Given** Story 1 is done and every minter call has been exercised on testnet (wire-in direct and escrowed, return, assign, disburse and reverse, repay and reverse, wire-out, ramps in both directions, income, expense and correction)

**When** a trustee calls `GET /v1/cash-book?chain_id=99000001`

**Then:**

- `summary.complete` is `true`
- `summary.bank_cash` and `summary.in_flight` equal `floor(onchain / 10)` of the minter's `bank_cash` and `in_flight`
- A non-trustee token gets `403`; no token gets `401`; a missing `chain_id` gets `400`

---

## Story 4 — Expense and Correction move bank cash by their sign

**Given** `bank_cash` is read from the cash book

**When** the Trustee records an expense of X, then a correction of +Y, then a correction of -Y

**Then:**

- After the expense `bank_cash` is lower by exactly X, not 2X
- After each correction `bank_cash` moves by the signed amount

---

## Story 5 — A ramp in both directions

**Given** a `BankToUsdc` ramp and a `UsdcToBank` ramp are opened

**When** the trustee reads `summary` and `ramps`, then closes both ramps (the second with a loss)

**Then:**

- Both ramps are listed `Open`; `in_flight` grew by both amounts and `bank_cash` fell by the `BankToUsdc` amount
- After the closes both are `Closed` with `received` and `loss`; `in_flight` fell by `received + loss` for each
- `bank_cash` gained only `received` of the `UsdcToBank` ramp

---

## Story 6 — An escrowed wire-in is assigned or returned

**Given** a wire-in whose receiver is the minter (status `Escrowed`)

**When** it is assigned to an LP and another escrowed wire-in is returned

**Then:**

- The first shows `Assigned` with the new receiver and `assigned_at`
- The second shows `Returned` with `returned_at` and `return_ref_hash`, and `bank_cash` fell by its amount

---

## Story 7 — An LP sees its wire-outs on /v1/requests

**Given** an LP whose settlement address requested a wire-out that was later settled, and another that is still pending

**When** the LP's wallet calls `GET /v1/requests?wallet=<G…>&chain_id=99000001`

**Then:**

- `wire_outs` lists both, newest first, with `status` `Settled` (`settled_at`, `value_date`, `ref_hash`) and `Pending`
- With `status=pending` only the pending one is listed
- `GET /v1/cash-book` shows the same wire-outs with `lp_id` and `lp_legal_name` of the LP

---

## Story 8 — EVM is unchanged

**Given** Hoodi 560048 and no Stellar chain in the request scope

**When** `GET /v1/requests?wallet=<0x…>&chain_id=560048` and `GET /v1/capital-allocation?chain_id=560048` are called, and `GET /v1/cash-book?chain_id=560048`

**Then:**

- The first two responses are identical to their pre-deploy values and `/v1/requests` has no `wire_outs` key
- The cash book answers `404 {"error":"minter_not_configured"}`

---

## Story 9 — The switch flips Stellar buckets only when complete

**Given** the cash book matches on-chain (Story 3)

**When** `CHAIN_99000001_STELLAR_API_CAPITAL_ALLOCATION_FROM_MINTER=true` is set and `GET /v1/capital-allocation?chain_id=99000001` is called

**Then:**

- `in_transit` equals the cash book's `in_flight` and `trust_account` equals its `bank_cash`
- The chain's Trustee-entered `loan_capital_transfers` trust-account and on/off-ramp figures no longer count; `deployed` is unchanged

**And when** the flag is set while `summary.complete` is `false`

**Then:** the buckets equal the unswitched values and the API log has `capital-allocation: minter fold incomplete; using legacy sources`
