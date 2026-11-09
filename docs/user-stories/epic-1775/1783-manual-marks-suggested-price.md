# User story: #1783 — Manual marks: suggested per-unit price and mark-due flags for the Trustee's revalue

**Epic:** #1775
**Issue:** https://github.com/eq-lab/pipeline/issues/1783
**Status:** Initial

---

## Overview

`GET /v1/loan-book/{loan_id}/security?chain_id=<id>` also suggests a per-unit price for every open goods record and flags the marks that are due. The Trustee submits the mark with `revalue` from the UI (#1859); the backend writes nothing. Spec: `docs/product-specs/loan-security-state.md#mark-suggestions`. Keys: `SECURITY_MARK_COMMODITIES` (API and worker), `SECURITY_MARK_MAX_AGE_SECS`, `SECURITY_MARK_MOVE_BPS`. Stories 2 to 6 need testnet SecurityRegistry records and prices, run in the epic QA pass #1777.

---

## Story 1 — The key is unset

**Given** the API runs without `SECURITY_MARK_COMMODITIES`

**When** a client reads the security state of a loan with an open goods record

**Then:**

- `suggestion_status` is `unmapped` and `suggested_mark` and `move_bps` are `null`
- A record with no mark is `mark_due: true` with `["missing"]`; an old mark is due with `["age"]`
- `prices.mark_max_age` is `"86400"` and `prices.mark_move_bps` is `200`
- A USD record or a closed record has `suggestion_status: null` and `mark_due: false`

---

## Story 2 — A mapped standard good gets a suggested mark

**Given** `gold` is mapped to `XAU` per `TroyOz` and the collector holds an `XAU` price

**When** a client reads a loan with an open `Mt` gold record

**Then:**

- `suggested_mark.value_per_unit` is `floor(price x 1e7 / 0.0311035 ...)` as a 7-decimal string, with `source_price`, `source_at`, `benchmark`, `report` and a 64-hex `report_hash` equal to the sha256 of `report`
- `move_bps` is the signed move of the suggestion against the on-chain mark

---

## Story 3 — An unmapped commodity or a missing price is explained

**Given** a record whose commodity is not in the map, another with a mapped commodity but no collected price, and one in an unsupported unit

**When** a client reads the loan

**Then** the statuses are `unmapped`, `no_price` and `unsupported_unit`, `suggested_mark` is `null`, and the route still answers `200`

---

## Story 4 — A concentrate is suggested from the loan's assay and offtake

**Given** a `MetalConcentrate` mapping, a `Dmt` record, and the loan's latest assay and offtake with each payable metal priced

**When** a client reads the loan

**Then:**

- `value_per_unit` is the net smelter return per dry tonne, never below 0, with `assay_id` and `offtake_id` set and one `metal.<ASSET>` line per metal in `report`
- With no assay or offtake the status is `inputs_missing`; an unpriced metal gives `no_price`; a hostile stored decimal such as `1e999999999` gives `unreadable`

---

## Story 5 — A mark is due by age, by move or because it is missing

**Given** a counted goods record

**When** its mark is older than `min(SECURITY_MARK_MAX_AGE_SECS, price_stale_after)`, or differs from the suggestion by more than `SECURITY_MARK_MOVE_BPS`, or does not exist

**Then:**

- `mark_due` is `true` with the reasons in the order `missing`, `age`, `moved`, and `mark_due_at` is `mark_at + the effective age`
- Exactly 24 h old and exactly a 2 % move are not due
- `prices.marks_due` counts the due records, and is `null` when any mark time cannot be decoded

---

## Story 6 — The price collector is unchanged without the map

**Given** the worker runs without `SECURITY_MARK_COMMODITIES`

**When** the asset price collector runs a cycle

**Then** it collects exactly today's `(asset, provider)` list and runs no SecurityRegistry query; with the map set it also collects the mapped open goods commodities and the payable metals of mapped concentrates
