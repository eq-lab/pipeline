# Issue #634: [FE] [Stellar] Stake page: chain-aware wiring (steps, trustline, XLM fee, all states)

Source: https://github.com/eq-lab/pipeline/issues/634

## Scope

Make the `/stake` page (`packages/frontend/src/routes/stake.tsx`) chain-aware so
that flipping the active wallet view to **Stellar** (via the existing TopBar pill
/ account dropdown — `useWalletView().kind`) switches the entire stake/unstake
flow to the Soroban `FungibleVault` stack, while EVM remains the default and
unchanged. This is the stake-page analog of #552 (deposit/withdraw chain-aware
wiring via the `useDepositFlow` adapter).

In scope:

- A new chain-agnostic adapter hook `useStakeFlow(tab, amountBig, setAmountInput)`
  (mirroring `useDepositFlow`) that calls every EVM and Stellar hook
  unconditionally and returns a unified `StakeFlowState` selected by active chain
  and active tab. The route consumes only this adapter.
- Export the #633 Stellar staked hooks from `packages/frontend/src/wallet/index.ts`
  (they exist but are **not yet exported** — see Assumptions).
- Stellar step model on the page:
  - **Step 1 — trustline.** "Enable sPLUSD" (Stake tab) / "Enable PLUSD" (Unstake
    tab), reusing the #604 trustline UI slot (same StepsCard row shape as the
    deposit page Stellar steps). Shown already-complete when the trustline exists.
    Stake uses `useStellarChangeTrustStakedPlusd` (sPLUSD share trustline); Unstake
    uses `useChangeTrust` (PLUSD trustline, the same hook the deposit flow uses).
  - **Step 2 — stake/unstake** (single signature). No claim, no voucher.
- Exchange-rate / conversion card: read share price from the Stellar convert hooks
  (`useStellarStakeConvertToShares` / `useStellarUnstakeConvertToAssets`) at SAC
  7-decimal scale; do not regress the #540 combined card / #541 decimals.
- Network fee row on Stellar: Soroban simulation resource fee in XLM (see Open
  Questions on the USD claim). Requires extending `useStellarNetworkFeeEstimate` to
  support `"stake" | "unstake"` directions (today it only supports
  `"deposit" | "withdraw"`).
- Chain-keyed token decimals (7 on Stellar, 18 on EVM convert scale), asset labels
  (PLUSD / sPLUSD), and balances.
- Reset amount + write-surfaces and invalidate/refetch on chain switch so no EVM
  data lingers in a Stellar view and vice-versa (mirror the `prevKindRef` pattern
  in `deposit.tsx`).
- Toasts scoped per chain+tab (mirror the deposit page toast-id scoping) — optional
  but recommended for parity; see Open Questions.
- User-stories doc per ISSUE_PROTOCOL §6 at
  `docs/user-stories/epic-531/634-stellar-stake-chain-aware-wiring.md`, linked from
  `docs/user-stories/index.md`.

Out of scope (per Issue):

- Backend/indexer awareness (staking is pure on-chain — no voucher/claim).
- Any new on-page network-selector UI — the switch is the existing TopBar pill /
  account dropdown only.
- Changes to the #633 hook internals beyond exporting them (and the fee-hook
  direction extension, which is page-support glue, not a vault-hook change).

## Assumptions and Risks

- **#633 is merged** (confirmed: PR #637, per issue comment 2026-06-18). The hooks
  `useStellarStake`, `useStellarUnstake`, `useStellarStakeConvertToShares`,
  `useStellarUnstakeConvertToAssets`, `useStellarStakedPlusdBalance`,
  `useStellarStakedPlusdAsset`, and `useStellarChangeTrustStakedPlusd` live in
  `packages/frontend/src/wallet/stellar/useStellarStakedPlusd.ts`.
- **Export gap (must fix first).** None of the #633 Stellar staked hooks are
  currently re-exported from `packages/frontend/src/wallet/index.ts`. The adapter
  imports everything from `@/wallet`, so Step 1 of implementation is adding these
  exports (function + types). Without this the adapter will not compile.
- **Fee-hook direction gap.** `useStellarNetworkFeeEstimate` only accepts
  `"deposit" | "withdraw"` and builds the fee from the deposit-manager /
  withdrawal-queue clients. Stake/unstake need a representative
  `FungibleVault.deposit` / `redeem` simulation. The `StakedPlusdClient`
  (`contracts/stakedPlusd.ts`) exposes `buildDeposit` / `buildRedeem`; the hook
  must be extended to assemble those for the new directions and extract the fee
  the same way (`formatFeeXlm`). New mock keys
  `pipeline.mock.wallet.stellar.networkFeeEstimate.stake` / `.unstake` follow the
  existing pattern.
- **Convert-scale parity.** The EVM page hard-codes `CONVERT_DECIMALS = 18` because
  the EVM convert mock is 1e18-scaled. The Stellar convert hooks are SAC 1e7-scaled
  (documented in `useStellarStakedPlusd.ts`). The adapter must format Stellar
  convert outputs at 7 dp, not 18 — getting this wrong reproduces the #541
  off-by-powers-of-ten bug. Decimals must be chain-keyed, not a single constant.
- **No claim/voucher on Stellar staking.** Unlike the deposit flow, staking has no
  step 3. The Stellar StepsCard renders exactly two rows (trustline + stake/unstake);
  the EVM Stake tab keeps two rows (approve + stake) and EVM Unstake keeps one row.
  The route must branch the StepsCard shape by `(isStellar, tab)`.
- **Unstake delivers PLUSD.** Redeem reverts if the receiver lacks a PLUSD
  trustline. The Unstake-tab trustline step must use the PLUSD `useChangeTrust`
  hook (deposit flow already surfaces PLUSD trustline state), not the sPLUSD one.
- **Rules of Hooks.** All EVM + Stellar hooks must be called unconditionally inside
  `useStakeFlow`, then selected — exactly as `useDepositFlow` does. The existing
  `stake.tsx` already calls EVM hooks unconditionally; preserving that discipline
  through the adapter avoids conditional-hook regressions.
- **Test mock parity.** `stake.test.tsx` is EVM-only and mocks wagmi at the module
  level. New Stellar coverage should follow the `deposit.test.tsx` Stellar pattern
  (localStorage `pipeline.mock.wallet.stellar.*` keys) rather than wagmi mocks. The
  `/test` scenarios file (`routes/test/-scenarios.ts`) should gain Stellar
  stake/unstake fixtures for manual + QA verification.
- **Risk: large component diff.** Folding all EVM + Stellar logic into the route
  inline would balloon `stake.tsx`. The adapter-hook approach (proven by #552) keeps
  the route thin and is the required pattern here.

## Open Questions

1. The Issue body says the network-fee row should match the `~0.00xx XLM ($y.yy)`
   format "from #542". This is inaccurate: #542 resolved to an **ETH-only** estimate
   (the page renders `~0.00042 ETH`, no USD), `useStellarNetworkFeeEstimate` resolved
   (its OQ2) to **XLM-only** with no USD conversion, and there is no XLM→USD price
   helper in the codebase. Plan assumes the Stellar fee row shows **`~0.00xx XLM`
   (no USD)** for parity with the existing deposit page. Confirm this is acceptable,
   or specify the USD price source if a `($y.yy)` suffix is genuinely required.
2. Toast emission: the deposit page emits chain/direction-scoped toasts for each
   step. The current stake page emits **no toasts**. Should the Stellar stake flow
   add toasts (trustline-enabled / staked / unstaked) for parity with deposit, or
   stay toast-free to match today's EVM stake page? Plan assumes **no new toasts**
   (match current stake page) unless told otherwise.

## Implementation Steps

1. **Export #633 hooks.** In `packages/frontend/src/wallet/index.ts`, re-export the
   Stellar staked hooks and their result types from
   `./stellar/useStellarStakedPlusd`: `useStellarStake`, `useStellarUnstake`,
   `useStellarStakeConvertToShares`, `useStellarUnstakeConvertToAssets`,
   `useStellarStakedPlusdBalance`, `useStellarStakedPlusdAsset`,
   `useStellarChangeTrustStakedPlusd` (+ `StellarStakeResult`,
   `StellarUnstakeResult`, `UseStellarConvertResult`,
   `UseStellarStakedPlusdBalanceResult`, `UseStellarChangeTrustStakedPlusdResult`).
   Update `packages/frontend/src/wallet/README.md` if it enumerates exports.

2. **Extend the Stellar fee hook.** In
   `packages/frontend/src/wallet/stellar/useStellarNetworkFeeEstimate.ts`:
   widen `StellarFeeDirection` to `"deposit" | "withdraw" | "stake" | "unstake"`;
   add `stake` / `unstake` mock keys; for the new directions select
   `stakedPlusdId` as the contract and assemble a representative
   `StakedPlusdClient.buildDeposit(address, REPRESENTATIVE_AMOUNT, address, src)` /
   `buildRedeem(...)` to extract the fee via the same `formatFeeXlm` path. Add a
   unit test mirroring the existing deposit/withdraw fee tests.

3. **Create the adapter** `packages/frontend/src/wallet/useStakeFlow.ts`
   (mirror `useDepositFlow.ts`):
   - Signature: `useStakeFlow(tab: "stake" | "unstake", amountBig: bigint,
     setAmountInput: (v: string) => void): StakeFlowState`.
   - Call **all** hooks unconditionally:
     - EVM: `useEvmWallet`, `useStakedPlusdAsset`, `useEvmToken` (PLUSD w/ vault
       spender, and sPLUSD no-spender), `useStake`, `useUnstake`,
       `useStakedPlusdConvertToShares`, `useStakedPlusdConvertToAssets`,
       `useNetworkFeeEstimate("stake")`, `useNetworkFeeEstimate("unstake")`.
     - Stellar: `useStellarWallet`, `useStellarStakedPlusdAsset`,
       `useStellarStake`, `useStellarUnstake`,
       `useStellarStakeConvertToShares`, `useStellarUnstakeConvertToAssets`,
       `useStellarStakedPlusdBalance` (sPLUSD balance), `useStellarSacToken` /
       `useStellarToken` for the PLUSD balance, `useStellarChangeTrustStakedPlusd`
       (sPLUSD trustline), `useChangeTrust` (PLUSD trustline),
       `useStellarNetworkFeeEstimate("stake")`, `useStellarNetworkFeeEstimate("unstake")`.
   - Define `StakeFlowState`: `isConnected`, `connect`, `address`, `decimals`,
     `convertDecimals` (18 EVM / 7 Stellar), `inputBalance`/`outputBalance`
     formatted strings, `balance` (raw bigint for chips), `isReady`, `hasBalance`,
     `previewOutputValue`, `exchangeRateText`, `networkFee`, `isInputDisabled`,
     `onQuickAmount`, refetch helper, and a `steps` descriptor.
   - Steps descriptor must encode the per-(chain,tab) shape:
     - EVM Stake: `[approve, stake]`.
     - EVM Unstake: `[unstake]`.
     - Stellar Stake: `[enableSplusdTrustline, stake]`.
     - Stellar Unstake: `[enablePlusdTrustline, unstake]`.
     Reuse the `StepInfo` shape (`label`, `actionLabel`, `state`, `loading`,
     `disabled`, `onAction`) from `useDepositFlow`. Derive trustline-step `state`
     = `success` when `!needsTrustline`, and gate the stake/unstake step on the
     trustline being present (mirror `bothTrustlinesReady`/`canStellarStep2`).
   - Stellar balance conversion: use `sacDisplayToRaw` for the PLUSD balance
     (Horizon decimal string) and the raw bigint from `useStellarStakedPlusdBalance`
     for sPLUSD; format with the 7-dp helper (mirror `formatStellarBalance`).
   - Preview + exchange-rate: select EVM convert (1e18) vs Stellar convert (1e7);
     format with the chain-keyed `convertDecimals`; keep the 4-dp truncation for the
     rate row (reuse `formatUnits4` logic). Stake rate row reads convert-to-shares
     (`1 PLUSD = x sPLUSD`); Unstake reads convert-to-assets (`1 sPLUSD = x PLUSD`).

4. **Rewrite `routes/stake.tsx` to consume the adapter.**
   - Read `useWalletView().kind`; pass `activeTab`, `amountBig`, `setAmountInput`
     into `useStakeFlow`.
   - Parse `amountBig` against the active chain decimals (two-pass `lastDecimals`
     pattern from `deposit.tsx` — Stellar is 7 dp, EVM convert is 18 but token
     balances are read at the token's own decimals; verify the parse decimals match
     the balance/amount comparison decimals to avoid a scale mismatch).
   - Reset `amountInput` + write surfaces on chain switch (`prevKindRef` effect).
   - Render the combined conversion card from adapter fields (token labels,
     balances, preview, exchange rate, network fee) — preserve the #540 single-card
     / #615 no-nested-border / #612 spacing layout.
   - Keep the wallet-disconnected yellow banner (Figma 1994-7280 / 1994-7226) gated
     on `!flow.isConnected`; the Connect button opens the shared `useConnectModal`.
   - Render the StepsCard with the adapter's `steps` array (length 1 or 2 depending
     on chain+tab). Keep stable `data-testid`s and add Stellar-specific ones
     (e.g. `stake-trustline-step`).
   - Refetch balances on stake/unstake success (mirror existing effects, routed
     through the adapter refetch helper).

5. **Add `/test` scenarios.** In `packages/frontend/src/routes/test/-scenarios.ts`
   add Stellar stake/unstake fixtures (connected Stellar wallet; sPLUSD trustline
   missing → present; PLUSD trustline missing → present on unstake; convert rates;
   stake/unstake mock hashes; fee mock keys). These back the user-stories doc and
   QA.

6. **Tests** (see Test Strategy).

7. **User-stories doc.** Create
   `docs/user-stories/epic-531/634-stellar-stake-chain-aware-wiring.md` covering the
   Stellar stake + unstake journeys for wallet-disconnected, init (connected, needs
   trustline), and approved (trustline present) states — desktop + mobile — plus EVM
   regression parity. Mirror the structure of
   `docs/user-stories/epic-498/552-stellar-deposit-withdraw-wiring.md`. Link it from
   `docs/user-stories/index.md`.

8. **Lint/build.** Run `npx tsx scripts/lint-docs.ts` (docs structure) and the
   frontend lint/build + unit tests.

## Test Strategy

- **Adapter unit/integration tests** in a new `routes/-stake.test.tsx` Stellar block
  (or a dedicated `useStakeFlow` test) using the `pipeline.mock.wallet.stellar.*`
  localStorage layer (follow `deposit.test.tsx`’s Stellar approach, not wagmi
  mocks):
  - Stellar Stake, wallet disconnected → yellow banner; no StepsCard.
  - Stellar Stake, connected, no sPLUSD trustline → step 1 "Enable sPLUSD" idle +
    enabled; step 2 "Stake" disabled until trustline present.
  - Stellar Stake, sPLUSD trustline present → step 1 shows Done; step 2 enabled;
    click → success via `stakedPlusd.stake` mock; sPLUSD/PLUSD balances refetch.
  - Stellar Unstake, connected, no PLUSD trustline → step 1 "Enable PLUSD"; step 2
    "Unstake" gated; with PLUSD trustline → Unstake enabled; click → success.
  - Exchange-rate row at 7-dp scale: convertToShares rate `"9600000"` →
    `1 PLUSD = 0.9600 sPLUSD`; convertToAssets rate `"10400000"` →
    `1 sPLUSD = 1.0400 PLUSD` (regression guard for #541 — must NOT be off by
    powers of ten).
  - Network-fee row shows mocked `~0.00xx XLM` on Stellar (stake + unstake keys);
    `—` when disconnected.
  - Chain switch (EVM → Stellar and back) clears the amount input and shows no
    stale EVM Done badge / EVM fee in the Stellar view.
- **EVM regression**: keep all existing `stake.test.tsx` assertions green (the
  default `useWalletView().kind` is EVM; behavior must be unchanged).
- **Fee-hook unit test** for the new `stake`/`unstake` directions (mock-key path +
  the assembled-fee path mirroring the deposit/withdraw tests).
- **Manual / QA** via `/test` scenarios on `http://localhost:3000/stake`: flip the
  TopBar pill to Stellar and verify the whole flow switches (steps, labels, decimals,
  fee, exchange rate) and flips back cleanly. Verify against the epic Figma states
  (disconnected 1994-7280, init 1497-95311, approved 1498-101158) desktop + mobile
  (mobile follows the deposit mobile design).

## Docs to Update

- `docs/user-stories/epic-531/634-stellar-stake-chain-aware-wiring.md` (new) +
  link in `docs/user-stories/index.md`.
- `packages/frontend/src/wallet/README.md` — document `useStakeFlow`, the new
  Stellar staked exports, and the extended `useStellarNetworkFeeEstimate` directions
  + mock keys (`pipeline.mock.wallet.stellar.networkFeeEstimate.stake` / `.unstake`).
- No product-spec change required: `docs/product-specs/staking.md` already describes
  the pure on-chain (no-voucher) staking model and the Stellar share-price sampling
  this plan wires to. No user-facing behavior changes beyond surfacing the existing
  spec on Stellar.
