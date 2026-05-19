# Issue #278: Staked PLUSD (sPLUSD) vault hook — stake/unstake via ERC-4626 deposit/redeem

Source: https://github.com/eq-lab/pipeline/issues/278

## Scope

Add the sPLUSD ERC-4626 vault surface to the wallet module so the upcoming `/stake` page wiring can talk to the contract. The work is a sibling of #211 (DepositManager hook set) and #274 (WithdrawalQueue hook set) — same patterns, same mock-layer discipline, same caching primitives. The sPLUSD share is itself an ERC-20, so balance / decimals / symbol / allowance / approve are already covered by `useToken` (#220) — this Issue only adds the vault-specific surface (`asset()`, `convertToShares()`, `convertToAssets()`, `deposit()`, `redeem()`).

**In scope:**

- New ABI file `packages/frontend/src/wallet/abis/stakedPlusd.ts` exposing exactly five entries (`asset`, `convertToShares`, `convertToAssets`, `deposit`, `redeem`) typed `as const`. No ERC-20 / UUPS / AccessManaged plumbing.
- New hook module `packages/frontend/src/wallet/useStakedPlusd.ts` exporting:
  - `useStakedPlusdAsset(): { plusd, isLoading, error }` — one-shot, cached forever via `CACHE_FOREVER`. Maps on-chain `asset()` → `plusd`.
  - `useStakedPlusdConvertToShares(assets: bigint | undefined): { data: bigint | undefined, isLoading, error }` — short-stale (`staleTime: 30_000`, `refetchInterval: 30_000`). Mock path computes `(assets * rate) / 1e18` from a single rate-keyed mock value.
  - `useStakedPlusdConvertToAssets(shares: bigint | undefined): { data: bigint | undefined, isLoading, error }` — same caching, same rate convention but inverted (`(shares * rate) / 1e18`).
  - `useStake(): { write(amount), data: { hash, shares? } | undefined, isPending, isSuccess, error, reset }` — wraps `deposit(amount, receiver)`. `receiver` is the connected wallet, applied internally; not a call-site arg.
  - `useUnstake(): { write(shares), data: { hash, assets? } | undefined, isPending, isSuccess, error, reset }` — wraps `redeem(shares, receiver, owner)`. Both `receiver` and `owner` are the connected wallet, applied internally.
- Matching unit tests in `packages/frontend/src/wallet/useStakedPlusd.test.tsx` covering the same matrix that `useWithdrawalQueue.test.tsx` covers, plus convert-rate maths.
- New env variable `VITE_STAKED_PLUSD_ADDRESS` wired through `packages/frontend/src/lib/env.ts` as `ENV.STAKED_PLUSD_ADDRESS` (zero-address default; same short-circuit pattern as `DEPOSIT_MANAGER_ADDRESS` and `WITHDRAWAL_QUEUE_ADDRESS`) and added to `.env.example`.
- Mock-layer keys following the existing `pipeline.mock.wallet.contract.stakedPlusd.*` schema (named aliases) plus generic per-address fallbacks. Convert mocks use a **rate-based** convention (a single 18-decimal rate keyed once, used to derive the output for any input amount).
- Re-exports from `packages/frontend/src/wallet/index.ts` so external consumers stay on `@/wallet` only.
- Docs: add five rows to `docs/frontend/hooks.md` (alphabetical placement); extend the wallet `README.md` mock-key schema table and worked-snippet section with the new keys; extend the public-API section with a description of each new hook.

**Out of scope (per Issue):**

- The `/stake` page wiring (`packages/frontend/src/routes/stake.tsx` currently uses static strings) — follow-up Issue, analogous to #227 for `/deposit`.
- `mint(shares, receiver)` and `withdraw(assets, receiver, owner)` — the other two ERC-4626 entry points. Stake = PLUSD-in / sPLUSD-out (= `deposit`); unstake = sPLUSD-in / PLUSD-out (= `redeem`). The product flow never needs `mint` / `withdraw`.
- `totalAssets`, `totalSupply`, `maxDeposit`, `maxMint`, `maxRedeem`, `maxWithdraw`, `previewDeposit`, `previewMint`, `previewRedeem`, `previewWithdraw` — bring in only when a UI needs them.
- ERC-20 surface on sPLUSD itself (`decimals` / `symbol` / `balance` / `allowance` / `approve`) — covered by `useToken({ token: sPlusdAddress })` from #220.
- PLUSD-side `approve` to the sPLUSD vault — covered by the existing `useApproval` (and by `useToken({ token: plusd, spender: sPlusdVault })` once call sites prefer the bundled hook).
- Any staking voucher / off-chain verification flow — there is none; staking is a direct on-chain ERC-4626 deposit/redeem (unlike `claimWithdrawal`).
- Wiring the new hooks into the `/test` diagnostic page — optional follow-up, not blocking.
- Indexer / API / contract-side changes (the sPLUSD indexer plan in `docs/superpowers/specs/2026-05-14-splusd-stake-unstake-indexing-design.md` is unrelated to this frontend Issue and tracked separately under #177).

## Assumptions and Risks

**Assumptions:**

- `StakedPlusd.asset()` is the underlying ERC-20 (PLUSD) and is immutable for the deployed proxy — safe to cache `staleTime: Infinity`. This matches the ERC-4626 spec.
- `convertToShares` and `convertToAssets` are pure view functions whose value drifts as yield accrues, but only slowly. `staleTime: 30_000` + `refetchInterval: 30_000` gives the Stake page a live-feeling preview without hammering the RPC; call sites that need a different cadence can layer their own `refetch` on top (the underlying wagmi `useReadContract` exposes this surface via its `query` return shape, but `useStakedPlusdConvert*` deliberately does **not** re-export it in v1 — call sites that need it should consult viem directly, file a follow-up, or roll the value into a higher-cadence custom hook).
- Mock-layer rate convention: keying the convert mocks by exact input amount (`…convertToShares.<amount>`) makes scenarios painful to author for arbitrary user input. A single 18-decimal rate covers every amount and keeps the `/test` scenario list small. Worked example: rate `"959600000000000000"` (= 0.9596 sPLUSD per 1 PLUSD, scaled to 1e18) means `convertToShares(1_000_000_000_000_000_000n)` returns `959_600_000_000_000_000n`, and `convertToShares(500_000_000_000_000_000n)` returns `479_800_000_000_000_000n`. The arithmetic is `(input * rate) / 10n**18n`, performed in BigInt to avoid precision loss.
- `deposit(assets, receiver)` returns `uint256 shares` and `redeem(shares, receiver, owner)` returns `uint256 assets`. Per the existing `useRequestWithdrawal` precedent, wagmi's `useWriteContract` only surfaces a tx hash on the real path — it does not decode the receipt return value. The `shares?` and `assets?` fields in the returned `data` object are populated **only** via the mock-key JSON (mirroring `RequestWithdrawalResult.requestId?` / `queued?` and `ClaimWithdrawalResult.amount?`).
- The connected wallet for `useStake` / `useUnstake` is supplied by `useWallet().address`. When `address === undefined` (no wallet connected), `write()` must fail fast with `Error("Wallet not connected")` rather than send a malformed transaction. This mirrors how `useApproval` handles the same edge case.
- The `pipeline.mock.wallet.contract.stakedPlusd.*` key prefix is unused today — verified by grepping the codebase (`grep -rn "stakedPlusd\|sPlusd\|splusd\|STAKED_PLUSD" packages/frontend/src/` returns no hits in the wallet module). No collisions.
- Tests should reuse the `vi.hoisted(() => ({ … }))` env-mock pattern already established in `useWithdrawalQueue.test.tsx`. The hoisted block must include `DEPOSIT_MANAGER_ADDRESS`, `WITHDRAWAL_QUEUE_ADDRESS`, **and** `STAKED_PLUSD_ADDRESS` so the module-level `vi.mock("@/lib/env", …)` stays valid for code paths that incidentally touch any sibling address.

**Risks:**

- **Rate-mock semantics confusion.** A single rate at 18 decimals is unusual — readers may expect "rate per 1 unit of the input token in the input token's decimals." Mitigation: a long JSDoc on each convert hook (and a worked snippet in `README.md`) explicitly documents the `(input * rate) / 1e18` formula and shows two examples (1 PLUSD and 0.5 PLUSD). The unit test for the mock path asserts both cases.
- **BigInt overflow.** `(input * rate) / 1e18` is safe for any realistic vault size: max realistic `input` ≤ 1e36 (1e18 tokens × 18 decimals) × rate ≤ 1e18 → 1e54, well inside `BigInt` range. No overflow guard needed beyond the implicit unbounded BigInt arithmetic.
- **Wallet-not-connected vs zero-address branches.** Two distinct guards: the env address being zero (config missing) and the user's wallet not being connected (UI state). These produce different error messages so a future `/stake` page can surface the right copy. Document the two cases in the JSDoc to prevent confusion.
- **Caching cadence drift.** A 30-second `refetchInterval` is non-default for the wallet module (everything else uses `CACHE_FOREVER` or wagmi defaults). A future hook that opts into the same cadence should reuse the constant defined here (`CONVERT_CACHE` or inline literal) rather than introduce a third pattern.
- **Same-tab mock bridge.** Verify that the `pipeline-mock:wallet` custom-event bridge in `mock.ts` already covers the new keys without changes (it does — `installSameTabMockBridge` broadcasts any `pipeline.mock.*` write generically).
- **No-restricted-imports.** Confirm the ESLint barrel rule still passes: new file lives inside `src/wallet/`, imports `wagmi` / `viem` locally, only re-exports through `index.ts`.

## Open Questions

_None_

## Implementation Steps

1. **Create `packages/frontend/src/wallet/abis/stakedPlusd.ts`** with exactly the five entries from the Issue body (`asset`, `convertToShares`, `convertToAssets`, `deposit`, `redeem`), typed `as const`. Match the file-level JSDoc style of `abis/withdrawalQueue.ts`. Reference the full ABI source (`docs.local/splusd_abi.txt`) in a top-of-file comment. Do **not** include any ERC-20, UUPS, or AccessManaged entries.

2. **Add `STAKED_PLUSD_ADDRESS` to `packages/frontend/src/lib/env.ts`** below `WITHDRAWAL_QUEUE_ADDRESS`, defaulting to the zero address, cast `as \`0x${string}\``. Mirror the JSDoc note about the zero-address short-circuit semantics already used for `DEPOSIT_MANAGER_ADDRESS` / `WITHDRAWAL_QUEUE_ADDRESS`.

3. **Add `VITE_STAKED_PLUSD_ADDRESS` to `.env.example`** in the `# ── Frontend (VITE_) ────` block, immediately under `VITE_WITHDRAWAL_QUEUE_ADDRESS`, with one-line comment:
   `VITE_STAKED_PLUSD_ADDRESS=0x0000000000000000000000000000000000000000 # set to StakedPLUSD vault address on Hoodi`.

4. **Create `packages/frontend/src/wallet/useStakedPlusd.ts`** with the five hooks. Structure it as a direct mirror of `useWithdrawalQueue.ts`:
   - File-level JSDoc explaining the mock-key precedence, the rate-mock semantics for the convert hooks, the "mock-only" status of `shares?` / `assets?` in write `data`, and the two error branches (`Wallet not connected` vs `StakedPLUSD not configured`).
   - `MOCK_KEYS` constant block containing:
     - `assetAlias: "pipeline.mock.wallet.contract.stakedPlusd.asset"`
     - `convertToSharesAlias: "pipeline.mock.wallet.contract.stakedPlusd.convertToShares"` (rate scalar at 1e18)
     - `convertToAssetsAlias: "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets"` (rate scalar at 1e18)
     - `stake: "pipeline.mock.wallet.contract.stakedPlusd.stake"` (JSON)
     - `unstake: "pipeline.mock.wallet.contract.stakedPlusd.unstake"` (JSON)
     - Generic factories: `contractAsset(address)`, `contractConvertToShares(address)`, `contractConvertToAssets(address)` — all lowercased.
   - `ZERO_ADDRESS` constant (re-used local literal — same as `useWithdrawalQueue.ts`).
   - `RATE_SCALE = 10n ** 18n` constant.
   - Exported types: `StakedPlusdAssetResult`, `StakedPlusdConvertResult`, `StakeResult`, `UnstakeResult`.
     - `StakedPlusdAssetResult`: `{ plusd: \`0x${string}\` | undefined, isLoading: boolean, error: Error | null }`.
     - `StakedPlusdConvertResult`: `{ data: bigint | undefined, isLoading: boolean, error: Error | null }`.
     - `StakeResult`: `{ write: (amount: bigint) => void, data: { hash: string; shares?: string } | undefined, isPending, isSuccess, error, reset }`.
     - `UnstakeResult`: `{ write: (shares: bigint) => void, data: { hash: string; assets?: string } | undefined, isPending, isSuccess, error, reset }`.
   - **`useStakedPlusdAsset()`**: same four-tier resolution as `useWithdrawalQueueAddresses` but for a single field (`asset`). Named-alias mock → generic per-address mock → zero-address short-circuit → real `useReadContract` with `CACHE_FOREVER` and `query.enabled: !shouldSkipReal`. Reads `functionName: "asset"` against `ENV.STAKED_PLUSD_ADDRESS`. Returns the data under `plusd`.
   - **`useStakedPlusdConvertToShares(assets: bigint | undefined)` and `useStakedPlusdConvertToAssets(shares: bigint | undefined)`**: implement once as an inner helper `useConvert(direction: "toShares" | "toAssets", input: bigint | undefined)` and expose two thin wrappers, or duplicate the body — author's choice; either keeps the typings clean. Mandatory behaviour:
     - `input === undefined || input === 0n` → return `{ data: undefined, isLoading: false, error: null }` and pass `enabled: false` to the underlying `useReadContract`.
     - `ENV.STAKED_PLUSD_ADDRESS === ZERO_ADDRESS` → short-circuit to `{ data: undefined, isLoading: false, error: null }`.
     - Named-alias mock present (`pipeline.mock.wallet.contract.stakedPlusd.convertToShares` / `…convertToAssets`) → parse as bigint, return `(input * rate) / RATE_SCALE` via `useMock` so the hook stays reactive.
     - Generic per-address mock present → same arithmetic against the per-address key.
     - Otherwise → real `useReadContract({ functionName: "convertToShares" | "convertToAssets", args: [input], query: { enabled: !shouldSkipReal, staleTime: 30_000, refetchInterval: 30_000 } })`. Return the wagmi `data` as `bigint | undefined`.
   - **`useStake()`**: clone the `useRequestWithdrawal` skeleton. Differences:
     - Pull `address` from `useWallet()` at the top of the hook (so the wallet barrel handles its own mock layer for `address`).
     - Mock key precedence: same `readMock(MOCK_KEYS.stake, parseJson<{ hash; shares? }>)` pattern. Mock path resolves with the full parsed JSON.
     - Real path: if `address === undefined`, set `Error("Wallet not connected")` and bail. If `STAKED_PLUSD_ADDRESS === ZERO_ADDRESS`, set `Error("StakedPLUSD not configured")` and bail. Otherwise `wagmiWrite.writeContract({ abi: stakedPlusdAbi, address: ENV.STAKED_PLUSD_ADDRESS, functionName: "deposit", args: [amount, address] })`.
   - **`useUnstake()`**: identical structure to `useStake` but `functionName: "redeem"`, `args: [shares, address, address]` (receiver and owner both = connected wallet). Mock key `MOCK_KEYS.unstake`. Mock JSON shape `{ hash; assets? }`.
   - Both write hooks must call `useWriteContract()` and `useWallet()` unconditionally at the top of the hook (the React rules of hooks). The bailout branches happen inside the `write` callback.
   - All comments and structure should make it obvious that this is a copy-paste of `useWithdrawalQueue.ts` with the new function names and the rate-mock branch added to the convert hooks.

5. **Re-export from `packages/frontend/src/wallet/index.ts`** alongside the deposit / withdrawal hooks:
   - Value exports: `useStakedPlusdAsset`, `useStakedPlusdConvertToShares`, `useStakedPlusdConvertToAssets`, `useStake`, `useUnstake`.
   - Type exports: `StakedPlusdAssetResult`, `StakedPlusdConvertResult`, `StakeResult`, `UnstakeResult`.

6. **Create `packages/frontend/src/wallet/useStakedPlusd.test.tsx`** by copying `useWithdrawalQueue.test.tsx` and adapting. Use the same `vi.hoisted` `mockEnv` pattern but extend it to include `STAKED_PLUSD_ADDRESS`. Test groups (one `describe` block each):
   - `useStakedPlusdAsset — named alias mock`: returns plusd from `…stakedPlusd.asset`; `useReadContract` `enabled: false`.
   - `useStakedPlusdAsset — generic per-address mock`: returns value from `pipeline.mock.wallet.contract.<addr>.asset`; lowercased-address lookup works.
   - `useStakedPlusdAsset — named alias priority`: named wins over generic.
   - `useStakedPlusdAsset — zero-address short-circuit`: returns `{ plusd: undefined }`; no RPC.
   - `useStakedPlusdAsset — caching options forwarded`: `CACHE_FOREVER` keys present on the underlying call.
   - `useStakedPlusdConvertToShares — undefined input disables`: `enabled: false`, `data: undefined`.
   - `useStakedPlusdConvertToShares — zero input disables`: same as above.
   - `useStakedPlusdConvertToShares — real path forwards args`: `useReadContract` called with `{ functionName: "convertToShares", address: SP, args: [input] }` and `staleTime: 30_000`, `refetchInterval: 30_000`.
   - `useStakedPlusdConvertToShares — mock-path rate maths`: with rate `"959600000000000000"` (0.9596 at 1e18), `input = 1_000_000_000_000_000_000n` → `data = 959_600_000_000_000_000n`; `input = 500_000_000_000_000_000n` → `data = 479_800_000_000_000_000n`. `useReadContract` disabled; `fetchSpy` not called.
   - `useStakedPlusdConvertToShares — generic per-address mock`: same arithmetic, keyed by `pipeline.mock.wallet.contract.<addr>.convertToShares`.
   - `useStakedPlusdConvertToShares — zero-address short-circuit`: `data: undefined`, no RPC.
   - Mirror set for `useStakedPlusdConvertToAssets` with the inverted rate convention.
   - `useStake — args pass-through`: with connected wallet `0xWAL…`, `writeContract` called with `{ functionName: "deposit", address: SP, args: [amount, 0xWAL…] }`.
   - `useStake — mock key bypasses RPC`: write returns `{ hash, shares }` from JSON; `mockWriteContract` not called.
   - `useStake — wallet-not-connected error`: with `address: undefined`, `write()` sets `Error(/Wallet not connected/)`; `writeContract` not called.
   - `useStake — zero-address disables`: sets `Error(/StakedPLUSD not configured/)`; `writeContract` not called.
   - `useStake — reset semantics`: `reset()` clears `data` / `isSuccess` in mock mode.
   - Mirror set for `useUnstake` (args `[shares, 0xWAL…, 0xWAL…]`, mock data `{ hash, assets }`).

7. **Update `packages/frontend/src/wallet/README.md`** mock-key schema table with the new rows under the WithdrawalQueue block:
   - `pipeline.mock.wallet.contract.stakedPlusd.asset` → `string (0x…)` — named alias for `useStakedPlusdAsset`. Takes priority over the generic key.
   - `pipeline.mock.wallet.contract.<address>.asset` → `string (0x…)` — generic per-address fallback.
   - `pipeline.mock.wallet.contract.stakedPlusd.convertToShares` → decimal bigint at 18 decimals (rate). Mock hook returns `(assets * rate) / 1e18`.
   - `pipeline.mock.wallet.contract.<address>.convertToShares` → same, generic per-address fallback.
   - `pipeline.mock.wallet.contract.stakedPlusd.convertToAssets` → decimal bigint at 18 decimals (inverse rate). Mock hook returns `(shares * rate) / 1e18`.
   - `pipeline.mock.wallet.contract.<address>.convertToAssets` → same, generic per-address fallback.
   - `pipeline.mock.wallet.contract.stakedPlusd.stake` → JSON `{ hash: "0x…", shares?: "1000000000000000000" }`.
   - `pipeline.mock.wallet.contract.stakedPlusd.unstake` → JSON `{ hash: "0x…", assets?: "1000000000000000000" }`.
   Add a worked snippet illustrating the full mocked stake / unstake flow (set address, convert rates in both directions, stake/unstake mocks) parallel to the existing deposit / withdrawal snippets. Show the worked maths inline as a comment (`// 0.9596 sPLUSD per 1 PLUSD ⇒ rate = 959600000000000000`).

8. **Extend the public-API section of `README.md`** with a `useStakedPlusdAsset() / useStakedPlusdConvertToShares() / useStakedPlusdConvertToAssets() / useStake() / useUnstake()` block, modelled after the `useRequestDeposit()` / `useClaim()` blocks already present.

9. **Update `docs/frontend/hooks.md`** with five new alphabetically-sorted rows:
   - `useStake` (placed after `useRequestWithdrawal`).
   - `useStakedPlusdAsset` (placed after `useStake`).
   - `useStakedPlusdConvertToAssets` (placed after `useStakedPlusdAsset`).
   - `useStakedPlusdConvertToShares` (placed after `useStakedPlusdConvertToAssets`).
   - `useUnstake` (placed near the end, before `useWallet`).
   Use one-sentence descriptions following the existing row style (return shape + mock-key reference).

10. **Run lint + tests:**
    - `npx tsx scripts/lint-docs.ts` to validate docs structure.
    - The repo-level frontend test suite (`yarn workspace @pipeline/frontend test` or `/test-fast`) — verify the new test file passes and no existing test regresses.
    - `yarn workspace @pipeline/frontend lint` (or the equivalent invoked by `/test-fast`) — confirm the `no-restricted-imports` boundary still passes.

## Test Strategy

**Unit tests** in `packages/frontend/src/wallet/useStakedPlusd.test.tsx` covering (matching the existing `useWithdrawalQueue.test.tsx` matrix where applicable, plus convert-rate maths):

| Hook | Scenario | Assertion |
|------|----------|-----------|
| `useStakedPlusdAsset` | Named-alias mock set | Returns parsed plusd; `useReadContract` disabled; no `fetch`. |
| `useStakedPlusdAsset` | Generic per-address mock (`asset`) | Returns generic value; lowercased address lookup works for uppercase env. |
| `useStakedPlusdAsset` | Both named + generic set | Named wins. |
| `useStakedPlusdAsset` | Zero-address env | Returns `{ plusd: undefined }`; reads disabled. |
| `useStakedPlusdAsset` | Real RPC path | `CACHE_FOREVER` flags forwarded. |
| `useStakedPlusdConvertToShares` | Input undefined | `enabled: false`; `data: undefined`. |
| `useStakedPlusdConvertToShares` | Input 0n | `enabled: false`; `data: undefined`. |
| `useStakedPlusdConvertToShares` | Non-zero input, no mock | `useReadContract` called with `{ functionName: "convertToShares", address: SP, args: [input] }`, `staleTime: 30_000`, `refetchInterval: 30_000`. |
| `useStakedPlusdConvertToShares` | Named-alias rate mock, 1e18 input | Returns `(input * rate) / 1e18`; `useReadContract` disabled; no `fetch`. |
| `useStakedPlusdConvertToShares` | Named-alias rate mock, 0.5e18 input | Returns `(input * rate) / 1e18` (half the previous case). |
| `useStakedPlusdConvertToShares` | Generic per-address rate mock | Same arithmetic against the per-address key. |
| `useStakedPlusdConvertToShares` | Zero-address env | `data: undefined`; reads disabled. |
| `useStakedPlusdConvertToAssets` | All of the above, inverted rate | Identical matrix, inverted direction. |
| `useStake` | Non-zero address, wallet connected, no mock | `writeContract` called with `{ functionName: "deposit", address: SP, args: [amount, walletAddr] }`. |
| `useStake` | Mock key set | `write()` settles `isPending` → `isSuccess` with parsed `{ hash, shares }`; `writeContract` and `fetch` never called. |
| `useStake` | Wallet not connected | `write()` sets `Error(/Wallet not connected/)`; `writeContract` not called. |
| `useStake` | Zero-address env | `write()` sets `Error(/StakedPLUSD not configured/)`; `writeContract` not called. |
| `useStake` | `reset()` in mock mode | Clears `data` and `isSuccess`. |
| `useUnstake` | Non-zero address, wallet connected, no mock | `writeContract` called with `{ functionName: "redeem", address: SP, args: [shares, walletAddr, walletAddr] }`. |
| `useUnstake` | Mock key set | `write()` settles with parsed `{ hash, assets }`. |
| `useUnstake` | Wallet not connected | `write()` sets `Error(/Wallet not connected/)`. |
| `useUnstake` | Zero-address env | `write()` sets `Error(/StakedPLUSD not configured/)`. |
| `useUnstake` | `reset()` in mock mode | Clears `data` and `isSuccess`. |

**Edge cases to cover explicitly:**

- Uppercase env address with lowercase mock key (generic per-address path) on the convert hooks.
- Two distinct error guards for the write hooks: `wallet-not-connected` (UI state) vs `zero-address-config` (env state) must produce different error messages.
- `Promise.resolve().then` microtask settle observable via `waitFor` for write hooks.
- `fetchSpy` assertions to prove zero network IO in mock mode for **all** five hooks.
- Reactivity: writing the rate mock key via `localStorage.setItem` mid-render must cause the convert hook to re-render with the new value (already exercised by `useMock` / `subscribeMock`; one assertion per direction is sufficient).

**Integration / E2E:** none required for this Issue — the hooks are not wired to a page yet. The follow-up `/stake` Issue will add ux-tester coverage. There is no Figma reference in #278 so no design-driven verification step applies.

**Lint:**

- `npx tsx scripts/lint-docs.ts` must pass after the docs updates.
- Frontend `eslint` must pass — in particular the `no-restricted-imports` boundary (the new hook file lives in `src/wallet/`, so direct `wagmi` / `viem` imports are allowed).

## Docs to Update

- **`docs/frontend/hooks.md`** — add five rows (`useStake`, `useStakedPlusdAsset`, `useStakedPlusdConvertToAssets`, `useStakedPlusdConvertToShares`, `useUnstake`), alphabetical placement.
- **`packages/frontend/src/wallet/README.md`** — extend the mock-key schema table with eight new rows; add a worked snippet for the full mocked stake / unstake flow paralleling the existing deposit and withdrawal snippets; extend the public-API section with one block per new hook.
- **`.env.example`** — add `VITE_STAKED_PLUSD_ADDRESS=0x0000000000000000000000000000000000000000  # set to StakedPLUSD vault address on Hoodi`.

No product-spec change is required: this Issue exposes contract bindings without changing any user-facing behaviour. The stake flow's product spec will be updated by the follow-up `/stake` page Issue.
