# Issue #1810: LP: activity is stale after a confirmed action — toast "View activity" / opening Activity needs a manual refresh to show the new entry

Source: https://github.com/eq-lab/pipeline/issues/1810

Epic: #522 (Activity page). Branch: `fix/1810-activity-invalidation` (draft PR #1853). Covers the
requests-invalidation part of #1629. The other #1629 items (approve errors, shares-as-USD, chart
spacing) are out of scope.

## Scope

### Root cause (verified in code)

- The `QueryClient` (`packages/frontend/src/wallet/evm/EvmWalletProvider.tsx`) uses defaults
  (`staleTime: 0`, `refetchOnMount: true`). Opening `/transactions` or Home therefore already refetches
  `/v1/requests` once on mount. The bug is **indexer lag**: that one refetch, and the immediate
  `invalidateQueries` that `useDepositFlow` fires on each request mutation's `isSuccess` edge (#1658),
  run before the worker has indexed the event, so the served list is still the old one. After that
  nothing refetches until window focus or a reload.
- The only fast polling (`REQUESTS_FAST_POLL_MS = 5_000` while a known request id is unlisted) is a
  `refetchInterval` option passed by `useDepositFlow`. It stops as soon as `/deposit` unmounts, which
  is exactly when the toast's "View" action navigates to `/transactions`.
- **Claims** (deposit and withdraw step 3) invalidate nothing. `routes/deposit.tsx` navigates to `/`
  on claim success, and Home's `RecentActivityCard` refetches once on mount, usually still seeing
  `PendingClaim`.
- **Stake / unstake** (`useStakeFlow` + `routes/stake.tsx`) invalidate nothing either. They navigate
  to `/` on success, so the Activity "Stake" / "Unstake" rows and `/v1/pnl` are stale the same way.
- **Balances:** Home reads Stellar PLUSD through `useStellarSacToken` (`staleTime: 30_000`) and
  sPLUSD through `useStellarStakedPlusdBalance` (`staleTime: 30_000`), so for up to 30 s after a
  Stellar claim or stake, Home can show the cached pre-action balance. `routes/deposit.tsx` refetches
  only the active-direction input token after step 3, which is not the token the claim changed. EVM
  `balanceOf` reads (`useEvmToken`, wagmi defaults) do refetch on mount.

### What changes

1. **One confirmation point.** A new hook, `useActionConfirmedRefresh()`, lives in
   `packages/frontend/src/api/activityRefresh.ts`. Both adapters (`useDepositFlow`, `useStakeFlow`)
   call the callback it returns on the `isSuccess` rising edge of every write that adds or changes an
   activity row: request deposit, request withdrawal, claim deposit, claim withdrawal, stake and
   unstake, on both EVM and Stellar. The callback:
   - registers an **activity expectation** (see 2);
   - invalidates `["requests"]`, `["pnl"]`, `["positionsHistory"]`;
   - invalidates on-chain balance reads: `["stellarSacToken"]`, `["stellarUsdcBalance"]`,
     `["stellarStakedPlusdBalance"]`, and wagmi `readContract` queries whose `functionName` is
     `balanceOf` (a predicate on `queryKey[0] === "readContract"`).

   The four #1658 `useEffect`s that call `useInvalidateRequests` in `useDepositFlow` are replaced by
   this callback. `useInvalidateRequests` is then unused and gets deleted.
2. **Bounded polling of the served list.** A small module-level external store holds the open
   expectations. `useRequests` subscribes to the store (`useSyncExternalStore`). While **any open
   expectation for the hook's own wallet + chain id** is unmet by the served data and not expired,
   `refetchInterval` is `ACTIVITY_POLL_MS = 3_000`. Otherwise it is the caller's interval, or `false`.
   This holds for every `useRequests` consumer (`/transactions`, `RecentActivityCard`, `/deposit`), so
   the polling follows the user across the navigation.
   - Expectation shapes (no entry is ever synthesised. The expectation is only a stop condition
     checked against the served list):
     - `{ type, requestId }`: a Deposit/Withdraw request was confirmed. Met when the served list
       has a row with that `type` and `request_id` (any status).
     - `{ type, requestId, status: "Completed" }`: a claim was confirmed. Met when that row's served
       status is `Completed`.
     - `{ type, baselineCount }`: stake/unstake (rows have no `request_id`), or a Stellar request
       whose result lacks `requestId` (it is optional in `useStellarRequestDeposit`). Met when the
       served list has more rows of that `type` than `baselineCount`. `baselineCount` is read from
       the cached `["requests", kind, address, chainId]` data at registration time. If nothing is
       cached, it is `undefined` and the expectation is met by the first served list that contains
       any row of that `type`.
     - Every expectation carries `wallet`, `chainId` (resolved from the active view exactly as
       `useRequests` does) and `deadline = Date.now() + ACTIVITY_POLL_CAP_MS` (`60_000`).
   - **How it stops:**
     - (a) **Met:** after each fetch, `useRequests` settles expectations against the new data in an
       effect. Met ones are removed. When one is removed this way, `["pnl"]` and
       `["positionsHistory"]` are invalidated once more, because the same indexer pass feeds them.
     - (b) **Cap:** the `refetchInterval` function compares `Date.now()` with `deadline` on every
       evaluation and returns the fallback interval once it has passed. Expired expectations are
       pruned on the next register/settle. The cap is 60 s, so at most about 20 extra requests per
       action.
     - (c) **Unmount:** React Query only polls mounted observers.
     - (d) **Wallet or chain switch:** expectations for another wallet/chain do not count for the
       active query.

     After the cap, the existing behaviour (refetch on mount and on focus, `/deposit`'s 5 s/60 s
     interval) continues unchanged.
3. **Claim request id capture.** In `useDepositFlow` the claim mutations' `data` carries no
   `requestId`. The id used in each step-3 `onAction` (EVM: `evmDepositRequestId` /
   `evmWithdrawRequestId`. Stellar: `stellarRequestIdBigInt`) is stored in a ref when the claim is
   sent and read on the success edge.

### Out of scope

- Any UI, copy, toast or navigation change. The toasts and the `navigate("/")` calls stay as they are.
- Optimistic or frontend-computed rows. Only the served list is shown.
- #1629 items other than requests invalidation. The `useDepositFlow` known-id 5 s poll stays: it
  drives the form's own state machine and covers reload recovery (see Assumptions).
- Mock-layer (`mockVer`) removal and backend/indexer changes.

## Assumptions and Risks

- **Indexer lag fits inside 60 s on staging.** The worker indexer polls every 500 ms
  (`packages/worker/src/indexer/config.rs`, `POLLING_INTERVAL_MS` default 500), plus confirmation
  depth and ledger close. If an environment lags longer, the list falls back to refetch on
  mount/focus after the cap. The cap is a single constant, easy to tune.
- **`/v1/requests` returns the wallet's full list** (`get_requests` in
  `packages/api/src/routes/analytics.rs`, no pagination). This keeps the `baselineCount` match valid.
  If pagination is added later, the count match must change. The plan notes this in the spec text.
- **Same indexer pass for `/v1/pnl` and `/v1/positions/history`.** Invalidating them once more when
  the requests expectation settles assumes those reads come from the same indexed events. If they
  lag further, `positionsHistory`'s existing 30 s poll still catches up. `pnl` refetches on next mount.
- **`refetchInterval` recomputation.** The hook re-renders on store changes, so React Query's
  `setOptions` sees the new function and restarts the timer. This is verified by a fake-timer test
  (see Test Strategy) rather than assumed.
- **Rising-edge semantics.** Mutations stay `isSuccess` until `reset()`, so registration must fire
  on the edge only (a `prev` ref per mutation), or re-renders would re-register and extend the cap.
- **Overlap with the `/deposit` known-id poll.** Two mechanisms touch the same query on `/deposit`.
  The rule "min(open-expectation 3 s, caller interval)" keeps them consistent. A follow-up to fold
  the known-id poll into expectations is logged as tech debt, not done here.
- **No dependency on open PRs.** Built on `main` at 83c63c0b. #1629 (draft PR #1657) touches the
  same hooks. Whichever merges second rebases. #1629's requests-invalidation item is covered here and
  should be dropped from it.

## Open Questions

_None_

## Implementation Steps

1. **`packages/frontend/src/api/activityRefresh.ts`** (new). One 2–3-line header:
   `// spec: docs/frontend/wallet-flows.md#activity-refresh-after-a-confirmed-action`.
   - Types: `ActivityExpectation = { wallet: string; chainId: number; type: RequestType;
     deadline: number } & ({ requestId: string; status?: "Completed" } | { baselineCount?: number })`.
   - Constants: `ACTIVITY_POLL_MS = 3_000`, `ACTIVITY_POLL_CAP_MS = 60_000` (exported for tests).
   - Store: module array plus listeners. `subscribeExpectations`, `getExpectations` (stable
     snapshot: replace the array on change), `addExpectation`, `settleExpectations(data, wallet,
     chainId, now)` (removes met and expired ones, returns whether any was met),
     `resetExpectationsForTests`.
   - Pure helpers: `isExpectationMet(e, data)` and
     `openExpectationsFor(list, wallet, chainId, data, now)`. Compare wallets case-insensitively
     (the API lowercases `wallet`) and ids via `String(...)`.
   - Hook `useActionConfirmedRefresh(): (a: { type: RequestType; requestId?: string | bigint;
     claimed?: boolean }) => void`. It resolves `kind`/address/chainId the same way `useRequests`
     does. It reads `baselineCount` from
     `queryClient.getQueriesData<RequestsResponse>({ queryKey: ["requests", kind, address, chainId] })`
     when there is no `requestId`. It then calls `addExpectation` and the invalidations listed in
     Scope 1. Stable via `useCallback`.
2. **`packages/frontend/src/api/useRequests.ts`**
   - Replace the 24-line header with a ≤3-line `spec:` header (pointing at
     `src/api/README.md#userequests` + `docs/frontend/wallet-flows.md#activity-refresh-after-a-confirmed-action`).
     Strip the other narrative/JSDoc comments in the file. Remove the
     `packages/frontend/src/api/useRequests.ts` entry from `scripts/lint-comments.baseline.json`.
   - Subscribe to the expectations store with `useSyncExternalStore`. Always pass a function
     `refetchInterval`: open expectations for `(address, chainId)` →
     `Math.min(ACTIVITY_POLL_MS, callerValue ?? Infinity)`, else the caller's value (number or
     function result) or `false`.
   - `useEffect` on `query.dataUpdatedAt`: `settleExpectations(...)`. If any was met, invalidate
     `["pnl"]` and `["positionsHistory"]`.
   - Delete `useInvalidateRequests`. Update `packages/frontend/src/api/index.ts` to export
     `useActionConfirmedRefresh` (and the constants only if tests need them through the barrel).
3. **`packages/frontend/src/wallet/useDepositFlow.ts`**
   - Swap the `useInvalidateRequests` import for `useActionConfirmedRefresh`. Delete the four #1658
     `useEffect`s.
   - Add rising-edge effects (a `useRef` prev flag each) for the request and claim mutations on both
     chains: `evmRequestDeposit`, `evmRequestWithdrawal`, `stellarRequestDeposit`,
     `stellarRequestWithdrawal` → `{ type, requestId: data?.requestId }`, and `evmClaim`,
     `evmClaimWithdrawal`, `stellarClaim`, `stellarClaimWithdrawal` →
     `{ type, requestId: claimIdRef.current, claimed: true }`.
   - Add `claimIdRef` (one per direction is enough; set inside each step-3 `onAction` before
     `write(...)`).
   - Keep `REQUESTS_FAST_POLL_MS`/`REQUESTS_POLL_MS` and the known-id interval as they are.
4. **`packages/frontend/src/wallet/useStakeFlow.ts`**: import `useActionConfirmedRefresh` from
   `@/api`. Add rising-edge effects on `evmStake`, `evmUnstake`, `stellarStake`, `stellarUnstake`
   `isSuccess` → `{ type: "Stake" | "Unstake" }` (baseline-count expectation). Check that no
   import cycle is introduced: `@/api` already imports from `@/wallet`, and `useDepositFlow` already
   imports `@/api`, so the same pattern is fine.
5. **No route changes** in `routes/deposit.tsx`, `routes/stake.tsx`, `routes/transactions.tsx` or
   `components/RecentActivityCard.tsx`. Their existing `useRequests()` calls pick up the polling
   automatically.
6. **Tech debt:** add a row to `docs/exec-plans/tech-debt-tracker.md`: "`useDepositFlow` known-id
   5 s poll overlaps the activity-expectation store (#1810); fold into expectations".
7. Run `yarn workspace @pipeline/frontend test`, `yarn workspace @pipeline/frontend lint`,
   `yarn workspace @pipeline/frontend build`, `npx tsx scripts/lint-docs.ts` and
   `npx tsx scripts/lint-comments.ts`. All must pass.

## Test Strategy

- **`packages/frontend/src/api/activityRefresh.test.ts`** (new, pure + store):
  - `isExpectationMet` covers: id listed (any status), id present but `PendingClaim` with
    `status: "Completed"` → not met, then `Completed` → met, `baselineCount` 2 with 2 rows → not
    met and with 3 → met, `baselineCount` undefined with 0 rows → not met and with 1 → met.
  - Wallet case-insensitivity and bigint vs string id.
  - `settleExpectations` removes met and expired ones, leaves other wallets/chains alone, and
    returns `true` only when one was met.
  - `useActionConfirmedRefresh`: it registers with the active view's wallet/chain, reads
    `baselineCount` from the seeded cache, and invalidates `requests`/`pnl`/`positionsHistory`, the
    three Stellar balance keys and only wagmi `balanceOf` `readContract` keys. Seed other keys to
    assert they are untouched.
- **`packages/frontend/src/api/useRequests.test.tsx`** (fake timers + real `QueryClient`):
  - With an open expectation for the mounted wallet, the hook refetches every 3 s and stops once a
    response lists the id.
  - Polling stops after `ACTIVITY_POLL_CAP_MS` when the id never appears.
  - An expectation for another wallet or chain id causes no polling.
  - A caller interval of 60 s becomes 3 s while an expectation is open and returns to 60 s after.
  - A function caller interval still receives the latest data.
  - Settling an expectation invalidates `pnl`/`positionsHistory`.
  - Replace the `useInvalidateRequests (#1658)` block. Shrink the test file's baseline header if it
    is touched.
- **`packages/frontend/src/wallet/useDepositFlow.test.tsx`**: replace the "requests invalidation
  (#1658)" block. Mock `useActionConfirmedRefresh` and assert:
  - one call per success edge for all four request mutations (with `requestId`) and all four claims
    (with the id captured at `onAction`, `claimed: true`);
  - no repeat call on rerender while `isSuccess` stays true.
- **`packages/frontend/src/wallet/useStakeFlow.test.tsx`**: one call per stake/unstake success edge
  on EVM and Stellar, with no `requestId`.
- **`packages/frontend/src/routes/-deposit.test.tsx`**: update the `@/api` mock
  (`useInvalidateRequests` → `useActionConfirmedRefresh`).
- **Integration (`packages/frontend/src/routes/-transactions.test.tsx`)**: with an expectation
  registered and `fetch` first returning the old list and then the list with the new Withdraw row,
  the "Sell" row appears after advancing 3 s with no remount. Add the same for
  `RecentActivityCard` showing a claimed Deposit (`Completed`) after a `PendingClaim` response,
  matching the two Acceptance bullets.
- **Manual (staging, user-run):**
  - Stellar testnet: confirm a withdrawal request, then click the toast "View": the Sell row appears
    within a few seconds without a refresh.
  - Claim a deposit: Home's Recent activity shows the Buy row as claimed, and the PLUSD balance has
    updated.
  - Network tab: `/v1/requests` polls every 3 s and stops once the row is served (or after 60 s).

## Docs to Update

- **`docs/frontend/wallet-flows.md`** (576 lines, not a product spec, so no 200-line cap):
  - Under `### Request state model`, replace the "Request list refresh (#1658)" bullet with a
    pointer to a new `### Activity refresh after a confirmed action` subsection (placed after
    `### Terminal-success toasts and navigation`). The subsection covers: which writes register an
    expectation, the three expectation shapes and their met rules, the 3 s / 60 s numbers, the four
    stop conditions, which queries are invalidated, and the "served list only, no optimistic rows"
    rule.
  - In `## Stake / unstake adapter` → `### Design choices`, add one bullet pointing at the same
    subsection.
- **`docs/frontend/hooks.md`**: remove the `useInvalidateRequests` row. Add a `useActionConfirmedRefresh`
  row (`@/api`; consumers `useDepositFlow`, `useStakeFlow`). Add a note to the `useRequests`
  behaviour if a row exists (currently only the #1658 row mentions it).
- **`packages/frontend/src/api/README.md`** `### useRequests()`: add a short paragraph on
  expectation-driven polling, linking to the wallet-flows subsection.
- **`docs/frontend/dashboard-components.md`**: in the Activity page section (around line 1955) and the
  `RecentActivityCard` mention, add one sentence: rows refresh after a confirmed action through the
  expectation poll (link to the wallet-flows subsection).
- **Product specs:** none. Behaviour matches the intended spec, and no `docs/product-specs/` file is
  extended. For reference, `home-screen-states.md` is at 198/200 lines and must not grow.
- **`docs/exec-plans/tech-debt-tracker.md`**: the one row from step 6.
