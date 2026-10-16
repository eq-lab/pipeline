# User story: #1531 — LoanBook API: per-loan endpoints require chain_id

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1531
**Status:** Initial

---

## Overview

The nine per-loan operations under `/v1/loan-book/{loan_id}/…` (financials, valuations, ccr-history, waterfall, `GET`/`POST` transfers, assay, offtake, disbursement/complete) now require a `chain_id` query parameter, because a loan id is only unique within a chain. There is no silent `DEFAULT_CHAIN_ID` fallback. Backend-only; no Figma reference. The financials, waterfall, and transfers responses now also carry `chain_id`, and both transfers operations are tagged `LoanBook` in Swagger.

Validation order on every endpoint: 401 (trustee endpoints, missing or invalid token), then chain 400, then the other query/body extractors, then 403 (role), then `invalid loan_id` 400, then payload validation 400, then 404 / 422. An authenticated non-trustee who omits `chain_id` gets 400, not 403.

Automated coverage is in `packages/api/tests/loan_chain_required.rs` (public-route 400s, 401-before-chain, guard pre-check per chain, OpenAPI contract); Story 3 is the real two-chain check and is run by QA #1527.

---

## Story 1 — A per-loan GET without a valid chain_id is refused

**Given** the API is configured with `CHAINS=1,99000001`

**When** `GET /v1/loan-book/{loan_id}/financials` (or valuations, ccr-history, waterfall) is called without `chain_id`, or with `chain_id=5`, or with `chain_id=abc`

**Then:**

- Missing returns 400 `{"error":"chain_id is required"}`
- `chain_id=5` returns 400 `unknown chain_id: 5 (configured: 1, 99000001)`
- `chain_id=abc` returns 400 `invalid chain_id: abc`
- `ccr-history` without `chain_id` and without `from` returns the chain 400, not the `from` error

## Story 2 — A trustee write without chain_id is refused and writes nothing

**Given** a signed-in Trustee and an indexed loan

**When** `POST /v1/loan-book/{loan_id}/assay`, `…/offtake`, `…/disbursement/complete`, or `POST …/transfers` is called without `chain_id`

**Then:**

- The response is 400 `chain_id is required`
- No assay, offtake, disbursement, or transfers record is created or changed
- Without a token the same calls return 401

## Story 3 — The same loan_id resolves per chain

**Given** a stack with two configured chains where `loan_id` 7 exists on both and the loans differ

**When** `GET /v1/loan-book/7/financials?chain_id=1` and `?chain_id=99000001` (and the same for `…/transfers` as a Trustee) are called

**Then:**

- Each response shows that chain's own loan data
- Each response carries `chain_id` equal to the requested chain
- A loan indexed on one chain only returns 404 `loan 7 not indexed on chain <id>` on the other

## Story 4 — Swagger shows chain_id as required

**Given** the API is running

**When** the Swagger UI is opened

**Then:**

- All nine operations list `chain_id` as a required query parameter
- Both `…/transfers` operations appear under the `LoanBook` tag, not `CapitalAllocation`

## Story 5 — The Trustee loan-detail page still works

**Given** a signed-in Trustee on a loan-detail page

**When** the page loads financials, valuation, the CCR chart, and the waterfall, and the Trustee marks the disbursement complete

**Then:**

- All sections render and the action succeeds, because the Trustee hooks already send `chain_id`
