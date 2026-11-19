# User story: #1328 — Collateral asset and metal names are normalized

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/1328
**Status:** Initial

---

## Overview

The collateral valuation anchor `asset` and `price_provider` are trimmed and case-normalized at submission, and metal and element names in assay and offtake records match case- and whitespace-insensitively. Spec: `docs/product-specs/collateral-valuation.md#per-loan-valuation-record` and `docs/product-specs/api-authorization-loan-submission.md`.

Persona: Trustee submitting a loan and its assay and offtake terms through the API.

---

## Story 1 — Asset is normalized at submission

**Given** a valid loan payload with `collateral_valuation.asset` set to `" xau "` and `price_provider` set to `" Metal_Price "`

**When** the Trustee calls `POST /v1/loan-book/loan`

**Then:**

- The request succeeds
- `GET /v1/loan-book/submissions` shows `asset` as `XAU` and `price_provider` as `metal_price`

---

## Story 2 — Malformed asset is rejected

**Given** a valid loan payload with `asset` set to `XAU/USD`

**When** the Trustee calls `POST /v1/loan-book/loan` or `/resubmit`

**Then:**

- The response is 400 and the error names `asset`

---

## Story 3 — Mixed-case names still value the loan

**Given** a MetalConcentrate loan with an assay naming `gold` and an offtake naming `Gold` in `payable_terms` and `refining_charges`

**When** the Trustee posts both records and opens the waterfall and the mark suggestion

**Then:**

- The gold grade and the refining charge are non-zero, matching an all-lowercase submission

---

## Story 4 — Duplicate names are rejected

**Given** an assay or offtake payload where two entries differ only by case or surrounding whitespace (for example `gold` and `Gold`)

**When** the Trustee calls `POST /v1/loan-book/{loan_id}/assay` or `/offtake`

**Then:**

- The response is 400 and the error says the name is duplicated
- An empty or whitespace-only name also returns 400
