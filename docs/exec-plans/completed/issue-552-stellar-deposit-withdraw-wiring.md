# Issue #552: [FE] [Stellar] Deposit/withdraw page: chain-aware wiring (steps, trustline, XLM fee, all states)

Source: https://github.com/eq-lab/pipeline/issues/552

## Scope

Make the deposit/withdraw page (`packages/frontend/src/routes/deposit.tsx`) react to the
active wallet view (`useWalletView().kind`, from `WalletViewContext`). When the TopBar pill /
account dropdown flips to **Stellar**, the entire page — token balances, min-deposit gate, step
state machine, network fee, chain info (decimals/asset labels), request history, and vouchers —
switches to the Stellar/Soroban stack built in #549/#550/#551. EVM remains the default and its
behavior must be unchanged (no regressions). Both directions (`?direction=deposit|withdraw`) get
the treatment.

The plan introduces a **thin chain-agnostic adapter** that both stacks implement, rather than
sprinkling `if (kind === "stellar")` through the 970-line component. The adapter is selected by
`kind` and exposes a single interface the render layer consumes.

**In scope**

- A per-chain "flow adapter" hook pair (EVM + Stellar) producing a unified shape: balances,
  decimals, min gate, step gates/states, action callbacks, request/voucher state, network fee
  string, amount parse/format helpers.
- Chain-aware data layer:
  - `useRequests` (`src/api/useRequests.ts`) must resolve the active chain's wallet address and
    send the backend chain dispatch param, with invalidate/refetch on view switch. (EVM history
    today; Stellar history reflects the Stellar account.)
  - Voucher hook selection: EVM (`useDepositVoucher`/`useWithdrawalVoucher`) vs Stellar
    (`useStellarDepositVoucher`/`useStellarWithdrawalVoucher`) by active view.
- Step model on Stellar: reuse the approve slot as the **trustline** step ("Enable PLUSD" for
  deposit, "Enable USDC" for withdraw) via `useChangeTrust` / `useStellarChangeTrustUsdc`;
  step 2 is the single-signature request; step 3 is claim. Already-complete when trustline exists.
- New **Stellar network-fee hook** (Soroban simulation resource fee in XLM + USD conversion),
  matching the `~0.00xx XLM ($y.yy)` format referenced from #506/#542.
- Chain info: 7-decimal Stellar amounts (`SAC_DECIMALS`), asset labels (PLUSD/USDC) keyed off
  the active view; keep the existing $1,000 frontend min-deposit rule (Soroban enforces none).
- All epic Figma states on Stellar: init, in-progress, claim-ready, below-minimum,
  wallet-not-connected — desktop + mobile.
- A user-stories doc per ISSUE_PROTOCOL §6 + index link.

**Out of scope**

- Backend voucher/indexing work (separate backend sub-issue). The page may rely on the dev-only
  verifier signer on testnet, and on the existing Stellar voucher mock keys, until then.
- `staked_pl_usd` vault / Stake page (different epic).
- Any new on-page network selector UI — the switch is the existing TopBar pill / dropdown.
- Stellar Stake/Unstake request types in `useRequests` (Deposit/Withdraw only here).

## Assumptions and Risks

- **`useRequests` Stellar source.** The issue says `useRequests` must switch to the active chain's
  wallet + backend chain dispatch. The backend `/v1/requests` chain-aware support is part of the
  out-of-scope backend sub-issue. For Stellar the on-chain read hooks
  (`useStellarDepositRequest` / `useStellarWithdrawalRequest`, returning `{ claimed, ... }`) already
  provide the request lifecycle needed to drive the steps. **Assumption:** on the Stellar branch we
  drive the step state machine from the on-chain read hooks + localStorage in-flight recovery
  (`readInflightDeposit`/`readInflightWithdrawal`), and pass a `chain_id` to `useRequests` only so
  the EVM path keeps working and the Stellar history list (if/when the backend supports it) is not
  cross-contaminated. We do NOT block on backend `/v1/requests` chain support. See Open Questions.
- **Network fee accuracy.** Building a real Soroban resource-fee estimate requires simulating a
  representative `request_deposit`/`request_withdrawal` tx. This needs a connected address +
  configured contract. Risk: simulation latency/failure. Mitigation: mock key parity with the EVM
  fee hook (`pipeline.mock.wallet.stellar.networkFeeEstimate.{deposit,withdraw}`) and a graceful
  `undefined` → `"—"` fallback. XLM→USD conversion source must be identified (see Open Questions).
- **Rules of Hooks.** The component currently calls every EVM hook unconditionally. Adding Stellar
  hooks means both stacks' hooks run on every render regardless of `kind`. The adapter must keep all
  hook calls unconditional (inactive-chain hooks are disabled via their own `enabled`/`requestId
  === undefined` guards, as the existing EVM voucher pattern already does).
- **Stale data on switch.** Switching `kind` must not show EVM data in a Stellar view. Because the
  adapter selects an entirely different state object by `kind`, stale render is avoided structurally;
  React Query keys differ per chain so no manual invalidation is strictly required, but the amount
  input should reset on `kind` change (mirror the existing `onSwap` reset).
- **Component size.** `deposit.tsx` is already ~970 lines. Folding two stacks in risks an unreadable
  file. Mitigation: extract the adapter(s) into co-located hooks (e.g. `useDepositFlow.ts` under
  `src/routes/` as a component-local hook, allowed by FRONTEND code-structure rules) so the route
  body only consumes the unified shape.
- **Decimals divergence.** EVM USDC = 6 dp, Stellar SAC = 7 dp. `parseUsdc`/`formatUsdc` are called
  with an explicit `decimals` arg already, so the adapter must feed the active chain's decimals
  (`SAC_DECIMALS = 7` for Stellar). The $1,000 min must be expressed in the active decimals.
- **Mock parity.** Stellar mock keys exist for wallet, balances (`balance.sac.{usdc,plusd}`),
  contracts, request/claim/changeTrust, and vouchers. Net-new mock key needed only for the Stellar
  network fee.

## Open Questions

1. **`useRequests` Stellar history backend.** Confirm the intended source of Stellar request history
   for this sub-issue: drive steps purely from the on-chain `useStellarDeposit/WithdrawalRequest`
   read hooks + in-flight localStorage (recommended, backend-independent), OR also call
   `/v1/requests?wallet=<G…>&chain_id=<stellarChainId>` now (depends on the out-of-scope backend
   change). The body lists the API change but the backend support is explicitly out of scope.
2. **XLM→USD price source for the network fee.** Is there an existing price feed / hook the
   frontend may use for the XLM→USD conversion (to render `($y.yy)`), or should the Stellar fee hook
   reuse a Blend/oracle read? `useNetworkFeeEstimate` (EVM) renders ETH-only with no USD per its
   doc note (#506) — but #552 explicitly asks for `XLM ($y.yy)`. Need the conversion source.
3. **Explorer links.** The issue lists "explorer links ... key off the active network" under chain
   info, but the current deposit page renders no explorer link (only the Transactions page might).
   Confirm whether this sub-issue must add explorer links to the deposit page, or whether
   "chain info" here means only decimals + asset labels (explorer links handled wherever they
   already render). No Stellar explorer URL constant exists in `chain.ts` today.

## Implementation Steps

1. [x] **Add a Stellar network-fee hook.** Create
   `packages/frontend/src/wallet/stellar/useStellarNetworkFeeEstimate.ts` exposing
   `useStellarNetworkFeeEstimate(direction: "deposit" | "withdraw"): { feeXlm: string | undefined }`
   (string formatted `~0.00xx XLM`, no USD conversion per OQ2 resolution). Simulate a representative
   `request_deposit`/`request_withdrawal` via the existing contract clients
   (`DepositManagerClient.buildRequestDeposit` / `WithdrawalQueueClient.buildRequestWithdrawal`) to
   read fee from assembled tx (in stroops), convert to XLM, and format. Mock keys:
   `pipeline.mock.wallet.stellar.networkFeeEstimate.{deposit,withdraw}`. Disconnected/unconfigured →
   `undefined`. Export from `src/wallet/index.ts`. Unit tests added in
   `useStellarNetworkFeeEstimate.test.tsx`.

2. [x] **Make `useRequests` chain-aware** (`src/api/useRequests.ts`). Read the active view via
   `useWalletView()`; select EVM (`useEvmWallet`) vs Stellar (`useStellarWallet`) address. Per OQ1
   resolution: address-only switch (no `chain_id` param added). EVM path unchanged. Updated
   `src/api/useRequests.test.tsx` with 3 Stellar-view tests.

3. [x] **Build the chain-agnostic flow adapter.** `src/wallet/useDepositFlow.ts` — single
   `useDepositFlow(direction, amountBig, setAmountInput)` function that calls ALL hooks
   unconditionally and returns `FlowState`. Exported via `src/wallet/index.ts`.
   - `decimals`, `formattedBalance`, `balance`, `minDeposit`
   - `meetsMin` / `hasBalance`
   - step 1/2/3 (`StepInfo` with label, actionLabel, state, loading, disabled, onAction)
   - `step1Tx/step2Tx/step3Tx` (`StepTxState`) for toast emission
   - `requestId`, `requestIsConfirmed`, `isPendingVerification`
   - `networkFee` string
   - `isAnyTxInFlight`, `isInputFaded`, `isAmountLocked`, `lockedAmountRaw`, quick-amount handler
   - `isManagerUnreachable`, `isManagerLoading`, `connect`, `address`, `isConnected`
   All inner hooks called unconditionally; inactive-direction/chain hooks disabled via existing
   guards. Branches by `useWalletView().kind`.

4. [x] **Refactor `deposit.tsx` to consume the adapter.** Replaced direct EVM hook calls with
   `useDepositFlow`. Render (ConversionCard, banners, StepsCard) reads only from `FlowState`.
   Stellar step 1 labels: "Enable PLUSD" (deposit) / "Enable USDC" (withdraw). Reset `amountInput`
   on chain switch via `prevKindRef`. Stellar-equivalent toasts scoped per chain+direction.

5. [x] **Chain info wiring.** `SAC_DECIMALS = 7` fed to `formatUsdc`/`parseUsdc` calls and token
   labels via adapter. Explorer links: out of scope per OQ3 resolution.

6. [x] **Min-deposit on Stellar.** Frontend $1,000 rule: `STELLAR_MIN_DEPOSIT = 1_000n * 10n ** 7n`
   (`10_000_000_000n`). Used for below-min banner and Min quick-amount chip.

7. [x] **State coverage.** All states wired: init, in-progress (request pending via
   `useStellarDepositRequest`/`useStellarWithdrawalRequest`), claim-ready (voucher data),
   below-minimum, wallet-not-connected (Stellar connect() in banner).

8. [x] **Update the wallet/api catalogues.** Updated `docs/frontend/hooks.md` with
   `useStellarNetworkFeeEstimate`. Updated `src/api/README.md` with Stellar fee mock key and
   `useRequests` chain-awareness note.

9. [x] **Lint & build.** Doc lint: 0 errors. TS typecheck: 0 errors. Vitest: 21 pre-existing
   failures only (AccountDropdown + useStellarWithdrawalQueue), all new tests pass.

## Test Strategy

- **Unit (Vitest + RTL):**
  - `useStellarNetworkFeeEstimate.test.ts` — mock-key fast path returns formatted string;
    disconnected/unconfigured returns `undefined`.
  - `useRequests.test.tsx` — EVM path unchanged (no `chain_id`); Stellar view selects the Stellar
    address / `chain_id` (or, per OQ1, asserts the on-chain-read decision).
  - Adapter hook tests (`useDepositFlow`-style) for both chains: step gating (trustline needed vs
    satisfied, request, claim), min gate, decimals (6 vs 7), input-faded/locked transitions.
- **Component tests for `deposit.tsx`:** with `WalletViewProvider` set to `stellar` + Stellar mock
  keys (wallet, `balance.sac.{usdc,plusd}`, contracts, request/claim/changeTrust, voucher), assert:
  step 1 reads "Enable PLUSD"/"Enable USDC" and is `success` when trustline exists / actionable when
  not; step 2/3 progress through mock; below-min banner shows under $1,000; connect banner when
  disconnected. Flip `kind` evm↔stellar and assert no stale data + amount reset. Keep/extend the
  existing EVM deposit/withdraw tests to prove no regression.
- **Manual / Figma verification (testnet):** with a Stellar wallet connected, run full deposit and
  withdraw journeys through the real contracts (relying on the dev verifier signer for vouchers);
  verify against the epic #498 Figma states on desktop + mobile. Confirm EVM journeys are unchanged.
- Figma references (from issue + #498 body): deposit `node-id=1498-100812`, withdraw
  `1498-100351`, swap `1498-100157`, wallet-not-connected `1994-6885` — verify Stellar renders match.

## Docs to Update

- `docs/user-stories/epic-498/552-stellar-deposit-withdraw-wiring.md` — new user-stories doc covering
  Stellar deposit + withdraw journeys (trustline step, request, claim), state coverage (init,
  in-progress, claim-ready, below-min, disconnected), network switch (evm↔stellar, no stale data),
  desktop + mobile. Link it from `docs/user-stories/index.md`.
- `docs/frontend/hooks.md` — add `useStellarNetworkFeeEstimate` (and any new shared adapter util/hook
  that is genuinely reused, not component-local).
- `src/api/README.md` — document the new Stellar network-fee mock key if added there, and any
  `useRequests` chain_id behavior change.
- No product-spec change expected (no new product behavior beyond what epic #498 already specifies);
  confirm during implementation.
