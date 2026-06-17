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

1. **Add a Stellar network-fee hook.** Create
   `packages/frontend/src/wallet/stellar/useStellarNetworkFeeEstimate.ts` exposing
   `useStellarNetworkFeeEstimate(direction: "deposit" | "withdraw"): { feeXlm: string | undefined }`
   (string already formatted `~0.00xx XLM ($y.yy)`). Simulate a representative
   `request_deposit`/`request_withdrawal` via the existing contract clients
   (`DepositManagerClient.buildRequestDeposit` / `WithdrawalQueueClient.buildRequestWithdrawal`) to
   read `minResourceFee`/sim cost, convert XLM→USD (per Open Question 2), and format. Mock keys:
   `pipeline.mock.wallet.stellar.networkFeeEstimate.{deposit,withdraw}`. Disconnected/unconfigured →
   `undefined`. Export from `src/wallet/index.ts`. Add a unit test.

2. **Make `useRequests` chain-aware** (`src/api/useRequests.ts`). Read the active view via
   `useWalletView()`; select EVM (`useEvmWallet`) vs Stellar (`useStellarWallet`) address; include
   `chain_id` in the query path and the query key when on Stellar (EVM path unchanged: no
   `chain_id`, matching `useDepositVoucher`). Keep the mock-version external store. Update
   `src/api/useRequests.test.tsx`. (Pending Open Question 1, the Stellar branch may instead be left
   to the on-chain read hooks; reflect the decision here.)

3. **Build the chain-agnostic flow adapter.** Add adapter hooks under `src/wallet/` (e.g.
   `src/wallet/useDepositFlow.ts`, exported via `src/wallet/index.ts`) — one EVM adapter, one
   Stellar adapter — each returning a unified `FlowState`. Placing them in `src/wallet/` respects
   the ESLint `no-restricted-imports` boundary (`@tanstack/react-query`, wagmi/viem, and
   `@stellar/stellar-sdk` are only importable from `src/wallet/**`; the adapter composes existing
   `@/wallet` + `@/api` hooks but lives on the safe side of the boundary regardless):
   - `decimals`, `formattedBalance`, `balance`, `minAmount`
   - `meetsMin` / `hasBalance` / `canAct`
   - step 1 (`label`, `actionLabel`, `state`, `loading`, `disabled`, `onAction`) = approve (EVM) /
     trustline (Stellar via `useChangeTrust` deposit, `useStellarChangeTrustUsdc` withdraw;
     `needsTrustline` → `state: "idle"`, else `"success"`)
   - step 2 = request (EVM `useRequestDeposit/Withdrawal`; Stellar `useStellarRequestDeposit/Withdrawal`)
   - step 3 = claim (EVM `useClaim/ClaimWithdrawal`; Stellar `useStellarClaim/ClaimWithdrawal`, passing
     `voucher.signatureBytes`)
   - `requestId`, `requestIsConfirmed`, `isPendingVerification`/claim-ready
   - `voucher` (EVM vs Stellar voucher hook)
   - `networkFee` string
   - `isAnyTxInFlight`, `isInputFaded`, `isAmountLocked`, quick-amount handler
   All inner hooks called unconditionally; inactive-direction/chain hooks disabled via existing
   guards. A top-level selector picks the EVM or Stellar adapter by `useWalletView().kind`.

4. **Refactor `deposit.tsx` to consume the adapter.** Replace the direct EVM hook calls and the
   `isDeposit ? ... : ...` derivations with the unified `FlowState`. The render (ConversionCard,
   banners, StepsCard) reads only from `FlowState`. Stellar step labels: "Enable PLUSD" (deposit) /
   "Enable USDC" (withdraw) for step 1; keep "Confirm…"/"Claim…" labels per chain/direction.
   Connect-wallet banner Connect button calls the active chain's `connect()`. Reset `amountInput` on
   `kind` change (extend the existing `onSwap` reset to also fire on view switch). Preserve all EVM
   toast ids/behavior; add Stellar-equivalent toasts (trustline / request / claim) scoped per
   chain+direction so they don't collide.

5. **Chain info wiring.** Feed `SAC_DECIMALS` (7) on Stellar to `parseUsdc`/`formatUsdc` calls and
   token labels via the adapter. Keep the $1,000 min expressed in active decimals. (Explorer links
   per Open Question 3.)

6. **Min-deposit on Stellar.** Soroban enforces no on-chain min; the adapter supplies the frontend
   $1,000 rule (`1000 * 10**7`) for the below-min banner + Min quick-amount chip.

7. **State coverage.** Verify each Figma state renders on Stellar: init, in-progress (request
   pending / PendingVerification analogue from on-chain read), claim-ready (voucher ready),
   below-minimum, wallet-not-connected, and a clear error when the account cannot cover the
   trustline base reserve / XLM fee (surface via the changeTrust hook `error`).

8. **Update the wallet/api catalogues.** Add the new fee hook to `docs/frontend/hooks.md`
   (and any new util). Update `src/api/README.md` if a new Stellar fee mock key is documented there.

9. **Lint & build.** Run `npx tsx scripts/lint-docs.ts` and the frontend lint/typecheck/build.

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
