# Issue #782: Trustee Type-3 RISK_COUNCIL escalation — Escalate to Default (this round)

Source: https://github.com/eq-lab/pipeline/issues/782

## Scope

#782 is the epic-level ask for all three Type-3 RISK_COUNCIL proposal flows (escalate-to-default, off-cycle re-term / amend-economics, write-down close). **This round implements only the Escalate-to-Default screen** (Figma node `4116-12953`); the other two frames (`4116-13481` amend-economics, `4116-13625` write-down close) are **deferred to a follow-up issue** — recorded here so the scoping is traceable. Decisions confirmed with the requester:

- **Scope:** Escalate-to-Default only this round.
- **Safe/voting/timelock layer:** mock (no backend endpoint exists — the RISK_COUNCIL Safe proposal, signer/voting status, and 24h timelock have no API; `setDefault`/`amendEconomics`/`closeLoan(Default/OtherWriteDown)` are RISK_COUNCIL-only per `docs/product-specs/smart-contracts-registry.md`, NOT Trustee-callable). Real numbers where endpoints exist; the "Submit to Risk Council Safe" button is a mock (trustee cannot execute).
- **Routing:** everything under `/risk-council`.

Design reference: [Figma node 4116-12953](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=4116-12953&m=dev).

## In scope

- **Routing restructure** (`packages/trustee/src/routes/`): convert `risk-council.tsx` (currently a placeholder leaf) into a pass-through `<Outlet/>` layout; move its placeholder content to a new `risk-council.index.tsx` (`/risk-council`); add `risk-council.escalate.$id.tsx` → `createFileRoute("/risk-council/escalate/$id")`. Mirrors the `loans.tsx` / `loans.index.tsx` pattern. `vite build` regenerates `routeTree.gen.ts`.
- **The Escalate-to-Default page** (`risk-council.escalate.$id.tsx`, render-only) + colocated presenter (`-risk-council-escalate.ts`), per `docs/FRONTEND.md` rule 2, mirroring the record-coupon route/presenter split:
  - Header: "‹ Risk Council" back link (→ `/risk-council`), title "Escalate to Default — <originator>", chips "Risk Council Safe · 24h timelock" + "Draft".
  - Left "Loan ledger & deterioration" card: Facility / senior deployed, Repaid to date, Collateral (+ commodity/price sublabel), CCR (+ "next alert at 110%"), Days on watchlist, CCR-trend chart (reuse `CcrTrendCard`/`useLoanCcrHistory`, #879/#880), "Portfolio impact if defaulted" (At-risk `X% → Y%`, commodity concentration).
  - Right "Proposal" card: composed `RiskCouncilSafe.propose(LoanRegistry.setDefault(loanId: #<id> — <originator>))` code block, 3-item checklist, the "You cannot execute this" note, and a mock "Submit to Risk Council Safe" button (flips a local Draft → Submitted state; no network / no wallet).
- **Entry wiring:** `loans.$id.tsx` `onOtherAction("Escalate to Risk Council")` → navigate to `/risk-council/escalate/$id`.
- **Tests:** render tests (mock hooks) for the ledger rows (real values), the composed proposal text with the loan id, the "cannot execute" note, and the mock Submit flip; plus the `loans.$id` navigation test.

## Data sourcing (real vs mock)

- **Real:** originator / Facility (`principal`) / senior deployed (`senior_outstanding`) / Collateral — `useLoanBook` entry (registry monetary → `formatRegistry*` ×1000; consistent with #888's rule — ratios/bps un-scaled). CCR = `entry.ccr_bps` as-is. CCR trend = `useLoanCcrHistory`. Repaid = `useLoanFinancials` (`offtaker − offtaker_outstanding`). Current at-risk % = loan-book `summary.at_risk_wl_and_default_pct`; concentration = `summary.top_concentration`.
- **Mock:** the "→ Y% if defaulted" projection (no projection endpoint), Days on watchlist (no source), and the entire Safe proposal / checklist / Draft-Submitted status / Submit action.

## Out of scope (deferred follow-up)

- Amend-economics (`4116-13481`) and Write-down close (`4116-13625`) screens.
- Any real Safe-proposal / signer-voting / timelock backend (blocked on infra that does not exist).
