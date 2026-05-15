# Issue #215: Add useApproval hook for ERC-20 allowance check/approve

Source: https://github.com/eq-lab/pipeline/issues/215

## Scope

Add a generic, reusable React hook `useApproval` to the `@/wallet` module that bridges ERC-20 reads (`allowance(owner, spender)`) with ERC-20 writes (`approve(spender, amount)`). Token address and spender address are parameters — nothing is hard-coded — so the same hook serves USDC → DepositManager today and any future (token, spender) pair tomorrow.

In scope:

- Extend `packages/frontend/src/wallet/abis/erc20.ts` with two new ABI entries: `allowance(owner, spender) view → uint256` and `approve(spender, amount) → bool` (`nonpayable`). The file stays a minimal, hand-curated subset typed `as const`; the existing four entries (`balanceOf`, `decimals`, `symbol`, `name`) are untouched.
- New hook file `packages/frontend/src/wallet/useApproval.ts` implementing `useApproval({ token, spender })` and exporting the result type `UseApprovalResult`.
- Behaviour contract (matches the Issue body verbatim):
  - `allowance: bigint | undefined` — current `allowance(owner=connected, spender)`. `undefined` when wallet disconnected, when `token` or `spender` is the zero address, or while the read is in flight.
  - `isSufficient: (amount: bigint) => boolean` — convenience. Returns `false` when `allowance` is `undefined`; `true` when `allowance >= amount`. Stable identity across renders for a given `allowance` value (use `useCallback`).
  - `approve: (amount: bigint) => void` — triggers `approve(spender, amount)` on the token contract via wagmi `useWriteContract`. No-op (sets `error`) when token or spender is the zero address or wallet is disconnected.
  - `data: { hash: string } | undefined` — populated after the approve tx is broadcast. Mock path also populates this (with the mocked hash).
  - `isLoading` — true while the allowance read is in flight.
  - `isPending` — true while an approve tx is in flight.
  - `isSuccess` — true once the approve tx is confirmed (matches the existing `useRequestDeposit` / `useClaim` semantics: surfaces wagmi's `isSuccess` flag, which is true after broadcast — we do not wait for receipt confirmation, consistent with the rest of the wallet module).
  - `error: Error | null` — read or write error; cleared by `reset()`.
  - `reset: () => void` — clears `data`, `error`, and resets `isPending`/`isSuccess` to their initial state.
  - `refetch: () => void` — re-reads `allowance`. Wired to wagmi's `useReadContract` `refetch`. After a successful approve the hook calls this automatically (via a `useEffect` that watches `isSuccess`) so `allowance` / `isSufficient` reflect the new value without the consumer doing anything.
- Mock layer (consistent with `useDepositManager.ts`):
  - `pipeline.mock.wallet.allowance.<tokenLowercase>.<spenderLowercase>` → decimal bigint string. When present, the wagmi read is skipped (`query.enabled: false`) and the hook returns this value as `allowance`. Reactive via `useMock` + `parseBigInt` (bigint primitives are stable, so no `useSyncExternalStore` snapshot churn).
  - `pipeline.mock.wallet.contract.<tokenLowercase>.approve` → JSON `{ hash: "0x..." }`. When present, `approve()` settles synchronously (one tick `isPending: true`, then `isSuccess: true` with the parsed data) and `writeContract` is never called. Detected via `readMock` (non-reactive) in the `approve` callback — same pattern as `useRequestDeposit` to avoid `getSnapshot should be cached` warnings on JSON-returning parsers.
  - After a mocked approve settles, the hook still calls `refetch()` so a tester can update the allowance mock key and observe the new value reactively (the wagmi `refetch` is a no-op when `query.enabled: false`, but the `useMock` subscription on the allowance key already re-renders on any same-tab mock write via the existing bridge — the explicit `refetch()` call is for parity with the real path).
- Barrel export in `packages/frontend/src/wallet/index.ts` — add `useApproval` to the exports and `UseApprovalResult` to the type exports. No wagmi/viem types leak through the barrel.
- Unit tests at `packages/frontend/src/wallet/useApproval.test.tsx` covering all branches (see Test Strategy).
- Catalogue update in `docs/frontend/hooks.md` — add a single new alphabetical row for `useApproval`.
- README update in `packages/frontend/src/wallet/README.md` — new `### useApproval()` Public-API subsection (between `useDepositManagerMinDeposit` and `useRequestDeposit` for symmetry), two new rows in the mock-key schema table, and one DevTools console snippet demonstrating allowance + approve mocking for a (USDC, DepositManager) pair.

Out of scope (explicit, per Issue body):

- Wiring `useApproval` into any call-site / route (e.g. the deposit page). That belongs to a follow-up Issue.
- Multi-token batching, multicall, or chained approve-then-deposit single-button UX.
- EIP-2612 `permit` support (gasless approvals) — separate Issue when needed.
- Spender allowance race / front-running mitigations (e.g. the USDT "reset to 0 first" pattern). USDC and plUSD both accept overwriting a non-zero allowance with a new non-zero value, so no special handling is required.
- Receipt-based confirmation polling. Consistent with the existing write hooks, `isSuccess` reflects "tx broadcast accepted" rather than "tx mined". If a consumer needs mined-confirmation, that's a separate cross-cutting concern (likely a `useTxReceipt(hash)` helper, not in scope here).
- A product-spec change. This is internal wallet-module surface; the protocol-level approval requirement is already implicit in the ERC-20 + DepositManager contracts.

## Assumptions and Risks

- **ABI correctness.** `allowance(address owner, address spender) view returns (uint256)` and `approve(address spender, uint256 amount) returns (bool)` are part of the ERC-20 standard (EIP-20). Both USDC and plUSD implement them with the canonical signatures. No need to verify against `docs.local/manager_abi.txt` — that file is for the DepositManager contract, not the tokens. The ABI entries follow the same shape as the existing four in `abis/erc20.ts` (typed `as const`, viem-friendly).
- **Existing write-hook pattern is the template.** `useRequestDeposit` in `useDepositManager.ts` already solves the four hard problems this hook hits: (1) reactive mock-key detection without `useSyncExternalStore` snapshot churn for JSON-returning parsers, (2) zero-address short-circuit that surfaces a typed `Error` via `error`, (3) mock state machine that flips `isPending` then `isSuccess` in a microtask so the transition is observable in tests, (4) keeping wagmi hooks unconditional. `useApproval` reuses these patterns verbatim — there are no new architectural problems.
- **Disconnected-wallet handling.** The allowance read needs the connected wallet as `owner`. When `useWallet().address` is `undefined`, the hook returns `allowance: undefined`, sets `query.enabled: false` on the wagmi read, and `approve()` becomes a no-op with `error = Error("Wallet not connected")`. This mirrors how `useUsdcBalance` already handles the disconnected case (`if (!isConnected || !address) → undefined data, no read`).
- **Zero-address handling.** Two parameters can be zero — token and spender. The hook treats either being `0x0...0` as "not configured": no RPC call, `allowance` stays `undefined`, `approve()` surfaces `Error("Token not configured")` or `Error("Spender not configured")` respectively. Same pattern as `useDepositManagerMinDeposit`.
- **Allowance staleness.** The Issue says `refetch` must re-read after external changes and the hook must auto-refetch after a successful approve. We solve auto-refetch via a `useEffect(() => { if (isSuccess) refetch(); }, [isSuccess, refetch])`. External changes (e.g. user approves from a different dapp) are NOT auto-detected — the consumer or a periodic refetch covers that. This is acceptable for the first cut; if the consumer needs polling, they wire it themselves with the returned `refetch`. Note this limitation in the README.
- **Refetch identity stability.** wagmi's `refetch` from `useReadContract` is stable across renders (TanStack Query memoizes it). We can pass it straight through; no `useCallback` wrapping needed. If wagmi changes this contract in the future the tests will catch it (the test asserts `refetch` referential stability across re-renders).
- **`isSufficient` semantics with `undefined` allowance.** Two reasonable interpretations: (a) return `false` (pessimistic — "we don't know, assume insufficient"), (b) return `undefined` (tri-state — "we don't know"). The Issue API signature says `(amount: bigint) => boolean`, which forces (a). Pick (a): consumers can still observe `isLoading` separately to distinguish "still loading" from "definitely insufficient". Document this in JSDoc and the README.
- **No dependency on unfinished work.** #211 (DepositManager hook) is merged and #213 (minDeposit hook) is also merged. The Issue body is self-contained. No blockers.
- **Risk: same-tab mock bridge already installed.** `WalletProvider` calls `installSameTabMockBridge()` on mount. The new hook reuses `useMock` + `readMock` so it picks up changes reactively for the allowance key without any extra plumbing.
- **Risk: race between mocked approve and allowance refetch.** When the approve mock fires, we schedule the state transition in a `Promise.resolve().then(...)` microtask, then the `useEffect` on `isSuccess` schedules a `refetch()`. If a test wants to assert "allowance updated after approve" it must update the mock allowance key BEFORE calling `approve()` (or in the microtask gap). This is documented in the README snippet and one test exercises this exact ordering.
- **Risk: ESLint boundary.** The new hook lives inside `src/wallet/`, so direct `wagmi` import is allowed. The barrel only re-exports the hook + result type, not wagmi types. ESLint `no-restricted-imports` continues to enforce this from call sites.

## Open Questions

_None_

## Implementation Steps

1. **Extend the ERC-20 ABI.**
   - File: `packages/frontend/src/wallet/abis/erc20.ts`.
   - Append two new entries inside the `erc20Abi` array (keep the file `as const`):
     - `{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] }`
     - `{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }`
   - Update the file-level JSDoc one-liner to drop the "used by `useUsdcBalance`" wording — say it is the minimal ERC-20 subset consumed by the wallet module.

2. **Create `useApproval.ts`.**
   - File: `packages/frontend/src/wallet/useApproval.ts`.
   - Imports: `useEffect, useState, useCallback` from `react`; `useReadContract, useWriteContract` from `wagmi`; `useWallet` from `./useWallet`; `useMock, readMock, parseBigInt, parseJson` from `./mock`; `erc20Abi` from `./abis/erc20`.
   - Define a local `MOCK_KEYS` object (mirrors `useDepositManager.ts`):
     ```ts
     const MOCK_KEYS = {
       allowance: (token: string, spender: string) =>
         `pipeline.mock.wallet.allowance.${token.toLowerCase()}.${spender.toLowerCase()}`,
       approve: (token: string) =>
         `pipeline.mock.wallet.contract.${token.toLowerCase()}.approve`,
     };
     const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
     ```
   - Define and export the result type `UseApprovalResult` with the fields listed in Scope.
   - Define the args type `UseApprovalArgs = { token: \`0x${string}\`; spender: \`0x${string}\` }`.
   - Implement `useApproval({ token, spender })`:
     - Call `useWallet()` for `address` / `isConnected`.
     - Compute `tokenIsZero`, `spenderIsZero`, `walletConnected`.
     - `mockAllowance = useMock(MOCK_KEYS.allowance(token, spender), parseBigInt)` (reactive — bigint primitive, no snapshot churn).
     - `useReadContract` for `allowance(owner, spender)` with `query.enabled = !mockAllowanceSet && walletConnected && !tokenIsZero && !spenderIsZero`. Do NOT use `CACHE_FOREVER` — allowances change after approve calls; let TanStack Query's defaults apply, and the auto-refetch-on-success handles the immediate post-approve case.
     - Set up local state for the approve mock path (`mockState`, `setMockState`) matching the `useRequestDeposit` shape.
     - Set up local state for non-mock error paths (`writeError`, `setWriteError`) for the zero-address and disconnected-wallet cases.
     - Always call `useWriteContract()` — never conditionally.
     - `approve = useCallback((amount: bigint) => { … }, [token, spender, walletConnected, wagmiWrite.writeContract])`:
       - Re-read `approveMock = readMock(MOCK_KEYS.approve(token), parseJson<{ hash: string }>)` at call time.
       - If `approveMock !== undefined` → flip `mockState` to `{ isPending: true }`, then in `Promise.resolve().then(...)` set `{ data: approveMock, isPending: false, isSuccess: true, error: null }`.
       - Else if `!walletConnected` → `setWriteError(new Error("Wallet not connected"))`.
       - Else if `tokenIsZero` → `setWriteError(new Error("Token not configured"))`.
       - Else if `spenderIsZero` → `setWriteError(new Error("Spender not configured"))`.
       - Else → `wagmiWrite.writeContract({ abi: erc20Abi, address: token, functionName: "approve", args: [spender, amount] })`.
     - `isSufficient = useCallback((amount: bigint) => (allowance !== undefined && allowance >= amount), [allowance])`.
     - `refetch = allowanceRead.refetch` (wagmi memoizes; pass through).
     - `reset = useCallback(() => { setMockState(initial); setWriteError(null); wagmiWrite.reset(); }, [wagmiWrite.reset])`.
     - `useEffect(() => { if (isSuccess) refetch(); }, [isSuccess, refetch])` — covers both mock path (`mockState.isSuccess`) and real path (`wagmiWrite.isSuccess`); compute a single `isSuccess` variable above the effect.
     - Compose the returned object by branching on `hasApproveMock` (computed via `readMock` once per render, non-reactive — matches `useRequestDeposit`) → return `mockState.*`; else if mock allowance set → return `{ allowance: mockAllowance, isLoading: false, error: null, … wagmi-side write fields }`; else default-path return.
     - One subtle point: `allowance` must come from the mock value when present, even on the wagmi path. Specifically: `const allowance = mockAllowance ?? (walletConnected && !tokenIsZero && !spenderIsZero ? allowanceRead.data as bigint | undefined : undefined);`.

3. **Update the barrel.**
   - `packages/frontend/src/wallet/index.ts`: add `useApproval` to the value exports and `UseApprovalResult` to the type exports. Keep the alphabetical-ish grouping (group it next to `useDepositManager*` exports or as a new section — either is fine, no enforced ordering).

4. **Write unit tests.**
   - File: `packages/frontend/src/wallet/useApproval.test.tsx`.
   - Use the same wagmi / `@reown/appkit/react` / `@tanstack/react-query` / `@/lib/env` mock setup as `useDepositManager.test.tsx`. Copy the `vi.hoisted` env block and the stable `stableWriteContractState` shape verbatim.
   - Required cases (every branch of the implementation must be hit):
     1. **Allowance — mock key returns parsed bigint.** Set `pipeline.mock.wallet.allowance.0xtoken.0xspender` to `"1000000"`. Mock `useAccount` to return a connected address. Render the hook with matching `token` / `spender`. Assert `allowance === 1_000_000n`. Assert `useReadContract` was either not called or called with `query.enabled === false`.
     2. **Allowance — case-insensitive on token + spender.** Mock key lower-cased; hook called with mixed-case `token` / `spender`. Same assertion.
     3. **Allowance — real RPC path.** No allowance mock, non-zero addresses, connected wallet. Mock `useReadContract` to return `{ data: 500n, isLoading: false, error: null }`. Assert `allowance === 500n`. Assert `useReadContract` was called with `args: [walletAddress, spender]`, `functionName: "allowance"`, `query.enabled: true`.
     4. **Allowance — disabled when wallet disconnected.** `useAccount` returns `{ address: undefined, isConnected: false }`. Assert `allowance === undefined` and `useReadContract` called with `query.enabled: false`.
     5. **Allowance — disabled when token is zero address.** Assert `allowance === undefined`, `query.enabled: false`.
     6. **Allowance — disabled when spender is zero address.** Same.
     7. **`isSufficient` semantics.** With `allowance = 100n`: `isSufficient(99n) === true`, `isSufficient(100n) === true`, `isSufficient(101n) === false`. With `allowance = undefined`: `isSufficient(0n) === false`.
     8. **`approve` — args pass-through (no mock, non-zero, connected).** Call `result.current.approve(123n)`. Assert `writeContract` called once with `{ abi: erc20Abi, address: <token>, functionName: "approve", args: [<spender>, 123n] }`.
     9. **`approve` — mock key bypasses RPC.** Set `pipeline.mock.wallet.contract.0xtoken.approve` to `JSON.stringify({ hash: "0xabc" })`. Call `approve(100n)`. After `waitFor`, assert `data` equals `{ hash: "0xabc" }`, `isSuccess === true`, `writeContract` was NOT called.
    10. **`approve` — disconnected wallet surfaces typed error.** Default disconnected. Call `approve(100n)`. Assert `error.message` matches `/Wallet not connected/i`, `writeContract` not called.
    11. **`approve` — zero token surfaces typed error.** Token = `0x0...0`. `approve(100n)` → `error.message` matches `/Token not configured/i`.
    12. **`approve` — zero spender surfaces typed error.** Spender = `0x0...0`. Similar assertion.
    13. **Auto-refetch after successful approve (real path).** Mock `useReadContract` to expose a `refetch` spy; flip the wagmi mock to `isSuccess: true`; re-render. Assert `refetch` was called. (Easiest to do by toggling `mockUseWriteContract` return shape via `mockReturnValueOnce` and re-rendering.)
    14. **Auto-refetch after mocked approve.** With approve mock key set, call `approve()`. After `waitFor` for `isSuccess`, assert the read's `refetch` spy was called.
    15. **Manual `refetch()` is exposed.** Render hook, assert `typeof result.current.refetch === "function"`, call it, assert the wagmi `refetch` spy fires.
    16. **`reset()` clears state.** Trigger a mocked approve → `isSuccess: true, data: {...}`. Call `reset()`. Assert `data === undefined`, `isSuccess === false`, `error === null`, and the wagmi `reset` spy was also called.
    17. **No RPC in mock mode (lock-in guard).** Spy on `globalThis.fetch` (same pattern as `useUsdcBalance.test.tsx`); set both mock keys; render + call `approve()`; assert `fetch` never called.

5. **Update the hooks catalogue.**
   - File: `docs/frontend/hooks.md`.
   - Insert one new row alphabetically (between `useApproval`-less-than-`useClaim`, so above `useClaim`): `| useApproval | @/wallet | Reads ERC-20 \`allowance(owner, spender)\` and exposes \`approve(spender, amount)\` for any (token, spender) pair. Returns \`{ allowance, isSufficient, approve, data, isLoading, isPending, isSuccess, error, reset, refetch }\`. Honours \`pipeline.mock.wallet.allowance.<token>.<spender>\` and \`pipeline.mock.wallet.contract.<token>.approve\` for mock testing. |`. Keep the table alphabetically sorted.

6. **Update the wallet README.**
   - File: `packages/frontend/src/wallet/README.md`.
   - Add `useApproval` to the import-example block at the top of "Public API".
   - Add a `### useApproval()` subsection before `### useRequestDeposit()` (so the read/check hooks group together) with: signature snippet, parameter table (`token`, `spender`), return-field table (allowance, isSufficient, approve, data, isLoading, isPending, isSuccess, error, reset, refetch), and a note that `isSufficient(amount)` returns `false` when `allowance` is undefined.
   - Add two rows to the mock-key schema table:
     - `pipeline.mock.wallet.allowance.<token>.<spender>` — decimal bigint string — current allowance; bypasses the real read.
     - `pipeline.mock.wallet.contract.<token>.approve` — JSON `{ hash: "0x…" }` — bypasses the real approve tx.
   - Add a "**Mock USDC → DepositManager allowance + approve**" DevTools console snippet showing both keys set together, including the "reset" snippet.

7. **Lint + typecheck + test.**
   - `yarn workspace @pipeline/frontend lint` — must pass.
   - `yarn workspace @pipeline/frontend tsc --noEmit` — must pass.
   - `yarn workspace @pipeline/frontend test` — must pass (existing 57+ tests + new useApproval tests).
   - `npx tsx scripts/lint-docs.ts` — must pass (the new hooks.md row + README edits).

## Test Strategy

Single new test file: `packages/frontend/src/wallet/useApproval.test.tsx`. Mirrors the wagmi/appkit/react-query mocking scaffolding from `useDepositManager.test.tsx` exactly. Cases enumerated above as steps 4.1 through 4.17 — every behavioural branch (mock allowance, real allowance, disconnected, both zero-address types, isSufficient with/without allowance, approve args pass-through, approve mock bypass, three approve error paths, auto-refetch on real and mocked success, manual refetch, reset semantics, no-fetch guard).

Edge cases explicitly exercised:
- Mixed-case `token` / `spender` arguments — assert key lookup lowercases both.
- `isSufficient(amount)` boundary at `allowance === amount` (should be `true`).
- `reset()` clears both mock state AND wagmi state (wagmi `reset` spy fires).
- `refetch` referential stability across re-renders (the test re-renders the hook and asserts `result.current.refetch === firstRender.refetch`).

Lint guards:
- `yarn workspace @pipeline/frontend lint` — catches any direct wagmi/viem import from outside `src/wallet/` (the hook lives inside the module, so its own imports are fine).
- `npx tsx scripts/lint-docs.ts` — validates the new `docs/frontend/hooks.md` row format.

## Docs to Update

- `docs/frontend/hooks.md` — one new row for `useApproval` (alphabetical).
- `packages/frontend/src/wallet/README.md` — new `### useApproval()` Public-API subsection, two new mock-key rows in the schema table, one new DevTools console snippet for the (USDC, DepositManager) pair.
- No product-spec change required. ERC-20 approval is a protocol-implementation detail already implicit in the deposit/withdraw flows; this Issue ships React-side surface only.
- No `docs/design-docs/` change (no visual surface introduced).
- No `.env.example` change (no new env variables).
- No `docs/exec-plans/tech-debt-tracker.md` entry expected; if the implementer takes any shortcut (e.g. defers external-allowance-change polling, or skips one of the listed test cases), log it there in the same commit.
