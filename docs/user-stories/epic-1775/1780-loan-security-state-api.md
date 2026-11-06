# User story: #1780 — API: loan security state — terms, collateral value, debt, LTV, margin call, records

**Epic:** #1775
**Issue:** https://github.com/eq-lab/pipeline/issues/1780
**Status:** Initial

---

## Overview

One public read, `GET /v1/loan-book/{loan_id}/security?chain_id=<id>`, serves the Stellar SecurityRegistry state of a loan from the tables #1779 projects: terms, the `coverage_detail` valuation, margin-call state, price staleness, pause state, inspectors, extension consents, and every record with docs, mark, lot, inspections, flag and linked minter repayments. Spec: `docs/product-specs/loan-security-state.md`.

Persona: a frontend (#1767, #1856 to #1859) or an operator with `curl`. The key is `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS`, equal to the indexer key. Stories 3 to 7 need testnet writes on the SecurityRegistry and the minter, which run in the epic QA pass #1777.

---

## Story 1 — The key is unset, or the chain is EVM

**Given** the API runs without `CHAIN_99000001_STELLAR_API_SECURITY_REGISTRY_ADDRESS`, or the request names an EVM chain

**When** a client calls `GET /v1/loan-book/7/security?chain_id=<id>`

**Then:**

- The answer is `404 {"error":"security_registry_not_configured"}` and no database read happens
- A missing, malformed or unknown `chain_id` answers `400`; a malformed `loan_id` such as `abc` or `1e999999999` answers `400`
- Every other endpoint on pipeline-test behaves as before, and an invalid Strkey in the key fails API boot naming it

---

## Story 2 — A loan with no terms returns empty state

**Given** the key is set and loan id 9999 has no SecurityRegistry rows

**When** a client calls `GET /v1/loan-book/9999/security?chain_id=99000001`

**Then:**

- The answer is `200` with `terms: null`, `valuation: null`, `margin_call: null`, `prices: null` and `records: []`
- `loan_status` is `null` when the loan is not in the loan registry
- `paused` and `inspectors` come from `security_registry_state`

---

## Story 3 — Terms, a record and a revalue are served, and match `coverage_detail`

**Given** a loan with terms set, one registered and perfected record, and a `revalue` mark

**When** the worker has folded (within about 60 s, `refresh_pending` is `false`) and a client calls the route

**Then:**

- `terms` equals the `terms_set` arguments, `records[0].mark` equals the `revalue` mark, and every amount is a 7-decimal string such as `"1250.0000000"`
- `valuation.value`, `debt`, `ltv_bps` and `coverage_bps` equal `stellar contract invoke … -- coverage_detail --loan_id <id>` at `valuation.as_of.detail_ledger`; with no debt, `coverage_bps` is `4294967295` as a JSON number
- `records[0].valuation.value` equals `floor(counted_quantity × value_per_unit / 1e7)`
- Right after a write `refresh_pending` is `true` until the next fold

---

## Story 4 — An open margin call keeps its `cure_by` after `set_terms`

**Given** a margin call opened by a revalue, then `set_terms` changing `cure_period`

**When** a client calls the route

**Then:**

- `margin_call.open` is `true` and `opened_at` is the call's ledger time
- `margin_call.cure_by` equals the `cure_by` of the `SecurityMarginCall` event and `cure_by_source` is `event`, although `coverage_detail.cure_by` now uses the new period
- `last_margin_call_ltv_bps` equals the event's `ltv_bps`, and `events[]` lists `open`, later `price_stale` and `cured` rows in order
- Past `cure_by` the call shows `cure_overdue: true`; with LTV at or below the advance ratio it shows `open_call_curable: true`

---

## Story 5 — Inspections and a flag are served inline

**Given** an inspection recorded, approved and flagged, then resolved with `resolve_flag`

**When** a client calls the route

**Then:**

- `records[0].inspections[]` carries the inspection with variances, `flagged`, `resolution` and `resolved_at`, in `inspection_id` order, and `is_lot_latest` marks the lot's latest one
- `records[0].flagged_by` is the flagging inspection id while flagged and `null` after resolution
- `records[0].lot.latest_quantity` and `inspection_stale` follow the latest inspection

---

## Story 6 — An enforced record shows its linked minter repayment

**Given** a record that is `Enforced`, and a minter `repay` with `sale_id` equal to that record id

**When** a client calls the route

**Then:**

- `records[0].repayments[]` lists the repayment with `cash`, `interest_minted`, `fee_shares`, `value_date`, `ref_hash` and `tx_hash`
- After a `reverse_repayment` of it, `reversed_at` is set
- Repayments of another sale id do not appear on this record

---

## Story 7 — A closed loan with an open record is served without alarm

**Given** a loan closed in the loan registry while a record is still `Active`, and a margin call still open on-chain

**When** a client calls the route

**Then:**

- `loan_status` is `Closed` and the open record is served unchanged with `open: true`
- `records[0].agent_release` is `allowed` (outstanding is 0), so the Security Agent can release it
- `cure_overdue` and `ltv_above_ratio_no_onchain_call` are `false`, and the open call shows `open_call_curable: true`
