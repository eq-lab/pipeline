# User Stories: #730 — Loan Book table column widths + borrower truncation

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#730](https://github.com/eq-lab/pipeline/issues/730)
Figma: [node 3283:14479](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14479&m=dev)

---

## Story 1: Fixed-width numeric columns do not collapse when borrower is a long hash

**Persona:** Any user viewing the Protocol Dashboard Loan Book table.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns a non-empty response
where the borrower field is a long Ethereum-style address (42-character hex string).

**Steps:**

1. Set mock data with a long borrower hash:
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
           borrower: "0xf37d5bE2BE001D7c6f0c11d7f975c6A7b23c7Ec1",
           commodity: "Copper Concentrate",
           principal: "8000000.000000",
           collateral: null,
           ltv: null,
           duration_days: 120,
           rate: "0.112000",
           protection: "LC at sight",
           status: "Performing",
         },
       ],
     })
   );
   ```
2. Navigate to `http://localhost:5188/dashboard`.
3. On a desktop-width viewport (md+, ≥ 768px), inspect the Loan Book table.

**Expected outcome:**
- The Duration, Rate, and Protection column headers are fully readable — they are not
  pushed off-screen or squashed together by the long borrower hash.
- The Principal, Collateral, and LTV columns each occupy approximately 112px.
- The Duration and Rate columns each occupy approximately 96px.
- The Protection column occupies approximately 128px.
- The Borrower / Commodity column fills the remaining width (flexible).
- The long borrower hash is truncated to a single line ending in `…` (ellipsis) within
  the Borrower / Commodity column — it does not expand the column or wrap to a second line.

---

## Story 2: Short borrower name renders without ellipsis and without column distortion

**Persona:** Any user viewing the Protocol Dashboard Loan Book table.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns a response where
the borrower + commodity is a short human-readable label.

**Steps:**

1. Set mock data with a short borrower name (see Story 1 setup but change `borrower` to
   `"Open Mineral"` and `commodity` to `"Copper Concentrate"`).
2. Navigate to `http://localhost:5188/dashboard`.
3. On a desktop-width viewport (md+), inspect the Loan Book table.

**Expected outcome:**
- The Borrower / Commodity cell shows `"Open Mineral / Copper Concentrate"` (or similar
  combined form) without truncation.
- All seven column headers (Borrower / Commodity, Principal, Collateral, LTV, Duration,
  Rate, Protection) are visible and correctly aligned.
- Numeric column widths remain stable — the short label does not cause them to expand.

---

## Story 3: Mobile stacked-card layout is unchanged

**Persona:** Any user viewing the Protocol Dashboard on a mobile viewport.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns a non-empty
response (may include a long borrower hash).

**Steps:**

1. Set mock data (see Story 1 for a long-hash example).
2. Navigate to `http://localhost:5188/dashboard`.
3. Narrow the browser viewport to below the `md` breakpoint (< 768px).
4. Observe the per-loan stacked cards.

**Expected outcome:**
- The desktop table is hidden; the mobile stacked-card layout is shown.
- Each loan card displays borrower/commodity as its primary label (full text, no truncation
  required in mobile — cards are full-width stacked layout, not a table).
- The six field pairs (Principal, Collateral, LTV, Duration, Rate, Protection) appear in
  a 2-column grid below the primary label.
- No column-width or table-layout changes affect the mobile cards.
