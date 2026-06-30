# User Stories: #727 — Loan Book panel — tab labels missing count badges + tab restyle

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#727](https://github.com/eq-lab/pipeline/issues/727)
Plan: `docs/exec-plans/active/issue-727-loan-book-tab-badges-styling.md`
Figma: [node 3283:14480](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14480&m=dev)

---

## Story 1: Active Loans tab badge shows live loan count

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns loans in the response.

**Steps:**

1. Set mock data with 2 active loans:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/loan-book",
     JSON.stringify({
       summary: {
         total_deployed: "31600000.000000",
         total_collateral: null,
         senior_debt_coverage: null,
         avg_yield: "0.112000",
         avg_duration_days: 68,
       },
       loans: [
         {
           originator: "Open Mineral",
           borrower: "Open Mineral",
           commodity: "Copper Concentrate",
           principal: "8000000.000000",
           collateral: null,
           ltv: null,
           duration_days: 120,
           rate: "0.112000",
           protection: "LC at sight",
           status: "Performing",
         },
         {
           originator: "Trafalgar",
           borrower: "Trafalgar",
           commodity: "Alumina",
           principal: "5200000.000000",
           collateral: null,
           ltv: null,
           duration_days: 150,
           rate: "0.109000",
           protection: null,
           status: "Performing",
         },
       ],
     })
   );
   ```
2. Navigate to `http://localhost:5188/dashboard`.
3. Observe the Loan Book panel tab bar.

**Expected outcome:**
- The "Active Loans" tab renders a count badge showing `2`.
- The badge is styled with a muted fill background and muted-ink caption text.
- The badge is positioned to the right of the "Active Loans" label text, inside the tab chip.

---

## Story 2: In Origination tab has no count badge

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns any valid response.

**Steps:**

1. Navigate to `http://localhost:5188/dashboard` (with or without mock data).
2. Observe the "In Origination" tab in the Loan Book panel tab bar.

**Expected outcome:**
- The "In Origination" tab shows only the label text — no count badge.
- The tab is visually disabled (muted text, reduced opacity, cursor not-allowed).
- No fabricated number appears next to the "In Origination" label.

---

## Story 3: Tab bar segmented-control styling matches Figma node 3283:14480

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns at least one active loan.

**Steps:**

1. Set mock data (see Story 1).
2. Navigate to `http://localhost:5188/dashboard`.
3. Observe the tab bar above the loan table.

**Expected outcome:**
- The tab container renders as a muted-fill (`--color-pipeline-fill-muted`) track with 2px padding and 6px radius.
- The Active Loans tab appears as a white chip (`--color-pipeline-surface`) on the muted track, with 32px height, 6px horizontal padding, 4px radius, Medium-weight caption-size (`--text-pipeline-caption`, 12px/16px) ink-colored label.
- The In Origination tab has no background fill, same height/padding/radius geometry, Regular-weight caption-size ink-muted label, and is visually de-emphasized.
- The overall tab bar appearance is a compact segmented control — noticeably different from the previous pill-style bar (dark ink selected background, 14px body-s text, pill radius).
