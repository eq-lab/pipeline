# Issue #211: DepositManager contract hook (read PLUSD/USDC addresses + requestDeposit/claim writes)

Source: https://github.com/eq-lab/pipeline/issues/211

## Scope

Add the next slice of `@/wallet` public hooks that surface the on-chain `DepositManager` contract to the LP UI. The wallet module landed in #181 already exposes `useWallet`, `useUsdcBalance`, and a generic `useContractRead`; this Issue extends it with:

In scope:

- New ABI file `packages/frontend/src/wallet/abis/depositManager.ts` containing **exactly** the four entries listed in the Issue body (`plUsd`, `usdc`, `requestDeposit`, `claim`), typed `as const` for viem type inference.
- New env variable `VITE_DEPOSIT_MANAGER_ADDRESS`, defaulted to the zero address (same pattern as `VITE_USDC_ADDRESS`), surfaced via `ENV.DEPOSIT_MANAGER_ADDRESS` in `packages/frontend/src/lib/env.ts`, and added to `.env.example` with a one-line comment under the existing `# ── Frontend (VITE_) ──` block.
- New read hook `useDepositManagerAddresses()` returning `{ plusd, usdc, isLoading, error }` where `plusd` / `usdc` are `\`0x${string}\` | undefined`. Fetches `plUsd()` and `usdc()` once per mount, caches forever (`staleTime: Infinity`, `gcTime: Infinity`, no refetch on focus / reconnect / interval). When `ENV.DEPOSIT_MANAGER_ADDRESS` is the zero address, the hook short-circuits and returns `{ plusd: undefined, usdc: undefined, isLoading: false, error: null }` without making an RPC call.
- New write hooks `useRequestDeposit()` and `useClaim()` — two hooks rather than one combined `useDepositManager`, matching the existing module style (`useUsdcBalance`, `useContractRead` are single-purpose). Each returns a `{ write, data, isPending, isSuccess, error, reset }`-shaped result where `write(args)` triggers the on-chain call via wagmi's `useWriteContract`. When the configured DepositManager address is zero, `write` is a no-op that surfaces a typed `Error("DepositManager not configured")` via `error` and the call returns immediately (the hook never reaches viem).
- Mock-layer plumbing:
  - Reads — `useDepositManagerAddresses` consults the existing `pipeline.mock.wallet.contract.<address>.<fn>` schema (lower-cased contract address + function name `plUsd` / `usdc`) before issuing the RPC. The implementation reuses `readMock` + the existing `parseAddress` helper; no new key family is required. Two named-alias keys are also accepted for ergonomic console use:
    - `pipeline.mock.wallet.contract.depositManager.plusd` → address string
    - `pipeline.mock.wallet.contract.depositManager.usdc` → address string
    A named alias takes precedence over the generic per-address key (so a tester does not need to know the deployed address). When either alias or the generic key is set the hook skips both the read and the env-zero-address short-circuit.
  - Writes — `useRequestDeposit` / `useClaim` honour two new mock keys that, when present, return a fixed result without calling `writeContract`:
    - `pipeline.mock.wallet.contract.depositManager.requestDeposit` → JSON-encoded `{ hash: "0x...", requestId: "123" }`
    - `pipeline.mock.wallet.contract.depositManager.claim` → JSON-encoded `{ hash: "0x...", amount: "1000000" }`
    Behaviour: `isPending` flips true for one tick, then settles to `isSuccess: true` with `data` set to the parsed object. No RPC call is issued and viem's `writeContract` is never invoked.
- Public-API barrel update: `packages/frontend/src/wallet/index.ts` re-exports `useDepositManagerAddresses`, `useRequestDeposit`, `useClaim`, plus their result types. The `no-restricted-imports` boundary stays intact — wagmi / viem types are not re-exported.
- Unit tests for all three new hooks (mock mode, zero-address short-circuit, args-pass-through, single-fetch caching for the read).
- Catalogue update in `docs/frontend/hooks.md` — add one row per new shared hook.
- `packages/frontend/src/wallet/README.md` — append the new mock keys to the schema table and a worked DevTools-console snippet.

Out of scope:

- USDC `approve()` flow on the ERC-20 (caller's responsibility, handled in the deposit-page flow Issue).
- Fetching `verifierSignature` from the API verifier service (separate Issue / consumer's responsibility — the hook just takes it as an input arg).
- The `requests(requestId)` view, rate-limit getters, and admin setters (not needed by the LP UI; intentionally left out of the ABI file).
- Withdrawal queue / sPLUSD redeem flows — those will get their own hooks against different contracts.
- Wiring the new hooks into any UI route. This Issue ships the wallet-module surface only.
- A product-spec change. The frontend behavior contract (LP-facing deposit / claim semantics) is already defined in the protocol specs; adding the React surface to call the contract is implementation, not new product behavior.

## Assumptions and Risks

- **ABI verified against `docs.local/manager_abi.txt`.** The four function entries in the Issue body match the deployed ABI exactly (verified during planning: `plUsd` and `usdc` are `view → address`; `requestDeposit(uint256 amount) → uint256 requestId` is `nonpayable`; `claim(uint256 requestId, bytes verifierSignature) → uint256 amount` is `nonpayable`). The ABI file copies the four entries verbatim from the Issue body; no transformation.
- **wagmi write-hook surface.** wagmi v2 exposes `useWriteContract` whose `writeContract` accepts `{ abi, address, functionName, args, account?, chainId? }` and returns a `{ data: hash, error, isPending, isSuccess, reset, writeContract, writeContractAsync }` shape. We wrap this so consumers receive `{ write, data, isPending, isSuccess, error, reset }` and never see the underlying wagmi types. The `data` field surfaces the transaction hash; `requestId` / `amount` decoded from the return value are NOT recovered synchronously (write hooks return a tx hash, not a decoded return value — decoding requires reading the transaction receipt logs / call return). This matches what the Issue body asks for; if a consumer needs the decoded `requestId` they will subscribe to the `DepositRequested(requestId, user, amount)` event (separate Issue) or decode the receipt. The unit test asserts on the args-pass-through, not on a decoded return.
- **Mock-layer write return shape.** Because real writes only return a tx hash, the mocked write returns a richer object `{ hash, requestId? | amount? }` so consumer tests that want to assert on the post-write request id can do so. This is a deliberate deviation from "perfect parity with the real hook" — documented in the README addition. The plan deliberately surfaces this asymmetry rather than papering over it.
- **Single-fetch caching.** wagmi's `useReadContract` accepts a `query` config that maps to TanStack Query options. `{ staleTime: Infinity, gcTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false }` together produce the "fetch once per page lifetime" semantics the Issue asks for. The unit test asserts via the mocked `useReadContract` that these flags are forwarded.
- **Zero-address short-circuit.** Mirrors the existing `useUsdcBalance` behavior. The hook returns `undefined` data + `error: null` (not an error state) so consumers can treat "not configured" as "loading complete, no data" the same way they treat "wallet disconnected."
- **Two hooks vs. one combined.** The Issue body explicitly says either pattern is fine. Two hooks (`useRequestDeposit`, `useClaim`) is preferred because (a) it matches the existing single-purpose-hook style in `useWallet.ts`, (b) consumers of the deposit page and the withdraw page are different and pulling one giant hook into both pages would create unused-binding noise, (c) each hook gets its own focused unit test.
- **No dependency on unfinished work.** #181 (the parent wallet module) is merged. The deposit-page consumer issue (which will exercise these hooks end-to-end) is separate and not blocking — this Issue ships the surface only.
- **Risk: ABI drift.** If the deployed `DepositManager` contract changes the signature of any of the four functions, the ABI file goes stale silently. Mitigation: keep the ABI file under 20 lines and the diff against `docs.local/manager_abi.txt` is trivial to re-verify. A future Issue could codegen the ABI from the canonical artifact; out of scope here.
- **Risk: same-tab mock bridge already installed.** `WalletProvider` calls `installSameTabMockBridge()` on mount; the new hooks reuse the existing `useMock` / `readMock` helpers so they pick up changes reactively without any further bridge plumbing. Verified by re-reading `wallet/mock.ts`.

## Open Questions

_None_

## Implementation Steps

1. **Create the ABI file.**
   - New file `packages/frontend/src/wallet/abis/depositManager.ts`.
   - Export `const depositManagerAbi = [...] as const` containing exactly the four entries shown in the Issue body.
   - JSDoc the file: one-paragraph rationale ("only the four functions consumed by the LP UI; full ABI lives in `docs.local/manager_abi.txt`").

2. **Extend `ENV`.**
   - In `packages/frontend/src/lib/env.ts`, add a `DEPOSIT_MANAGER_ADDRESS` field reading `VITE_DEPOSIT_MANAGER_ADDRESS` via `readString(...)` with default `"0x0000000000000000000000000000000000000000"`, typed `as \`0x${string}\``. Match the existing `USDC_ADDRESS` JSDoc style (mention the zero-address default short-circuit).
   - Add the variable to `.env.example` under the existing `# ── Frontend (VITE_) ──` block, just below `VITE_USDC_ADDRESS`, with a one-line comment.

3. **Add new mock-key constants and helpers.**
   - In `packages/frontend/src/wallet/useWallet.ts` (or a new sibling file — implementer's choice; see step 4), extend the local `KEYS` object with:
     - `depositManagerPlusdAlias: "pipeline.mock.wallet.contract.depositManager.plusd"`
     - `depositManagerUsdcAlias: "pipeline.mock.wallet.contract.depositManager.usdc"`
     - `depositManagerRequestDeposit: "pipeline.mock.wallet.contract.depositManager.requestDeposit"`
     - `depositManagerClaim: "pipeline.mock.wallet.contract.depositManager.claim"`
   - Reuse `useMock`, `parseAddress`, `parseJson` from `wallet/mock.ts`. No new parse helpers needed.

4. **Implement the three new hooks.**
   - File placement: create a dedicated `packages/frontend/src/wallet/useDepositManager.ts` to keep `useWallet.ts` from growing beyond its current ~200 LOC ceiling. Export `useDepositManagerAddresses`, `useRequestDeposit`, `useClaim`, and their result/arg types.
   - `useDepositManagerAddresses()`:
     - Read named-alias mock keys first (`plusd` + `usdc`).
     - Else if `ENV.DEPOSIT_MANAGER_ADDRESS === 0x0…`: short-circuit to `{ plusd: undefined, usdc: undefined, isLoading: false, error: null }`.
     - Else issue two `useReadContract` calls (or one parallel pair) with `query: { staleTime: Infinity, gcTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false }`.
     - Also consult the generic `pipeline.mock.wallet.contract.<lowercased-dm-address>.plUsd` / `.usdc` keys (so consumers who set the generic per-address mock pattern still bypass the RPC). The implementation can call the existing public `useContractRead` and let it handle the generic-key path, then layer the named-alias check on top.
   - `useRequestDeposit()`:
     - If mock key `pipeline.mock.wallet.contract.depositManager.requestDeposit` present → return a memoised `write(args)` that synchronously parses the mocked JSON and surfaces it as `data` with `isSuccess: true`. `useWriteContract` is NOT called.
     - Else if `ENV.DEPOSIT_MANAGER_ADDRESS === 0x0…` → `write` is a function that sets internal error state to `new Error("DepositManager not configured")` and resolves; `isPending` never flips true.
     - Else delegate to `useWriteContract` with `{ abi: depositManagerAbi, address: ENV.DEPOSIT_MANAGER_ADDRESS, functionName: "requestDeposit", args: [amount] }`.
     - Public surface: `{ write: (amount: bigint) => void, data, isPending, isSuccess, error, reset }`.
   - `useClaim()`: same shape; `write: (requestId: bigint, verifierSignature: \`0x${string}\`) => void`. Mock key `…depositManager.claim` returns `{ hash, amount }`.

5. **Update the wallet barrel.**
   - In `packages/frontend/src/wallet/index.ts`, add named exports for the three new hooks and their result/arg types. Keep the JSDoc reminder about the `no-restricted-imports` boundary.

6. **Write unit tests** (see Test Strategy for full coverage matrix).
   - Create `packages/frontend/src/wallet/useDepositManager.test.tsx`. Mock `wagmi`'s `useReadContract` and `useWriteContract` the same way the existing `useContractRead.test.tsx` / `useUsdcBalance.test.tsx` do (vi.mock with the same `@reown/appkit/react`, `@tanstack/react-query`, and `./config` stubs already used in those files).

7. **Update `docs/frontend/hooks.md`.**
   - Add one row per new shared hook (`useClaim`, `useDepositManagerAddresses`, `useRequestDeposit`) — alphabetical order, `@/wallet` import path, one-sentence description.

8. **Update `packages/frontend/src/wallet/README.md`.**
   - Add the four new mock keys to the `localStorage mock key schema` table.
   - Add a DevTools-console snippet under "DevTools console snippets" showing how to mock the addresses + a successful `requestDeposit`.
   - Add a `useDepositManagerAddresses` / `useRequestDeposit` / `useClaim` subsection under "Public API" with a brief signature and example.

9. **Lint and typecheck.**
   - `yarn workspace @pipeline/frontend lint` — must pass.
   - `npx tsx scripts/lint-docs.ts` — must pass (markdown docs structure).
   - `yarn workspace @pipeline/frontend tsc --noEmit` (or the package's `typecheck` script if defined) — zero errors.
   - `yarn workspace @pipeline/frontend test` — all new + existing tests green.

## Test Strategy

New test file `packages/frontend/src/wallet/useDepositManager.test.tsx`. Use the same wagmi / appkit / react-query mocking pattern as `useContractRead.test.tsx`. Cover:

- **`useDepositManagerAddresses` — mock named aliases.**
  - Set `pipeline.mock.wallet.contract.depositManager.plusd` + `…usdc` to fixed addresses. Assert returned `{ plusd, usdc }` match. Assert `useReadContract` was either not called or called with `query.enabled === false`.
- **`useDepositManagerAddresses` — generic per-address mock.**
  - Set `ENV.DEPOSIT_MANAGER_ADDRESS` to a non-zero address (via `withEnvOverride`).
  - Set the generic `pipeline.mock.wallet.contract.<addr-lowercase>.plUsd` + `…usdc` keys. Assert the hook returns those values and does NOT issue a real read.
- **`useDepositManagerAddresses` — zero-address short-circuit.**
  - Default ENV. Assert returned `{ plusd: undefined, usdc: undefined }` and `useReadContract` calls are either absent or have `query.enabled === false`.
- **`useDepositManagerAddresses` — caching options forwarded.**
  - Use `withEnvOverride` to set a non-zero address with no mock keys. Inspect the args passed to the mocked `useReadContract`: assert `query.staleTime === Infinity`, `refetchOnWindowFocus === false`, `refetchOnReconnect === false`, `refetchOnMount === false`, `refetchInterval === false`.
- **`useRequestDeposit` — args pass-through (no mock, non-zero address).**
  - `withEnvOverride` for a non-zero DM address. Call `result.current.write(123n)`. Assert the mocked `useWriteContract`'s returned `writeContract` was called with `{ abi: depositManagerAbi, address: <env address>, functionName: "requestDeposit", args: [123n] }`.
- **`useRequestDeposit` — mock key bypasses RPC.**
  - Set `pipeline.mock.wallet.contract.depositManager.requestDeposit` to `JSON.stringify({ hash: "0xabc", requestId: "42" })`. Call `write(123n)`. Assert `data` equals the parsed object, `isSuccess === true`, and the mocked `writeContract` was NOT called.
- **`useRequestDeposit` — zero-address disables.**
  - Default ENV. Call `write(123n)`. Assert `error` is an `Error` with message matching `/DepositManager not configured/` and `writeContract` was not called.
- **`useClaim` — args pass-through, mock-key bypass, zero-address-disabled** — mirror the three `useRequestDeposit` cases with arg shape `(requestId: bigint, sig: \`0x${string}\`)`.
- **`fetch` is never called in mock mode** — spy on `globalThis.fetch` (per the existing `useUsdcBalance.test.tsx` pattern) for at least one mocked-write case to lock in the "zero RPC" guarantee.

Edge cases explicitly covered above:
- Empty / unset mock keys (default path).
- Uppercase contract address mock key — `useContractRead` already lowercases the address; assert this still works for the new flows via one mixed-case env override.
- Reset semantics: call `result.current.reset()` on the write hook and assert `data` returns to `undefined` and `isSuccess` to `false`.

Lint guards:
- `yarn workspace @pipeline/frontend lint` (ESLint must catch any direct wagmi/viem import from outside `src/wallet/`).
- `npx tsx scripts/lint-docs.ts` (`docs/frontend/hooks.md` row format).

## Docs to Update

- `docs/frontend/hooks.md` — add three rows (alphabetical: `useClaim`, `useDepositManagerAddresses`, `useRequestDeposit`).
- `packages/frontend/src/wallet/README.md` — extend the mock-key schema table with the four new keys; add a DevTools console snippet; add Public-API subsections for the three new hooks.
- `.env.example` — add `VITE_DEPOSIT_MANAGER_ADDRESS` under the frontend block.
- No product-spec change required. The protocol-level deposit / claim semantics are already specified in the existing product specs; this Issue ships React-side plumbing only.
- No `docs/design-docs/` change (no visual surface introduced).
- No `docs/exec-plans/tech-debt-tracker.md` entry expected; if the implementer takes any shortcut (e.g. defers receipt-based requestId decoding to a follow-up), log it there in the same commit.
