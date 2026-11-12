# User story: #1906 — Trustee: stop reading CCR (valuations, ccr-history, ccr_bps, initial_ccr) — use SecurityRegistry LTV on Stellar

**Epic:** #1775
**Issue:** https://github.com/eq-lab/pipeline/issues/1906
**Status:** Initial

---

## Overview

The Trustee console stops reading every CCR source that backend #1786 removes (`GET /v1/loan-book/{id}/valuations`, `GET /v1/loan-book/{id}/ccr-history`, the loan-book `ccr_bps` / `collateral` / `ltv` / `spot_price` / `spot_change_7d`, and `initial_ccr`). On Stellar it shows the LTV, margin-call state and price staleness from the SecurityRegistry. On EVM the CCR UI is removed and nothing replaces it. Spec: `docs/frontend/trustee-flows.md#security-card`, `docs/frontend/trustee-flows.md#ltv-column--tab-mapping`.

Persona: Trustee, signed in. A Stellar loan has SecurityRegistry terms and a stored valuation; an EVM loan does not. The loans-table LTV fields (`ltv_bps`, `margin_call_open`, `price_stale`) come from #1786 phase 1; until then the keys are absent and the console must still work. Story 5 needs #1786 deployed.

---

## Story 1 — A Stellar loan detail shows the Security card

**Given** a Stellar loan with terms (advance 80%, margin-call 85%) and a valuation with LTV 81.2%

**When** the Trustee opens `/loans/$id`

**Then:**

- A "Security" card shows LTV, Advance ratio, Margin-call ratio, Security value, Amount owed and Margin call
- The LTV is amber because it is above the loan's own advance ratio; it is red when a margin call is open
- A "Price stale" chip shows when the price is stale; "Updating from chain…" shows while a refresh is pending
- There is no "Price & collateral" card, no Spot line and no "CCR trend" card, on any layout (Active, Watchlist, Matured)
- A loan without terms shows "No security terms are set for this loan."; a failed `/security` read shows an inline error in the card and the rest of the page still renders

---

## Story 2 — An EVM loan detail shows no CCR, security or placeholder

**Given** a loan on the EVM chain

**When** the Trustee opens its detail page

**Then:**

- There is no Security card, no CCR row, no CCR trend and no "—" placeholder row
- The browser makes no request to `/security`, `/valuations` or `/ccr-history`
- The page's other cards (hero, tiles, registry, documents, actions) render as before

---

## Story 3 — The loans table shows the LTV column only when served

**Given** the loans table with a Stellar loan that has `ltv_bps` 8123, `margin_call_open` true and `price_stale` true, a Stellar loan with all three `null`, and an EVM loan

**When** the Trustee opens `/loans`

**Then:**

- The columns are Originator, Chain, Commodity, Senior outst., LTV, Nearest payment, Stage; there is no Spot sub-line, Collateral column or CCR column
- The first row reads `81.2%` in red with "Margin call" and "Price stale"; the second reads `—`; the EVM row is blank
- A footnote explains the LTV
- When no row has a non-null `ltv_bps` or an open margin call (or the keys are absent), the LTV column and the footnote are hidden
- A `ltv_bps` of `4294967295` reads "No security value"

---

## Story 4 — Risk Council Escalate and Amend show LTV on Stellar and nothing on EVM

**Given** a Stellar loan with security state, and an EVM loan

**When** the Trustee opens `/risk-council/escalate/$id` and `/risk-council/reterm/$id`

**Then:**

- On Stellar, Escalate shows Security value, an LTV line (for example "81.2% — margin call at 85%") and "Advance / margin-call ratio", plus "Price stale" when true; Amend economics shows an LTV row
- On EVM, with a `404` from `/security`, or with no terms, those rows are absent entirely
- Neither page shows a CCR row, a Collateral row or a CCR trend

---

## Story 5 — After #1786 removes the CCR sources, every page still loads

**Given** the backend without `/valuations`, `/ccr-history` and the loan-book `ccr_bps`, `collateral`, `ltv`, `spot_price`, `spot_change_7d`

**When** the Trustee opens Overview, Loans, a loan detail, Escalate and Amend economics

**Then:**

- Every page loads with no console error and no failed request
- The Origination form still submits without `initial_ccr`
