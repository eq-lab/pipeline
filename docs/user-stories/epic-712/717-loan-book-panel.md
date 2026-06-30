# User Stories: #717 — Loan Book panel (Panel B)

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#717](https://github.com/eq-lab/pipeline/issues/717)
Plan: `docs/exec-plans/active/issue-717-deployment-monitor-panel.md`
Figma desktop: [node 3283:14431](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14431&m=dev)
Figma mobile: [node 3283:72323](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72323&m=dev)

---

## Story 1: Ready state — summary cards and loan table with data

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; `GET /v1/loan-book` returns at least one active loan.

**Steps:**

1. Set mock data:
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
     }),
   );
   ```
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the "Loan Book" panel (second card in the grid).

**Expected outcomes:**

- The panel title reads **"Loan Book"**.
- Five summary cards are visible with labels: Total Deployed, Collateral, Senior Debt Coverage, Yield, Average Duration.
- "Total Deployed" card shows **$31.6M**.
- "Yield" card shows **11.2%** (one decimal, not two).
- "Average Duration" card shows **68 days**.
- "Collateral" and "Senior Debt Coverage" cards show **—** (null fields).
- The tab bar shows **Active Loans** (active) and **In Origination** (visibly disabled).
- The loan table shows a row for "Open Mineral / Copper Concentrate" with principal **$8.0M**.
- The protection column shows **LC at sight**.
- No loading spinner or error state is visible.

---

## Story 2: Null optional fields degrade to em-dash

**Persona:** Any user.

**Pre-conditions:** Dev server running; mock set with a loan having null collateral, ltv, and protection.

**Steps:**

1. Set mock data with a loan where `collateral: null`, `ltv: null`, `protection: null`.
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the Loan Book panel table row.

**Expected outcomes:**

- The Collateral column shows **—**.
- The LTV column shows **—**.
- The Protection column shows **—**.
- Other populated columns (Principal, Duration, Rate) show their formatted values.

---

## Story 3: Loading state

**Persona:** Any user on a slow connection.

**Pre-conditions:** Dev server running; no mock key set; real API is not running (or throttled).

**Steps:**

1. Navigate to `http://localhost:3000/dashboard` with the API offline.

**Expected outcomes:**

- The Loan Book panel shows a loading spinner / "Loading…" text while the request is in flight.
- No error message is visible yet.

---

## Story 4: Error state with retry

**Persona:** Any user whose request to `/v1/loan-book` fails.

**Pre-conditions:** Dev server running; API returns 500.

**Steps:**

1. Navigate to `http://localhost:3000/dashboard`.
2. Observe the Loan Book panel when the API fails.
3. Click the "Retry" button.

**Expected outcomes:**

- The panel shows an error message ("Couldn't load this panel" or similar) with a **Retry** button.
- Clicking Retry re-fires the query.

---

## Story 5: Empty state — no active loans

**Persona:** Any user when no active loans exist.

**Pre-conditions:** Dev server running; mock returns `loans: []`.

**Steps:**

1. Set mock:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/loan-book",
     JSON.stringify({
       summary: { total_deployed: "0.000000", total_collateral: null, senior_debt_coverage: null, avg_yield: null, avg_duration_days: null },
       loans: [],
     }),
   );
   ```
2. Navigate to `http://localhost:3000/dashboard`.

**Expected outcomes:**

- The Loan Book panel shows an empty state (no table, no summary cards).
- No error or loading state.

---

## Story 6: Tab bar — In Origination is disabled

**Persona:** Any user.

**Pre-conditions:** Dev server running; mock returns at least one active loan.

**Steps:**

1. Set the ready-state mock from Story 1.
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the tab bar inside the Loan Book panel.
4. Attempt to click "In Origination".

**Expected outcomes:**

- The tab bar shows **Active Loans** (highlighted/active) and **In Origination** (greyed out/disabled).
- Clicking "In Origination" does nothing (it is disabled).

---

## Story 7: Mobile layout — stacked cards

**Persona:** Any user on a mobile viewport.

**Pre-conditions:** Dev server running; mock returns at least one active loan; viewport width < 768px.

**Steps:**

1. Set the ready-state mock from Story 1.
2. Navigate to `http://localhost:3000/dashboard` at viewport width 375px.

**Expected outcomes:**

- The summary section shows horizontally-scrollable cards (two visible at a time, rest scrollable).
- The loan table is replaced by stacked cards — each loan is a card with label/value rows.
- No horizontal page overflow occurs.
