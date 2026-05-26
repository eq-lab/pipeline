# Issue #405: /deposit: estimate network fee for representative 1000 USDC / 1000 PLUSD, refreshed once a minute

Source: https://github.com/eq-lab/pipeline/issues/405

## Scope

On `/deposit`, replace the em-dash placeholder in the `ConversionCard` "Network fee" row with a live ETH-denominated gas-cost estimate that is decoupled from the user-typed amount.

In scope:

- Add a new wallet hook (`useNetworkFeeEstimate`) under `packages/frontend/src/wallet/` that returns a viem-formatted ETH string (e.g. `~0.00053 ETH`) for a fixed representative call.
- Two call shapes: `requestDeposit(1000 USDC)` and `requestWithdrawal(1000 PLUSD)`. Representative amounts are scaled by token decimals at call time.
- Refetch cadence: once per minute (`refetchInterval: 60_000`).
- Wire the hook output into `networkFee={...}` on the `ConversionCard` in `packages/frontend/src/routes/deposit.tsx`, swapping direction by `isDeposit`.
- Mock-key support so unit/UX tests can pin a deterministic fee string.

Out of scope:

- USD-equivalent fee display (no ETH/USD price source is wired up; explicitly excluded by the Issue and the maintainer's comment).
- Localised currency formatting.
- Multi-chain fee logic.
- Per-amount fee preview (the displayed value is intentionally constant per direction).
- Surfacing the fee in non-`/deposit` surfaces (Stake card, Loans, etc.).
- Closing #270 / #383 as part of this PR — they will be auto-closed by the PR body or curated separately by the manager.

## Assumptions and Risks

- **Wallet may be disconnected.** `estimateContractGas` requires an `account`. When `address` is undefined we should fall back to a public-RPC `estimateGas` against a synthetic account (zero address won't work for ERC-20 paths). Decision: when `account` is unavailable, render `—` (current placeholder) — do not block on this. The hook should accept the disconnected state and refetch automatically once `useWallet().address` resolves.
- **Simulation may revert without prior approval / sufficient balance.** `requestDeposit` requires USDC allowance; `requestWithdrawal` requires a PLUSD balance. A representative call from a real connected wallet that lacks allowance/balance will revert during `estimateContractGas`, defeating the whole feature. Mitigation: use `publicClient.estimateContractGas` with a `stateOverride` that grants the caller a 1000-token balance and `2^256-1` allowance for the DepositManager. viem supports `stateOverride` on `estimateContractGas` — verify the configured RPC accepts `eth_estimateGas` with state overrides. If the RPC does not support overrides, fall back to a hard-coded representative gas number (see Open Questions).
- **DepositManager / WithdrawalQueue not configured (zero address).** The hook must short-circuit to `undefined` (renders `—`).
- **`minDeposit` may exceed 1000 USDC.** Unlikely (current minDeposit is far smaller), but if a future admin raises it above 1000 USDC the simulation will revert with `DepositManagerLessThanMinAmount`. Mitigation: read `minDeposit()` and use `max(1000 USDC, minDeposit)` as the representative amount.
- **Gas-price source.** `estimateContractGas` returns gas units, not cost. Multiply by `publicClient.getGasPrice()` to derive wei, then `formatEther` and truncate. Both calls happen inside the same refetch tick.
- **Per-tx gas cap clamp.** Existing `estimateGasCapped` clamps to `EVM_TX_GAS_CAP` (chain ceiling). For display purposes we want the *un-clamped* estimate × gas price; clamping is an actual-tx concern only. Use `applyGasBuffer` for parity with the real write path, but skip the clamp so we do not silently floor a large estimate.
- **RPC load.** Two reads (`estimateContractGas` + `getGasPrice`) once per minute per open `/deposit` tab. Negligible.
- **Test environment.** vitest tests must avoid real RPC. Mock-key path required.

## Open Questions

- Does the configured Hoodi RPC accept `eth_estimateGas` with `stateOverride` for ERC-20 balance/allowance? If **no**, the planner recommends falling back to a curated constant gas number (`~250_000` for `requestDeposit`, `~180_000` for `requestWithdrawal`) and multiplying by live `gasPrice` — but this trades accuracy for resilience and should be confirmed before the coder hard-codes the fallback.
- Should the hook render `—` or `…` (loading state) on first paint before the first estimate resolves? Current default in `ConversionCard.test.tsx` is `—`; this plan keeps `—` for both "not configured" and "loading", but a separate placeholder (e.g. `…`) could improve UX.

## Implementation Steps

<!-- Status: all steps completed -->

1. **[DONE] New hook: `packages/frontend/src/wallet/useNetworkFeeEstimate.ts`.**
   - Signature: `useNetworkFeeEstimate(direction: "deposit" | "withdraw"): { feeEth: string | undefined; isLoading: boolean; error: Error | null }`.
   - Mock-key support (named alias): `pipeline.mock.wallet.networkFeeEstimate.deposit` / `…withdraw` — JSON string `"0.00053"` short-circuits to `feeEth: "~0.00053 ETH"` (or accept a raw display string).
   - When `direction === "deposit"`:
     - Read `usdc` address + `decimals()` via `useDepositManagerAddresses()` + `useToken({ token: "usdc" })`.
     - Representative amount: `parseUnits("1000", usdcDecimals)`, clamped to `max(amount, minDeposit)` from `useDepositManagerMinDeposit()`.
     - Estimate `requestDeposit(amount)` on `ENV.DEPOSIT_MANAGER_ADDRESS` with `stateOverride` granting the caller a 1000-USDC balance + unlimited allowance to DepositManager.
   - When `direction === "withdraw"`:
     - Representative amount: `parseUnits("1000", plusdDecimals)` (PLUSD also has 6 decimals — confirm via `useToken({ token: "plusd" })`).
     - Estimate `requestWithdrawal(amount)` on `ENV.WITHDRAWAL_QUEUE_ADDRESS` with `stateOverride` granting the caller a 1000-PLUSD balance.
   - Use `useQuery` (via wagmi's `useReadContract` is not appropriate here — we need a raw async). Either:
     - Add a thin `useQuery({ queryKey: ["networkFeeEstimate", direction, address, dmAddress], queryFn, refetchInterval: 60_000, staleTime: 60_000 })`, importing `useQuery` from `@tanstack/react-query`. This is the only place we'll add a direct `@tanstack/react-query` import outside the wallet module — adjust the ESLint `no-restricted-imports` allowlist if the wallet module is already excluded (per `index.ts` header it is).
   - `queryFn`:
     1. Bail early (return `undefined`) when `publicClient`, `address`, or contract address is missing / zero.
     2. Call `publicClient.estimateContractGas({ ..., stateOverride })`.
     3. Apply `+20 %` buffer via `applyGasBuffer` (do not clamp — display only).
     4. Call `publicClient.getGasPrice()`.
     5. `feeWei = gas * gasPrice`; `feeEth = formatEther(feeWei)`; truncate to 5 decimals.
     6. Return `feeEth`.
   - Format helper: `formatFeeEth(feeWei: bigint): string` returns `~0.00053 ETH` (5-decimal truncation, drop trailing zeros down to 2 decimals min). Co-locate with the hook for now; extract to `lib/format.ts` if reused.
   - Mock path: when the named-alias key is set, parse with `parseJson<string>` and return `~${parsed} ETH` (or pass through if already prefixed).
   - Surface errors only via the returned `error` field — never throw.

2. **[DONE] Export the hook.**
   - Add `useNetworkFeeEstimate` (value) and `UseNetworkFeeEstimateResult` (type) to `packages/frontend/src/wallet/index.ts`.

3. **[DONE] Wire into `deposit.tsx`.**
   - Import `useNetworkFeeEstimate` from `@/wallet`.
   - Call both directions unconditionally (hooks rules); active direction selected via `isDeposit`.
   - Replace `networkFee="—"` with `networkFee={networkFee ?? "—"}`.

4. **[DONE] stateOverride approach.**
   - Decision: use `estimateContractGas` without `stateOverride` first; catch reverts and fall back to curated constants (250k deposit / 180k withdraw). Chosen per manager's instruction (open-question resolution). Documented in hook file header.

5. **[DONE] Test mock keys.**
   - Added `pipeline.mock.wallet.networkFeeEstimate.deposit` and `pipeline.mock.wallet.networkFeeEstimate.withdraw` to `docs/STORIES.md`.

## Test Strategy

Unit (vitest, jsdom):

- `packages/frontend/src/wallet/useNetworkFeeEstimate.test.tsx` (new):
  - Mock-key path: setting `pipeline.mock.wallet.networkFeeEstimate.deposit = "0.00053"` makes the hook return `feeEth: "~0.00053 ETH"` synchronously.
  - Zero-address short-circuit returns `feeEth: undefined`.
  - Disconnected wallet returns `feeEth: undefined` and no error.
  - Direction toggle: switching from `"deposit"` to `"withdraw"` reads the corresponding mock key.
  - Error surfaces on `error`, not via throw.

- `packages/frontend/src/components/ConversionCard.test.tsx`: no change required (existing tests pass `networkFee="—"` explicitly).

- `packages/frontend/src/routes/-deposit.test.tsx`: extend with a case that sets the mock key and asserts the rendered fee row contains `~0.00053 ETH` (instead of `—`).

Lint / build:

- `npx tsx scripts/lint-docs.ts` (docs lint).
- `yarn --cwd packages/frontend lint && yarn --cwd packages/frontend build` (TS + bundle).
- `yarn test` at the workspace root (or `yarn --cwd packages/frontend test`).

UX (post-implementation, driven by `ux-tester`):

- Navigate to `http://localhost:5173/deposit` with a connected wallet. Network fee row renders `~0.0xxxx ETH` within ~5 s.
- Toggle Deposit ↔ Withdraw — fee value updates (may differ between directions).
- Type into the amount input — fee value does NOT change (decoupled).
- Wait 60+ s — value refreshes (may be identical if gas price is stable).

## Docs to Update

- `docs/product-specs/deposits.md` — add a short subsection under the deposit-card UX describing the "fee row shows a representative 1000-USDC estimate, refreshed every minute, ETH only" behaviour.
- `docs/product-specs/withdrawals.md` — analogous note for the withdraw direction.
- `docs/STORIES.md` — add a "deposit network fee renders ETH amount" story if not already present.
- No design-doc updates needed; the Figma reference's USD-in-parentheses style is explicitly deferred (Issue comment).
- Cross-link this Issue from #270 and #383 in the PR body so they close together (manager / human decision — not the coder's call).
