# Issue #770: Statement of Financial Position: fill Liquid fields (Cash/USYC) from Stellar contracts

Source: https://github.com/eq-lab/pipeline/issues/770

Sub-issue of epic #712 (Protocol Dashboard). Frontend flow. Figma reference (epic
#712): `A43rjYYjSwdTmiwwf5cx5n` node `3283:14275` (Balance Sheet, Panel A) — see the
epic for the Withdrawal Queue node.

## Scope

Two connected changes so both the **Balance Sheet Liquid Assets** rows (Panel A) and
the Withdrawal Queue **Liquid Cover** metric (Panel C) reflect the same on-chain USDC
value from the deployed Stellar testnet contracts.

**In scope**

1. **Cash — stablecoins (USDC).** Point the existing on-chain read at the *deployed
   Stellar testnet* USDC SAC and the correct holder account. The code plumbing already
   exists (`useStellarUsdcCustodyBalance` → `usdc_SAC.balance(usdcCustodyId)` →
   `useBalanceSheetPanel` row `bs-cash-usdc`). What is broken is **configuration**: the
   checked-in `.env` / `.env.example` still carry **Futurenet** values, and the custody
   account is set to the *issuer* G-account (`GC5SUAX…`), which makes `balance()` return
   the i64-max sentinel → the row renders `—`. The fix is to set `VITE_STELLAR_USDC_ID`
   to the deployed `usdc = CB3SHE2S5QMO4GLM65B6DADFRL7K5JPUSKNVJIXJG37ZRABZJRN5DEE6` and
   `VITE_STELLAR_USDC_CUSTODY_ID` to the real cash-holding account (see Open Questions —
   which account is unresolved).

2. **Liquid Cover.** Rewire `useWithdrawalQueuePanel.ts` so the `cash` term of the
   `(cash + tbills) / queue` ratio comes from the **on-chain** USDC custody balance
   (`useStellarUsdcCustodyBalance`, the same value the Balance Sheet shows) instead of the
   REST leaf `assets.liquid.cash_stablecoins`, which is `null` in v1 → today renders
   `0.0x`. Keep the null/non-finite → 0 rule and the divide-by-zero → `—` guard.

3. **USYC (Tokenized T-bills).** Remains a labelled seam (`—` / 0). There is **no `usyc`
   contract** in the deployment, so it cannot be sourced. `usycNav.ts` and the `tbills`
   term stay as the 1:1 identity stub contributing 0. Document the dependency.

**Out of scope**

- **Off-chain USD (trust company account)** — off-chain, no on-chain source; stays `—`.
- Backend `GET /v1/financial-position` and `GET /v1/withdrawal-queue` stay `null` for the
  liquid leaves and `liquid_cover` in v1 — this is a deliberate frontend on-chain fill.
- USYC sourcing — deferred until a USYC token/oracle is deployed.
- Any Balance Sheet layout / Figma-visual change beyond value population.

## Assumptions and Risks

- **Plumbing already exists.** `useStellarUsdcCustodyBalance` (in
  `packages/frontend/src/wallet/stellar/useStellarFinancialPositionReads.ts`) already
  calls `createTokenClient(usdcId).balance(usdcCustodyId)` at 7-decimal SAC scale with the
  i64-max sentinel guard, and `useBalanceSheetPanel.ts` already renders it into the
  `bs-cash-usdc` row and the client-recomputed assets total. So the *hook + view* work is
  a no-op for Cash; the effective change there is **env configuration** plus the
  Liquid-Cover rewire. Do not duplicate the read.
- **Env is the real lever.** `.env` currently has `VITE_STELLAR_USDC_ID=CBSUIU…`
  (Futurenet) and `VITE_STELLAR_USDC_CUSTODY_ID=GC5SUAX…` (the issuer G-account →
  sentinel → `—`). `.env.example` is "configured for Futurenet" and leaves both blank.
  The deployment in the issue is **testnet** (`usdc = CB3SHE2S…`), so
  `VITE_STELLAR_NETWORK_PASSPHRASE` / `VITE_STELLAR_HORIZON_URL` / `VITE_STELLAR_RPC_URL`
  and the four `VITE_STELLAR_*_ID` protocol contracts should also move to the testnet
  deployment for a coherent local run. Risk: mixing a testnet USDC SAC with a
  Futurenet RPC/passphrase yields "contract not found" and a whole-panel-safe `—`.
- **Holder account unknown.** The deployment (`addresses.json`) lists only C-contract
  addresses (`usdc`, `deposit_manager`, `withdrawal_queue`, `staked_pl_usd`,
  `loan_registry`, …) — no explicit "Capital-Wallet"/treasury G-account. `balance()`
  accepts either a `G…` classic account or a `C…` contract address (via
  `Address(...).toScVal()`), so the custody could be the `deposit_manager` or
  `withdrawal_queue` contract itself, or a separate treasury account. This is the primary
  open question — see below.
- **Coupling risk.** After the rewire the Balance Sheet and Liquid Cover must show a
  *consistent* cash figure. Both must read the same hook and same scaling
  (`sacRawToDisplay` → human number). Guard against unit drift: the Balance Sheet works in
  human USD; Liquid Cover's `queue` is a REST human-USD decimal string — the on-chain cash
  must be converted to the same human-USD unit before dividing.
- **No behavioural regression when unconfigured.** With empty/mismatched env the hook
  returns `undefined`; Cash → `—`, and Liquid Cover must fall back to 0 (→ `0.0x` when
  queue > 0, `—` when queue = 0) exactly as today. Preserve this.
- **Not a `trivial` task** — it changes a documented metric's data source and touches the
  product spec, so it needs planner review and the normal frontend flow.

## Open Questions

1. **Which account's USDC balance is "Cash — stablecoins"?** The deployment lists no
   treasury/Capital-Wallet G-account. Is the custody holder the `deposit_manager` contract
   (`CBN4P3NY…`), the `withdrawal_queue` contract (`CCWP3P4C…`), or a separate
   off-deployment treasury/Capital-Wallet account the human must supply? The Balance Sheet
   and Liquid Cover values are only correct once this is confirmed. (The product spec calls
   it the "Capital Wallet"/"custody account" but never pins an address.)
2. **Testnet vs Futurenet env baseline.** The deployed addresses are testnet, but the
   checked-in `.env` is Futurenet. Should this task flip the whole Stellar block
   (`VITE_STELLAR_NETWORK_PASSPHRASE`, `HORIZON_URL`, `RPC_URL`, `DEPOSIT_MANAGER_ID`,
   `WITHDRAWAL_QUEUE_ID`, `STAKED_PLUSD_ID`, `PLUSD_ISSUER_ID`, `USDC_ID`,
   `USDC_CUSTODY_ID`) to the testnet deployment, or only touch the USDC pair and leave the
   rest for a human? (Mixed networks will silently render `—`.)
3. **Confirm USYC stays `—`/0 and Off-chain USD stays out of scope** for this issue
   (no `usyc` contract deployed; off-chain has no source). Assumed yes per the issue body.
4. **Liquid Cover source** — confirm the metric should consume the on-chain USDC custody
   balance directly (reuse `useStellarUsdcCustodyBalance`) rather than waiting for a REST
   `cash_stablecoins` field. Assumed yes per the issue ("feed the same on-chain values"),
   but it deviates from the "no frontend-computed metrics / backend-served fields only"
   memory rule — this is an explicitly user-approved on-chain fill (issue body:
   "user-approved on-chain fill"), so it is allowed; flagging so the manager can confirm.

## Implementation Steps

1. **Resolve the custody account (Open Question 1) before coding.** Do not guess. Once the
   holder address is confirmed, set it as `VITE_STELLAR_USDC_CUSTODY_ID`.

2. **Update env config** (`.env` and `.env.example`), in
   `packages/frontend`-consumed keys:
   - Set `VITE_STELLAR_USDC_ID=CB3SHE2S5QMO4GLM65B6DADFRL7K5JPUSKNVJIXJG37ZRABZJRN5DEE6`
     (deployed testnet USDC SAC).
   - Set `VITE_STELLAR_USDC_CUSTODY_ID=<confirmed holder from step 1>`.
   - If Open Question 2 is "flip to testnet", also update
     `VITE_STELLAR_NETWORK_PASSPHRASE` (testnet: `"Test SDF Network ; September 2015"`),
     `VITE_STELLAR_HORIZON_URL` (`https://horizon-testnet.stellar.org`),
     `VITE_STELLAR_RPC_URL` (`https://soroban-testnet.stellar.org`),
     `VITE_STELLAR_DEPOSIT_MANAGER_ID=CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX`,
     `VITE_STELLAR_WITHDRAWAL_QUEUE_ID=CCWP3P4CJRKHFL5ADFI4QFFUKSLKABRBBVJ6VS52VOGY2RMYZ6FT56K6`,
     `VITE_STELLAR_STAKED_PLUSD_ID=CAMBCWGBKYZZOK4URJ3C4BBUPNIMWU2A3HT33YFCETFHHAGCS7WGOA27`,
     and `VITE_STELLAR_PLUSD_ISSUER_ID` from the deployment (`plusd` — resolve its issuer
     G-account from `addresses.json`). Update the trailing `# …` comments (drop the stale
     "futurenet 2026-06-19" notes; note "testnet" + date).
   - Update the `lib/env.ts` doc-comments that still cite Futurenet example addresses
     (`STELLAR_USDC_ID`, `STELLAR_USDC_CUSTODY_ID`, `STELLAR_PLUSD_ISSUER_ID`) to the
     testnet deployment values, if the block is flipped.

3. **Rewire Liquid Cover** in
   `packages/frontend/src/components/dashboard/useWithdrawalQueuePanel.ts`:
   - Import and call `useStellarUsdcCustodyBalance` (from
     `@/wallet/stellar/useStellarFinancialPositionReads`) and `sacRawToDisplay` (from
     `@/wallet/stellar/useStellarSacToken`).
   - Replace the `cash` derivation (currently `fp?.assets.liquid.cash_stablecoins`) with
     the on-chain value: when the hook's `data` (raw i128 bigint) is defined, convert via
     `parseFloat(sacRawToDisplay(raw))`; else `0`. Keep the existing `Number.isFinite`
     guard → 0.
   - Leave the `tbills` term reading `fp?.assets.liquid.tokenized_tbills` (still `null` →
     0) — the USYC seam. (Optionally source `tbills` from the same `usycNav` seam once a
     contract exists; out of scope now.)
   - Keep `queue` from `data.summary.in_queue_usd` and the divide-by-zero → `—` guard.
   - Update the JSDoc on `WithdrawalQueueSummaryFormatted.liquidCover` and the inline
     comments: `cash = on-chain USDC custody balance` (not the null REST leaf). Note the
     seam that `tbills` remains null until USYC is deployed.
   - Do **not** change `useFinancialPosition()` usage if `tbills` still needs it; if `cash`
     no longer uses `fp`, keep `fp` only for `tbills` (still needed) — verify no unused
     import lint error.

4. **Confirm the Balance Sheet needs no code change.** `useBalanceSheetPanel.ts` already
   renders `useStellarUsdcCustodyBalance` into `bs-cash-usdc` and the assets total. Verify
   this remains correct after the env change; do not re-plumb the row. USYC row stays `—`,
   off-chain row stays `—`, the "Excludes assets pending a data source" footnote
   (`showTotalsDisclaimer`) continues to trip because USYC + off-chain remain unsourced.

5. **Lint & typecheck.** Run `npx tsx scripts/lint-docs.ts` (docs) and the frontend
   lint/typecheck; fix any unused-import / type errors introduced by step 3.

## Test Strategy

- **`useWithdrawalQueuePanel.test.tsx`** — update the existing suite (currently asserts
  Liquid Cover reads REST `cash_stablecoins`):
  - Mock `useStellarUsdcCustodyBalance` (as the suite already mocks `@/wallet` and
    `@/lib/env`). Add a mock returning a raw bigint (e.g. `18_500_000_000_000n` =
    1,850,000 USDC at 7-decimal scale).
  - Assert: on-chain cash = queue → `1.0x`; on-chain cash `undefined` (unconfigured) →
    `0.0x` when queue > 0; queue = 0 / empty state → `—`.
  - Replace/repurpose the existing "real cash value from financial-position" test
    (it currently feeds `cash_stablecoins` via REST) to feed the on-chain hook instead.
  - Keep the null/non-finite → 0 and divide-by-zero → `—` assertions.
- **`useBalanceSheetPanel.test.tsx`** — confirm no regression: `bs-cash-usdc` renders the
  on-chain USDC value, USYC + off-chain stay `—`, totals footnote logic unchanged. Add a
  case only if step 3's shared-hook change affects it (it should not).
- **`useStellarFinancialPositionReads.test.tsx`** — unchanged behaviour; the hook is
  reused as-is. Sentinel-guard and zero-balance cases already cover the config edge cases.
- **Manual / Figma verification** (frontend flow, no ux-tester phase): with the confirmed
  testnet env, run `yarn workspace @pipeline/frontend dev` (localhost:5173), open the
  Protocol Dashboard, and verify against Figma node `3283:14275` that (a) the Balance
  Sheet Cash row shows a real USDC figure (not `—`), (b) USYC + off-chain stay `—`, and
  (c) the Withdrawal Queue Liquid Cover reads a real ratio (not `0.0x`) consistent with
  `cash / in-queue`. Confirm the two panels agree on the cash number.

## Docs to Update

- **`docs/product-specs/dashboards.md`**
  - Panel A "Cash — stablecoins (USDC)" bullet (~line 116): already accurate; refresh only
    if the custody-account description or env var changes.
  - Panel C (~line 180): update the `liquid_cover` note — it currently says REST serves
    `null` until a Capital-Wallet source exists. Document that the **frontend** now
    computes Liquid Cover as `(on-chain USDC custody balance + tbills) / in_queue_usd`,
    with `tbills` still 0 (no USYC contract) and the REST `liquid_cover` remaining `null`
    (informational). Mark this as a user-approved on-chain fill, mirroring the Panel A
    Cash treatment.
- **`docs/frontend/hooks.md`** — if `useWithdrawalQueuePanel` / `useStellarUsdcCustodyBalance`
  usage notes reference the Liquid Cover source, update to reflect the on-chain source.
- **`.env.example`** header comment ("configured for Futurenet") — update if the block is
  flipped to testnet (Open Question 2).
- **`docs/exec-plans/tech-debt-tracker.md`** — log the USYC seam: Tokenized T-bills stays
  0/`—` until a USYC token/oracle is deployed; wire `usycNav.ts` + the `tbills` term then.
