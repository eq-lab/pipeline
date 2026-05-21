# Issue #354: /withdraw: PLUSD balance not shown and amount input is uninteractable

Source: https://github.com/eq-lab/pipeline/issues/354

## Scope

Restore `/withdraw` interactivity by fixing the upstream `useWithdrawalQueueAddresses()` read failure and by surfacing the failure visibly when it happens again. Two coupled changes:

1. **Env**: verify and (if stale) update `VITE_WITHDRAWAL_QUEUE_ADDRESS` (and audit `VITE_STAKED_PLUSD_ADDRESS`) against the current Hoodi deployment so `fromToken()` / `intoToken()` reads succeed.
2. **Frontend resilience**:
   - `packages/frontend/src/wallet/useWithdrawalQueue.ts` — `console.error` the read errors from `fromToken` / `intoToken` (mirrors #346 for deposit).
   - `packages/frontend/src/routes/withdraw.tsx` — when `useWithdrawalQueueAddresses()` settles with `plusd === undefined && usdc === undefined` (and is not loading), render an explicit "WithdrawalQueue not reachable" banner instead of a silent dead page.
   - `packages/frontend/src/routes/deposit.tsx` — apply the same banner pattern symmetrically when `useDepositManagerAddresses()` returns both `undefined` post-loading (parity, per issue suggestion §2).

### Out of scope

- Adding a Deposit↔Withdraw nav entry point (separate UX).
- Pre-flight `simulateContract` refactor tracked in #350.
- Touching the staked-PLUSD wallet hooks (only audit the env value; do not modify ABI/hook in this issue).

## Assumptions and Risks

- **Assumption**: The Hoodi deployment of `WithdrawalQueue` is reachable, and the canonical current address is documented somewhere outside the repo (deploy logs / team channel / `docs.local/` on operator machines — the `docs.local/` referenced in the issue body is gitignored and not present in this worktree). The coder will need to obtain the current address from the deploy artifacts (or operator) before editing `.env`.
- **Risk**: If the deployed address has not actually changed, the read failure has a different root cause (RPC endpoint, ABI drift, chain mismatch). The banner + console.error are still net-positive, but the env update alone will not "fix" the bug. The diagnostic banner is precisely what lets us tell the two cases apart.
- **Risk**: `.env` is symlinked across worktrees (see AGENTS §Worktrees). Editing it here changes it for every worktree — call this out in the PR description.
- **Risk**: The same WithdrawalQueue ABI subset was just updated for #352. If the deployed contract was redeployed *and* the on-chain interface for `fromToken()` / `intoToken()` changed, an address-only fix is insufficient. Verify both function selectors still exist on the new deployment.

## Open Questions

_Resolved:_
- **WithdrawalQueue address**: confirmed correct — `0xB9f148312a85Ec1d3f4512fF04de6b21a4d12c58` is the current deployment. No `.env` change needed. Root cause is the silent read error (cause B), not a stale address.
- **PLUSD address**: `0x18D6cCaF8D363309A6C283eEA8b2C68D107016b7` (operator-confirmed). The `fromToken()` read should return this value; if it doesn't, log it.
- **`VITE_STAKED_PLUSD_ADDRESS`**: confirmed `0xD2cf15F273aE6BE2bDF5043Db032D5B59ec4908B` (operator-confirmed). Audit deferred — no staked-PLUSD page exists yet.

## Implementation Steps

1. **No `.env` change needed** — `VITE_WITHDRAWAL_QUEUE_ADDRESS=0xB9f148312a85Ec1d3f4512fF04de6b21a4d12c58` is confirmed correct. Expected `fromToken()` return is `0x18D6cCaF8D363309A6C283eEA8b2C68D107016b7` (PLUSD). If the read still fails, the root cause is an ABI mismatch or RPC error — the console.error added in step 2 will surface it.

2. **Surface read errors from `useWithdrawalQueueAddresses` to the console** in `/Users/dima/git/pipeline-background/packages/frontend/src/wallet/useWithdrawalQueue.ts`:
   - In the real-RPC branch (around lines 190-199), add a `useEffect` that `console.error`s `fromTokenRead.error` and `intoTokenRead.error` when they transition from `null` → non-null. Mirror the pattern used in #346 for `useDepositManagerAddresses` (read `useDepositManager.ts` for the exact shape so the two stay symmetric).
   - Keep the returned `error` field unchanged so consumers can still react to it.

3. **Add an unreachable-contract banner to `/withdraw`** in `/Users/dima/git/pipeline-background/packages/frontend/src/routes/withdraw.tsx`:
   - Capture the full result of `useWithdrawalQueueAddresses()` (not just `plusd`) — destructure `plusd`, `usdc`, `isLoading`, `error`.
   - Compute `const isQueueUnreachable = isConnected && !isLoading && plusd === undefined && usdc === undefined;`.
   - When `isQueueUnreachable` is true, render a danger-tone banner above (or in place of) `StepsCard` with copy "WithdrawalQueue not reachable. Check `VITE_WITHDRAWAL_QUEUE_ADDRESS` and RPC connectivity." — reuse the existing low-balance banner styling from `/deposit` as the visual template (see `routes/deposit.tsx:451-`). Tokenised classes only — no raw colors.
   - Keep the existing card visible so the user still sees the disabled state; the banner is additive diagnostic UI. (If the coder finds that mirrors the deposit pattern by replacing the StepsCard, do that instead — match the deposit precedent rather than diverging.)

4. **Add the symmetric banner to `/deposit`** in `/Users/dima/git/pipeline-background/packages/frontend/src/routes/deposit.tsx`:
   - Same shape: destructure the full `useDepositManagerAddresses()` result, compute `isManagerUnreachable` from `plusd`/`usdc` both undefined post-loading, render the analogous banner. Copy refers to `VITE_DEPOSIT_MANAGER_ADDRESS`.

5. **Lint + typecheck** the frontend package per AGENTS §Lint: `yarn workspace @pipeline/frontend lint` (and `tsc --noEmit` via the package's build).

## Test Strategy

- **Unit (Vitest, `useWithdrawalQueue.test.tsx`)**: add a case that asserts `console.error` is invoked when `fromTokenRead`/`intoTokenRead` produce an error. Spy on `console.error`, prime wagmi mocks to reject, render the hook, assert the spy was called with the underlying error. Mirror in `useDepositManager.test.tsx` if a symmetric console.error is added there.
- **Component (route test, if/where one exists for `withdraw.tsx`)**: render `<Withdraw />` with `useWithdrawalQueueAddresses` mocked to return `{ plusd: undefined, usdc: undefined, isLoading: false, error: new Error("x") }` and a connected wallet; assert the "WithdrawalQueue not reachable" banner is in the DOM. Repeat for `<Deposit />`.
- **Manual via `ux-tester`** (Figma reference `https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100351&m=dev`):
  1. With a known-bad `VITE_WITHDRAWAL_QUEUE_ADDRESS` (e.g. the zero address swapped in temporarily), open `/withdraw` with a connected wallet — verify the banner appears, console shows the read error, balance label remains `"—"`.
  2. Restore the corrected address, reload — verify the banner disappears, balance renders, input is enabled, and chips work.
  3. Repeat the negative test for `/deposit`.
- **Regression**: run `yarn workspace @pipeline/frontend test` to ensure existing useWithdrawalQueue / useDepositManager / withdraw tests still pass.

## Docs to Update

- `docs/exec-plans/active/issue-354-withdraw-uninteractable.md` — this plan (created here; archived by manager on completion).
- No product-spec change required: this is a `bug` fix with diagnostic UX scaffolding; user-visible copy is a developer-targeted error banner, not a new product feature.
- If `VITE_WITHDRAWAL_QUEUE_ADDRESS` is updated, add a one-line note in the PR body so reviewers can correlate with deploy logs. No tracked doc holds the address today.
