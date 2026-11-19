# User story: #2125 — Standard-goods collateral converts tonnes to the price's unit

**Epic:** #2129
**Issue:** https://github.com/eq-lab/pipeline/issues/2125
**Status:** Initial

---

## Overview

A standard-goods loan's collateral is `reference_price * quantity_in_quote_unit * (1 - haircut)`. The anchor's quantity is dry metric tonnes; `XAU`, `XAG`, `XPT` and `XPD` are priced per troy ounce, so tonnes convert at 1,000,000 / 31.1035 oz per tonne. Spec: `docs/product-specs/collateral-valuation.md` (Standard goods).

Persona: operator or QA via the API.

---

## Story 1 — Precious-metal standard-goods loan

**Given** a drawn standard-goods loan on `XAU` with `quantity_dmt` 2, haircut 0.10 and an XAU price of US$4,000

**When** the operator calls `GET /v1/loan-book` (and `GET /v1/loans/:id/valuations`)

**Then:**

- The loan's collateral is about US$231.5M, not about US$7,200
- `summary.total_collateral` includes that value

---

## Story 2 — Asset with no known quote unit

**Given** a standard-goods loan on a non-precious symbol (for example `KC` or `XCU`) with a price present

**When** the operator calls `GET /v1/loan-book` (and `/valuations`)

**Then:**

- `collateral` is `null` (unpriced)
- `/valuations` reports `missing_inputs: ["quote_unit"]`

---

## Story 3 — Concentrate loan unchanged

**Given** a metal-concentrate loan

**When** the operator calls `GET /v1/loan-book`

**Then** its collateral value is the same as before this change.
