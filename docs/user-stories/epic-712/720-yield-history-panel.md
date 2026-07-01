# User Stories: #720 — Yield History panel (Panel D)

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#720](https://github.com/eq-lab/pipeline/issues/720)
Plan: `docs/exec-plans/active/issue-720-yield-history-panel.md`
Figma desktop: [node 3283:68333](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-68333&m=dev)
Figma mobile: [node 3283:72387](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72387&m=dev)

---

## Story 1: Ready state — Cumulative Yield chart + metric cards

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; mock data set for yield, prices, stats, and loan-book.

**Steps:**

1. Set mock data:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/stats/yield",
     JSON.stringify([
       { timestamp: "2025-01-01T00:00:00Z", apy: "0.104", accrued: "1000000.000000", principal_outstanding: "30000000.000000" },
       { timestamp: "2025-01-08T00:00:00Z", apy: "0.104", accrued: "2000000.000000", principal_outstanding: "31000000.000000" },
       { timestamp: "2025-01-15T00:00:00Z", apy: "0.109", accrued: "2910000.000000", principal_outstanding: "31600000.000000" },
     ]),
   );
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/stats/prices",
     JSON.stringify({
       vault_address: "0xVault",
       interval: "weekly",
       prices: [
         { timestamp: "2025-01-01T00:00:00Z", avg_price: "1.00" },
         { timestamp: "2025-01-08T00:00:00Z", avg_price: "1.02" },
         { timestamp: "2025-01-15T00:00:00Z", avg_price: "1.04" },
       ],
     }),
   );
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/stats",
     JSON.stringify({ vaults: [{ vault_address: "0xVault", share_price: "1.04", apy: "0.104" }] }),
   );
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/loan-book",
     JSON.stringify({
       summary: { total_deployed: "31600000.000000", total_collateral: null, senior_debt_coverage: null, avg_yield: "0.109", avg_duration_days: 68 },
       loans: [],
     }),
   );
   ```
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the "Yield History" panel.

**Expected outcomes:**

- The panel title reads **"Yield History"**.
- A "Cumulative Yield" card is visible containing:
  - Eyebrow label: **"Cumulative Yield"**.
  - Headline value: **"$2.9M"** (compact USD from 2910000).
  - A green bar chart spanning the full card width with ~100 monotonically increasing bars.
  - Time-range tabs: **7D / 1M / 3M / 1Y / All** (floating style, "All" active by default).
- Three metric cards are visible below the chart:
  - **"Current APY, Net to sPLUSD"** shows **10.4%**.
  - **"Loan Book Yield"** shows **10.9%**.
  - **"Target Net to sPLUSD"** shows **8–12%**.
- The `data-testid="dashboard-panel-yield-history"` attribute is present on the panel root.

---

## Story 2: Empty state — vault is the zero-address dev default

**Persona:** Developer running the app locally with no `.env` configured.

**Pre-conditions:** `VITE_STAKED_PLUSD_ADDRESS` is not set (defaults to the zero address).
No mock data is needed — the panel should degrade without network calls.

**Steps:**

1. Ensure no `pipeline.mock.api.GET./v1/stats/yield` key is set in localStorage.
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the "Yield History" panel.

**Expected outcomes:**

- The panel shows the empty state body (PanelEmpty).
- No network request is made for `/v1/stats/yield`, `/v1/stats/prices`, etc.
- The panel does NOT crash.

---

## Story 3: Error state — API returns 500

**Persona:** Any user when the backend is unavailable.

**Pre-conditions:** Mock a failing fetch for `/v1/stats/yield`. Ensure vault is non-zero by
setting `pipeline.mock.api.GET./v1/stats/yield` to an invalid response, or by using a
real server that returns 500.

**Steps:**

1. Set vault mock to a non-zero address via ENV (or configure `.env`).
2. Clear mock keys so the app attempts a real fetch.
3. Intercept the fetch and return a 500 response (or disconnect the dev API server).
4. Navigate to `http://localhost:3000/dashboard`.
5. Observe the "Yield History" panel.

**Expected outcomes:**

- The panel shows the error state body (PanelError).
- A **retry button** is visible. Clicking it triggers a refetch.
- The panel does NOT crash or show empty/loading indefinitely.

---

## Story 4: Time-range tab switching

**Persona:** Any user who wants to view a shorter/longer history window.

**Pre-conditions:** Ready state (Story 1 mock data in place).

**Steps:**

1. Set mock data as in Story 1.
2. Navigate to `http://localhost:3000/dashboard`.
3. In the "Yield History" panel, click the **"1M"** tab.

**Expected outcomes:**

- The **"1M"** tab becomes active (selected styling).
- The chart updates to reflect the 1-month period (the API would be called with `days=30&interval=daily`).
- The headline value still shows the latest cumulative yield.
- Clicking **"All"** restores the full-history view.

---

## Story 5: Null APY fields show em-dash

**Persona:** Any user when there are no active loans.

**Pre-conditions:** Mock data with `apy: null` in yield samples and `avg_yield: null` in loan-book.

**Steps:**

1. Set mock data:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/stats/yield",
     JSON.stringify([
       { timestamp: "2025-01-01T00:00:00Z", apy: null, accrued: "1000000.000000", principal_outstanding: "0" },
     ]),
   );
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/stats",
     JSON.stringify({ vaults: [{ vault_address: "0xVault", share_price: "1.00", apy: null }] }),
   );
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/loan-book",
     JSON.stringify({ summary: { total_deployed: "0", total_collateral: null, senior_debt_coverage: null, avg_yield: null, avg_duration_days: null }, loans: [] }),
   );
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/stats/prices",
     JSON.stringify({ vault_address: "0xVault", interval: "weekly", prices: [{ timestamp: "2025-01-01T00:00:00Z", avg_price: "1.00" }] }),
   );
   ```
2. Navigate to `http://localhost:3000/dashboard`.
3. Observe the metric cards in the "Yield History" panel.

**Expected outcomes:**

- **"Current APY, Net to sPLUSD"** shows **"—"** (em-dash).
- **"Loan Book Yield"** shows **"—"** (em-dash).
- **"Target Net to sPLUSD"** still shows **"8–12%"** (static constant, unaffected).
- The chart still renders (accrued = 1000000 is valid).
