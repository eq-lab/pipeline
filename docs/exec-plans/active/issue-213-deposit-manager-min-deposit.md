# Issue #213: DepositManager: add minDeposit() contract read

Source: https://github.com/eq-lab/pipeline/issues/213

## Scope

Extend the DepositManager wallet hook surface (delivered in #211) with a read of the `minDeposit()` view function so the deposit UI can later validate user input against the on-chain minimum.

In scope:

- Append a `minDeposit` entry to the ABI in `packages/frontend/src/wallet/abis/depositManager.ts`.
- Add a new dedicated hook `useDepositManagerMinDeposit()` in `packages/frontend/src/wallet/useDepositManager.ts` returning `{ minDeposit, isLoading, error }` with the same "fetch once per mount + cache forever" pattern as `useDepositManagerAddresses`.
- Honour two mock keys, named alias winning over generic:
  - `pipeline.mock.wallet.contract.depositManager.minDeposit` (named alias)
  - `pipeline.mock.wallet.contract.<address>.minDeposit` (generic per-address)
- Short-circuit when `ENV.DEPOSIT_MANAGER_ADDRESS` is the zero address — no RPC call, return `minDeposit: undefined`.
- Re-export the hook and its result type from `packages/frontend/src/wallet/index.ts`.
- Unit tests covering: real read happy path, cached/once-only behaviour, both mock keys (with named alias priority), zero-address short-circuit, and "no RPC when mock key set".
- Documentation updates: `docs/frontend/hooks.md` (new row), `packages/frontend/src/wallet/README.md` (key table + console snippets).

Out of scope (per issue body):

- Validation UI / form integration on the deposit page.
- `setMinDeposit` admin write.
- Subscribing to `MinDepositSet` for live updates.

### Decision: dedicated hook over folding into `useDepositManagerAddresses`

The issue allows either approach. We pick the dedicated hook because:

- `useDepositManagerAddresses` has zero production call sites today (only tests + README), so the diff stays minimal either way — but a rename to `useDepositManagerConfig` still churns README, hooks.md, and three test describe blocks for no consumer benefit.
- A standalone hook is independently testable and keeps the mock-key surface symmetric with the existing `plusd` / `usdc` aliases (one alias per view).
- Separation lets `minDeposit` live in code paths that don't already need to read addresses (e.g. the deposit form once shipped) without paying for two unrelated reads.

## Assumptions and Risks

- **Wagmi return typing.** `useReadContract` for a `view → uint256` function returns `bigint | undefined`; the existing `useReadContract` mocks in `useDepositManager.test.tsx` return generic `data: unknown`, so the new test path must assert through the hook's returned `bigint`. No new wagmi mock surface needed beyond what `mockUseReadContract` already provides.
- **Mock parse helper.** `parseBigInt` already exists in `wallet/mock.ts` and handles bigint strings (e.g. `"1000000"`). No new parser required.
- **Same-tab reactivity.** The named-alias mock key must use `useMock(...)` (reactive via `useSyncExternalStore`) to match the `plusd` / `usdc` precedent; the generic per-address key uses `readMock(...)` (one-shot, like the addresses hook). bigint primitives returned by `parseBigInt` are stable across reads, so `useSyncExternalStore` will not loop.
- **Type widening.** The ABI must be typed `as const` so viem infers `uint256 → bigint` correctly. The existing file already uses `as const`; just append the entry inside the array.
- **Caching trade-off.** A stale `minDeposit` will surface as a `DepositManagerLessThanMinAmount` revert through the existing tx error path — acceptable per the issue body. We will NOT add an event subscription or polling.
- **No env/config change.** Reuses `VITE_DEPOSIT_MANAGER_ADDRESS` (wired in #211); no `lib/env.ts` change.

Risks:

- None blocking. The risk surface is purely additive to the existing #211 surface.

## Open Questions

_None_

## Implementation Steps

1. **Extend the ABI.** Edit `packages/frontend/src/wallet/abis/depositManager.ts`:
   - Append after the existing `usdc` entry (keep ordering: views first, then writes):
     ```ts
     {
       type: "function",
       name: "minDeposit",
       stateMutability: "view",
       inputs: [],
       outputs: [{ name: "", type: "uint256" }],
     },
     ```
   - Update the file's module-level comment to say "five entries" instead of "four functions".

2. **Add mock-key constants.** In `packages/frontend/src/wallet/useDepositManager.ts`, extend the `MOCK_KEYS` object:
   - `minDepositAlias: "pipeline.mock.wallet.contract.depositManager.minDeposit"`
   - `contractMinDeposit: (address: string) => \`pipeline.mock.wallet.contract.${address.toLowerCase()}.minDeposit\``

3. **Add the `DepositManagerMinDepositResult` type.** Next to `DepositManagerAddressesResult`:
   ```ts
   export interface DepositManagerMinDepositResult {
     minDeposit: bigint | undefined;
     isLoading: boolean;
     error: Error | null;
   }
   ```

4. **Implement `useDepositManagerMinDeposit()`.** In `packages/frontend/src/wallet/useDepositManager.ts`, after `useDepositManagerAddresses`:
   - Read the named alias reactively via `useMock(MOCK_KEYS.minDepositAlias, parseBigInt)`.
   - Read the generic per-address key once via `readMock(MOCK_KEYS.contractMinDeposit(DM_ADDRESS), parseBigInt)`.
   - Compute `isZeroAddress` and `shouldSkipReal = hasMock || isZeroAddress`.
   - Always call `useReadContract({ address, abi: depositManagerAbi, functionName: "minDeposit", query: { enabled: !shouldSkipReal, ...cacheForever } })` (hook ordering invariant).
   - Reuse the exact `cacheForever` shape from `useDepositManagerAddresses` (extract to a module-level `const CACHE_FOREVER = { … }` and reuse from both hooks to avoid duplication).
   - Return precedence: named alias > generic per-address > zero-address short-circuit > real RPC result. Cast `data as bigint | undefined`.

5. **De-duplicate `cacheForever`.** Lift the `cacheForever` object literal out of `useDepositManagerAddresses` into a module-level `const CACHE_FOREVER` and reference it from both hooks. (Simple refactor inside the same file — no behaviour change.)

6. **Re-export from the wallet barrel.** Edit `packages/frontend/src/wallet/index.ts`:
   - Add `useDepositManagerMinDeposit` to the value re-export.
   - Add `DepositManagerMinDepositResult` to the type re-export.

7. **Update the wallet README.** Edit `packages/frontend/src/wallet/README.md`:
   - Add a `useDepositManagerMinDeposit()` section mirroring the `useDepositManagerAddresses()` example.
   - Add two rows to the mock-key table:
     - `pipeline.mock.wallet.contract.depositManager.minDeposit` → `string` (decimal bigint, e.g. `"1000000"`)
     - `pipeline.mock.wallet.contract.<address>.minDeposit` → same shape, generic per-address fallback
   - Include the key in the "set all DepositManager mocks" / "clear all DepositManager mocks" console snippets.

8. **Update the hooks catalogue.** Edit `docs/frontend/hooks.md` — add an alphabetically-placed row for `useDepositManagerMinDeposit` describing return shape and the named-alias mock key. Keep the table sorted alphabetically.

9. **Run linters.** `npx tsx scripts/lint-docs.ts` after doc edits; verify `npm run lint` (or the local equivalent) is clean.

## Test Strategy

Extend `packages/frontend/src/wallet/useDepositManager.test.tsx` with a new top-level `describe("useDepositManagerMinDeposit …")` block covering:

1. **Named alias mock returns the parsed bigint and disables real read.**
   - Set `localStorage.setItem("pipeline.mock.wallet.contract.depositManager.minDeposit", "1000000")`.
   - Assert `result.current.minDeposit === 1_000_000n`, `isLoading === false`, `error === null`.
   - Assert `mockUseReadContract` was called with `query.enabled === false` for the `minDeposit` call.

2. **Generic per-address mock returns the parsed bigint.**
   - Set `mockEnv.DEPOSIT_MANAGER_ADDRESS` to a non-zero address.
   - Set `pipeline.mock.wallet.contract.<addr>.minDeposit` to `"2500000"`.
   - Assert `result.current.minDeposit === 2_500_000n`.

3. **Named alias takes priority over generic per-address.**
   - Set both keys with different values; assert the named alias value wins.

4. **Zero-address short-circuit.**
   - Default env (zero address); assert `result.current.minDeposit === undefined`, no error, and all `useReadContract` calls have `enabled === false`.

5. **No RPC when a mock key is set** (`fetchSpy.mockClear()` then assert `fetchSpy` not called after `renderHook` resolves) — mirrors the existing `useRequestDeposit` mock-mode RPC-quiet assertion.

6. **Caching options forwarded.** Set a non-zero address and no mock, assert the `minDeposit` `useReadContract` call carries `staleTime: Infinity`, `gcTime: Infinity`, and all three `refetchOn*: false` flags plus `refetchInterval: false`.

7. **Real RPC path returns the wagmi data unchanged.** Override `mockUseReadContract` to return `{ data: 5_000_000n, isLoading: false, error: null }` for the `minDeposit` call (use the `functionName` argument in the mock factory to discriminate, or temporarily replace the implementation just for this test); assert `result.current.minDeposit === 5_000_000n`.

No production call site exists yet, so no integration/UX test is required — the unit tests are the full acceptance gate for this Issue.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — new `useDepositManagerMinDeposit()` section, mock-key table rows for both alias and generic keys, console snippet update.
- `packages/frontend/src/wallet/abis/depositManager.ts` module-level comment ("four functions" → "five entries").
- `docs/frontend/hooks.md` — new row for `useDepositManagerMinDeposit`.

No product spec change required: this Issue is a pure SDK/hook surface addition with no user-visible behaviour change yet (the deposit form integration is explicitly out of scope).
