# Issue #542: Stake page: network fee row always renders "—"; Figma shows "~$1.20"

Source: https://github.com/eq-lab/pipeline/issues/542

## Scope

The Network-fee row on `/stake` is hardcoded to `"—"`
(`packages/frontend/src/routes/stake.tsx:335` —
`<InfoRow label="Network fee" value="—" />`). It should instead show a live
network-fee estimate for the active tab (Stake vs. Unstake), mirroring the
Deposit page, which already wires `useNetworkFeeEstimate` into its fee row.

In scope:

- Extend `useNetworkFeeEstimate` (`packages/frontend/src/wallet/evm/useNetworkFeeEstimate.ts`)
  to support the stake/unstake directions, OR add a thin sibling hook that reuses
  the same gas-price + buffer + format machinery. (See Implementation Steps for
  the recommended shape.)
- Wire the active-tab estimate into `stake.tsx`'s Network-fee row, replacing the
  hardcoded `"—"` and falling back to `"—"` when the estimate is unavailable
  (disconnected, zero-address, loading) — exactly the deposit page pattern
  (`deposit.tsx:824` → `networkFee={networkFee ?? "—"}`).
- Unit tests for the new direction(s) in
  `packages/frontend/src/wallet/evm/useNetworkFeeEstimate.test.tsx`.

Out of scope (pending Open Question resolution):

- **Displaying the fee in USD (`~$1.20`).** The existing hook returns an
  ETH-denominated string (`~0.00053 ETH`). Issue #506 — the ETH→USD conversion
  for the deposit fee row — was **closed as working-as-intended** with the
  decision "we do not have usd price, show only eth amount." There is still no
  ETH→USD price source in the repo. Per that precedent this issue should ship an
  **ETH-denominated** estimate, not USD, unless a price source has since landed.
  This is the central Open Question below.

## Assumptions and Risks

- **Existing infrastructure (confirmed).** A `useNetworkFeeEstimate(direction)`
  hook already exists and is consumed by `deposit.tsx`. It computes
  `estimateContractGas → applyGasBuffer (+20%) → × getGasPrice()`, formats via
  `formatFeeEth` (`~X.XXXXX ETH`), supports `localStorage` mock keys
  (`pipeline.mock.wallet.networkFeeEstimate.<direction>`), and returns
  `{ feeEth: undefined }` when disconnected / zero-address. The stake work should
  reuse this machinery, not reinvent it.
- **Contract calls for the estimate (confirmed from `useStakedPlusd.ts`):**
  - Stake → `stakedPlusd.deposit(assets, receiver=address)`
    (ABI `packages/frontend/src/wallet/evm/abis/stakedPlusd.ts`, `deposit(uint256,address)`).
  - Unstake → `stakedPlusd.redeem(shares, receiver=address, owner=address)`
    (`redeem(uint256,address,address)`).
  - Contract address: `ENV.STAKED_PLUSD_ADDRESS` (zero-address short-circuit
    already used elsewhere). Both tokens are 6-decimal (per existing hook
    comments and mocks); the representative amount should follow the existing
    `REPRESENTATIVE_*` convention (e.g. a fixed `1000` parsed at the token's
    decimals), with a curated fallback gas constant when simulation reverts
    (deposit uses 250k, withdraw 180k as precedent — pick representative
    constants for stake/redeem, e.g. ~200k each, confirmable from
    `estimateGasCapped` results during implementation).
- **Hook naming collision risk.** The hook's `NetworkFeeDirection` type is
  currently `"deposit" | "withdraw"`. Adding `"stake" | "unstake"` keeps one hook
  but bloats its branchy `queryFn`. A cleaner alternative is to extract the
  shared `gas × gasPrice → formatFeeEth` core and add a small
  `useStakeNetworkFeeEstimate(direction: "stake" | "unstake")`. Either is
  acceptable; the plan recommends extending the union to keep a single consumer
  surface and a single mock-key namespace, but the coder may extract if the
  branch grows unwieldy. Whichever path, **do not regress** the existing
  deposit/withdraw behavior or its mock keys.
- **Mock-key parity.** The `/test` scenario harness drives stake states via mock
  keys. New stake/unstake fee estimates must be mockable with the same
  `pipeline.mock.wallet.networkFeeEstimate.<direction>` convention so the
  ux-tester / `/test` "Connected, ready to stake (approved)" scenario can pin a
  deterministic value.
- **Figma vs. precedent conflict (risk → Open Question).** Figma node
  1500-102009 shows `~$1.20` (USD). The #506 resolution says ETH-only. Shipping
  ETH will leave a known Figma divergence on the fee row; shipping USD requires a
  price source that does not exist. The plan cannot resolve this alone.
- **No backend changes; frontend-only flow** (`frontend` label, no testing phase
  per AGENTS.md — gate only on these Open Questions).

## Open Questions

1. **ETH vs. USD for the fee row (blocking).** Figma shows `~$1.20` (USD), but
   issue #506 was closed working-as-intended with "we do not have usd price, show
   only eth amount," and no ETH→USD price source has since been added to the repo.
   Should #542 ship an **ETH-denominated** estimate (matching the current deposit
   page and the #506 decision, accepting a Figma divergence on the `$` value), or
   has a price source landed that now makes the USD value feasible? If ETH-only,
   confirm the Figma `~$1.20` is treated as a stale/aspirational reference and
   the row will read e.g. `~0.00042 ETH`.

## Implementation Steps

1. In `packages/frontend/src/wallet/evm/useNetworkFeeEstimate.ts`:
   - Extend `NetworkFeeDirection` to include `"stake"` and `"unstake"`.
   - Add stake/unstake branches to `queryFn` that call
     `publicClient.estimateContractGas` against `stakedPlusdAbi` at
     `ENV.STAKED_PLUSD_ADDRESS`:
     - stake → `functionName: "deposit"`, `args: [representativeAssets, address]`
     - unstake → `functionName: "redeem"`, `args: [representativeShares, address, address]`
   - Reuse `applyGasBuffer` + `getGasPrice()` + `formatFeeEth`; add curated
     fallback gas constants (`FALLBACK_GAS_STAKE`, `FALLBACK_GAS_UNSTAKE`) for the
     revert path, matching the existing deposit/withdraw fallback pattern.
   - Add the zero-address short-circuit for `STAKED_PLUSD_ADDRESS`.
   - Add mock keys `pipeline.mock.wallet.networkFeeEstimate.stake` /
     `.unstake` to the `MOCK_KEYS` map and the mock fast-path.
   - Update the file's top doc comment to cover the new directions.
2. In `packages/frontend/src/routes/stake.tsx`:
   - Import `useNetworkFeeEstimate` from `@/wallet`.
   - Call it unconditionally for both directions
     (`const { feeEth: stakeFeeEth } = useNetworkFeeEstimate("stake");` and
     `unstake`), mirroring `deposit.tsx:189-190` (Rules of Hooks).
   - Derive `const networkFee = isStakeTab ? stakeFeeEth : unstakeFeeEth;`.
   - Replace `<InfoRow label="Network fee" value="—" />` with
     `<InfoRow label="Network fee" value={networkFee ?? "—"} />`.
3. Confirm `useNetworkFeeEstimate` is exported from the `@/wallet` barrel (it is
   already imported there by `deposit.tsx`); add the export if the new symbol
   shape requires it.
4. (Only if Open Question resolves to USD) — out of scope until a price source is
   confirmed; would require a new ETH→USD conversion step shared with #506. Do
   not implement speculatively.

## Test Strategy

- Extend `packages/frontend/src/wallet/evm/useNetworkFeeEstimate.test.tsx`:
  - Zero-address short-circuit for stake and unstake →
    `feeEth: undefined`.
  - Mock-key fast path for `stake` and `unstake` keys (pinned value, asserts no
    RPC call — `estimateContractGas`/`getGasPrice` not invoked).
  - Real RPC path: mocked `estimateContractGas` + `getGasPrice` →
    asserts the correctly formatted `~X.XXXXX ETH` string (reuse the existing 2
    gwei × 200k gas fixtures).
  - Revert path: `estimateContractGas` throws → falls back to the curated
    constant × gas price, still returns a formatted estimate.
- Regression: existing deposit/withdraw tests must remain green (do not change
  their keys or behavior).
- Run `cd packages/frontend && yarn test` (vitest) and the repo lint
  (`npx tsx scripts/lint-docs.ts` for docs; project TS lint for the change).
- Figma verification (manual / ux pass): with the `/test` "Connected, ready to
  stake (approved)" scenario, the Network-fee row renders a non-`—` estimate.
  Compare against Figma node 1500-102009 (frame 1498-101158). NOTE: the rendered
  value will be ETH unless the USD Open Question resolves otherwise — flag the
  unit divergence rather than treating it as a defect.

## Docs to Update

- No product-spec change required: this is a `bug`/`fix` that aligns the fee row
  with the already-shipped deposit behavior (no new user-facing behavior beyond
  what the deposit page already documents).
- If the new hook directions warrant it, update any frontend hook reference in
  `packages/frontend/src/wallet/README.md` (it already lists
  `useNetworkFeeEstimate`) to mention stake/unstake support.
- If the USD Open Question reopens the #506 scope, reference PR #516's history
  and Figma node 1993:7932 / 1500-102009 in that follow-up.
