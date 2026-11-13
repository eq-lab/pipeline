# User story: #1907 — LP app: Deployment Monitor reads ltv_bps instead of loan-book collateral / ltv

**Epic:** #1775
**Issue:** https://github.com/eq-lab/pipeline/issues/1907
**Status:** Initial

---

## Overview

The LP app's Protocol Dashboard Loan Book panel (Deployment Monitor) stops reading the per-loan CCR-era fields that #1786 Phase 2 removes from `GET /v1/loan-book` `loans[]` (`collateral`, `ltv`, `ccr_bps`, `spot_price`, `spot_change_7d`). The Active Loans table reads the SecurityRegistry LTV from `loans[].ltv_bps`, and the Collateral column is gone. The summary cards (Collateral, Senior Debt Coverage) keep reading `summary.total_collateral` and `summary.senior_debt_coverage`. Spec: `docs/frontend/dashboard-components.md#usedeploymentmonitorpanel`, `docs/frontend/dashboard-components.md#loanbooktable`.

Persona: any visitor of the Protocol Dashboard (`/dashboard`), no wallet needed. The panel must work with both response shapes: today's (legacy keys next to `ltv_bps`) and Phase 2's (legacy keys absent). Mock key: `pipeline.mock.api.GET./v1/loan-book`.

---

## Story 1 — A Stellar book shows LTV from `ltv_bps` and no Collateral column

**Given** the dashboard chain is Stellar and the loan-book response has three loans with `ltv_bps` 8123, 4294967295 and `null`

**When** the visitor opens `/dashboard` and looks at the Active Loans tab

**Then:**

- The table header reads Commodity, Principal, LTV, Duration, Rate, Protection; there is no Collateral column
- The LTV cells read `81.3%`, "No security value" (it does not spill into the Duration column) and `—`
- The LTV header reads `LTV · 81.3%` (mean of the valid values only; the sentinel and `null` rows are excluded)
- The "Collateral" summary card still renders from `total_collateral`

---

## Story 2 — An EVM book shows no LTV values

**Given** the dashboard chain is EVM and every loan has `ltv_bps: null`

**When** the visitor opens `/dashboard`

**Then:**

- Every LTV cell reads `—`
- The LTV header reads plain `LTV`, with no aggregate

---

## Story 3 — Today's response with the legacy keys renders the same as Story 1

**Given** a response whose loans still carry `collateral`, `ltv` (for example `"0.5718"`), `ccr_bps`, `spot_price` and `spot_change_7d` next to `ltv_bps` 8123

**When** the visitor opens `/dashboard`

**Then:**

- The row reads `81.3%`, not `57%`: the legacy `ltv` is ignored and there is no fallback to it
- There is no Collateral column and the header reads `LTV · 81.3%`

---

## Story 4 — After #1786 Phase 2 deploys the panel still works

**Given** a response whose loans have none of the legacy keys, only `ltv_bps`, and a submissions list that includes older submissions whose `loan_data` still carries `initial_ccr`

**When** the visitor opens `/dashboard` and switches between the Active Loans and In Origination tabs

**Then:**

- The Active Loans panel loads and renders as in Story 1
- The In Origination tab lists every in-flight submission, including the old ones with `initial_ccr`
