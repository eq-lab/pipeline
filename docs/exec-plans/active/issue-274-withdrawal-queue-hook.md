# Issue #274: WithdrawalQueue contract hook (read PLUSD/USDC addresses + requestWithdrawal/claimWithdrawal writes)

Source: https://github.com/eq-lab/pipeline/issues/274

## Scope

Add the WithdrawalQueue surface in `packages/frontend/src/wallet/` so the upcoming withdraw / claim-USDC flow can talk to the contract. The work is a direct mirror of #211 (DepositManager hook set) — same patterns, same mock-layer discipline, same caching primitives.

**In scope:**

- New ABI file `packages/frontend/src/wallet/abis/withdrawalQueue.ts` exposing exactly four entries (`fromToken`, `intoToken`, `requestWithdrawal`, `claimWithdrawal`) typed `as const`.
- New hook module `packages/frontend/src/wallet/useWithdrawalQueue.ts` exporting:
  - `useWithdrawalQueueAddresses(): { plusd, usdc, isLoading, error }` — one-shot, cached forever via `CACHE_FOREVER`. Maps on-chain `fromToken` → `plusd` and `intoToken` → `usdc`.
  - `useRequestWithdrawal(): { write(amount), data: { hash, requestId?, queued? } | undefined, isPending, isSuccess, error, reset }`.
  - `useClaimWithdrawal(): { write(requestId, verifierSignature), data: { hash, amount? } | undefined, isPending, isSuccess, error, reset }`.
- Matching unit tests in `packages/frontend/src/wallet/useWithdrawalQueue.test.tsx` covering the same matrix that `useDepositManager.test.tsx` covers.
- New env variable `VITE_WITHDRAWAL_QUEUE_ADDRESS` wired through `packages/frontend/src/lib/env.ts` as `ENV.WITHDRAWAL_QUEUE_ADDRESS` (zero-address default; same short-circuit pattern as `DEPOSIT_MANAGER_ADDRESS`) and added to `.env.example`.
- Mock-layer keys following the existing `pipeline.mock.wallet.contract.withdrawalQueue.*` schema (named aliases) plus generic per-address fallbacks (`pipeline.mock.wallet.contract.<addr>.fromToken` / `…intoToken`).
- Re-exports from `packages/frontend/src/wallet/index.ts` so external consumers stay on `@/wallet` only.
- Docs: add three rows to `docs/frontend/hooks.md` (alphabetical insertion); extend the wallet `README.md` mock-key schema table and worked-snippet section with the new keys; update the `useDepositManager.test.tsx` mockEnv hoisted block precedent in the new test file.

**Out of scope (per Issue):**

- The `/withdraw` page wiring (follow-up Issue, analogous to #227 for `/deposit`).
- A `useWithdrawalVoucher` hook for fetching the EIP-712 voucher from `GET /v1/withdrawals/{request_id}/voucher` (follow-up Issue, analogous to #235's `useDepositVoucher`).
- PLUSD `approve` to the WithdrawalQueue (already covered by the generic `useApproval`).
- Wiring the new hooks into the `/test` diagnostic page — optional follow-up; not blocking.
- Other useful read views on the contract (`claimable`, `isClaimable`, `convertFrom`, `convertInto`, `queueMetadata`, `requests`, `nextRequestId`, admin setters). Add when a UI needs them.
- Any solidity / contract-side changes.

## Assumptions and Risks

**Assumptions:**

- `WithdrawalQueue.fromToken` and `WithdrawalQueue.intoToken` are immutable for the deployed proxy in the same sense as `DepositManager.plUsd` / `DepositManager.usdc` — safe to cache `staleTime: Infinity`. (Confirmed by the Issue body: the on-chain names are generic but they hold PLUSD / USDC respectively for the deployed contract.)
- `requestWithdrawal` returns a tuple `(uint256 requestId, uint256 queued)` per the Issue body. The frontend never decodes the actual receipt return data — wagmi's `writeContract` only surfaces a `hash`. The `requestId?` and `queued?` fields in the returned `data` object are populated **only** via the mock-key JSON (mirroring `useRequestDeposit`'s `requestId?` field — that field is documented but never populated by the real wagmi path either).
- `claimWithdrawal`'s `verifierSignature` is a `0x…` bytes string identical in shape to the existing deposit `claim` voucher signature (same EIP-712 `VerifiedRequests` struct, same `packages/shared/src/eip712.rs:53` signer). The hook stays agnostic of how the caller obtains it.
- The `pipeline.mock.wallet.contract.withdrawalQueue.*` key prefix is unused today — verified by grepping the codebase. No collisions.
- Tests should reuse the `vi.hoisted(() => ({ … }))` env-mock pattern already established in `useDepositManager.test.tsx`. The hoisted block must include both `DEPOSIT_MANAGER_ADDRESS` and `WITHDRAWAL_QUEUE_ADDRESS` to keep the module-level `vi.mock("@/lib/env", …)` valid for any code path that incidentally touches `ENV.DEPOSIT_MANAGER_ADDRESS`.

**Risks:**

- **Tuple return decoding.** viem's `useReadContract` with a tuple-output `nonpayable` function is unusual — but since `requestWithdrawal` is `nonpayable` it goes through `useWriteContract`, which only returns a tx hash. The tuple-decoded `requestId` / `queued` fields are populated **only** on the mock path; on the real wagmi path `data` is `{ hash }` only. This is identical to `useRequestDeposit`'s behaviour today; the Issue body's wording ("surface both return fields") refers to the mock-path JSON shape, not real receipt parsing. Document this clearly in the JSDoc to prevent future confusion.
- **Same-tab mock bridge.** Verify that the `pipeline-mock:wallet` custom-event bridge in `mock.ts` already covers the new keys without changes (it does — it broadcasts any `pipeline.mock.*` write generically).
- **No-restricted-imports.** Confirm the ESLint barrel rule still passes: new file lives inside `src/wallet/`, imports `wagmi` / `viem` locally, only re-exports through `index.ts`.

## Open Questions

_None_

## Implementation Steps

1. **Create `packages/frontend/src/wallet/abis/withdrawalQueue.ts`** with exactly the four entries from the Issue body (`fromToken`, `intoToken`, `requestWithdrawal`, `claimWithdrawal`), typed `as const`. Match the file-level JSDoc style of `abis/depositManager.ts`. Reference the ABI source comment but do **not** include claimable / convertFrom / queueMetadata / admin setters.

2. **Add `WITHDRAWAL_QUEUE_ADDRESS` to `packages/frontend/src/lib/env.ts`** below `DEPOSIT_MANAGER_ADDRESS`, defaulting to the zero address, cast `as \`0x${string}\``. Mirror the JSDoc note about the zero-address short-circuit semantics.

3. **Add `VITE_WITHDRAWAL_QUEUE_ADDRESS` to `.env.example`** in the `# ── Frontend (VITE_) ────` block under `VITE_DEPOSIT_MANAGER_ADDRESS`, with one-line comment: `# set to WithdrawalQueue contract address on Hoodi`.

4. **Create `packages/frontend/src/wallet/useWithdrawalQueue.ts`** with the three hooks. Structure it as a direct mirror of `useDepositManager.ts`:
   - `MOCK_KEYS` constant block with `plusdAlias`, `usdcAlias`, `requestWithdrawal`, `claimWithdrawal`, plus generic factories `contractFromToken(address)` and `contractIntoToken(address)`. Keep the named aliases (`plusd` / `usdc`) **and** the generic per-address keys keyed on the on-chain function names (`fromToken` / `intoToken`) — matches the Issue's mock-layer spec.
   - `ZERO_ADDRESS` constant.
   - Exported types: `WithdrawalQueueAddressesResult`, `RequestWithdrawalResult`, `ClaimWithdrawalResult`. `RequestWithdrawalResult.data` shape: `{ hash: string; requestId?: string; queued?: string } | undefined`.
   - `useWithdrawalQueueAddresses()`: same four-tier resolution as `useDepositManagerAddresses` — named-alias mock → generic per-address mock → zero-address short-circuit → real `useReadContract` with `CACHE_FOREVER` and `query.enabled: !shouldSkipReal`. Reads use `functionName: "fromToken"` / `"intoToken"` against `ENV.WITHDRAWAL_QUEUE_ADDRESS`. Returns the data under the domain-friendly `plusd` / `usdc` keys.
   - `useRequestWithdrawal()`: clone the `useRequestDeposit` skeleton verbatim — `useState` for mockState, `useState` for zeroAddrError, `wagmiWrite = useWriteContract()`, mock-path-first `write` callback (`readMock(MOCK_KEYS.requestWithdrawal, parseJson)`), zero-address branch sets `Error("WithdrawalQueue not configured")`, real path calls `wagmiWrite.writeContract({ abi: withdrawalQueueAbi, address: ENV.WITHDRAWAL_QUEUE_ADDRESS, functionName: "requestWithdrawal", args: [amount] })`. Real-path `data` returns `{ hash: txHash }` (no tuple decode); mock-path `data` returns the full parsed JSON (so tests can include `requestId` and `queued`).
   - `useClaimWithdrawal()`: clone `useClaim` verbatim — `write(requestId, verifierSignature)`, mock key `MOCK_KEYS.claimWithdrawal`, real-path call uses `functionName: "claimWithdrawal"`, args `[requestId, verifierSignature]`. Same `Error("WithdrawalQueue not configured")` shape on zero-address.
   - Add module-level JSDoc explaining the mock-key precedence and the "mock-only" status of `requestId` / `queued` / `amount` fields in `data`.

5. **Re-export from `packages/frontend/src/wallet/index.ts`** alongside the deposit hooks:
   - Value exports: `useWithdrawalQueueAddresses`, `useRequestWithdrawal`, `useClaimWithdrawal`.
   - Type exports: `WithdrawalQueueAddressesResult`, `RequestWithdrawalResult`, `ClaimWithdrawalResult`.

6. **Create `packages/frontend/src/wallet/useWithdrawalQueue.test.tsx`** by copying `useDepositManager.test.tsx` and adapting. Use the same `vi.hoisted` `mockEnv` pattern but extend it to include `WITHDRAWAL_QUEUE_ADDRESS`. Test groups (one `describe` block each):
   - `useWithdrawalQueueAddresses — named alias mocks`: returns plusd / usdc from named-alias keys; all `useReadContract` calls have `enabled: false`.
   - `useWithdrawalQueueAddresses — generic per-address mock`: returns values from `pipeline.mock.wallet.contract.<addr>.fromToken` / `…intoToken`; including the uppercase-address-lowercased case.
   - `useWithdrawalQueueAddresses — named alias priority`: when both are set, named wins.
   - `useWithdrawalQueueAddresses — zero-address short-circuit`: returns undefined plusd / undefined usdc with no RPC; all `enabled` are false.
   - `useWithdrawalQueueAddresses — caching options forwarded`: all `CACHE_FOREVER` flags present on each `useReadContract` call.
   - `useRequestWithdrawal — args pass-through`: real wagmi call gets `{ functionName: "requestWithdrawal", address: WQ, args: [amount] }`.
   - `useRequestWithdrawal — mock key bypasses RPC`: write returns `{ hash, requestId, queued }` from the mock JSON; `mockWriteContract` not called; `fetchSpy` not called; `isPending` flips then settles to `isSuccess`.
   - `useRequestWithdrawal — zero-address disables`: sets `Error(/WithdrawalQueue not configured/)`; `mockWriteContract` not called.
   - `useRequestWithdrawal — reset semantics`: `reset()` clears `data` / `isSuccess`.
   - Mirror set for `useClaimWithdrawal` (args `[requestId, verifierSignature]`, mock data `{ hash, amount }`).

7. **Update `packages/frontend/src/wallet/README.md`** mock-key schema table with the new rows under the DepositManager block:
   - `pipeline.mock.wallet.contract.withdrawalQueue.plusd` → address (named alias for `fromToken`).
   - `pipeline.mock.wallet.contract.withdrawalQueue.usdc` → address (named alias for `intoToken`).
   - `pipeline.mock.wallet.contract.<address>.fromToken` → address (generic per-address fallback).
   - `pipeline.mock.wallet.contract.<address>.intoToken` → address (generic per-address fallback).
   - `pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal` → JSON `{ hash: "0x…", requestId?: "123", queued?: "1000000" }`.
   - `pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal` → JSON `{ hash: "0x…", amount?: "1000000" }`.
   Add a worked snippet illustrating the full mocked withdraw flow (set both addresses + `requestWithdrawal` + `claimWithdrawal` mocks), parallel to the deposit snippet already present.

8. **Update `docs/frontend/hooks.md`** with three new alphabetically-sorted rows:
   - `useClaimWithdrawal` (placed after `useClaim`).
   - `useRequestWithdrawal` (placed after `useRequestDeposit`).
   - `useWithdrawalQueueAddresses` (placed after `useToken`).
   Use one-sentence descriptions following the existing row style (return shape + mock-key reference).

9. **Run lint + tests:**
   - `npx tsx scripts/lint-docs.ts` to validate docs structure.
   - The repo-level frontend test suite (`yarn workspace @pipeline/frontend test` or the equivalent invoked by the `/test-fast` skill) — verify the new test file passes and no existing test regresses.

## Test Strategy

**Unit tests** in `packages/frontend/src/wallet/useWithdrawalQueue.test.tsx` covering (matching the existing `useDepositManager.test.tsx` matrix one-for-one):

| Hook | Scenario | Assertion |
|------|----------|-----------|
| `useWithdrawalQueueAddresses` | Named-alias mocks set | Returns parsed plusd / usdc; `useReadContract` calls disabled; no `fetch`. |
| `useWithdrawalQueueAddresses` | Generic per-address mock (`fromToken` / `intoToken`) | Returns generic values; lowercased address lookup works for uppercase env. |
| `useWithdrawalQueueAddresses` | Both named + generic set | Named wins. |
| `useWithdrawalQueueAddresses` | Zero-address env | Returns `{ undefined, undefined }`; all reads disabled. |
| `useWithdrawalQueueAddresses` | Real RPC path | `CACHE_FOREVER` flags (`staleTime`, `gcTime`, `refetchOnMount`, `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchInterval`) all forwarded to `useReadContract`. |
| `useRequestWithdrawal` | Non-zero address, no mock | `writeContract` called with `{ functionName: "requestWithdrawal", address: WQ, args: [amount] }`. |
| `useRequestWithdrawal` | Mock key set | `write()` settles `isPending` → `isSuccess` with parsed `{ hash, requestId, queued }`; `writeContract` and `fetch` never called. |
| `useRequestWithdrawal` | Zero-address env | `write()` sets `error.message` matching `/WithdrawalQueue not configured/`; `writeContract` not called. |
| `useRequestWithdrawal` | `reset()` in mock mode | Clears `data` and `isSuccess`. |
| `useClaimWithdrawal` | Non-zero address, no mock | `writeContract` called with `{ functionName: "claimWithdrawal", address: WQ, args: [requestId, verifierSignature] }`. |
| `useClaimWithdrawal` | Mock key set | `write()` settles with parsed `{ hash, amount }`; `writeContract` and `fetch` never called. |
| `useClaimWithdrawal` | Zero-address env | `write()` sets `error.message` matching `/WithdrawalQueue not configured/`. |
| `useClaimWithdrawal` | `reset()` in mock mode | Clears `data` and `isSuccess`. |

**Edge cases to cover explicitly:**

- Uppercase env address with lowercase mock key (generic per-address path).
- `Promise.resolve().then` microtask settle observable via `waitFor` — the mock path must remain async-observable so callers can wire `isPending` UI states.
- `fetchSpy` assertions to prove zero network IO in mock mode.

**Integration / E2E:** none required for this Issue — the hooks are not wired to a page yet. The follow-up `/withdraw` Issue will add ux-tester coverage. There is no Figma reference in #274 so no design-driven verification step applies.

**Lint:**

- `npx tsx scripts/lint-docs.ts` must pass after the docs updates.
- Frontend `eslint` must pass — in particular the `no-restricted-imports` boundary (the new hook file lives in `src/wallet/`, so direct `wagmi` / `viem` imports are allowed).

## Docs to Update

- **`docs/frontend/hooks.md`** — add three rows (`useWithdrawalQueueAddresses`, `useRequestWithdrawal`, `useClaimWithdrawal`), alphabetical placement.
- **`packages/frontend/src/wallet/README.md`** — extend the mock-key schema table with six new rows; add a worked snippet for the full withdraw → claim mocked flow paralleling the existing deposit snippet.
- **`.env.example`** — add `VITE_WITHDRAWAL_QUEUE_ADDRESS=0x0000000000000000000000000000000000000000  # set to WithdrawalQueue contract address on Hoodi`.

No product-spec change is required: this Issue exposes contract bindings without changing any user-facing behaviour. The withdraw flow's product spec will be updated by the follow-up `/withdraw` page Issue.
