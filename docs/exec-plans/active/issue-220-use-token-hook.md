# Issue #220: Add useToken hook — metadata + balance + approval composition

Source: https://github.com/eq-lab/pipeline/issues/220

## Scope

Add a new `useToken({ token, spender? })` React hook in the wallet module that
bundles three reads against an ERC-20 token contract for the connected wallet:

1. Metadata: `decimals()` + `symbol()` — read once and cached "forever"
   (`staleTime: Infinity`), mirroring the caching pattern used by
   `useDepositManagerAddresses` / `useDepositManagerMinDeposit`.
2. Balance: `balanceOf(owner)` where `owner = useWallet().address`.
3. Approval: composed by calling the existing `useApproval({ token, spender })`
   from `packages/frontend/src/wallet/useApproval.ts`. The approval fields are
   re-exposed under stable, prefixed names so call sites do not have to import
   `useApproval` themselves.

The hook follows the same `useMock` / `readMock` mock-first pattern used
across the wallet module. New `localStorage` mock keys:

- `pipeline.mock.wallet.contract.<token>.decimals` — numeric string (e.g. `"6"`)
- `pipeline.mock.wallet.contract.<token>.symbol`   — string (e.g. `"USDC"`)
- `pipeline.mock.wallet.balance.<token>`           — decimal bigint string

The existing `pipeline.mock.wallet.balance.usdc` key is replaced by the
per-address variant `pipeline.mock.wallet.balance.<usdc-token-address>` once
the USDC call sites are migrated to `useToken`. The legacy key is **dropped**
in the same change — no back-compat alias — because there are exactly three
call sites and they are all migrated in this plan.

Also in scope:

- Export `useToken` (and its types) from `packages/frontend/src/wallet/index.ts`.
- Migrate the three current `useUsdcBalance` call sites
  (`routes/index.tsx`, `routes/deposit.tsx`, `routes/withdraw.tsx`) to
  `useToken({ token: usdc })` where `usdc` comes from
  `useDepositManagerAddresses().usdc`.
- Delete `useUsdcBalance` (the function in `useWallet.ts`) and
  `useUsdcBalance.test.tsx` once all migrations land.
- Update `packages/frontend/src/wallet/README.md` and
  `docs/frontend/hooks.md` to reflect the new hook and the dropped one.

Out of scope (explicitly):

- Changes to `useApproval` itself. It stays as the underlying primitive and
  remains exported. `useToken` only composes it.
- EIP-2612 `permit` (gasless approvals).
- Multi-token batching (one hook call per token is fine).
- Native ETH balance.
- Changes to formatter / `Intl.NumberFormat` rendering. `formattedBalance`
  returns a plain formatted number string with no symbol or currency prefix/suffix
  (e.g. `"1,000.00"`). The USDC-specific `"$1,000.00"` currency-symbol rendering
  in `formatUsdcBalance` does not carry forward.

## Assumptions and Risks

- **Hook rules.** React hooks cannot be called conditionally. The plan calls
  `useApproval({ token, spender: spender ?? ZERO_ADDRESS })` unconditionally
  and masks its return values to `undefined` / no-op when `spender` is omitted.
  `useApproval` already short-circuits when `spender === ZERO_ADDRESS`, so the
  inner read is disabled and no RPC fires.
- **Metadata caching.** `decimals` and `symbol` are not strictly immutable per
  ERC-20 but are immutable in practice for all tokens we will ever consume.
  We accept the same trade-off `useDepositManagerAddresses` already takes.
- **Mock key rename.** Dropping `pipeline.mock.wallet.balance.usdc` is a
  breaking change for any developer who has it set in their browser. Acceptable
  because it is a dev-only mock and there are exactly three call sites, all
  migrated in this same change. We list it under the README "Mock layer"
  section as removed.
- **`formattedBalance` rendering shift.** Today `useUsdcBalance().formatted`
  returns `"$1,000.00"` (currency formatting). After this change, `formattedBalance`
  returns a plain formatted number (e.g. `"1,000.00"`) — no currency symbol, no
  token symbol suffix. This affects the visible text in `TopBar.wallet.balance`
  on `index.tsx`, `deposit.tsx`, `withdraw.tsx`. The current `TopBar` accepts an
  opaque string; callers can append a label if needed. Decision confirmed by the
  user: number-only, no symbol of any kind.
- **Test mocking.** `useToken` will be the first hook in the suite that
  composes another wallet hook (`useApproval`). Tests must either spy on the
  underlying wagmi `useReadContract` / `useWriteContract` (the existing
  approach in `useApproval.test.tsx`) or mock `./useApproval` itself.
  We choose the wagmi-level approach for parity with existing tests, so we
  exercise the real composition.
- **No outstanding dependencies.** #215 / #216 (useApproval) and #217
  (drop `VITE_USDC_ADDRESS`) are both closed and shipped. #218 (useBalance)
  is closed and superseded by this issue. There are no blocking issues.

## Open Questions

_None_ — resolved: `formattedBalance` returns a plain formatted number string
(e.g. `"1,000.00"`) with no currency symbol or token symbol. Confirmed by user.

## Implementation Steps

1. **Add `useToken.ts`** at `packages/frontend/src/wallet/useToken.ts`.
   - Imports: `useReadContract` from `wagmi`; `useWallet` from `./useWallet`;
     `useApproval` from `./useApproval`; `useMock`, `readMock`, `parseNumber`,
     `parseBigInt` from `./mock`; `erc20Abi` from `./abis/erc20`;
     `formatUnits` from `viem`.
   - Define `MOCK_KEYS`:
     ```ts
     const MOCK_KEYS = {
       decimals: (token: string) =>
         `pipeline.mock.wallet.contract.${token.toLowerCase()}.decimals`,
       symbol: (token: string) =>
         `pipeline.mock.wallet.contract.${token.toLowerCase()}.symbol`,
       balance: (token: string) =>
         `pipeline.mock.wallet.balance.${token.toLowerCase()}`,
     };
     ```
   - Define `parseString = (raw: string) => raw` (or reuse a generic identity
     parser; if useful, add `parseString` next to `parseAddress` in `mock.ts`).
   - Types:
     ```ts
     export interface UseTokenArgs {
       token: `0x${string}`;
       spender?: `0x${string}`;
     }
     export interface UseTokenResult {
       decimals: number | undefined;
       symbol: string | undefined;
       balance: bigint | undefined;
       formattedBalance: string | undefined;
       refetchBalance: () => void;
       allowance: bigint | undefined;
       isSufficient: ((amount: bigint) => boolean) | undefined;
       approve: ((amount: bigint) => void) | undefined;
       approveData: { hash: string } | undefined;
       isApprovePending: boolean;
       isApproveSuccess: boolean;
       refetchAllowance: (() => void) | undefined;
       isLoading: boolean;
       error: Error | null;
     }
     ```
   - Hook body:
     - `const { address, isConnected } = useWallet();`
     - `const walletConnected = isConnected && address !== undefined;`
     - `const tokenIsZero = token === ZERO_ADDRESS;`
     - Metadata mock reads via `useMock(MOCK_KEYS.decimals(token), parseNumber)`
       and `useMock(MOCK_KEYS.symbol(token), parseString)`.
     - Wagmi metadata reads with `query.enabled = !mockSet && !tokenIsZero`
       and `CACHE_FOREVER` options. (Lift `CACHE_FOREVER` from
       `useDepositManager.ts` into a shared `cache.ts` if reused; otherwise
       duplicate the literal — small surface, prefer extraction following
       `docs/FRONTEND.md` rule 3 once a second copy appears.)
     - Balance mock read via `useMock(MOCK_KEYS.balance(token), parseBigInt)`.
     - Wagmi balance read with `query.enabled = !mockBalanceSet &&
       walletConnected && !tokenIsZero`.
     - Approval composition: call
       `useApproval({ token, spender: spender ?? ZERO_ADDRESS })`
       unconditionally; mask its fields to `undefined`/no-op when `spender`
       is omitted.
     - Compose `formattedBalance` from raw balance + decimals using
       `formatUnits(balance, decimals)` and a thin `Intl.NumberFormat`
       call (2 fractional digits, en-US locale, no currency, no symbol).
       Return a plain number string (e.g. `"1,000.00"`). `undefined` if
       balance or decimals is still `undefined`. `symbol` is not used here.
     - Aggregate `isLoading` as `(any underlying read isLoading)`.
     - Aggregate `error` as the first non-null among metadata-read errors,
       balance-read error, and `useApproval().error` (only when spender given).
3. **Optionally extract `CACHE_FOREVER`.** If the literal is now used by
   two modules (`useDepositManager.ts` + `useToken.ts`), move it to
   `packages/frontend/src/wallet/cache.ts` and have both import it (per
   `docs/FRONTEND.md` rule 3, extracted util ships with a unit test).
   Update `docs/frontend/utils.md`. If we keep the duplicate inline, document
   the choice in the PR comment — the rule is "lift on the second copy".
4. **Export from the barrel.** Add to
   `packages/frontend/src/wallet/index.ts`:
   ```ts
   export { useToken } from "./useToken";
   export type { UseTokenArgs, UseTokenResult } from "./useToken";
   ```
5. **Migrate `routes/index.tsx`.**
   - Remove `useUsdcBalance` from the imports.
   - Inside `Home()`, replace
     ```ts
     const { formatted } = useUsdcBalance();
     ```
     with
     ```ts
     const { usdc } = useDepositManagerAddresses();
     const { formattedBalance } = useToken({
       token: usdc ?? "0x0000000000000000000000000000000000000000",
     });
     ```
   - Replace `formatted ?? "—"` in the `TopBar wallet={…}` prop with
     `formattedBalance ?? "—"`.
   - Add the corresponding import: `useToken, useDepositManagerAddresses`.
6. **Migrate `routes/deposit.tsx` and `routes/withdraw.tsx`** with the same
   pattern as step 5. For `withdraw.tsx`, the existing UI shows USDC balance
   in the TopBar (matches the deposit page) — keep the same migration.
7. **Delete `useUsdcBalance`.**
   - Remove `useUsdcBalance` export from `useWallet.ts` (delete the function
     plus the `formatUsdcBalance` helper, and the `usdcBalance` key from
     `KEYS`).
   - Delete `packages/frontend/src/wallet/useUsdcBalance.test.tsx`.
   - Remove `useUsdcBalance` and `UsdcBalanceResult` from the wallet barrel
     `index.ts`.
   - Note: this drops the legacy mock key
     `pipeline.mock.wallet.balance.usdc`. Per-token mock balance
     (`pipeline.mock.wallet.balance.<token-address>`) is the only supported
     key after the change.
8. **Add tests at `packages/frontend/src/wallet/useToken.test.tsx`.** See
   "Test Strategy".
9. **Update `packages/frontend/src/wallet/README.md`.**
   - Add `useToken` to the public API import example.
   - Add a `useToken({ token, spender? })` section with parameters + return
     field table, mirroring the existing `useApproval` section.
   - Remove the `useUsdcBalance` section.
   - Add the new mock keys to the localStorage schema table:
     - `pipeline.mock.wallet.contract.<token>.decimals`
     - `pipeline.mock.wallet.contract.<token>.symbol`
     - `pipeline.mock.wallet.balance.<token>` (replaces the legacy
       `pipeline.mock.wallet.balance.usdc`)
   - Remove `pipeline.mock.wallet.balance.usdc` from the table and from any
     DevTools console snippets.
   - Add a worked DevTools console example for mocking a complete `useToken`
     surface (decimals + symbol + balance + allowance + approve).
10. **Update `docs/frontend/hooks.md`.**
    - Add a row for `useToken` (sorted alphabetically — between `useRequestDeposit`
      and `useWallet`).
    - Remove the `useUsdcBalance` row.
11. **Lint + typecheck.**
    - `yarn workspace @pipeline/frontend lint` (or the repo-wide lint task)
      and resolve any `no-restricted-imports` issues.
    - `npx tsx scripts/lint-docs.ts` to validate the doc edits.
12. **Update `docs/frontend/utils.md`** only if `CACHE_FOREVER` is extracted in
    step 3.

## Test Strategy

New unit-test file `packages/frontend/src/wallet/useToken.test.tsx` modeled on
`useApproval.test.tsx` and `useUsdcBalance.test.tsx`:

- Set up wagmi mocks (`useAccount`, `useReadContract`, `useWriteContract`,
  `useChainId`, `useDisconnect`) and the `@reown/appkit/react`,
  `@tanstack/react-query`, `./config` stubs — same boilerplate already in
  `useApproval.test.tsx`.

Test cases:

1. **Metadata mock keys** — set `pipeline.mock.wallet.contract.<token>.decimals`
   and `…symbol`; assert `result.current.decimals === 6` and
   `result.current.symbol === "USDC"`; assert that the matching
   `useReadContract` invocations have `query.enabled: false` (zero RPC for
   metadata in mock mode).
2. **Balance mock key** — set `pipeline.mock.wallet.balance.<token>`; assert
   `result.current.balance === 1_000_000_000n` and `formattedBalance` matches
   `"1,000.00"` after metadata also mocked.
3. **Real RPC happy path** — no mock keys; wagmi returns
   `decimals=6`, `symbol="USDC"`, `balance=500_000_000n`; assert all three
   are surfaced and `formattedBalance === "500.00"`.
4. **Spender omitted branch** — no `spender` arg; assert `allowance`,
   `isSufficient`, `approve`, `approveData`, `refetchAllowance` are all
   `undefined`; assert `useApproval`'s underlying `useReadContract`
   invocation (filtered by `functionName: "allowance"`) has
   `query.enabled: false`.
5. **Spender provided branch (delegation)** — set both the allowance mock
   key `pipeline.mock.wallet.allowance.<token>.<spender>` and the approve
   mock key; call `result.current.approve(123n)` and assert
   `result.current.isApproveSuccess === true` after the microtask.
6. **Zero-address token short-circuit** — `token = 0x000…`; assert every
   read's `query.enabled` is `false` and all metadata / balance / approval
   fields are `undefined`.
7. **Disconnected wallet** — `useAccount` returns `{ address: undefined,
   isConnected: false }`; assert `balance` is `undefined` and the
   `balanceOf` `useReadContract` invocation has `query.enabled: false`.
   Metadata reads still fire (metadata is independent of the wallet).
8. **Aggregated `isLoading`** — when one of the underlying reads is
   `isLoading: true`, assert `result.current.isLoading === true`.
9. **`error` aggregation** — when `useApproval` reports an error and
   `spender` is provided, assert it surfaces through `result.current.error`.
   When `spender` is omitted, `useApproval`'s internal error is masked.
10. **No RPC in full mock mode (lock-in guard)** — spy on `globalThis.fetch`;
    set every relevant mock key; assert `fetchSpy` is never called.
11. **`formattedBalance` returns `undefined` while metadata is loading** —
    mock balance set but decimals/symbol still in flight; assert
    `formattedBalance === undefined`.

Regression / smoke:

- `yarn workspace @pipeline/frontend test` — all existing tests pass after
  the deletion of `useUsdcBalance.test.tsx` and the migration of three
  route files.
- `yarn workspace @pipeline/frontend build` — confirms the route files still
  compile against the new hook signature.

UX manual verification (handled by `ux-tester`):

- Figma reference: the existing deposit/withdraw flow Figma frames already
  drive `useUsdcBalance` consumers. Run `ux-tester` against the home,
  deposit, and withdraw routes with the new mock-key set:
  - `pipeline.mock.wallet.contract.<usdc-addr>.decimals = "6"`
  - `pipeline.mock.wallet.contract.<usdc-addr>.symbol = "USDC"`
  - `pipeline.mock.wallet.balance.<usdc-addr> = "1000000000"`
- Confirm `TopBar` renders the formatted balance string on all three routes.
- Spot-check that disconnecting the wallet (clear `pipeline.mock.wallet.address`)
  collapses the TopBar back to the "Connect Wallet" state.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — public API, mock-key schema,
  DevTools console snippets (see step 9).
- `docs/frontend/hooks.md` — add `useToken` row, remove `useUsdcBalance` row.
- `docs/frontend/utils.md` — only if `CACHE_FOREVER` is extracted into a
  shared `wallet/cache.ts` (step 3).
- No product-spec change required — this is a structural refactor of the
  frontend wallet hooks. No user-visible product behavior changes beyond the
  `formattedBalance` rendering noted in "Assumptions and Risks" / "Open
  Questions".
- `docs/FRONTEND.md` reference to `useUsdcBalance` (line 107) — replace with
  a reference to `useToken` so the prose stays accurate.
