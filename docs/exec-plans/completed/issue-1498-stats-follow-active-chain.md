# Issue #1498: Stats, home strip, dashboard and withdrawal-queue hooks follow the active chain instead of hard-wiring Stellar

Source: https://github.com/eq-lab/pipeline/issues/1498 (sub-issue of epic #1494, EVM support for the LP app)

## Scope

In scope (LP app, `packages/frontend`):

1. **One chain resolver.** A new `useActiveChain()` hook in `wallet/` returns `{ kind, chainId }`. `chainId` is `ENV.EVM_CHAIN_ID` or `ENV.STELLAR_CHAIN_ID`, chosen by the resolution rule in Open Question 2. Every protocol-stats API hook takes `chainId` from its caller and includes it in its React Query key. No API hook keeps a hard-coded `ENV.STELLAR_CHAIN_ID`, and none falls back to `chainId || ENV.STELLAR_CHAIN_ID`.
2. **Home surfaces always follow the active chain.** This does not depend on Open Question 1:
   - `HomeStatsStrip`: the exchange rate comes from the EVM `useStakedPlusdConvertToAssets(1e18)` on EVM and from the Stellar `useStellarUnstakeConvertToAssets(1e7)` on Stellar. It is formatted at that chain's `convertDecimals` (18 / 7, per `wallet-flows.md`), truncated to 4 dp. TVL comes from `useDashboardSummary({ chainId })` and APY from `useStats({ chainId })`.
   - `StakeCard`: the "Earn X% p.a." APY comes from `useStats({ chainId })`.
3. **Protocol Dashboard (`/dashboard`) chain seam.** A single `useDashboardChain()` hook decides which chain every dashboard panel reads. Its body is the only code that depends on Open Question 1. Every panel hook reads its chain from this hook:
   - `useYieldHistoryPanel` reads summary, TVL history and yield history.
   - `useDeploymentMonitorPanel` reads the loan book and loan submissions.
   - `useWithdrawalQueuePanel` reads the withdrawal queue and financial position.
   - `useBalanceSheetPanel` reads financial position plus the on-chain overrides.
4. **Balance sheet on EVM.** New EVM read hooks provide the two on-chain leaves:
   - PLUSD outstanding comes from `PLUSD.totalSupply()`.
   - Cash — stablecoins (USDC) comes from `USDC.balanceOf(DepositManager.custodian())`.

   `useBalanceSheetPanel` picks the Stellar or EVM pair from the dashboard chain's `kind`. If a read is unavailable it renders `—`; nothing is derived client-side.
5. **Docs**:
   - `docs/product-specs/dashboards.md`: record the chain-scoping decision and the EVM balance-sheet sources.
   - `docs/frontend/dashboard-components.md`: the HomeStatsStrip, useBalanceSheetPanel and useYieldHistoryPanel sections.
   - `packages/frontend/src/api/README.md` and `wallet/README.md`: document the new hooks and signatures.

Out of scope:

- Chain-selector UI on `/dashboard`. Even if the Open Question 1 answer is "Stellar-scoped with a selector", the selector component is a follow-up issue unless the user asks for it here. The epic lists "Protocol Dashboard chain selector UX beyond following the active view" as out of scope.
- The `isMainnetDeployment()` gate in `HomeStatsStrip`. #1497 re-derives network identity from the active view; this task leaves the gate call as is.
- Deployment config (staging frontend still points at pre-rework Hoodi addresses; that is #1503).
- `useStatsYield` / `useStatsPrices`. They already take `chainId` and have no callers in `src/`, so they are unchanged.
- Backend changes. Every endpoint touched already accepts `chain_id?` (`resolve_chain` → `DEFAULT_CHAIN_ID` when omitted). The read endpoints filter the DB by chain and do not need the chain in the API's `CHAINS` list. Verified on staging 2026-10-14: `chain_id=560048` returns 200 on `/v1/stats`, `/v1/dashboard/summary`, `/v1/loan-book`, `/v1/withdrawal-queue` and `/v1/financial-position`.

## Assumptions and Risks

- **Default view is `evm` for no-wallet visitors.** `WalletViewContext` defaults to `DEFAULT_KIND = "evm"`, and only `/account` and `AccountWalletCard` ever call `setKind`. If stats follow `kind` alone, then:
  - An anonymous visitor on production (EVM dark: `VITE_EVM_CHAIN_ID=1`, zero addresses) would see the exchange rate as `—`. TVL and APY would also show `—` or zeros from chain 1, where today they show live Stellar figures.
  - On staging, an anonymous visitor would see Hoodi numbers instead of Stellar ones.

  This is a regression risk. The resolution rule is Open Question 2; it lives in one function, so either answer is a one-line change.
- **#1365 is open.** A wallet-only LP cannot flip the view toggle, so following the view means they see whichever chain their stored `kind` says. The rule in Open Question 2 mitigates this.
- **#765.** Re-checked on 2026-10-14:
  - `GET /v1/dashboard/summary?chain_id=560048` → `loan_book_yield: null`, `outstanding_in_loans: "0.000000"`.
  - `GET /v1/loan-book?chain_id=560048` → `loans: []`.

  The malformed pre-rework Hoodi loan no longer exists on the indexed chain, so the symptom cannot reproduce. The rate scale cannot be positively confirmed until a `hoodi-v5` loan exists. Closing #765 is Open Question 3. Either way, the `#765` comments in `useDashboardSummary.ts`, `useLoanBook.ts`, `useLoanSubmissions.ts` and `dashboard-components.md` are removed, because the dashboard chain now comes from `useDashboardChain()`.
- **On-chain EVM surface verified on `hoodi-v5`** (read-only `eth_call`, 2026-10-14):
  - DepositManager `0x7A8B7628…93c1a9` exposes `custodian()` → `0xE122…FA8fA`, `plUsd()` → `0xBd27…3502` and `usdc()` → `0xe198…4597`.
  - PLUSD `totalSupply()` = `9000000000` at `decimals()` = 6.
  - USDC `balanceOf(custodian)` = `10000000000` at 6 decimals.
  - The frontend `depositManagerAbi` lacks `custodian()`; it must be added.
  - Staging's frontend env still holds pre-rework addresses (#1503). Until #1503 lands, staging EVM reads hit the old contracts. `custodian()` may revert there; the hook must surface that as `—`, not as a panel error.
- **EVM convert scale.** On `hoodi-v5`, sPLUSD and PLUSD are both 6-decimal. `convertToAssets(1e18)` still returns a correct ratio (`1e18` in → `1e18` out), so formatting at 18 dp is right because the scalar is 1e18. This task keeps the documented `convertDecimals = 18`. The token-decimals mismatch in `wallet-flows.md` belongs to #1504, the specs realignment.
- **Overlap with #1497.** #1497 touches `HomeStatsStrip` (`isMainnetDeployment` consumers) and `networkSwitcher.ts`. Merge conflicts in `HomeStatsStrip.tsx` are likely; whichever PR merges second rebases. This plan does not change the gate.
- **Query-key churn.** Adding `chainId` to keys means a view flip refetches every protocol panel. That is intended. With the 30 s polling hooks there is a brief loading state on flip, which the existing `PanelLoading` covers.

## Decision Log

Answers from the user on Issue #1498 (2026-10-14):

- **Q1 (dashboard scope): option (a), no chain selector.** The Protocol Dashboard sends `chain_id` from the connected wallet's chain; with no wallet it shows the default chain (Stellar for now). `useDashboardChain()` returns `useActiveChain()`.
- **Q2 (no wallet): the default chain is Stellar** (`ENV.STELLAR_CHAIN_ID`), until the backend changes endpoints for that case.
- **One rule for `useActiveChain()`:** EVM wallet connected → `ENV.EVM_CHAIN_ID`; Stellar wallet connected → `ENV.STELLAR_CHAIN_ID`; none → `ENV.STELLAR_CHAIN_ID`. Derived from `useEvmWallet().isConnected` / `useStellarWallet().isConnected`; `useWalletView().kind` only breaks a both-connected tie, so it is correct before and after #1512/#1513.
- **Q3 (close #765): the user's call; not acted on here.** The `#765` comments in the API hooks and the Stellar-scoped wording in `dashboard-components.md` were removed regardless.
- **Step 2 (refactor `usePnl` / `usePositionsHistory` onto `useActiveChain`) skipped.** Both are wallet-gated on the active namespace and unchanged; it stays optional cleanup.
- **EVM reads take `{ enabled }`** (default `true`); `useBalanceSheetPanel` passes `kind === "evm"` so a Stellar dashboard makes no EVM RPC calls.

## Open Questions (resolved — see Decision Log)

1. **Protocol Dashboard chain scope (product decision, per issue item 3).** Should `/dashboard` (a) follow the active wallet view like the home strip, or (b) stay Stellar-scoped with an explicit chain selector?

   **Recommended default: (a) follow the active view.** It is one rule across the app; EVM LPs see their chain's numbers; and #765, the original reason for hard-wiring Stellar, no longer reproduces. A selector (b) would be a separate UI issue (no Figma exists for it).

   Implementation impact: only the body of `components/dashboard/useDashboardChain.ts` changes. For (a) it returns `useActiveChain()`. For (b) it returns the Stellar chain until a selector issue lands. The rest of the plan is identical.

   The answer must be recorded in `docs/product-specs/dashboards.md` § Protocol Dashboard — Header and in `dashboard-components.md` § useYieldHistoryPanel "Decisions".
2. **Chain for visitors with no wallet in the active namespace.** Should `useActiveChain()` return the chain of `useWalletView().kind` unconditionally, as `usePnl` does? Or should it fall back to Stellar unless an EVM wallet is actually connected and the EVM view is active?

   **Recommended default: Stellar unless `kind === "evm"` AND `useEvmWallet().isConnected`.** This keeps anonymous visitors and Stellar LPs on the live product's numbers, including on prod where EVM is dark, and gives connected EVM LPs EVM numbers.

   `usePnl` and `usePositionsHistory` are wallet-gated, so either rule behaves identically for them.
3. **#765.** May the coder (or manager) close #765 with a comment carrying the 2026-10-14 evidence above, as "obsolete — the pre-rework Hoodi data is gone", or should it stay open until a `hoodi-v5` loan exists to re-verify the rate scale? **Recommended: close as obsolete.** If a new EVM loan shows bad scale, that is a new bug against `hoodi-v5`.

## Implementation Steps

All steps completed (step 2 skipped, see Decision Log).

1. **`useActiveChain` resolver.** Create `packages/frontend/src/wallet/useActiveChain.ts`, exporting `useActiveChain(): { kind: WalletViewKind; chainId: number }`.
   - It reads `useWalletView().kind`, plus `useEvmWallet().isConnected` if Open Question 2 is answered with the recommended rule.
   - It maps `evm` → `ENV.EVM_CHAIN_ID` and `stellar` → `ENV.STELLAR_CHAIN_ID`.
   - Export it from `wallet/index.ts`.
   - Header: one 2–3-line spec pointer to `docs/frontend/wallet-flows.md` / `dashboard-components.md`. No other comments.
2. **Refactor the existing pattern onto it.** In `api/usePnl.ts` and `api/usePositionsHistory.ts`, replace the inline `isStellar ? ENV.STELLAR_CHAIN_ID : ENV.EVM_CHAIN_ID` with `useActiveChain().chainId`.
   - Keep the address and connection selection keyed on `kind` exactly as today.
   - Behaviour must not change, because both hooks are gated on the active namespace being connected.
   - Skip this step if Open Question 2 picks "kind only" and the resolver is identical to the inline code. It stays optional cleanup.
3. **API hooks take `chainId`.** Change each of these signatures to `({ chainId }: { chainId: number })`:
   - `api/useStats.ts`
   - `api/useDashboardSummary.ts`
   - `api/useLoanBook.ts`
   - `api/useLoanSubmissions.ts`
   - `api/useWithdrawalQueue.ts`
   - `api/useFinancialPosition.ts`

   For each one:
   - Send `chain_id=<chainId>` via `URLSearchParams`.
   - Use the query key `[<existing-key>, chainId]`.
   - Remove the `ENV` import and the "Stellar-scoped / #765" comments.

   In `api/useDashboardTvlHistory.ts` and `api/useDashboardYieldHistory.ts`, drop the `chainId || ENV.STELLAR_CHAIN_ID` fallback and use `chainId` directly.

   Keep the existing per-file header comments only as far as the comment-minimal rule allows. Do not add field or function JSDoc to new code.
4. **Dashboard chain seam.** Create `packages/frontend/src/components/dashboard/useDashboardChain.ts`, which returns `{ kind, chainId }`. It implements the Open Question 1 answer:
   - (a) `return useActiveChain();`
   - (b) `return { kind: "stellar", chainId: ENV.STELLAR_CHAIN_ID };`
5. **Dashboard panels read the seam.**
   - `components/dashboard/useYieldHistoryPanel.ts`: replace `const chainId = ENV.STELLAR_CHAIN_ID` with `useDashboardChain().chainId`, and pass it to `useDashboardSummary`, `useDashboardTvlHistory` and `useDashboardYieldHistory`.
   - `components/dashboard/useDeploymentMonitorPanel.ts`: `useLoanBook({ chainId })` and `useLoanSubmissions({ chainId })`.
   - `components/dashboard/useWithdrawalQueuePanel.ts`: `useWithdrawalQueue({ chainId })` and `useFinancialPosition({ chainId })`.
6. **EVM balance-sheet reads.**
   - Add `custodian() view returns (address)` to `wallet/evm/abis/depositManager.ts`.
   - Create `wallet/evm/useEvmFinancialPositionReads.ts` with `useEvmPlusdTotalSupply()` and `useEvmUsdcCustodyBalance()`.
     - Both resolve token addresses from `useDepositManagerAddresses()` (`plusd`, `usdc`).
     - The custody hook reads `custodian()` from `ENV.DEPOSIT_MANAGER_ADDRESS`, then `erc20 balanceOf(custodian)`.
     - Read live `decimals()` with `erc20Abi`, and return a human-decimal string via `formatUnits(raw, decimals)`, or `undefined`.
   - Short-circuit to `undefined` with no RPC call when `DEPOSIT_MANAGER_ADDRESS` is the zero address or any intermediate address is missing.
   - A reverted or errored read returns `data: undefined` and an `error`, and must never throw into the panel.
   - Not wallet-gated, because these are protocol reads.
   - `staleTime` / `refetchInterval` are 30 s, matching the Stellar counterparts.
   - Export both hooks from `wallet/index.ts`. Add no new localStorage mock keys; tests use `vi.mock`.
7. **`useBalanceSheetPanel` picks by chain.** In `components/dashboard/useBalanceSheetPanel.ts`:
   - Call `useDashboardChain()` and `useFinancialPosition({ chainId })`.
   - Call all four on-chain hooks unconditionally (Stellar pair plus EVM pair, per the Rules of Hooks).
   - Select the active pair by `kind`:
     - Stellar keeps `parseHuman(plusdSupplyStr)` and `sacRawToDisplay(usdcCustodyRaw)`.
     - EVM uses `parseHuman(evmPlusdSupplyStr)` and `parseHuman(evmUsdcCustodyStr)`.
   - A missing value → `—`, and that row counts as unsourced for `showTotalsDisclaimer`. Totals logic is unchanged.
8. **`HomeStatsStrip`.** In `components/HomeStatsStrip.tsx`:
   - `const { kind, chainId } = useActiveChain();`
   - Call `useStakedPlusdConvertToAssets(kind === "evm" ? 10n ** 18n : undefined)` and `useStellarUnstakeConvertToAssets(kind === "stellar" ? 10n ** 7n : undefined)`.
   - Format the active raw value with `formatUnits(raw, kind === "evm" ? 18 : 7)`, truncated to 4 dp. This matches the `formatUnits4` truncation in `useStakeFlow.ts`.
     - Either extract `formatUnits4` into `src/utils/formatUnits4.ts` and reuse it from both places, or inline an equivalent.
     - Extraction is preferred. Catalogue it in `docs/frontend/utils.md`.
   - Today's `toFixed(4)` rounds, which contradicts `wallet-flows.md` ("truncated (not rounded)").
   - `useStats({ chainId })` and `useDashboardSummary({ chainId })`.
   - Leave the `isMainnetDeployment()` gate untouched.
9. **`StakeCard`.** In `components/StakeCard.tsx`, use `useStats({ chainId: useActiveChain().chainId })`.
10. **Grep sweep.** Run `rg "STELLAR_CHAIN_ID" packages/frontend/src`. The only remaining hits should be:
    - `lib/env.ts`
    - `routes/test.tsx`
    - the Stellar voucher hooks, which are intentionally Stellar
    - `useActiveChain.ts`
    - `useDashboardChain.ts`, only if Open Question 1 = (b)

    Run `rg "useStats\(|useDashboardSummary\(|useLoanBook\(|useLoanSubmissions\(|useWithdrawalQueue\(|useFinancialPosition\(" packages/frontend/src` and confirm that every call site passes `chainId`.
11. **Docs** (see Docs to Update), then `npx tsx scripts/lint-docs.ts`.
12. **Verify**: `yarn workspace @pipeline/frontend lint`, `typecheck` and `test`, or the repo's `/test-fast`. Then do the manual check in Test Strategy.

## Test Strategy

Unit tests (vitest; mock `@/wallet` the way `api/usePnl.test.tsx` does):

- `wallet/useActiveChain.test.tsx`: for `kind` ∈ {evm, stellar} × EVM-connected ∈ {true, false}, it returns the expected `{ kind, chainId }` per the Open Question 2 rule. The default with no provider must match the rule; with the recommended rule, a disconnected EVM default yields Stellar.
- API hook tests: update `useStats.test.tsx`, `useDashboardSummary.test.tsx`, `useLoanBook.test.tsx`, `useWithdrawalQueue.test.tsx`, `useFinancialPosition.test.tsx`, `useDashboardTvlHistory.test.tsx` and `useDashboardYieldHistory.test.tsx`. Add a minimal `useLoanSubmissions.test.tsx` if none exists. Each must:
  - assert that the fetched URL carries `chain_id=<given>` for both 560048 and 99000001;
  - assert that two different `chainId`s produce two separate fetches (distinct query keys);
  - drop assertions on the old ENV fallback.
- `usePnl.test.tsx` and `usePositionsHistory.test.tsx` stay green unchanged. They are the regression guard for step 2.
- `wallet/evm/useEvmFinancialPositionReads.test.tsx`:
  - Zero DepositManager address → `undefined` and no read.
  - Happy path: `totalSupply` 9000000000 at 6 dp → `"9000"`; custody balance 10000000000 at 6 dp → `"10000"`. Mock `wagmi` `useReadContract`, as `useDepositManager.test.tsx` does.
  - A reverted `custodian()` → `undefined` plus an error, with no throw.
- `components/dashboard/useBalanceSheetPanel.test.tsx`: add EVM-chain cases.
  - With EVM reads present, the PLUSD and USDC rows show the EVM values, and totals include them.
  - With EVM reads absent, both rows are `—`, `showTotalsDisclaimer` is true, and there is no panel error.
  - Existing Stellar cases still pass with the dashboard chain mocked to Stellar.
- `useYieldHistoryPanel.test.tsx`, `useDeploymentMonitorPanel.test.tsx` and `useWithdrawalQueuePanel.test.tsx`: mock `useDashboardChain`, and assert that the API hooks receive its `chainId`.
- `components/HomeStatsStrip.test.tsx`:
  - EVM view with rate `1042100000000000000n` → `1 sPLUSD = 1.0421 PLUSD`.
  - Stellar view with rate `10400000n` → `1 sPLUSD = 1.0400 PLUSD`.
  - Truncation, not rounding: `1042199999999999999n` → `1.0421`.
  - Missing rate → `—`, and missing `summary.tvl` → `—`.
  - `useStats` and `useDashboardSummary` are called with the active `chainId`.
  - The mainnet-gate tests are unchanged.
- `StakeCard` test, if one exists: `useStats` receives the active `chainId`.
- If `formatUnits4` is extracted, add `utils/formatUnits4.test.ts` covering truncation, zero padding and integer-only values.

Manual check (dev server is user-run; do not drive the user's browser). Ask the user to confirm in the Network tab:

- On `/` with a Stellar wallet connected and the Stellar view active, `/v1/stats`, `/v1/dashboard/summary` and the dashboard endpoints carry `chain_id=99000001`, and the exchange rate is non-`—` when Soroban is configured.
- After switching to the EVM view with an EVM wallet connected, the same requests carry `chain_id=560048`. Under the recommended rule for Open Question 2, a no-wallet visitor stays on `99000001`.
- Real data on EVM depends on #1503, which re-points the staging frontend at `hoodi-v5`. Until then, `—` in the EVM balance-sheet rows is expected.

## Docs to Update

- `docs/product-specs/dashboards.md`:
  - **§ Protocol Dashboard — Header**: add a "Chain scope" paragraph recording the Open Question 1 decision. Recommended text: "All Protocol Dashboard panels and the home stats strip read the chain of the active wallet view (`chain_id` per request)."
  - **Balance sheet sources**: add the EVM leaves.
    - PLUSD outstanding = `PLUSD.totalSupply()`, PLUSD resolved via `DepositManager.plUsd()`.
    - Cash — stablecoins = `USDC.balanceOf(DepositManager.custodian())`.
    - Both use live `decimals()`. Either one unsourced → `—`.
  - Remove any wording implying Stellar-only overrides.
- `docs/frontend/dashboard-components.md`:
  - § HomeStatsStrip:
    - The exchange rate is chain-aware: the EVM `useStakedPlusdConvertToAssets(1e18)` at 18 dp, or the Stellar `useStellarUnstakeConvertToAssets(1e7)` at 7 dp, truncated to 4 dp.
    - TVL and APY are fetched with the active `chainId`.
    - State the `useActiveChain` rule.
    - Fix the stale line ~540 ("TVL remains hardcoded").
  - § useBalanceSheetPanel: the chain-selected Stellar/EVM on-chain pair, and EVM decimal discipline (`formatUnits` with live decimals).
  - § useYieldHistoryPanel "Decisions":
    - Replace "`chainId` = `ENV.STELLAR_CHAIN_ID` … #765" with "`chainId` from `useDashboardChain()`" plus the Open Question 1 rule.
    - Replace "Resolves chain from ENV defaults" in the section intro.
  - § active-chain gating (line ~486): note that `useActiveChain` is the shared resolver for protocol stats. Leave the existing TD note about `useRequests` / `transactions.tsx` duplication alone unless they are migrated.
- `docs/frontend/wallet-flows.md`: add a short "Active chain for protocol reads" note pointing at `useActiveChain`, with the Open Question 2 rule.
- `packages/frontend/src/api/README.md`: new `{ chainId }` signatures for `useStats`, `useLoanBook`, `useWithdrawalQueue`, `useFinancialPosition`, `useDashboardSummary` and `useLoanSubmissions`.
- `packages/frontend/src/wallet/README.md`: `useActiveChain`, `useEvmPlusdTotalSupply`, `useEvmUsdcCustodyBalance`, and `custodian()` in the DepositManager ABI list.
- `docs/frontend/utils.md`: `formatUnits4`, if extracted.
