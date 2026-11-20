# User story: #1940 — API: /security and loan-book LTV fields for EVM chains

**Epic:** #1937
**Issue:** https://github.com/eq-lab/pipeline/issues/1940
**Status:** Initial

---

## Overview

The API serves the EVM SecurityRegistry state through the same code that serves Stellar (#1780, #1786 Phase 1): `GET /v1/loan-book/{loan_id}/security?chain_id=<id>`, the loan-book `ltv_bps`, `margin_call_open` and `price_stale`, and the attention-count `margin_call_open`. It reads the tables the EVM indexer (#1938) projects. EVM strings are exact 6-dp decimals, `agent_release` uses the contract's facility debt, and the route adds the EVM-only `terms.default_ratio_bps`, `terms.originator_fee_rate` and `default_breach`. Spec: `docs/product-specs/loan-security-state.md` and `docs/product-specs/loan-security-state-evm.md`.

Persona: a frontend (#1942, #1943) or an operator with `curl`. The keys are `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS` and `CHAIN_<id>_EVM_API_SECURITY_RECORD_NFT_ADDRESS`, set together and equal to the indexer's. The Hoodi chain id is 560048 and the addresses are those of `pipeline-contracts` `deployments/hoodi-v5.json`: registry `0xB51E7f13420D106946376A67Fe5921C63B09BE15`, RecordNft `0xf64302337Ad1F5A66b5f023F8ffd26074a68bA09`. Set them only after the worker's three EVM keys are live and the cursor is rewound. Stories 3 to 8 need Hoodi writes on the SecurityRegistry and run in the epic QA pass.

---

## Story 1 — The keys are unset, partial or Stellar-named on EVM

**Given** the API runs on Hoodi (chain 560048) without the two EVM keys

**When** a client calls `GET /v1/loan-book/7/security?chain_id=560048`

**Then:**

- The answer is `404 {"error":"security_registry_not_configured"}` and no database read happens
- The loan-book entries of the chain carry `ltv_bps`, `margin_call_open` and `price_stale` as `null`, and the chain's `margin_call_open` in `GET /v1/attention-counts` is `null`
- Setting only one of the two keys fails API boot with an error naming the missing key and saying the keys are set together
- A malformed address in either key fails boot naming that key
- Setting `CHAIN_560048_STELLAR_API_SECURITY_REGISTRY_ADDRESS` on the EVM chain, or an EVM key on a Stellar chain, fails boot naming the key
- A missing, malformed or unknown `chain_id` answers `400`, and a `loan_id` that is not a `u32` (`abc`, `1e999999999`, an id above `4294967295`) answers `400`

---

## Story 2 — A loan with no terms returns empty state

**Given** both keys set and loan id 9999 has no SecurityRegistry rows

**When** a client calls `GET /v1/loan-book/9999/security?chain_id=560048`

**Then:**

- The answer is `200` with `terms: null`, `valuation: null`, `margin_call: null`, `default_breach: null`, `prices: null` and `records: []`
- `pending_operations` is `[]`
- `paused` and `inspectors` come from `security_registry_state`, and `inspectors` are EIP-55 addresses

---

## Story 3 — Terms, a record and a revalue are served as 6-dp strings and match `coverageDetail`

**Given** a loan with terms set (including `defaultRatioBps` and `originatorFeeRate`), one registered and perfected goods record, and a `revalue` mark

**When** the worker has folded (within about 60 s, `refresh_pending` is `false`) and a client calls the route

**Then:**

- `terms` equals the `TermsSet` arguments, with `default_ratio_bps` and `originator_fee_rate` as numbers
- Every amount is an exact 6-dp string such as `"1250.000000"`, and `records[0].mark.value_per_unit` equals the `revalue` mark
- `valuation.value`, `ltv_bps` and `coverage_bps` equal `Reader.coverageDetail(loanId)` at `valuation.as_of.detail_ledger`; `valuation.debt` equals its `debt`, which is the facility debt and can exceed `outstanding + accrued_interest`
- `records[0].valuation.value` equals `floor(counted_quantity × value_per_unit / 1e6)`
- `records[0].agent_release` is `allowed` exactly when `Reader` facility debt over the other records' value is at or below the advance ratio
- The same request on a Stellar chain returns `terms.default_ratio_bps: null`, `terms.originator_fee_rate: null` and `default_breach: null`, with 7-dp strings

---

## Story 4 — A margin call keeps its `cure_by`, and a default breach is served apart

**Given** a margin call opened by a revalue, then a default breach that opens and later clears

**When** a client calls the route

**Then:**

- `margin_call.cure_by` is the `cure_by` of the `MarginCall` event with `cure_by_source: "event"`, and `margin_call.events` lists only `open`, `price_stale` and `cured` rows
- While the breach is open, `default_breach.open` is `true`, `opened_at` is the breach time, `last_default_breach_ltv_bps` is the event's `ltv_bps` and `events` lists `default_breach` and any `default_breach_price_stale`
- With LTV at or below `default_ratio_bps`, `open_breach_clearable` is `true`
- After the clear, `default_breach.open` is `false` and `events` ends with `default_breach_cleared`
- With LTV above `default_ratio_bps` and no breach open, `ltv_above_ratio_no_onchain_breach` is `true`

---

## Story 5 — An inspection approved on the RecordNft is served inline

**Given** an inspection recorded and approved on the RecordNft

**When** a client calls the route right after the approval, and again after the next fold

**Then:**

- First `refresh_pending` is `true`, because the RecordNft's `SecurityInspectionApproved` row is newer than the projection watermark; a Trustee poll keeps going until it is `false`
- After the fold `records[0].inspections[]` carries the inspection with its 6-dp `quantity` and `grade`, and `records[0].lot.latest_quantity` follows it
- Without the RecordNft key the route would not see the approval, which is why both keys are required

---

## Story 6 — An open goods record gets a 6-dp suggested mark

**Given** `SECURITY_MARK_COMMODITIES` mapping the record's commodity, a collected price for its asset and an open goods record

**When** a client calls the route

**Then:**

- `suggestion_status` is `ok` and `suggested_mark.value_per_unit` is a 6-dp string (`$100 / Mt` is `"100.000000"`)
- The report's `value_per_unit=` line and `security_registry=` (EIP-55) match the response, and `report_hash` is the sha256 of the report
- A Stellar record's suggestion in the same deployment is unchanged: 7 dp, same report format

---

## Story 7 — The loan book and attention counts serve EVM loans

**Given** both keys set and an EVM loan with terms and a valuation

**When** a client calls `GET /v1/loan-book` and `GET /v1/attention-counts`

**Then:**

- The loan's entry carries `ltv_bps`, `margin_call_open` and `price_stale` equal to `/security` `valuation.ltv_bps`, `margin_call.open` and `valuation.price_stale`
- An EVM loan and a Stellar loan with the same id each carry their own values
- The attention counts' `loans.margin_call_open` includes the EVM chain's open calls, and the chain's own entry is non-null

---

## Story 8 — The audit log lists the default-breach rows

**Given** a default breach that opened, went price-stale and cleared, and a `setTerms` with a default ratio

**When** a Trustee calls `GET /v1/audit-log`

**Then:**

- It lists `SecurityDefaultBreach` ("Default breach — LTV 95.00% above 90.00% default ratio"), `SecurityDefaultBreachPriceStale` and `SecurityDefaultBreachCleared` with scope `Loan #<id>`
- The `SecurityTermsSet` row ends its action with ", default ratio 90.00%" and its details carry `default_ratio_pct` and `originator_fee_rate_pct`
- A Stellar `SecurityTermsSet` row renders exactly as before
