# Issue #656: Deposit/withdraw: hide the bottom actions block while chain data / API are still loading

Source: https://github.com/eq-lab/pipeline/issues/656

## Scope

Fix a frontend flash where the bottom actions block on `/deposit` and `/withdraw`
renders the StepsCard (with placeholder `0.00` balances and default step states)
before chain balance data and the requests API have resolved.

In scope:

- `packages/frontend/src/wallet/useDepositFlow.ts` — expose a new combined
  readiness flag `isDataPending: boolean` on `FlowState`, computed for both the
  EVM and Stellar paths. It is `true` when the active-direction balance query is
  still loading OR the shared requests API query is still loading.
- `packages/frontend/src/routes/deposit.tsx` — add a leading guard in the bottom
  conditional (the block starting at line ~450/451) that renders a neutral
  hidden/loading state while `flow.isDataPending` is `true`, placed AFTER the
  `!flow.isConnected` connect-wallet branch and BEFORE the low-balance / Stellar
  trustline / EVM steps branches.
- Covers both directions (`deposit` and `?direction=withdraw`) and both chains
  (EVM + Stellar), since the flag is selected per active direction inside the hook.

Out of scope:

- No changes to the actual data-fetching hooks (`useEvmToken`, `useStellarToken`,
  `useStellarSacToken`, `useRequests`) — they already expose `isLoading`.
- No change to the connect-wallet banner behavior (disconnected still shows the
  connect banner, never a loader).
- No redesign of the StepsCard or banners.

## Assumptions and Risks

- **Disconnected vs. pending ordering.** When the wallet is disconnected, the
  balance/requests queries are `enabled: false`, so react-query reports
  `isLoading === false` (a disabled query is `pending` but not `fetching`, and
  `isLoading = isPending && isFetching`). The connect-wallet branch (`!flow.isConnected`)
  must therefore be evaluated FIRST so a disconnected user always sees the connect
  banner, never the loader. The new guard goes immediately after it.
- **EVM balance loading source.** `useEvmToken` aggregates its reads into a single
  `isLoading` boolean (already on `UseTokenResult`). For deposit the active token
  is USDC (`useEvmToken({ token: usdcAddr, ... })`); for withdraw it is PLUSD
  (`useEvmToken({ token: plusdAddr, ... })`). The hook must pick the loading flag
  matching the active direction, mirroring how it already selects
  `evmDepositBalance` vs `evmWithdrawBalance`.
- **Stellar balance loading source.** Deposit uses `useStellarToken()` (USDC);
  withdraw uses `useStellarSacToken({ assetCode: "PLUSD", ... })`. Both expose
  `isLoading`. Select per direction, mirroring `stellarUsdcBalanceRaw` vs
  `stellarPlusdBalanceRaw`.
- **Requests API loading.** `useRequests` already returns `isLoading`; today
  `useDepositFlow` destructures only `data` (line 316). Add `isLoading` to that
  destructure and OR it into `isDataPending`. The same `requestsData` drives both
  chains, so a single `requestsLoading` value applies to both paths.
- Risk: addresses-resolver dependencies (`useDepositManagerAddresses`,
  `useStellarDepositManagerAddresses`) load before token balances; while they are
  unresolved the token query may be disabled and report `isLoading === false`,
  producing a brief window where `isDataPending` is `false` but balance is still
  `undefined`. This is acceptable for the issue's scope (the issue is specifically
  about the balance/requests `isLoading` window); deeper "addresses unresolved"
  gating is noted as an open question rather than guessed at.

## Open Questions

- During the brief window where the protocol-addresses resolver is still loading
  (so the token balance query is disabled and `isLoading` is `false` while
  `balance` is still `undefined`), should the bottom block also be hidden? The
  issue scopes the fix to "balance query pending OR requests/API query pending";
  this plan implements exactly that. If the product wants the block hidden until
  `balance !== undefined` as well, the guard should additionally OR in
  `flow.balance === undefined && flow.isConnected`. Defaulting to the issue's
  literal wording (balance/requests `isLoading` only) unless told otherwise.
- Visual treatment of the pending state: the issue says "Render nothing (or a
  neutral skeleton/loader)". This plan renders a minimal neutral placeholder
  (an empty `data-testid="deposit-loading"` container) rather than a designed
  skeleton, since no Figma node is referenced for a loading state. Confirm whether
  a designed skeleton is required.

## Implementation Steps

1. **`packages/frontend/src/wallet/useDepositFlow.ts` — capture requests loading.**
   At line 316, change
   `const { data: requestsData } = useRequests({ refetchInterval: 60_000 });`
   to also destructure `isLoading`, e.g.
   `const { data: requestsData, isLoading: requestsLoading } = useRequests({ refetchInterval: 60_000 });`

2. **Capture EVM token loading flags.** In the `useEvmToken(...)` destructures
   (deposit ~line 250, withdraw ~line 265) add the existing `isLoading` field,
   aliased per direction (e.g. `isLoading: isEvmDepositBalanceLoading` and
   `isLoading: isEvmWithdrawBalanceLoading`).

3. **Capture Stellar token loading flags.** Use `usdcToken.isLoading` (from
   `useStellarToken()`, deposit) and `plusdSac.isLoading` (from
   `useStellarSacToken(...)`, withdraw). No new hook calls — both already exist.

4. **Add `isDataPending` to the `FlowState` interface** (`packages/frontend/src/wallet/useDepositFlow.ts`,
   in the `// ── Input derivations ──` group near `isReady`/`hasBalance`, ~line 145):
   `/** True while the active-direction balance query OR the requests API query is still loading. */`
   `isDataPending: boolean;`

5. **Compute and return `isDataPending` on the EVM path** (the `if (!isStellar)`
   return object, ~line 773). Select the balance-loading flag by direction:
   `const evmIsDataPending = (isDeposit ? isEvmDepositBalanceLoading : isEvmWithdrawBalanceLoading) || requestsLoading;`
   and add `isDataPending: evmIsDataPending,` to the returned object.

6. **Compute and return `isDataPending` on the Stellar path** (the final return,
   ~line 1063):
   `const stellarIsDataPending = (isDeposit ? usdcToken.isLoading : plusdSac.isLoading) || requestsLoading;`
   and add `isDataPending: stellarIsDataPending,` to the returned object.

7. **`packages/frontend/src/routes/deposit.tsx` — add the leading guard.** In the
   bottom conditional that begins at line 451 (`{!flow.isConnected ? (...)`),
   insert a new branch immediately after the `!flow.isConnected` branch and before
   the `isDeposit && flow.hasBalance === false` branch:

   ```tsx
   ) : flow.isDataPending ? (
     /* Chain data / requests API still loading — hide actions, render neutral placeholder. */
     <div data-testid="deposit-loading" aria-busy="true" />
   ) : isDeposit && flow.hasBalance === false ? (
   ```

   Keep the existing connect-wallet branch first so disconnected users still see
   the connect banner. The remaining branches (low-balance, Stellar 4-step,
   EVM 3-step) are unchanged and now only evaluate once data has resolved.

8. **Run lint/type checks** for the frontend package (tsc + eslint) and
   `npx tsx scripts/lint-docs.ts` per AGENTS.md.

## Test Strategy

Extend `packages/frontend/src/routes/-deposit.test.tsx`:

- The `@/api` mock currently hard-codes `useRequests` → `isLoading: false`.
  Refactor it to read from a mutable `let mockRequestsLoading = false;` so a test
  can flip it to `true`.
- The wagmi `mockUseReadContract` already defaults `isLoading: false`; add a test
  that overrides the balance read to `isLoading: true` (or flips `mockRequestsLoading`)
  and asserts:
  - `deposit-loading` placeholder is present.
  - `deposit-steps-card` / `withdraw-steps-card` is NOT in the document.
  - `low-balance-banner` is NOT in the document.
- Add the symmetric "data resolved" assertion: with `isLoading: false` and seeded
  balance/requests mocks, the StepsCard renders and `deposit-loading` is absent
  (guards against regression / over-hiding).
- Cover both directions (set `mockDirection`) and both chains (EVM via mock keys;
  Stellar via the `pipeline.mock.wallet.stellar.*` keys + `useWalletView` kind),
  at least: EVM deposit pending, EVM withdraw pending, Stellar deposit pending.
- Keep an explicit case: disconnected + (would-be) pending still shows
  `connect-wallet-banner`, never `deposit-loading`.

Run the frontend unit suite (`/test-fast` or the package's vitest) and confirm
green.

## Docs to Update

- None required. This is a `fix/` that corrects a loading-state flash; no
  user-facing behavior contract or product spec changes. (If a designed skeleton
  is mandated per Open Questions, add the Figma node reference to this plan and
  the relevant frontend doc.)
