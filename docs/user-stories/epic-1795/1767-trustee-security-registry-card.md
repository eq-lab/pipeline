# User story: #1767 — Trustee loan detail shows the security registry state

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1767
**Status:** Initial

---

## Overview

On a Stellar loan's detail page (`/loans/$id`) the Trustee reads the SecurityRegistry state, read-only: LTV, ratios, cure period, margin call, and a Security records card listing each record with its inspections. Values are shown as served by `GET /v1/loan-book/{loan_id}/security?chain_id=<id>`, with "—" when missing. Spec: `docs/frontend/trustee-flows.md#security-card` and `#security-records-card`. No Figma frame exists; the cards are built from the loan-detail primitives.

All checks use the real API on staging, no localStorage mocks. Open DevTools Network before starting.

**Prerequisites and live-testing risks:**

- On 2026-11-16 staging served `terms: null` and `records: []` for every loan, so only stories 6 and 7 can be checked live today. Stories 1–5 and 8 are covered by unit tests until the setup below exists.
- Setup for the full shape: the Risk Council sets terms on `/risk-council/security/$id` (#1858, 24 h schedule); the Security Agent registers and attests records and the inspection operators enter and approve inspections through the contracts-repo CLI (not available in the Trustee app).
- Writes (set terms, resolve flag, release) stay on the Risk Council pages; mark suggestions and revalue are #1859.

---

## Story 1 — Terms, ratios, cure period and margin-call state

**Given** a Stellar loan with security terms and a valuation

**When** the Trustee opens the loan detail

**Then:**

- Network shows `GET /v1/loan-book/{id}/security?chain_id=...`
- The Security card shows LTV, Advance ratio, Margin-call ratio, Cure period ("7 d" / "36 h"), Security value, Amount owed and Margin call, each equal to the served value

---

## Story 2 — Open margin call and cure period ended

**Given** a loan with `margin_call.open` true

**When** the loan detail loads, and again after `cure_overdue` turns true

**Then:**

- The Margin call row reads "Open since … · cure by …"; after the deadline it adds "· cure period ended"
- The note "The cure period has ended. Default is not automatic: the Risk Council decides whether to declare it." appears
- `open_call_curable` shows the curable note; `ltv_above_ratio_no_onchain_call` shows the above-ratio note
- The loan appears in Overview, Needs Attention, Loans group, as "Margin call open" (or "Watchlist · margin call open"), matching the sidebar attention count

---

## Story 3 — Stale price

**Given** a loan whose valuation or prices report `price_stale` true

**Then** the Security card shows the "Price stale" chip and the note "A stale price does not open a margin call; it alerts the Risk Council."

---

## Story 4 — Security records

**Given** a loan with registered records

**Then** the full-width Security records card, below the Security row, lists each record in served order with title, status, commodity, document and counted quantity, value, price (benchmark, per unit), price updated, attested date and attester, plus "Flagged", "Attestation stale", "Inspection stale", "Price stale", "Not counted" and "Closed" chips only where the served flag is true

---

## Story 5 — Inspections

**Given** a record with inspections

**Then** its table shows kind, inspected date, quantity, grade, entered by / at, approved by / at (or "Awaiting approval"), the three variances in bps, a "Flagged" pill and the resolution

---

## Story 6 — Terms but no records

**Given** a loan with terms and `records: []`

**Then** the Security records card shows "No security records are registered for this loan."

---

## Story 7 — No card

**Given** an EVM loan, or a Stellar loan with `terms: null`, or a registry-not-configured 404

**Then** no Security records card and no placeholder row render

---

## Story 8 — Past-Due notice

**Given** a loan past maturity

**Then** the notice reads "Maturity has passed. If the payment arrived, record it. If it didn't, escalate the loan to the Risk Council. Default is never automatic." and offers Record payment and Escalate to Risk Council, which opens the escalate page
