# User Stories: #718 — Balance Sheet panel (Panel A)

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#718](https://github.com/eq-lab/pipeline/issues/718)
Plan: `docs/exec-plans/active/issue-718-balance-sheet-panel.md`
Figma desktop: [node 3283:14275](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14275&m=dev)
Figma mobile: [node 3283:72288](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72288&m=dev)

---

## Story 1: Ready state — blended REST + Soroban data

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running at `http://localhost:5173`.

**Steps:**

1. Set mock REST data:
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/financial-position",
     JSON.stringify({
       assets: {
         total: "8100000.000000",
         liquid: { total: null, cash_stablecoins: null, tokenized_tbills: null, off_chain_usd: null },
         deployed: {
           total: "8100000.000000",
           secured_loans_outstanding: "8000000.000000",
           accrued_interest_receivable: "100000.000000",
         },
       },
       liabilities: {
         total: "500000.000000",
         senior_claims: { plusd_outstanding: null },
         subordinated_capital: { junior_tranche: "500000.000000" },
       },
     }),
   );
   ```

2. Set mock on-chain data (PLUSD total supply ≈ $43.14M):
   ```js
   localStorage.setItem("pipeline.mock.wallet.stellar.plusd.totalSupply", "431400000000000");
   localStorage.setItem("pipeline.mock.wallet.stellar.usdc.reserveBalance", "100000000000");
   ```

3. Navigate to `/dashboard`.

**Expected results:**
- The Balance Sheet panel (`data-testid="dashboard-panel-balance-sheet"`) renders in ready state.
- **Assets column** shows:
  - Secured loans outstanding: `$8.0M` (REST).
  - Accrued interest receivable: `$100.0K` (REST).
  - Cash — stablecoins (USDC): `$10.0K` (on-chain: 100_000_000_000n / 1e7).
  - Tokenized T-bills (USYC): `—`.
  - Off-chain USD: `—`.
- **Liabilities column** shows:
  - PLUSD outstanding: `$43.1M` (on-chain: 431_400_000_000_000n / 1e7) with caption "1:1 redeemable".
  - Junior tranche: `$500.0K` (REST).
- A muted footnote "Excludes assets pending a data source" is visible.
- Desktop: two columns side by side with a vertical 1px divider.

---

## Story 2: Loading state

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; REST is in-flight (no mock key set; fetch is delayed).

**Steps:**

1. Clear all mock keys:
   ```js
   localStorage.removeItem("pipeline.mock.api.GET./v1/financial-position");
   localStorage.removeItem("pipeline.mock.wallet.stellar.plusd.totalSupply");
   localStorage.removeItem("pipeline.mock.wallet.stellar.usdc.reserveBalance");
   ```

2. Navigate to `/dashboard`.
3. Observe immediately before REST resolves.

**Expected results:**
- The Balance Sheet panel shows the `PanelLoading` spinner (`data-testid="panel-loading"`).
- No rows or values are visible yet.

---

## Story 3: Error state with retry

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; REST endpoint unavailable.

**Steps:**

1. Ensure `VITE_API_BASE_URL` points to a non-existent host (or intercept with DevTools → Offline).
2. Navigate to `/dashboard`.
3. Wait for the panel to enter error state.

**Expected results:**
- The Balance Sheet panel shows the `PanelError` state (`data-testid="panel-error"`).
- A "Retry" button is visible. Clicking it triggers a refetch.

---

## Story 4: Unconfigured Soroban — rows render `—` gracefully

**Persona:** Any user; Stellar env vars not set.

**Pre-conditions:** `VITE_STELLAR_PLUSD_ID` and `VITE_STELLAR_USDC_ID` are empty (default).

**Steps:**

1. Set mock REST data (deployed rows only):
   ```js
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/financial-position",
     JSON.stringify({
       assets: {
         total: "8000000.000000",
         liquid: { total: null, cash_stablecoins: null, tokenized_tbills: null, off_chain_usd: null },
         deployed: {
           total: "8000000.000000",
           secured_loans_outstanding: "8000000.000000",
           accrued_interest_receivable: null,
         },
       },
       liabilities: {
         total: "500000.000000",
         senior_claims: { plusd_outstanding: null },
         subordinated_capital: { junior_tranche: "500000.000000" },
       },
     }),
   );
   ```

2. Do NOT set Soroban mock keys.
3. Navigate to `/dashboard`.

**Expected results:**
- Panel is in ready state (not loading, not error).
- Cash — stablecoins (USDC) renders `—`.
- PLUSD outstanding renders `—` (with "1:1 redeemable" caption still present).
- REST-sourced rows (Secured loans, Junior tranche) still render correctly.
- The footnote "Excludes assets pending a data source" is visible.

---

## Story 5: Mobile layout — single column stack

**Persona:** Any user on a mobile device (375–430px viewport).

**Pre-conditions:** Dev server running; mock data set as in Story 1.

**Steps:**

1. Set mock data as in Story 1.
2. Open DevTools → Device emulation → set viewport to 375px wide.
3. Navigate to `/dashboard`.

**Expected results:**
- The Assets section renders first, followed by the Liabilities section below it (single column).
- No horizontal divider between columns on mobile.
- Each section has its heading, muted total, and card body with sub-sections and rows.
- All rows are readable at 375px width.

---

## Story 6: Decimal correctness — 7-decimal SAC scale

**Persona:** QA tester verifying the 7-vs-6 decimal correctness.

**Pre-conditions:** Dev server running.

**Steps:**

1. Set exactly 1 PLUSD total supply (7-decimal: `10_000_000n`):
   ```js
   localStorage.setItem("pipeline.mock.wallet.stellar.plusd.totalSupply", "10000000");
   localStorage.setItem(
     "pipeline.mock.api.GET./v1/financial-position",
     JSON.stringify({
       assets: { total: null, liquid: { total: null, cash_stablecoins: null, tokenized_tbills: null, off_chain_usd: null }, deployed: { total: null, secured_loans_outstanding: null, accrued_interest_receivable: null } },
       liabilities: { total: null, senior_claims: { plusd_outstanding: null }, subordinated_capital: { junior_tranche: null } },
     }),
   );
   ```

2. Navigate to `/dashboard`.

**Expected results:**
- PLUSD outstanding shows `$1.00` (= 10_000_000n / 1e7 = 1.0 PLUSD, formatted as $1.00).
- NOT `$10.0` (which would indicate 6-decimal scale was used incorrectly).
