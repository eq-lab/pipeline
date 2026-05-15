# Issue #217: Drop VITE_USDC_ADDRESS env — derive USDC from DepositManager

Source: https://github.com/eq-lab/pipeline/issues/217

## Scope

Remove `VITE_USDC_ADDRESS` as a separate source of truth for the USDC token
address. Refactor `useUsdcBalance` to read the USDC address from
`useDepositManagerAddresses().usdc` (the `usdc()` view on the DepositManager
contract), so the on-chain manager becomes the single source of truth.

### In scope

- `packages/frontend/src/lib/env.ts` — remove the `USDC_ADDRESS` field from the
  `ENV` object (and its JSDoc).
- `packages/frontend/src/wallet/useWallet.ts` — refactor `useUsdcBalance` to
  derive the USDC address from `useDepositManagerAddresses()` instead of
  `ENV.USDC_ADDRESS`. Surface a loading state while the manager's `usdc()`
  call is in flight.
- `packages/frontend/src/wallet/useUsdcBalance.test.tsx` — update tests to
  reflect the new wiring (the "USDC_ADDRESS is zero" case becomes
  "DepositManager not configured / `usdc()` undefined").
- `packages/frontend/src/wallet/useApproval.test.tsx` and
  `packages/frontend/src/wallet/useDepositManager.test.tsx` — drop the
  `USDC_ADDRESS` entry from their `mockEnv` hoisted fixtures so the mocked
  `ENV` shape stays in sync with the production type.
- `.env.example` — remove the `VITE_USDC_ADDRESS` line under the
  `# ── Frontend (VITE_) ──` block.
- `packages/frontend/src/wallet/README.md` — drop the `VITE_USDC_ADDRESS`
  paragraphs (running instructions and the `useUsdcBalance` description) and
  point readers at the manager-derived source.
- `docs/STORIES.md` — update TC-181-1's "Expected" line so the "or `—` if
  `VITE_USDC_ADDRESS` is the zero default" wording is replaced by the new
  manager-derived gating ("or `—` if `VITE_DEPOSIT_MANAGER_ADDRESS` is unset /
  the manager's `usdc()` view returns the zero address").

### Out of scope

- No changes to the DepositManager contract or its ABI.
- No changes to `useApproval` (#215) — it already takes `token` as a parameter
  and call sites can pass `useDepositManagerAddresses().usdc`.
- No changes to consumers of `useUsdcBalance` (`routes/index.tsx`,
  `routes/deposit.tsx`, `routes/withdraw.tsx`) — the hook signature stays the
  same; they only see a (possibly longer) `isLoading: true` interval before
  `formatted` resolves.
- No changes to the existing localStorage mock keys for the USDC balance
  (`pipeline.mock.wallet.balance.usdc`) — it still short-circuits the balance
  read.
- No environment defaulting fallback to a hardcoded Hoodi USDC address — when
  the manager is not configured, balance reads stay skipped (same end-user
  behavior as today).

## Assumptions and Risks

- **Assumption: `useDepositManagerAddresses().usdc` is the canonical source.**
  The DepositManager contract exposes a `usdc()` view and the existing hook
  caches it with `staleTime: Infinity` (see
  `packages/frontend/src/wallet/useDepositManager.ts:46–54`), so reading USDC
  through it adds at most one RPC call per page lifetime.
- **Risk: loading state propagation.** Today `useUsdcBalance` returns
  `data: undefined, isLoading: false` when the configured USDC address is the
  zero address. After the change, while the manager's `usdc()` call is in
  flight we should surface `isLoading: true` so the UI does not flash an empty
  balance and then a real value. Call sites currently render `formatted ?? "—"`
  (`routes/deposit.tsx:33`, `routes/index.tsx`, `routes/withdraw.tsx:28`), so
  the worst case is a brief `—` followed by the real balance — acceptable, but
  the `isLoading` flag lets future call sites distinguish "not configured" from
  "in flight".
- **Risk: mock-key compatibility.** Tests and DevTools snippets that previously
  set USDC via `VITE_USDC_ADDRESS` now need to either set
  `VITE_DEPOSIT_MANAGER_ADDRESS` + rely on `usdc()` returning a real address,
  or use the named-alias mock key
  `pipeline.mock.wallet.contract.depositManager.usdc`. The
  `pipeline.mock.wallet.balance.usdc` key continues to short-circuit
  `useUsdcBalance` independently, so existing dev-flow snippets that set the
  balance directly are unaffected.
- **Risk: test fixture drift.** `useApproval.test.tsx` and
  `useDepositManager.test.tsx` mock the `ENV` shape literally. If we forget to
  remove `USDC_ADDRESS` from those `mockEnv` objects, the test mocks will
  diverge from the production `ENV` type (extra property is harmless for the
  consumer, but the mocks should track reality).
- **Risk: docs drift.** Several archived files reference `VITE_USDC_ADDRESS`
  (`docs/exec-plans/completed/issue-181-evm-wallet-connection.md`,
  `docs/exec-plans/completed/issue-211-deposit-manager-hook.md`). Those are
  historical and stay untouched. Only `docs/STORIES.md` (live test catalog)
  and `packages/frontend/src/wallet/README.md` (live API doc) are updated.
- **No backend dependency.** This is purely a frontend refactor; no API,
  worker, or contract changes are needed.

## Open Questions

_None_

## Implementation Steps

1. **Remove the `USDC_ADDRESS` env field.**
   Edit `packages/frontend/src/lib/env.ts`:
   - Delete the `USDC_ADDRESS: readString("VITE_USDC_ADDRESS", ...)` entry
     (lines 51–59) along with its JSDoc block.
   - Leave `EVM_CHAIN_ID`, `EVM_RPC_URL`, `DEPOSIT_MANAGER_ADDRESS`, and
     `WALLETCONNECT_PROJECT_ID` unchanged.

2. **Refactor `useUsdcBalance` to read the address from the manager.**
   Edit `packages/frontend/src/wallet/useWallet.ts`:
   - Remove the `import { ENV } from "@/lib/env";` (or keep it if any other
     code in the file still needs it — it is currently only used for
     `ENV.USDC_ADDRESS`, so the import can be deleted).
   - Add `import { useDepositManagerAddresses } from "./useDepositManager";`.
   - Inside `useUsdcBalance`, after the existing
     `const mockBalance = useMock(KEYS.usdcBalance, parseBigInt);` line:
     - Call `const { usdc: usdcAddress, isLoading: addressesLoading } =
       useDepositManagerAddresses();`.
     - Determine the "skip real read" condition as:
       `mockBalance !== undefined || !isConnected || !address || !usdcAddress ||
       usdcAddress === "0x0000000000000000000000000000000000000000"`.
     - Pass `address: usdcAddress ?? "0x0000000000000000000000000000000000000000"`
       to `useReadContract` so the hook signature is well-typed even when the
       address is not yet known; the `query.enabled` flag gates the actual
       call.
   - Update the final return so that when the mock is absent and the read is
     skipped because the manager is not yet resolved:
     - If `addressesLoading` is `true` and no mock balance is set, return
       `{ data: undefined, formatted: undefined, isLoading: true, error: null }`.
     - Else if `!isConnected || !address || !usdcAddress` → return the existing
       "balance unknown" tuple (`data: undefined`, `isLoading: false`,
       `error: null`).
     - Otherwise return the wagmi read's `data`, `isLoading`, `error` as today.
   - Preserve the mock short-circuit at the top of the function unchanged
     (`pipeline.mock.wallet.balance.usdc` continues to bypass everything).
   - Make sure the `useDepositManagerAddresses()` call is unconditional (hook
     rules) — call it before any early `return` branch.

3. **Update the unit tests for `useUsdcBalance`.**
   Edit `packages/frontend/src/wallet/useUsdcBalance.test.tsx`:
   - Replace the implicit "default ENV.USDC_ADDRESS is zero" assumption with
     an explicit `useDepositManagerAddresses` mock or a mocked `@/lib/env`
     `DEPOSIT_MANAGER_ADDRESS`. Two acceptable shapes:
     - **Preferred:** add a `vi.mock("./useDepositManager", ...)` block that
       exposes a `mockUseDepositManagerAddresses` function (mirroring the
       pattern used in `useDepositManager.test.tsx`). Tests then control the
       returned `{ plusd, usdc, isLoading }` directly without touching env.
     - **Alternative:** add a hoisted `mockEnv` + `vi.mock("@/lib/env", ...)`
       block matching `useApproval.test.tsx`/`useDepositManager.test.tsx`, and
       rely on the real `useDepositManagerAddresses` walking the zero-address
       short-circuit when `DEPOSIT_MANAGER_ADDRESS` is zero.
   - Rewrite or rename test cases:
     - The existing `useUsdcBalance — mock mode` block stays as-is; the
       `pipeline.mock.wallet.balance.usdc` short-circuit is unchanged.
     - `useUsdcBalance — disconnected / zero address` becomes
       `useUsdcBalance — disconnected wallet`.
     - `useUsdcBalance — zero USDC address` becomes
       `useUsdcBalance — DepositManager not configured`. Add a second
       describe block `useUsdcBalance — usdc() not yet resolved` that mocks
       `useDepositManagerAddresses` to return `{ usdc: undefined, isLoading:
       true }` and asserts `isLoading === true` and `data === undefined`.
     - Add a happy-path block `useUsdcBalance — real RPC path` that mocks
       `useDepositManagerAddresses` to return a concrete `usdc` address and a
       connected wallet, then asserts `useReadContract` is called with
       `address: <that usdc>` and `query.enabled: true`.
   - Remove the inline comment referring to `ENV.USDC_ADDRESS` defaulting to
     the zero address.

4. **Drop `USDC_ADDRESS` from the test ENV fixtures in sibling test files.**
   - Edit `packages/frontend/src/wallet/useApproval.test.tsx`: remove the
     `USDC_ADDRESS: "0x0000000000000000000000000000000000000000" as \`0x${string}\`,`
     line from the `mockEnv` `vi.hoisted` block (line 94). Nothing in
     `useApproval` reads `ENV.USDC_ADDRESS`, so this is a fixture-cleanup
     change only.
   - Edit `packages/frontend/src/wallet/useDepositManager.test.tsx`: remove
     the `USDC_ADDRESS: "0x0000000000000000000000000000000000000000" as
     \`0x${string}\`,` line from the `mockEnv` block (line 84) and remove the
     `mockEnv.USDC_ADDRESS = ZERO_ADDRESS as \`0x${string}\`;` assignment
     inside `resetEnv` (line 114).

5. **Remove `VITE_USDC_ADDRESS` from `.env.example`.**
   Edit `/Users/dima/git/pipeline/.env.example`: delete line 70
   (`VITE_USDC_ADDRESS=...`). Keep the surrounding block (chain id, RPC URL,
   `VITE_DEPOSIT_MANAGER_ADDRESS`, `VITE_WALLETCONNECT_PROJECT_ID`) untouched.

6. **Update `packages/frontend/src/wallet/README.md`.**
   - In the "Running the dev server" block (around lines 14–21), drop the
     `VITE_USDC_ADDRESS` mention from the `edit ...` comment and remove the
     paragraph that explains the zero-address default.
   - In the `useUsdcBalance()` section (around lines 65–80), replace
     "Reads `balanceOf(address)` on the USDC contract configured via
     `VITE_USDC_ADDRESS`. When the address is the zero address (default) the
     read is skipped..." with prose that documents the new derivation: the
     USDC address comes from `useDepositManagerAddresses().usdc`, the read is
     gated on the manager being configured and `usdc()` resolving, and
     `isLoading` is `true` while the manager call is in flight.
   - No changes needed to the mock-key schema table — the
     `pipeline.mock.wallet.balance.usdc` key continues to bypass the read.

7. **Update `docs/STORIES.md` TC-181-1.**
   - In the "Expected" line, replace
     `(or "—" if VITE_USDC_ADDRESS is the zero default)` with
     `(or "—" if VITE_DEPOSIT_MANAGER_ADDRESS is unset / the manager's usdc()
     view has not yet resolved)`.

8. **Validate the change manually.**
   - Run `yarn workspace @pipeline/frontend lint`.
   - Run `yarn workspace @pipeline/frontend test` (vitest) and confirm
     `useUsdcBalance` and DepositManager test suites pass.
   - Run `yarn workspace @pipeline/frontend build` to confirm the typed env
     accessor still compiles (any stale reference to `ENV.USDC_ADDRESS` will
     fail typecheck).
   - Run `npx tsx scripts/lint-docs.ts` to validate doc structure.

## Test Strategy

- **Unit tests — `useUsdcBalance` (refactored).**
  - Mock-mode tests stay as-is (balance mock key short-circuits regardless of
    manager state). Assert `data`, `formatted`, `isLoading`, and zero `fetch`
    calls — these are the existing lock-in guards.
  - **Disconnected wallet:** `useAccount` returns
    `{ address: undefined, isConnected: false }`, manager returns a real USDC
    address → `data` is `undefined`, `isLoading` is `false`, `useReadContract`
    `query.enabled` is `false`.
  - **DepositManager not configured (zero address):** manager mock returns
    `{ usdc: undefined, isLoading: false }` (either via env zero-address
    short-circuit or by mocking `useDepositManagerAddresses` directly) →
    `data` undefined, `isLoading` false, `query.enabled` false, no `fetch`
    calls.
  - **DepositManager `usdc()` in flight:** mock `useDepositManagerAddresses`
    to return `{ usdc: undefined, isLoading: true }` → `useUsdcBalance` should
    return `isLoading: true`, `data: undefined`, `query.enabled: false`.
  - **Real RPC path (happy case):** mock `useDepositManagerAddresses` to
    return `{ usdc: "0xabc…", isLoading: false }`, connected wallet, no mock
    balance key → `useReadContract` is called with `address: "0xabc…"`,
    `functionName: "balanceOf"`, `args: [walletAddress]`, and `query.enabled`
    is `true`. When `useReadContract` returns a value the hook returns that
    value with `formatted` populated.
  - **Address change reactivity:** rerender after the manager's `usdc` flips
    from `undefined` to a real address — the next `useReadContract` call
    should see the new address. (This is implicit in the wagmi behavior; we
    just assert the address argument tracks the latest `useDepositManagerAddresses`
    result.)
- **Sibling tests:** `useApproval.test.tsx` and `useDepositManager.test.tsx`
  continue to pass with the `USDC_ADDRESS` mockEnv entry removed (no
  production code in those modules reads it).
- **Build / typecheck:** removing `ENV.USDC_ADDRESS` is a breaking change for
  any caller — typecheck must pass to confirm there are no stragglers. (A
  full `rg "ENV.USDC_ADDRESS"` shows only `useWallet.ts` and the three test
  files listed above.)
- **No new e2e coverage required.** The TopBar/wallet-pill smoke story
  (TC-181-1) still validates the end-user behavior; only its expected-state
  wording changes (step 7).

## Docs to Update

- `packages/frontend/src/wallet/README.md` — drop `VITE_USDC_ADDRESS`
  references and rewrite the `useUsdcBalance` paragraph (step 6).
- `docs/STORIES.md` TC-181-1 expected line (step 7).
- `.env.example` — remove the `VITE_USDC_ADDRESS` row (step 5).
- No product-spec updates required: this is a "single source of truth"
  refactor with no observable behavior change at the user/agent surface
  (USDC balance still resolves through the manager when both are
  configured; still shows `—` when not configured). No spec under
  `docs/product-specs/` describes the env wiring.
- Archived plans (`docs/exec-plans/completed/issue-181-...`,
  `docs/exec-plans/completed/issue-211-...`) intentionally left untouched —
  they are historical records of how the system used to be configured.
