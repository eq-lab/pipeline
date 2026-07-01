# User Stories: #729 — Loan Book table: column headers missing aggregate subtitles

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#729](https://github.com/eq-lab/pipeline/issues/729)
Plan: `docs/exec-plans/active/issue-729-loan-book-header-aggregate-subtitles.md`
Figma: [node 3283:14431](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431&m=dev)

---

## Story 1: Principal column header shows portfolio total as subtitle

**Persona:** Any user viewing the Protocol Dashboard Loan Book table.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns a non-empty response with `total_deployed` set.

**Steps:**

1. Set mock data with `total_deployed` non-null and `total_collateral` null:
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
       ],
     })
   );
   ```
2. Navigate to `http://localhost:5188/dashboard`.
3. On a desktop-width viewport (md+), observe the Loan Book table header row.

**Expected outcome:**
- The Principal column header reads `Principal · $31.6M` as a single caption-styled run.
- The label and aggregate are separated by a middot (` · `).
- The entire header text (label + aggregate) renders at 12px/16px caption size (`--text-pipeline-caption`) in ink-muted color — not 14px body-s.
- The Collateral and LTV column headers show plain text only — no aggregate appended.

---

## Story 2: Collateral column header shows aggregate when total_collateral is non-null

**Persona:** Any user viewing the Protocol Dashboard Loan Book table.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns a non-empty response with both `total_deployed` and `total_collateral` set.

**Steps:**

1. Set mock data with both fields non-null:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/loan-book",
     JSON.stringify({
       summary: {
         total_deployed: "31600000.000000",
         total_collateral: "37600000.000000",
         senior_debt_coverage: "1.50",
         avg_yield: "0.112000",
         avg_duration_days: 68,
       },
       loans: [
         {
           originator: "Open Mineral",
           borrower: "Open Mineral",
           commodity: "Copper Concentrate",
           principal: "8000000.000000",
           collateral: "9500000.000000",
           ltv: "0.8511",
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
3. On a desktop-width viewport (md+), observe the Loan Book table header row.

**Expected outcome:**
- The Principal column header reads `Principal · $31.6M`.
- The Collateral column header reads `Collateral · $37.6M`.
- The LTV column header reads `LTV` only — no aggregate appended (LTV subtitle is intentionally omitted until a backend `portfolio_ltv` field exists).

---

## Story 3: Collateral column header shows no aggregate when total_collateral is null

**Persona:** Any user viewing the Protocol Dashboard Loan Book table (current production state while TODO #706 is not yet merged).

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns a non-empty response where `total_collateral` is null.

**Steps:**

1. Use mock data from Story 1 (total_collateral: null).
2. Navigate to `http://localhost:5188/dashboard`.
3. On a desktop-width viewport (md+), observe the Collateral column header.

**Expected outcome:**
- The Collateral column header shows plain `Collateral` text only — no middot, no aggregate value.
- No `"—"` or empty suffix appears after "Collateral".
- This is the graceful-degrade behavior, not a bug. It will show the aggregate once #706 (commodity price feed) lands.

---

## Story 4: Mobile card layout — no aggregate in field labels

**Persona:** Any user viewing the Protocol Dashboard on a mobile-width viewport.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns a non-empty response with `total_deployed` set.

**Steps:**

1. Set mock data (see Story 1).
2. Navigate to `http://localhost:5188/dashboard`.
3. Narrow the browser viewport to below `md` breakpoint (< 768px).
4. Observe each per-loan card's field labels (Principal, Collateral, LTV, etc.).

**Expected outcome:**
- Each field label within the loan card reads plain text only: `Principal`, `Collateral`, `LTV`, etc.
- No aggregate subtitle (`· $31.6M` etc.) appears next to the field labels in the mobile card layout.
- The aggregate subtitles belong exclusively to the desktop table header row — they do not appear in the mobile card layout (Figma node 3283-72323 shows no header row on mobile).
