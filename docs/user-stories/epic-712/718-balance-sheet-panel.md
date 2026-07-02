# User Stories: #718 — Balance Sheet panel (Panel A)

Epic: [#712 — Protocol Dashboard](https://github.com/eq-lab/pipeline/issues/712)
Issue: [#718](https://github.com/eq-lab/pipeline/issues/718)
Plan: `docs/exec-plans/active/issue-718-balance-sheet-panel.md`
Figma desktop: [node 3283:14275](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-14275&m=dev)
Figma mobile: [node 3283:72288](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72288&m=dev)

**Data sources (real data only — no localStorage mocks):**
- PLUSD outstanding (LIABILITY): Horizon `GET /assets?asset_code=PLUSD&asset_issuer={VITE_STELLAR_PLUSD_ISSUER_ID}` → `balances.authorized`
- Cash — stablecoins (USDC) (ASSET): Soroban `usdc_SAC.balance(VITE_STELLAR_USDC_CUSTODY_ID)` via `TokenClient`
- Deployed / Junior rows: `GET /v1/financial-position` REST API
- USYC and Off-chain USD: always `—` (no source in v1)

---

## Story 1: Ready state — real data from API + Soroban + Horizon

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running at `http://localhost:5173`. `VITE_STELLAR_PLUSD_ISSUER_ID`, `VITE_STELLAR_USDC_ID`, and `VITE_STELLAR_USDC_CUSTODY_ID` are configured. No `pipeline.mock.*` localStorage keys are set.

**Steps:**

1. Navigate to `/dashboard`.
2. Wait for the Balance Sheet panel to enter ready state (all network calls resolve).

**Expected results:**
- The Balance Sheet panel (`data-testid="dashboard-panel-balance-sheet"`) renders in ready state.
- **Assets column** shows:
  - Secured loans outstanding: from REST (`GET /v1/financial-position`)
  - Accrued interest receivable: from REST
  - Cash — stablecoins (USDC): from Soroban `usdc.balance(custodyAccount)` — shows `$0` if custody holds no USDC, or `—` if the custody account has no USDC trustline
  - Tokenized T-bills (USYC): `—`
  - Off-chain USD: `—`
- **Liabilities column** shows:
  - PLUSD outstanding: from Horizon `/assets` with caption "1:1 redeemable"
  - Junior tranche: from REST
- A muted footnote "Excludes assets pending a data source" is visible (USYC and off-chain always unsourced).
- Desktop: two columns side by side with a vertical 1px divider.
- Network tab confirms: a Soroban `POST https://rpc-futurenet.stellar.org/` fires (USDC `balance()` call) and a Horizon `GET /assets?asset_code=PLUSD…` fires. No `pipeline.mock.*` keys in localStorage.

---

## Story 2: Loading state

**Persona:** Any user viewing the Protocol Dashboard.

**Pre-conditions:** Dev server running; REST is in-flight.

**Steps:**

1. Navigate to `/dashboard`.
2. Observe immediately before REST resolves.

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

**Pre-conditions:** `VITE_STELLAR_USDC_ID` and `VITE_STELLAR_USDC_CUSTODY_ID` are empty.

**Steps:**

1. Leave USDC env vars unset (defaults to empty string).
2. Navigate to `/dashboard`.

**Expected results:**
- Panel is in ready state (not loading, not error).
- Cash — stablecoins (USDC) renders `—`.
- PLUSD outstanding renders `—` (if `VITE_STELLAR_PLUSD_ISSUER_ID` is also unset) or shows a real value (if set).
- REST-sourced rows (Secured loans, Junior tranche) still render correctly.
- The footnote "Excludes assets pending a data source" is visible.

---

## Story 5: Mobile layout — single column stack

**Persona:** Any user on a mobile device (375–430px viewport).

**Pre-conditions:** Dev server running; real data loading.

**Steps:**

1. Open DevTools → Device emulation → set viewport to 375px wide.
2. Navigate to `/dashboard`.

**Expected results:**
- The Assets section renders first, followed by the Liabilities section below it (single column).
- No horizontal divider between columns on mobile.
- Each section has its heading, muted total, and card body with sub-sections and rows.
- All rows are readable at 375px width.

---

## Story 6: Sentinel guard — issuer account does not render $922B

**Persona:** QA tester verifying the sentinel guard.

**Pre-conditions:** `VITE_STELLAR_USDC_CUSTODY_ID` is set to an issuer account (which returns i64 max from `balance()`).

**Steps:**

1. Set `VITE_STELLAR_USDC_CUSTODY_ID` to the USDC issuer account address.
2. Navigate to `/dashboard`.

**Expected results:**
- Cash — stablecoins (USDC) renders `—` (not ~$922B).
- No JavaScript error or crash — the hook silently treats the sentinel as unconfigured.
