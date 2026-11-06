# User story: #1781 — Audit log: SecurityRegistry events, legacy CollateralRegistry rows as history

**Epic:** #1775
**Issue:** https://github.com/eq-lab/pipeline/issues/1781
**Status:** Initial

---

## Overview

`GET /v1/audit-log` lists the 21 SecurityRegistry events indexed by #1779, renders the Stellar rows of the replaced CollateralRegistry as legacy history, and links an enforced record to the Minter repayments that booked its proceeds. Spec: `docs/product-specs/audit-logging.md#trustee-dashboard-feed-get-v1audit-log`.

Persona: trustee (Audit Log page of the Trustee app, which renders `action` verbatim). The SecurityRegistry key is `CHAIN_<id>_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS`; unset ships dark, so no `Security…` row exists and the feed is unchanged. Stories 1 to 4 need testnet writes on the SecurityRegistry, which do not exist yet; they run in the epic QA pass #1777. Rendering is covered by `packages/api/tests/audit_log_security_registry.rs`.

---

## Story 1 — A loan's security flow reads as a timeline

**Given** a Stellar loan with terms set, one record registered, perfected, attested and revalued, and an inspection recorded and approved

**When** the trustee opens the Audit Log on the Stellar chain

**Then:**

- The rows read "Security terms set — advance ratio 80.00%, margin call ratio 85.00%, cure period 14d", "Security record #1 registered — Pledge, lot #1", "Security record #1 perfected", "Security record #1 attested", "Security record #1 revalued — $1.000000/unit (LME)", "Inspection #1 recorded — Initial, security record #1" and "Inspection #1 approved — variance vs reference -2.50%, vs previous +0.10%, grade 0.00%"
- Every one has scope `Loan #<id>` and an empty `reference`
- Hashes and addresses (the attester, the inspector) are in `details` and never in the action text
- The row filter is the allow-list: record NFT `mint` / `burn` never appear

---

## Story 2 — Margin calls and stale prices

**Given** a loan whose LTV rises above the margin call ratio, and later falls back

**When** the trustee reads the feed

**Then:**

- "Margin call — LTV 87.50%, margin call ratio 85.00%, cure by <ISO date>" with `details.cure_by` as the raw unix seconds
- "Price stale — LTV 87.50% above 85.00% margin call ratio, no margin call until revalued" (repeats while it stays stale)
- "Margin call cured — LTV 78.00%"
- A debt with no counted value shows "LTV unbounded" and `details.ltv_pct` is `null`

---

## Story 3 — An enforced record shows its proceeds

**Given** a record enforced with a sale repaid through the Minter with `sale_id` equal to the record id

**When** the trustee reads the feed

**Then:**

- "Security record #3 enforced — proceeds $25.000000 repaid (repayment #2)", or "(repayments #2, #3)" for several
- `details.repayment_ids` is ascending and `details.proceeds` is the summed cash; a reversed repayment is left out
- With no matching repayment the action is "Security record #3 enforced", `repayment_ids` is `[]` and `proceeds` is `null`
- The `Cash repaid` rows are unchanged

---

## Story 4 — Legacy CollateralRegistry rows are marked

**Given** Stellar rows written by the replaced CollateralRegistry (`Pledged`, `HaircutSet`, `Revalued`, `Released`, `Liquidated`, `MarginCall`, …)

**When** the trustee reads the feed

**Then:**

- Their actions end with " (legacy collateral registry)", with `details` and `event_name` unchanged
- EVM rows of the same names render exactly as before, and `LoanCCRUpdated` is unchanged on both chains
- Pause and unpause of the SecurityRegistry show as "SecurityRegistry paused" / "SecurityRegistry unpaused" with Protocol scope; the inspector panel shows "Inspector panel set — 3 inspectors"
