# Loan Security State

## Overview

`GET /v1/loan-book/{loan_id}/security?chain_id=<id>` serves the Stellar SecurityRegistry state of one loan: terms, the collateral valuation, margin-call state, price staleness, pause state, the inspector panel, extension consents, and every record with its docs, mark, lot, inspections, flag and linked minter repayments. It is read from the projection tables the worker folds every 30 s ([security-registry-events.md](../references/security-registry-events.md#projection-tables)). The API has no RPC client and never recomputes the loan's value, LTV or coverage: it serves the `coverage_detail` snapshot the worker stored. On-chain inspections are served here (the read side of #1782).

Scope is Stellar only. The route needs `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS`, equal to the worker's `…_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS`. A chain without it, including every EVM chain, answers `404 {"error":"security_registry_not_configured"}`.

## Behavior

**Read or computed.** Every field is read from a table unless listed as computed.

| Field | Source |
|---|---|
| `terms.*`, `margin_call.open`, `opened_at` | `security_terms` (`margin_call_at` is event-folded, so fresher than the snapshot) |
| `valuation.value`, `stale_value`, `flagged_value`, `debt`, `ltv_bps`, `coverage_bps`, `price_stale` | `security_loan_valuations` (`coverage_detail` at `detail_ledger`), verbatim |
| `valuation.outstanding`, `accrued_interest` | the same row (`loan_money` at `money_ledger`, a separate simulate; it can differ from `debt` by a ledger of interest, TD-171) |
| `records[].valuation.counted_quantity`, `value_per_unit`, `mark_at`, `stale`, `flagged` | the `counted_records` of the same snapshot |
| `records[].valuation.value` | computed per record: goods `floor(counted_quantity × value_per_unit / 1e7)`, other `counted_quantity`. The contract divides once over the sum, so the values can sum a few raw units above `valuation.value` |
| `margin_call.cure_by` | the `cure_by` of the `open` event whose `block_timestamp` equals `margin_call_at` (fixed at opening, `lib.rs:994-1006`); else the snapshot's, when its `margin_call_at` matches (it is recomputed as `margin_call_at + current cure_period`, `lib.rs:785-789`, so it drifts after `set_terms`). `cure_by_source` is `event`, `coverage_detail` or `null` |
| `margin_call.cure_overdue` | computed: open, not `Closed`, `now > cure_by`. Nothing on-chain enforces `cure_by` |
| `margin_call.ltv_above_ratio_no_onchain_call` | computed: no call open, a valuation exists, `valuation.ltv_bps > margin_call_ratio_bps`, loan not `Closed` |
| `margin_call.open_call_curable` | computed: a call is open, a valuation exists, `valuation.ltv_bps <= advance_ratio_bps` (a `check_coverage` would cure it, `lib.rs:986-990`) |
| `margin_call.last_margin_call_ltv_bps`, `last_price_stale`, `events[]` | `security_margin_call_events` |
| `prices.mark_age`, `price_stale`, `records[].mark_stale`, `attestation_stale`, `inspection_stale` | computed at the API clock `now` from the projection |
| `records[].counts_toward_value` | computed: `Active` and not `InsuranceLossPayee` |
| `records[].agent_release` | computed from the snapshot: `allowed` when the Security Agent's own `release` passes `ensure_releasable` (`lib.rs:1199-1216`), else `needs_consent` (the Risk Council's `release_with_consent`). `PendingPerfection`, `InsuranceLossPayee` and zero outstanding are `allowed` before any snapshot is needed; the LTV branch is `null` without a snapshot or when a counted record cannot be resolved; `null` for a closed record |
| `records[].repayments[]` | minter `CashRepaid` rows with this loan and `sale_id == record_id`, with the earliest `CashRepaymentReversed` of the same repayment. A repayment links only when it is at or after the record's `SecurityEnforcementStarted` or `SecurityRecordEnforced` event on this loan, because minter sale ids collide with legacy CollateralRegistry ids |
| `paused`, `inspectors` | `security_registry_state` |
| `refresh_pending` | computed: the loan has SecurityRegistry log rows newer than the projection watermark, or SecurityRegistry or loan-registry log rows newer than the valuation's `source_log_id` |

**Closed loans.** `close_loan` does not check open records (`loan-registry/src/lib.rs:564-614`). Records are served unchanged, open ones included. With outstanding 0, `agent_release` is `allowed`. A closed loan carries no alarm: `cure_overdue` and `ltv_above_ratio_no_onchain_call` are `false`, and a call still open on-chain shows `open_call_curable: true`.

**Freshness.** The fold runs every 30 s and the valuation refreshes when a log row is newer or the last read is older than 5 min with debt above 0, so a write shows within one or two cycles. `refresh_pending: true` means the served state lags; poll until it is `false`. `valuation.*` is as of `detail_ledger`. The computed staleness flags use the API clock (`now`, in the response); the contract uses the ledger timestamp, so a flag can flip a few seconds apart from the contract's at the boundary. All tables are read in one `REPEATABLE READ, READ ONLY` transaction, so the response never mixes two projection versions.

`loan_status` is read in the same transaction as the projection, from the loan registry the valuation was read from (the configured one when there is no snapshot). A difference from the configured key is logged.

**View-seeded loans.** Rows with `complete = false` have partial history (no opening `cure_by`, `view` doc provenance, missing `flagged`). The flags are passed through, never guessed.

**Nulls.** `terms: null` means the loan has no terms; then `valuation`, `margin_call` and `prices` are `null` and `records` is `[]`. `valuation: null` means no snapshot yet: the margin-call flags are `false` and record `valuation` and `agent_release` are `null`. `loan_status: null` means the loan is not indexed in the loan registry. An unknown loan id returns `200` with `terms: null`. A stale or flagged record counts in `value`; its `attestation_stale` and `inspection_stale` are `null` unless the record is `Active`.

## Computed Fields

The contract mirrors live in `shared::security_state`, so the alerts (#1784) and readiness (#1785) reuse them. Line numbers are `pipeline-stellar-contracts@e9881ac`, `contracts/security-registry/src/lib.rs`.

| Function | Mirrors |
|---|---|
| `ltv_bps(debt, value)` | `ltv_bps`, `954-965`: 0 without debt; `u32::MAX` when `value <= 0` or on overflow; else `ceil(debt × 10000 / value)` |
| `coverage_bps(debt, value)` | `coverage_bps`, `944-951`, with `coverage`'s zero-debt rule (`738-745`, `781-785`): `floor(max(value, 0) × 10000 / debt)`; `u32::MAX` without debt or on overflow |
| `counted_value_excluding(terms, exclude)` | `valuation`, `897-916`: goods `qty × value_per_unit`, other `qty × 1e7`, summed with checked adds and divided by `1e7` once; `None` where the contract panics with `Overflow` |
| `record_term_value(term)` | `record_term`, `868-888`, per record |
| `agent_release(…)` | `ensure_releasable`, `1199-1216` |
| `attestation_stale`, `inspection_stale`, `mark_stale` | `is_stale`, `918-942`, and `record_term`, `868-888` |
| `mark_age`, `price_stale` | `mark_age`, `807-827`, and the per-record price-stale rule |
| `counts_toward_value`, `is_in_storage` | `Protection::counts` (`types.rs`) and the `is_stale` storage test |
| `cure_by(…)` | the event-over-snapshot rule above |
| `format_7dp`, `format_7dp_i128` | exact `raw / 1e7` as a plain 7-decimal string, never an exponent |

Stored decimals are read with a bounded exponent: Postgres decoding returns round numbers with a negative exponent (`12500000000` as `125E+8`), which is rescaled; an exponent below -40 or above 20000 is rejected, never expanded. An undecodable number is served as `null`, and every flag that depends on it is `null` (unknown), never `false` or `0`.

## API Contract

`GET /v1/loan-book/{loan_id}/security?chain_id=<id>`, public (every field is on-chain data). `chain_id` is required: `400` when missing, malformed or not in `CHAINS`. `loan_id` is a `u32`: `400` otherwise. `404 security_registry_not_configured` when the chain has no API SecurityRegistry key (checked before any database read). `500` on a database error.

**Encoding.** Ids, `u64` times and `u64` durations are decimal strings (`mark_age` can be `u64::MAX`). `u32` bps, `i32` variances and `default_rate` are JSON numbers. `ltv_bps` and `coverage_bps` keep `4294967295` as the `u32::MAX` sentinel. `i128` and `u128` amounts and quantities, grades and prices are exact 7-decimal strings (`raw / 1e7`, e.g. `"1250.0000000"`). Hashes are lowercase hex and addresses are Strkeys, as stored.

```json
{ "chain_id": 99000001, "loan_id": "7", "security_registry": "C...", "now": "1762400000",
  "loan_status": "Performing", "paused": false, "inspectors": ["G..."], "refresh_pending": false,
  "terms": { "advance_ratio_bps": 8000, "margin_call_ratio_bps": 8500, "cure_period": "604800",
    "price_stale_after": "86400", "payment_term": "Lc", "grace_period": "0", "default_rate": 0,
    "attestation_interval": "0", "inspection_interval": "0", "tolerance_bps": 200,
    "grade_tolerance_bps": 100, "set_ledger": 123, "complete": true },
  "valuation": { "value": "0.0000000", "stale_value": "0.0000000", "flagged_value": "0.0000000",
    "debt": "0.0000000", "outstanding": "0.0000000", "accrued_interest": "0.0000000",
    "ltv_bps": 0, "coverage_bps": 4294967295, "price_stale": false,
    "as_of": { "detail_ledger": 1, "money_ledger": 1, "fetched_at": "ISO" } },
  "margin_call": { "open": false, "opened_at": null, "cure_by": null, "cure_by_source": null,
    "cure_overdue": false, "last_margin_call_ltv_bps": null,
    "last_price_stale": { "ltv_bps": 9000, "at": "..." },
    "ltv_above_ratio_no_onchain_call": false, "open_call_curable": false,
    "events": [{ "kind": "open|price_stale|cured", "ltv_bps": 9000, "margin_call_ratio_bps": 8500,
                 "cure_by": "...", "at": "...", "block_number": 1, "tx_hash": "..." }] },
  "prices": { "mark_age": "0", "price_stale": false },
  "extension_consents": [{ "position": 0, "consent_hash": "hex", "new_maturity": "...", "ledger": 1, "at": "..." }],
  "records": [{ "record_id": "1", "lot_id": "1", "protection": "WarehousePledge", "commodity": "...",
    "unit": "Mt", "reference_quantity": "...", "reference_grade": "...", "region": "...",
    "site_hash": "hex", "control_kind": "Agent", "control_reference": "...", "perfection": "...",
    "release_condition": "hex", "status": "Active", "open": true, "perfected_at": "...",
    "attested_by": "G...", "attested_at": "...", "flagged_by": null, "registered_ledger": 1,
    "closed_ledger": null, "release_reason_hash": null, "released_by_consent": null,
    "complete": true, "needs_view": false,
    "docs": [{ "position": 0, "kind": "WarehouseReceipt", "sha256": "hex", "source": "register", "ledger": null }],
    "mark": { "value_per_unit": "...", "at": "...", "benchmark": "LME", "report_hash": "hex" },
    "lot": { "latest_inspection_id": "2", "latest_inspected_at": "...", "latest_quantity": "...", "complete": true },
    "counts_toward_value": true, "attestation_stale": false, "inspection_stale": false, "mark_stale": false,
    "valuation": { "counted_quantity": "...", "value_per_unit": "...", "mark_at": "...", "value": "...",
                   "stale": false, "flagged": false },
    "agent_release": "allowed|needs_consent",
    "inspections": [{ "inspection_id": "2", "inspector": "G...", "kind": "StockCount", "inspected_at": "...",
      "quantity": "...", "grade": "...", "entered_by": "G...", "approved_by": null, "flagged": null,
      "resolution": null, "is_lot_latest": false, "complete": true, "needs_view": false }],
    "repayments": [{ "repayment_id": "3", "cash": "...", "interest_minted": "...", "fee_shares": "...",
      "value_date": "...", "ref_hash": "hex", "tx_hash": "...", "at": "...", "reversed_at": null }] }] }
```

The inspection object carries every `security_inspections` column (region, site and certificate hashes, `certificate_no`, `entered_at`, `approved_at`, the three variances, `resolution_reason_hash`, `resolved_at`); the example shortens it. Records are ordered by `record_id`, open and closed; `open` is `status` not `Released` and not `Enforced`. `docs` are ordered by `position` and `inspections` by `inspection_id`; `flagged_by` is `null` when there is no flag. `is_lot_latest` is `inspection_id == lot.latest_inspection_id`. `repayments` is `[]` for a record with no sale, and joins on `sale_id`, so it is served for any status (an `Enforced` record is the usual one). Repayment rows are not pinned to one minter address, so repayments booked on an older minter still link.

## Data Model

No table or migration. The route reads the tables in [security-registry-events.md](../references/security-registry-events.md#projection-tables) and the minter `CashRepaid` / `CashRepaymentReversed` rows of `contract_logs`. Every read is scoped by `chain_id` and the configured `contract_address`, except the minter repayment join, which is scoped by chain, loan and sale id.

## Security

Public and read-only. The response is on-chain data only: no personal data, no RPC call, no write. Operator wallets (`entered_by`, `approved_by`, `attested_by`) are on-chain addresses and are not mapped to accounts. AccessManager roles (`can_call`) and the record NFT holder are not indexed and not served. `loan_id` is parsed as a `u32`, never as an arbitrary decimal, so a request cannot make the server expand a huge exponent.
