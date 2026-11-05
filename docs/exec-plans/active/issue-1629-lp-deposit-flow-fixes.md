# Issue #1629: LP: approve errors swallowed, no requests invalidation (double deposit), shares shown as USD, chart spacing

Source: https://github.com/eq-lab/pipeline/issues/1629

Parent epic: #1521. Branch: `fix/1629-lp-deposit-flow-fixes`. App: LP (`packages/frontend`).

## Scope

Five independent fixes in the LP app, each with a test.

1. **EVM approve errors surface.** In `useDepositFlow`, EVM step 1 (approve USDC / PLUSD) gets
   `state: "error"`, `errorMessage` and `errorDetails`, and `step1Tx.error` / `step1Tx.userError`
   carry the approval error instead of a hard-coded `null`. The deposit route's step-1 toast gets
   the error branch that `routes/stake.tsx` already has.
2. **Request lifecycle after `requestDeposit` / `requestWithdrawal`.**
   - Parse the EVM request id from the mined receipt (`DepositRequested` / `WithdrawalRequested`).
   - Invalidate `["requests"]` when a request mutation succeeds (EVM and Stellar), and poll faster
     while a known request id is not yet listed by the API.
   - Guard against a second request after a reload: persist an EVM in-flight record, as the
     Stellar path already does, and treat it as an active request until the API lists that id.
3. **Headline sPLUSD value in assets, not shares.** The home route's `balanceLabel` and
   `StakeCard.splusdUsdValue` use `splusdInPlusdActive`, the on-chain `convertToAssets` read that
   is already computed. They no longer use `splusdSharesActive`. The chart tooltip and Y axis
   depend on Open Question 1.
4. **Chart x positions by timestamp.** `PortfolioPlaceholderCard` places served-series bars at
   their bucket timestamp on a time scale, not at an even index slot. Hover uses a step lookup:
   the latest bucket whose timestamp is at or before the cursor time.
5. **Stellar minimum deposit from the contract.** Remove the hard-coded `STELLAR_MIN_DEPOSIT`.
   A new hook reads the Soroban DepositManager's `min_deposit()`.

Out of scope:

- Backend changes. A per-bucket assets value on `/v1/positions/history` would be a backend issue;
  see Open Question 1.
- `useStakeFlow`'s use of the aggregated `useEvmToken().error` for step 1. It mixes read errors
  into the approve row. Log it as tech debt and do not change it here.
- Stake/unstake request invalidation.

## Assumptions and Risks

- **Stellar `min_deposit()` exists on the live contract.** I checked the testnet contract
  `CDMMJ2UOAJG7B6U5WT5LCVNJI4Y5ELQQRIYUYTIZFZ523KNEFJPLHWZT` (current `.env`) on 2026-10-26.
  Its spec lists `min_deposit() -> i128` and `set_min_deposit(new_min_deposit)`, and simulating
  the call returns `10000000000` ($1,000 at 7 dp). So the "Soroban has no on-chain minimum getter"
  statement in `docs/frontend/wallet-flows.md#business-rules` is out of date. The checked-in
  `wallet/stellar/contracts/depositManager.ts` binding (captured 2026-06-10) does not list it.
- **EVM event signatures.** I took these from the worker indexer
  (`packages/worker/src/indexer/parsers.rs`), which already decodes them from the live chain:
  `DepositRequested(uint256 indexed requestId, address indexed user, uint256 amount)` and
  `WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued)`.
  Neither is in the frontend ABI subsets yet.
- **Item 4's premise conflicts with the backend spec.** `docs/references/backend.md`
  (`GET /v1/positions/history`) and `build_history_series` in `packages/api/src/routes/pnl.rs` say
  the series is already dense: one bucket per interval step, with quiet buckets carried forward.
  With a dense uniform grid, index spacing and timestamp spacing give the same picture today.
  The time-scale change is still correct and costs little, because it removes the dependence on
  densification. See Open Question 2.
- **Invalidation alone does not close the indexer-lag window.** The API usually does not list the
  request yet when the receipt lands. That is why the plan adds faster polling while a known id is
  missing, and why the reload guard needs a persisted record.
- **Hook-test wiring.** `useDepositFlow.test.tsx` mocks the whole `@/wallet` and `@/api` barrels
  and renders without a `QueryClientProvider`. Calling `useQueryClient()` directly in
  `useDepositFlow` would break those tests. The invalidation therefore goes through a new `@/api`
  hook, which the barrel mocks can stub. `routes/-deposit.test.tsx` drives Stellar through
  `seedStellarMocks`, so the new min-deposit hook must be stubbed with `vi.mock` of its module.
  No new `pipeline.mock.*` key is added.
- **`formatBigintCurrency(undefined)` returns `$0.00`.** While `convertToAssets` is loading, or
  if it fails, with a non-zero share balance, the headline would show a false `$0.00`. The plan
  renders `—` in that case, following the "missing data renders —" rule.

## Open Questions

1. **Chart tooltip and Y-axis units (item 3).** `/v1/positions/history` serves only
   `shares_balance` per bucket and no assets or price. The card's `$` tooltip and `$` Y axis are
   share counts formatted as dollars. Showing true USD per bucket needs the historical share
   price, and multiplying by today's `convertToAssets` ratio would be a client-derived, and
   historically wrong, metric. Which option?
   - (a) Relabel the tooltip and Y axis in share units (`1,234.56 sPLUSD`, no `$`). The values
     stay verbatim. This departs from the Figma `$` styling.
   - (b) File a backend issue to add a per-bucket assets/value field. Keep the chart unchanged
     until it lands and fix only the headline in this PR.
   - (c) Both: (a) now, switch to `$` once (b) lands.

   My default if you don't answer is (b). This PR would fix only the headline and `StakeCard`.
2. **Item 4 given a dense backend series.** The backend already returns a dense, uniform grid (see
   Assumptions). Should we still ship the timestamp x scale as a defensive change, as planned, or
   drop item 4 and close it as "API is dense"? My default is to ship it. It is small, and the
   rendering stays the same for dense data.
3. **EVM reload guard storage.** The planned guard persists an in-flight EVM request
   (`{ requestId, amount, txHash, createdAt }`) in `localStorage`, keyed by chain and address. It
   mirrors the existing Stellar `pipeline.stellar.deposit.inflight.*` record and is cleared as soon
   as `/v1/requests` lists that id. It is a persisted recovery record, not a mock. Is that
   acceptable under the "no localStorage mocks — real data" rule? The alternative is an on-chain
   `getLogs` scan for `DepositRequested(user)` / `WithdrawalRequested(withdrawer)` on page load,
   cross-checked against `RequestClaimed`. It needs no storage but is heavier and limited by the
   RPC's log-range cap. My default is the `localStorage` record.

## Implementation Steps

### Item 1: EVM approve errors

1. `packages/frontend/src/wallet/evm/useApproval.ts`: in `approve`, call `setWriteError(null)` before
   each new attempt. Without it, a stale simulate failure would mask a later wallet rejection,
   because `error = writeError ?? wagmiWrite.error ?? …`.
2. `packages/frontend/src/wallet/evm/useEvmToken.ts`: add `approveError: Error | null` to
   `UseTokenResult`. It is `approval.error` when a spender is given and `null` otherwise. It is
   separate from the aggregated `error`, so balance and metadata read failures never paint the
   approve row.
3. `packages/frontend/src/wallet/useDepositFlow.ts`, EVM path:
   - Destructure `approveError` from both `useEvmToken` calls (deposit USDC and withdraw PLUSD).
   - `evmStep1Error = isDeposit ? depositApproveError : withdrawApproveError`, and
     `evmStep1UserError = toUserError(...)`.
   - Step 1 state: success conditions win over error (same as the stake flow), then
     `evmStep1Error && !isApprovePending ? "error" : "idle"`.
   - `step1.errorMessage` / `step1.errorDetails` are set only when `state === "error"`.
   - `step1Tx.error = evmStep1Error`, `step1Tx.userError = evmStep1UserError`.
4. `packages/frontend/src/routes/deposit.tsx`, step-1 toast effect (around L155): add a
   `prevStep1Error` ref and an error branch copied from `routes/stake.tsx` L129–151.
   - It logs `console.error("Approval failed:", …)`.
   - It calls `toast.update(toastId, { tone: "danger", title: mapped.isSpecific ? mapped.message : "Approval failed", action: Details → setErrorDialog })`.
   - Add `flow.step1Tx.error` to the effect deps.

### Item 2: request id, invalidation, duplicate guard

5. ABIs:
   - `packages/frontend/src/wallet/evm/abis/depositManager.ts`: add the `DepositRequested` event
     entry.
   - `packages/frontend/src/wallet/evm/abis/withdrawalQueue.ts`: add `WithdrawalRequested`.
   - Optionally add `RequestClaimed`, only if Open Question 3 resolves to the `getLogs` approach.
6. `packages/frontend/src/wallet/evm/useDepositManager.ts`, `useRequestDeposit` real path: when
   `wagmiReceipt.data` is present, decode with viem
   `parseEventLogs({ abi: depositManagerAbi, eventName: "DepositRequested", logs: wagmiReceipt.data.logs })`.
   Keep only logs whose `address` matches `DM_ADDRESS`, case-insensitively, and whose `user`
   matches the connected address. Return `data: { hash, requestId: args.requestId.toString() }`.
   Memoize the decode on the receipt.
7. `packages/frontend/src/wallet/evm/useWithdrawalQueue.ts`, `useRequestWithdrawal`: do the same
   with `WithdrawalRequested` (match `withdrawer`), and set `requestId` and `queued`. Update the
   header comment, which says `requestId` is mock-only.
8. New `packages/frontend/src/wallet/evm/inflight.ts`: `read/write/clearInflightEvmRequest(kind, chainId, address)`.
   - `kind` is `"deposit" | "withdraw"`.
   - The key is `pipeline.evm.<kind>.inflight.<chainId>.<lowercased address>`.
   - The shape is `{ requestId, amount, txHash, createdAt }`.
   - Use try/catch around storage and validate the parsed shape, mirroring the Stellar helpers.
   - Export from `src/wallet/index.ts`.
   - In `useRequestDeposit` and `useRequestWithdrawal`, add an effect: once the receipt succeeds
     and the `requestId` is decoded, `writeInflightEvmRequest(...)` with the amount passed to
     `write`. Keep the last amount in a ref.
9. `packages/frontend/src/api/useRequests.ts`:
   - Export `useInvalidateRequests()`. It returns a stable callback that calls
     `queryClient.invalidateQueries({ queryKey: ["requests"] })`. Re-export it from `src/api/index.ts`.
   - Widen `UseRequestsOptions.refetchInterval` to
     `number | ((data: RequestsResponse | undefined) => number | false)`, and pass function values
     through as `(query) => fn(query.state.data)`.
10. `packages/frontend/src/wallet/useDepositFlow.ts`:
    - Read `evmDepositInflight` / `evmWithdrawInflight` with `readInflightEvmRequest` for the
      connected EVM address and `ENV.EVM_CHAIN_ID`. Read them before `useRequests`.
    - Collect the pending ids that are known but may not be indexed yet:
      `evmRequestDeposit.data?.requestId`, `evmRequestWithdrawal.data?.requestId`, the EVM in-flight
      ids, `stellarRequestDeposit.data?.requestId`, `stellarRequestWithdrawal.data?.requestId`, and
      the Stellar in-flight ids.
    - Call `useRequests({ refetchInterval: (data) => anyKnownIdMissingFrom(data) ? 5_000 : 60_000 })`.
    - `const invalidateRequests = useInvalidateRequests()`. Add one `useEffect` per request
      mutation (EVM deposit, EVM withdraw, Stellar deposit, Stellar withdraw) that calls it on the
      `isSuccess` rising edge.
    - Reconcile: an effect that calls `clearInflightEvmRequest` once `requestsData.requests`
      contains that `request_id`, with any status. After that, the API drives state. Ignore the
      record for the current render as soon as the id is listed (an `*InflightActive` flag),
      mirroring Stellar.
    - EVM request ids: `evmDepositRequestId = active?.request_id ?? evmRequestDeposit.data?.requestId ?? (evmDepositInflightActive ? inflight.requestId : undefined)`.
      Do the same for withdraw.
    - `evmDepositRequestIsConfirmed` becomes `active !== null || (isSuccess && id !== undefined) || evmDepositInflightActive`.
      Same for withdraw. This one change disables approve and confirm, which is the duplicate
      guard, because both `canEvmApprove*` and `canEvmConfirm*` already include `!…RequestIsConfirmed`.
    - "Awaiting indexer" state, when confirmed but no active request yet: `step2.loading` is true,
      `isPendingVerification` is true, and `isAmountLocked` is true. `lockedAmountRaw` is the
      active request amount, else the in-flight amount, else the in-session mutation amount.
      Mirror the Stellar `lockedAmountRaw` fallback. `exceedsBalance` stays false while locked.
    - Also clear the EVM in-flight record on claim success, which mirrors Stellar.

### Item 3: headline in assets

11. `packages/frontend/src/routes/index.tsx` (around L154):
    - Replace `formatBigintCurrency(splusdSharesActive, splusdDecimals)` with a
      `splusdValueFormatted` built from `splusdInPlusdActive` at `plusdDecimals`.
    - When `splusdSharesActive` is a non-zero amount but `splusdInPlusdActive` is still
      `undefined`, render `"—"`. Otherwise use `formatBigintCurrency(splusdInPlusdActive, plusdDecimals)`,
      which gives `$0.00` for zero shares.
    - Pass it to every `balanceLabel` and to `StakeCard.splusdUsdValue`, mobile and desktop.
    - `deriveHomeState`, `mobileHomeState` and `isDisplayZero` gating keep using shares.
12. Chart tooltip and Y axis: follow Open Question 1.
    - (a): add an optional `valueFormatter` / unit prop to `PortfolioPlaceholderCard` and
      `ChartValueAxis` so the tooltip and ticks render `N sPLUSD`.
    - (b): no chart change in this PR. Log the backend follow-up issue under epic #1521, labelled
      `backend`. The manager or a human files it; the planner does not.

### Item 4: timestamp x scale

13. `packages/frontend/src/components/usePortfolioChart.ts`:
    - Add a pure `timeToX(ts, t0, t1)` helper and a `stepIndexAt(timestamps, t)` helper (binary
      search for the last index with `timestamps[i] <= t`, clamped to 0).
    - `onPointerMove` maps the cursor fraction to time over `[t0, t1]` and sets
      `hoveredIdx = stepIndexAt(...)`.
    - In series mode, `t0 = timestamps[0]` and `t1 = max(timestamps.at(-1), now)`. The last bucket
      keeps its value up to "now" under step interpolation.
    - Placeholder mode keeps index slots: its timestamps are already uniform.
    - Expose `xOf(i)` or `t0`/`t1` from the hook state.
14. `packages/frontend/src/components/PortfolioPlaceholderCard.tsx` (around L341):
    - In series mode, each bar's `cx` comes from its timestamp, not `slotCentreX(i, slotCount)`.
    - Bar width uses the median bucket spacing in px (the same clamps as today), so a gap does
      not widen bars.
    - `cursorLeftPct` uses the hovered bucket's x.
    - The placeholder branch is unchanged.

### Item 5: Stellar min deposit

15. New `packages/frontend/src/wallet/stellar/useStellarDepositManagerMinDeposit.ts`:
    - A `useQuery` keyed `["stellarDepositManagerMinDeposit", depositManagerId]` that simulates
      `min_deposit()`, following the read-simulation pattern in
      `useStellarDepositManagerAddresses.ts` (`READ_SIMULATION_SOURCE`). It returns
      `{ minDeposit: bigint | undefined, isLoading, error }`.
    - `scValToNative` of an i128 is a `bigint`; coerce with `BigInt(...)`.
    - Use the EVM hook's cache policy (`staleTime: Infinity`, no refetch on focus). Like EVM, a
      stale value surfaces as a contract revert.
    - When `depositManagerId` is empty, short-circuit to `undefined`.
    - Add no mock key.
    - Optionally add `minDeposit()` to `DepositManagerClient` and reuse it. Export the hook from
      `src/wallet/index.ts`.
16. `packages/frontend/src/wallet/useDepositFlow.ts`:
    - Delete `STELLAR_MIN_DEPOSIT` and its comment, and call the new hook unconditionally.
    - Replace every use at L646, L707, L1071, L1267 and L1285 with `stellarMinDeposit`.
    - Make the Stellar path's undefined handling match the EVM path:
      - `stellarDepositMeetsMin` requires the value to be defined.
      - `isStellarDepositReady` requires it.
      - `stellarHasBalance` is `undefined` until it loads.
      - The Min chip is a no-op until it loads.
      - `minChipLabel` falls back to `"Min"`.
      - `minDeposit` returns the read value.
17. Comments: one 2–3-line spec-pointer header per new file, nothing else. Run
    `npx tsx scripts/lint-comments.ts`, and shrink `scripts/lint-comments.baseline.json` for
    touched files that it lists.

## Test Strategy

Vitest, colocated. Every item gets at least one test, per the acceptance criteria.

- **Item 1**
  - `useApproval.test.tsx`: a simulate failure followed by a retry clears the stale `writeError`.
  - `useEvmToken.test.tsx`: `approveError` reflects only approval errors and is `null` without a
    spender.
  - `useDepositFlow.test.tsx`, new EVM describe: an approve error gives
    `step1.state === "error"`, a mapped `errorMessage`, `errorDetails`, and a non-null
    `step1Tx.error`. Success wins over error. A pending approve is not an error.
  - `routes/-deposit.test.tsx`: a failed approve shows the danger toast with a Details action.
- **Item 2**
  - `useDepositManager.test.tsx` / `useWithdrawalQueue.test.tsx`: given a mocked
    `useWaitForTransactionReceipt` receipt with an encoded `DepositRequested` /
    `WithdrawalRequested` log, built with viem `encodeEventTopics` / `encodeAbiParameters`,
    `data.requestId` (and `queued`) are decoded. A log from another address or user is ignored,
    and the in-flight record is written.
  - `inflight.test.ts`: round trip, malformed JSON, and storage throwing.
  - `useRequests.test.tsx`: the function form of `refetchInterval` is passed through.
    `useInvalidateRequests` invalidates every `["requests", …]` key.
  - `useDepositFlow.test.tsx`, acceptance: with an EVM in-flight record present and `/v1/requests`
    empty (the reload case):
    - `requestIsConfirmed` is true;
    - `step1.disabled` and `step2.disabled` are both true;
    - `isAmountLocked` is true, with `lockedAmountRaw` equal to the in-flight amount;
    - `step2.loading` is true.

    Once the API lists that `request_id`, the record is cleared and the API drives state.
    The invalidate callback fires once on each request mutation's `isSuccess` rising edge (EVM
    and Stellar).
- **Item 3**
  - `routes/-index.test.tsx`: with shares ≠ assets, for example 1,000 shares and 1,001.50 assets,
    the balance heading and `StakeCard` show `$1,001.50`. Assets undefined with non-zero shares
    renders `—`. Zero shares renders `$0.00`.
  - Chart unit tests follow Open Question 1.
- **Item 4**
  - `PortfolioPlaceholderCard.test.tsx` / a `usePortfolioChart` unit test: for a series with an
    uneven gap (`t, t+1h, t+10h`), bar x positions are proportional to time.
    `stepIndexAt` returns the earlier bucket for a cursor inside the gap. A dense uniform series
    renders the same as before (regression).
- **Item 5**
  - `useStellarDepositManagerMinDeposit.test.tsx`: mock `SorobanRpc.Server.simulateTransaction`
    to return an i128 `10000000000` ScVal, and expect `minDeposit === 10_000_000_000n`. An
    unconfigured id returns `undefined` with no RPC call.
  - `useDepositFlow.test.tsx`: the Stellar `minChipLabel` and `meetsMin` follow the hook value,
    for example a $500 minimum means $600 meets it. While it is undefined, Confirm is disabled and
    the chip reads `Min`.
  - Update `routes/-deposit.test.tsx` Stellar cases with
    `vi.mock("@/wallet/stellar/useStellarDepositManagerMinDeposit", …)` returning `1000n * 10n ** 7n`.
- **Gates**
  - `yarn workspace` lint, typecheck and tests for `packages/frontend`.
  - `npx tsx scripts/lint-docs.ts`.
  - `npx tsx scripts/lint-comments.ts`.

## Docs to Update

- `docs/frontend/wallet-flows.md`
  - **Business rules:** replace the "Stellar minimum deposit is $1,000, frontend-owned" bullet.
    The minimum is read from Soroban `min_deposit()` through
    `useStellarDepositManagerMinDeposit`, and gating is undefined-safe as on EVM.
  - **Request state model:** add "EVM request id from the receipt event", "`["requests"]`
    invalidation + 5 s polling while a known id is unlisted", and "EVM in-flight record (reload
    guard), cleared when the API lists the id".
  - **Step error state:** EVM step 1 (approve) now derives `"error"` from `approveError`.
  - **EVM integration → Hooks and contract surface:** add the `DepositRequested` /
    `WithdrawalRequested` ABI entries.
- `docs/frontend/hooks.md`
  - Add rows for `useStellarDepositManagerMinDeposit`, `useInvalidateRequests`, and the
    `useEvmToken().approveError` field.
  - Note the `useRequestDeposit` / `useRequestWithdrawal` `data.requestId` on the real path.
- `docs/frontend/dashboard-components.md`
  - § `stake-or-add-usd`: the `balanceLabel` source becomes `splusdInPlusdActive` (assets), with
    `—` while loading.
  - § Y axis (#1234) and § Served series mode: units per Open Question 1, and the timestamp
    x scale with the step-lookup hover (item 4).
  - § Home route: the balance source.
- `packages/frontend/src/wallet/README.md`: the `useRequestDeposit` / `useRequestWithdrawal`
  requestId note, and the new hook entry.
- `packages/frontend/src/wallet/stellar/contracts/depositManager.ts` header: list `min_deposit` if
  it is added to the client.
- `docs/exec-plans/tech-debt-tracker.md`: `useStakeFlow` step 1 uses the aggregated
  `useEvmToken().error`, so read errors paint the approve row. It should switch to `approveError`.
