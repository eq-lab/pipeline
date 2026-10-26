# Wallet flows

Architecture and behavior specs for the chain-agnostic deposit / withdraw / stake flows in
`packages/frontend/src/wallet/**`. This is the home for flow-shape knowledge that previously lived
as file-header docblocks inside the hooks — see [`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

The source hooks carry only code-level comments plus a one-line pointer back to the relevant
section here.

> **Migration status** ([issue #991](https://github.com/eq-lab/pipeline/issues/991), sub-issue #995):
> the deposit/withdraw and stake/unstake adapters below are migrated. The lower-level EVM and
> Stellar integration hooks are scaffolds pending the rest of #995. Do not delete a source comment
> until its content lives in a section here.

## Deposit / withdraw adapter (`useDepositFlow`)

**Source:** `packages/frontend/src/wallet/useDepositFlow.ts`
**Consumer:** the deposit/withdraw route, `packages/frontend/src/routes/deposit.tsx`.

A chain-agnostic adapter that exposes a single `FlowState` shape so the route never calls
EVM- or Stellar-specific hooks directly.

### Architecture

All hooks — both EVM and Stellar, both deposit and withdraw directions — are called
**unconditionally** inside `useDepositFlow` (this is required by the Rules of Hooks; the original
`deposit.tsx` likewise called both directions unconditionally and branched by direction). Inactive
chain/direction hooks disable themselves via their own `enabled` / `requestId === undefined` guards.
At the end the hook selects the active-chain, active-direction values and returns them as
`FlowState`.

### The `FlowState` contract

- The component reads **only** from `FlowState`; all chain-specific detail is hidden inside the hook.
- Per-step toast-state helpers (`step1Tx`, `step2Tx`, `step3Tx`, each `{ isPending, isSuccess,
  error }`) are included so the component can emit toasts without knowing which chain is active.
- `amountBig` is passed **in** from the component (parsed from the text input); the hook does not own
  the input.

### Design choices & invariants

- **Stellar balance scale.** Stellar balances arrive from Horizon as human-decimal strings (e.g.
  `"1.5"`) and are converted to `bigint` at 7 dp (`sacDisplayToRaw`) for amount comparisons.
- **Trustline array invariant.** `FlowState.trustlines` is always `[PLUSD (index 0), USDC (index 1)]`
  on Stellar — both rendered as steps inside the `StepsCard` regardless of direction — and always
  `[]` on EVM (no trustline UI). The **display** order is independent of the array index order:
  the `StepsCard` renders "Enable USDC" first, then "Enable PLUSD" (#1131).
- **USDC balance source.** On Stellar the deposit input balance comes from `useStellarToken` — the
  *same* source as the TopBar wallet pill — so the deposit page's balance check can never disagree
  with the header. (The SAC hook reads a separate mock key / issuer and would diverge, surfacing a
  false "Add funds" banner when the user actually holds USDC.)
- **Post-changeTrust trustline poll (#1127, supersedes the single #662 refetch).** After a
  successful `changeTrust` submit, the real path runs a bounded poll —
  `pollTrustlineUntilPresent` (`packages/frontend/src/wallet/stellar/pollTrustline.ts`), 8
  attempts × 1.5 s — re-querying the trustline until `hasTrustline` flips, because Horizon's
  `/accounts` endpoint can lag its own transaction-submission response and a single immediate
  refetch often still returns the stale "no trustline". Applies to all three changeTrust hooks
  (PLUSD, USDC, sPLUSD). The step's `isSuccess` flips immediately on tx success; only the
  needs-trustline banner waits for the poll. If Horizon lags past the ~12 s budget, the UI falls
  back to the 30 s background `refetchInterval`. Mock fast-paths keep a single refetch call.

### Business rules

- **Minimum deposit comes from the contract on both chains (#1658).** Stellar reads Soroban
  `min_deposit()` (i128) through `useStellarDepositManagerMinDeposit`, EVM reads `minDeposit()`
  through `useDepositManagerMinDeposit`; both are read once per page lifetime. The frontend owns no
  minimum value. (History: #598 lowered the old hard-coded value to $1; #641 restored $1,000; #1658
  removed it.) Gating is undefined-safe on both chains: until the read resolves `isReady`,
  `meetsMin` and `hasBalance` are not true, Confirm is disabled, the Min chip is a no-op and
  `minChipLabel` is `"Min"`. A stale cached minimum surfaces as a contract revert through the
  normal tx error path.
- **Both trustlines before Confirm.** On Stellar, both the PLUSD and USDC trustlines must be present
  before the Confirm step can proceed (per issue #604, Q3).
- **Amount never exceeds the balance (#1628).** Every direction of both flows — deposit included —
  gates its step CTAs on `amountBig <= balance` and exposes `exceedsBalance` so the page renders an
  `InlineError` "Insufficient balance" under the input while the typed amount is over the live
  balance (never while the amount is locked to an in-flight request). Quick-amount chips write
  `formatUsdcInput` (viem `formatUnits`, exact, no grouping, no 2-dp rounding) so **Max equals
  the balance to the last base unit** on 6-, 7- and 18-dp tokens, and 25/50/75% are computed in
  base units with BigInt floor division, so they can never round above the balance. The Min and
  `$5,000` / `$10,000` deposit chips are not clamped: a chip above the balance simply trips the
  insufficient-balance gate.

### EVM token decimals

EVM PLUSD and sPLUSD are **6-decimal** tokens (`PipelineUSD.sol`; the ERC-4626 vault has no
decimals offset) — never 18, never hard-coded (#1627). Every EVM scale comes from the token's
`decimals()` read: `useEvmToken(...).decimals` where the token is already mounted (home route,
stake flow), or `useEvmStakeDecimals()` (`@/wallet`, `{ plusd, splusd }`, each `undefined` while
loading) for consumers that only need the scale — `HomeStatsStrip`, `RecentActivityCard` and the
Transactions page pass it into `renderRequestRow` (assets at `plusd`, shares at `splusd`).
While a scale is still `undefined` the display helpers render their empty value (`isDisplayZero`
→ `true`, `formatBigintCurrency` → `$0.00`, `formatTokenAmount` → `—`, `buildSeries` → `null`)
instead of mis-scaling. Request amounts from `/v1/requests` are at the same token decimals.
Mocks (`/test` scenarios and route tests) seed `6`.

### XLM funding rule

`FlowState.needsXlmFunding` / `StakeFlowState.needsXlmFunding` (#1196, #1130): `true` when the
connected Stellar account cannot pay Stellar network fees, in which case every step CTA (trustline
enable, confirm, claim, stake, unstake) would fail — the page replaces the StepsCard with the
no-XLM banner (see
[`dashboard-components.md` § banner precedence](./dashboard-components.md#deposit-and-withdraw-route)).
Always `false` on EVM.

- **Source.** `useStellarXlmBalance` reads the `native` balance line from Horizon `loadAccount`.
  Unlike the token hooks, a Horizon 404 is **not** folded into "zero / no trustline" — it is
  surfaced as `accountExists: false`, the unfunded-account discriminator #1130 asked for (an
  account absent from the ledger cannot hold trustlines at all; `changeTrust` fails at
  `loadAccount`).
- **Trigger.** Zero-or-unfunded, resolved-only: `accountExists === false`, or the resolved
  `xlmBalance` parses to `0`. A still-loading (undefined) balance never triggers, so the banner
  cannot flash during initial load; the XLM query's first load also joins `isDataPending`.
- **Deliberately not fee-compared.** The rule does not compare against the fee estimate: a
  nonzero-but-below-fee XLM balance is a negligible edge (fees are ~0.00001–0.005 XLM) and the fee
  simulation itself cannot run against an unfunded source account. Reserve-aware math (trustline
  base reserve) is out of scope — see the tech-debt tracker if ever needed.
- **Mock key.** `pipeline.mock.wallet.stellar.balance.xlm` (human-decimal string; reports
  `accountExists: true`).

### Request state model

- **Active request.** The active request is the most recent `Deposit`/`Withdraw` in
  `PendingVerification` or `PendingClaim`; it locks the amount input and drives step gating.
- **Completed-deposit reset (fires once).** When the latest deposit settles to `Completed` (and no
  newer `Pending*` exists), the hook raises `isDepositCompleted` so the page resets the form to its
  initial state — there is no terminal "done" layout. The signal is gated by
  `depositCompletedRequestId` / `dismissedDepositRequestId` so the reset fires exactly once per
  completed deposit. The completed request is tracked separately from the active set (a claimed
  request drops out of the active filter); waiting for it to clear avoids re-enabling Claim during
  the API's `PendingClaim` lag.
- **Stellar recovery (API may be empty).** Until the backend request-list sub-issue lands, the
  Stellar API list can be empty, so steps are driven from **on-chain reads + a `localStorage`
  in-flight record**. The in-flight record is written when `request_deposit` succeeds and is only
  cleared by a successful claim through this browser. If the request was claimed any other way
  (different device, the API `Completed` reset, …) the record would linger and pin the form as
  "confirmed" forever. To prevent that, when the on-chain request reads back as already claimed the
  record is treated as inactive (`*InflightActive`) and physically cleared. A claimed request is
  terminal, so this reconciliation never races a genuinely in-flight one.
- **EVM request id from the receipt (#1658).** `useRequestDeposit` / `useRequestWithdrawal` decode
  `requestId` (and `queued` for withdrawals) from the mined receipt's `DepositRequested` /
  `WithdrawalRequested` event, keeping only logs emitted by the configured contract for the
  connected wallet.
- **Request list refresh (#1658).** Each request mutation's `isSuccess` rising edge (EVM and
  Stellar, deposit and withdraw) invalidates every `["requests"]` query through
  `useInvalidateRequests`. While a known request id (mutation result or in-flight record) is not
  yet listed by `/v1/requests`, the list polls every 5 s instead of 60 s.
- **EVM in-flight record (reload guard, #1658).** After the receipt is decoded, the amount, tx hash
  and request id are persisted under `pipeline.evm.<deposit|withdraw>.inflight.<chainId>.<address>`
  (a recovery record, never a stand-in for API data). Until `/v1/requests` lists that id, the flow
  treats it as an active request: `requestIsConfirmed`, `isPendingVerification`, `isAmountLocked`
  and `step2.loading` are true, `lockedAmountRaw` is the recorded amount, and approve and confirm
  are disabled, so a reload cannot start a second request. Once the API lists the id (any
  status) the record is cleared and the API drives state; a successful claim also clears it.
- **PLUSD authorization window.** When the PLUSD trustline exists but the issuer has not yet
  authorized it, Claim is blocked (it would fail with "balance is deauthorized", contract error
  #11) and the step label reads "Claim your PLUSD — awaiting authorization".
- **Voucher polling stop rule (#313).** All four voucher hooks (EVM + Stellar, deposit +
  withdrawal) poll every 3 s while pending and share one classification
  (`api/voucherRetry.ts`): 404 "not found" / 403 "forbidden" / "not yet" states are retriable and
  keep polling (retry cap 20); any other error stops both `retry` and `refetchInterval`, settling
  the hook at `status: "failed"` instead of hitting the API every 3 s forever.
- **Claim voucher `deadline`.** The live on-chain `claim_request(request_id, verifier_signature,
  deadline)` shape (see #800) requires a `deadline`; a voucher missing or with a malformed deadline
  is not treated as claimable.

### Step model

Steps are labelled per (chain, direction):

| Step | EVM deposit | EVM withdraw | Stellar deposit | Stellar withdraw |
|------|-------------|--------------|-----------------|------------------|
| 1 | Approve USDC | Approve PLUSD | Enable PLUSD (trustline) | Enable USDC (trustline) |
| 2 | Confirm USDC transfer | Confirm PLUSD burn | Confirm USDC transfer | Confirm PLUSD burn |
| 3 | Claim PLUSD | Claim USDC | Claim PLUSD | Claim USDC |

### Terminal-success toasts and navigation (#1142)

Terminal success toasts carry the **action + amount** — "Staked 100.00 PLUSD" /
"Unstaked 25.50 sPLUSD" (stake step 2), "Deposited 1,000.00 USDC" / "Withdrawal of … PLUSD
submitted" (deposit/withdraw step 2), "+X PLUSD" / "Claimed X USDC" (claim step 3). The amount is
captured into a ref when the step's pending toast is shown (the routes clear `amountInput` on
success); the claim amount comes from `lockedAmountRaw`. Value-less fallback titles remain for
recovered in-flight requests whose ref is empty. After a **flow-terminal** success —
stake/unstake step 2, deposit/withdraw **claim** — the route navigates home (`/`); intermediate
steps (approve, trustline, request) never navigate. `ToastProvider` mounts above the router, so
the success toast survives the route change.

### Step error state

Added by #1024, after a failed `requestWithdrawal` left the stepper looking fully successful (the
burn had succeeded on-chain, so the backend indexed the request as `PendingClaim` and step 2 showed
its success check) while the only failure signal was a console error and a transient toast.

- `StepState` is `"idle" | "success" | "error"`. The request step (2) and claim step (3) derive
  `"error"` from their underlying mutation: `mutation.error` set and the mutation not pending. The
  success conditions **win over error** — if the backend/on-chain state says the step genuinely
  completed (e.g. the request is `PendingClaim`), the flow is recoverable and the step stays green.
- EVM step 1 (approve) derives `"error"` from `useEvmToken().approveError` (the approval hook's
  error only, never the balance / metadata read errors), not pending, and only when no success
  condition holds. `step1Tx.error` / `step1Tx.userError` carry it so the deposit route can raise the
  same danger toast with a Details action as the stake route (#1658).
- `StepInfo.errorMessage` carries the mutation's error message only while `state === "error"`.
  As of #1034 that message is **mapped, never raw**: `toUserError` supplies the short human line
  and the raw payload moves to `StepInfo.errorDetails`, shown only inside the details dialog —
  see [`error-handling.md`](./error-handling.md).
- Rendering (`@pipeline/ui` `StepRow`): the error state red-tints the numbered badge and shows the
  message as a red line under the label, but **keeps the action button** so the user can retry —
  unlike the success state, which replaces the button with the green check pill — positive-secondary fill, positive check (#1217, Figma 1498:100812; supersedes #1189's ink recolor). Error and loading
  rows always render at full opacity.

## Stake / unstake adapter (`useStakeFlow`)

**Source:** `packages/frontend/src/wallet/useStakeFlow.ts`
**Consumer:** the stake/unstake route, `packages/frontend/src/routes/stake.tsx`.

Mirrors `useDepositFlow`: a chain-agnostic adapter exposing a single `StakeFlowState` so the route
never calls chain-specific hooks directly.

As of #1034 the stake steps carry the same error state as the deposit stepper:
`StakeStepState` is `"idle" | "success" | "error"`, derived per
[Step error state](#step-error-state) (mutation error set and not pending; success wins), with the
mapped message in `errorMessage` and the raw payload in `errorDetails` — previously stake/unstake
failures were toast-only with no stepper signal.

### Architecture

All hooks (both EVM and Stellar, both stake and unstake tabs) are called **unconditionally**;
inactive-tab hooks disable themselves via `undefined` arguments. The hook selects the active-chain,
active-tab values and returns `StakeFlowState`. The component reads **only** from `StakeFlowState`;
`amountBig` is passed in from the component; `step1Tx` / `step2Tx` carry per-step toast state.

### Design choices

- **Convert scale is the output token's live decimals.** `convertDecimals` — the output scale of the
  convert/preview hooks — is the output token's `decimals()` on EVM (sPLUSD on Stake, PLUSD on
  Unstake; both 6, `undefined` while loading so the preview shows `0` and the rate `—`) and **7** on
  Stellar (`SAC_DECIMALS`). The "1 PLUSD" / "1 sPLUSD" rate inputs are `parseUnits("1", <input
  token decimals>)`. Exchange-rate rows are truncated (not rounded) to 4 dp. (#1627 — the former
  hard-coded 18 showed every EVM preview as 0.00.)
- **`stellarUsdcToken` is mounted but unused** in the stake flow — called only to satisfy the Rules
  of Hooks (`void stellarUsdcToken`).

### Steps shape by (chain, tab)

| Chain / tab | Steps (StepsCard rows) |
|-------------|------------------------|
| EVM stake | `[Approve PLUSD, Stake]` |
| EVM unstake | `[Unstake]` |
| Stellar stake | `[Enable sPLUSD (trustline), Stake]` — the Enable row is omitted entirely when `trustlineStatus === "not_required"` (#1198), leaving `[Stake]` numbered 1 |
| Stellar unstake | `[Enable PLUSD (trustline), Unstake]` |

### Trustline model

- **Stake** needs an **sPLUSD** trustline; **unstake** needs a **PLUSD** trustline (same as the
  deposit flow).
- The sPLUSD step uses the fail-safe `trustlineStatus` discriminator: "success" shows **only** when
  the trustline is confirmed `satisfied`. `not_required` (Soroban-native shares — no classic
  trustline exists to enable) still unblocks staking but **removes the Enable sPLUSD step from the
  card entirely** (#1198): a pre-completed check for an action the user can never perform is
  misleading. While the share asset is loading or errored, the step stays "idle" and staking is
  blocked — never a false-ready state.

## Single connected wallet

Issue #1512 (epic #1494), LP app only — `@pipeline/wallet-connect` (Trustee app) is unchanged.

- **One wallet at a time.** While an EVM or Stellar wallet is connected, no connect entry point for
  the other chain is offered: every connect CTA keys on the active `kind`'s wallet, and
  `ConnectModalProvider.open()` is a no-op while `useWalletPresence().isAnyConnected`. Nothing is
  auto-disconnected on connect; the LP disconnects, then connects again (the connect modal keeps its
  EVM / Soroban tabs for that choice).
- **`kind` is derived**, never stored: see [`hooks.md`](./hooks.md) (`useWalletView`). The
  `pipeline.wallet.view.kind` key and `setKind` no longer exist.
- **Legacy both-connected state.** If both kits come back connected (a session restored from before
  this change, or both `pipeline.mock.wallet.*` and `pipeline.mock.wallet.stellar.*` set), the app
  disconnects **both** once `useWalletPresence().isSettled` is true and leaves the LP disconnected to
  connect exactly one — no "stored kind wins" or "Stellar wins" rule. The cleanup also deletes the
  legacy `pipeline.wallet.view.kind` key. Real sessions are disconnected through each kit; for the
  mock layer, when both mock wallets are connected each reports disconnected and a one-time
  `console.warn` explains the conflict (see `packages/frontend/src/wallet/README.md`).

## Active chain for protocol reads

`useActiveChain()` (`wallet/useActiveChain.ts`, #1498) returns `{ kind, chainId }` for protocol-level
reads (stats, TVL, APY, the Protocol Dashboard, the home exchange rate). One rule, derived from the
connection flags so it holds whatever `useWalletView().kind` defaults to:

- EVM wallet connected → `evm`, `chainId = ENV.EVM_CHAIN_ID`.
- Stellar wallet connected → `stellar`, `chainId = ENV.STELLAR_CHAIN_ID`.
- No wallet connected → `stellar` (`ENV.STELLAR_CHAIN_ID`); the default stays Stellar until the
  backend serves chain-agnostic data for non-connected visitors.
- Both connected (a transient legacy state, see above) → `useWalletView().kind` breaks the tie.

Every protocol-stats API hook (`useStats`, `useDashboardSummary`, `useLoanBook`,
`useLoanSubmissions`, `useWithdrawalQueue`, `useFinancialPosition`, the TVL / yield history hooks)
takes `chainId` from its caller and includes it in its query key; none falls back to a Stellar
constant. The Protocol Dashboard reads the rule through `useDashboardChain`.

## Network switcher (cross-deployment links)

**Source:** `packages/wallet-connect/src/network/links.ts` (shared helpers); per-app glue in
`packages/frontend/src/wallet/networkSwitcher.ts` and `packages/trustee/src/lib/networkSwitcher.ts`.
**Consumers:** the LP `TopBar` (its always-visible `NetworkSwitcher` pill; the former
`AccountDropdown` menu row was deleted with the component in #1575); the trustee `TrusteeSidebar`'s
account chip and `⋯` `AccountMenu` popover.

### Design (issue #1032)

Each deployment (ArgoCD `test.yaml` / `prod.yaml`) is **single-network** — the existing flat env
vars (`VITE_STELLAR_NETWORK_PASSPHRASE`, contract IDs, RPC URLs, …) are set to one network's values
per environment, and testnet/mainnet live at **different origins** entirely. There is no runtime
config swap, no network store, no query re-keying, and no wallet-kit re-coordination — "switching
networks" means navigating to a sibling deployment's URL, and the separate origin naturally
isolates everything else (a fresh page load, a wallet that must reconnect on the new origin).

1. **Current-network identity** follows the active view (`useActiveChain().kind`, #1497). The
   Stellar view derives it from the deployment's own existing Stellar network passphrase — no new
   var needed for this half. The EVM view uses `networkIdFromEvmChainId(VITE_EVM_CHAIN_ID)` through
   the [chain registry](#chain-registry): chain `1` → `{ id: "mainnet", label: "Mainnet" }`, `560048`
   → `{ id: "testnet", label: "Testnet" }`, any other id → testnet-styled with the label
   `Chain <id>`. The mainnet gate (`isMainnetNetwork(kind)` / `useIsMainnetNetwork()`) follows the
   same view and drives the `HomeStatsStrip` TVL gate, the `TopBar` / `MobileNavMenu` Dashboard
   link and the `/dashboard` route guard. `networkIdFromPassphrase` maps
   `"Test SDF Network ; September 2015"` → `{ id: "testnet", label: "Testnet" }` and
   `"Public Global Stellar Network ; September 2015"` → `{ id: "mainnet", label: "Mainnet" }`.
   Any other passphrase (futurenet, standalone, …) is treated as **testnet-styled** (no
   real-funds affordance) but keeps the raw passphrase string as the visible label, since there is
   no canonical short name for it.
2. **Sibling links** come from one new env var, same name in both apps:
   `VITE_NETWORK_LINKS="mainnet=https://app.pipeline.one,testnet=https://pipeline.stage.eqlab.net"`
   (the trustee's yaml sets this to the dashboard's own sibling URLs instead). `parseNetworkLinks`
   parses it defensively — entries are `id=url`, comma-separated, order preserved; an entry missing
   `=`, an empty id/url, or a URL that fails to parse as absolute `http(s)` is dropped rather than
   thrown (an operator typo degrades the switcher, it does not break the app). A network absent
   from the var is simply not offered. **When the var is unset, or only the current network
   remains after excluding self, the switcher renders as a static network label with no menu** —
   this is the "hidden when unconfigured" behavior the issue requires, and it is also the default
   dev/local experience (the var defaults to the empty string).
3. **UI.** Both apps render the current network as an always-visible **pill** (tinted background,
   colored dot + network label) outside any menu, so the active network never requires opening a
   menu to see:
   - LP app: `TopBar`'s `topbar-network-badge` is the `NetworkSwitcher` component
     (`packages/frontend/src/components/NetworkSwitcher.tsx`). With siblings configured it is a
     button with a chevron that opens its own small popover (`topbar-network-menu`) listing
     "Switch to …" rows; with none it renders as a non-interactive pill. Chrome matches the
     restyled wallet chip (#1210, following #1185): 48 px tall, `--radius-pipeline-card` 4 px
     corners, **no border** — white surface on testnet, the amber `warning`/10 tint alone
     carrying the mainnet real-funds signal. (The LP `AccountDropdown`, which carried a second
     network row, was deleted in #1575.)
     Mounts (#1125): on desktop the pill lives **inside** `TopBar`'s wallet slot
     (`topbar-wallet-slot`, `min-w-40 justify-end gap-2`) so the gap to the wallet pill is a
     fixed 8px regardless of the balance's width; on mobile it renders as a "Network" row in
     `MobileNavMenu` (`mobile-network-switcher`) — the component itself carries no breakpoint
     classes, each mount owns visibility and spacing.
   - Trustee: the account chip's `trustee-network-badge` pill (white-tint for testnet, amber-tint
     for mainnet on the navy sidebar); switch rows live in the `⋯` `AccountMenu` popover above
     "Sign out".
   - The testnet pill dot is green (LP) / muted (menus); the mainnet dot uses the amber
     `--color-pipeline-warning` token rather than the literal brand navy, since a navy dot would
     be invisible against these apps' navy/dark-ink surfaces.
4. **Mainnet confirm.** Clicking a mainnet sibling link opens the shared styled
   `NetworkSwitchDialog` (`@pipeline/ui`) — real funds are at stake once you cross onto mainnet.
   The dialog states that the wallet must be reconnected on the other origin; Cancel/Escape/
   backdrop close without navigating. The gate is decided by `shouldConfirmNetworkSwitch(link)`
   (`@pipeline/wallet-connect`; true only for `mainnet`) — `window.confirm` is not used. Any other
   network navigates immediately via `navigateToNetworkLink` → `window.location.assign(url)` — a
   full-page, cross-origin navigation, so no in-app state carries over by design. The LP app wraps
   the pending-link state in `useNetworkSwitch()` (`packages/frontend/src/wallet/useNetworkSwitch.ts`);
   the trustee inlines the same two-state flow in `AccountMenu`.
5. **Shared vs. per-app.** The parsing/identity/navigate/gate logic (`parseNetworkLinks`,
   `networkIdFromPassphrase`, `networkIdFromEvmChainId`, `navigateToNetworkLink`, `shouldConfirmNetworkSwitch`) and the
   confirm dialog (`NetworkSwitchDialog`, `@pipeline/ui`) live once in shared packages so both
   apps run the same implementation. The thin composition that reads each app's own `ENV` and
   combines it with those helpers (`getNetworkSwitcherState`) is duplicated per app (mirrors the
   trustee/LP util-duplication precedent in `docs/frontend/utils.md` — the trustee app does not
   depend on `@pipeline/frontend`, epic #775) — each app's version is a handful of lines and is unit
   tested in place.

### Deployment note

`docker/frontend/entrypoint.sh` and `docker/trustee/entrypoint.sh` both pass `VITE_NETWORK_LINKS`
through to the runtime `window.__ENV__` injection. Operators must add the var to each environment's
ArgoCD values (`test.yaml` / `prod.yaml`) for the switcher to appear; an absent var is a safe
default (static label only), not an error.

## EVM integration

Hook behaviours of `packages/frontend/src/wallet/evm/**` against the deployed contracts
([evm-requests-queue.md](../product-specs/evm-requests-queue.md)), the chain registry and the
wrong-network rules.

### Hooks and contract surface

| Hook (`wallet/evm/`) | Calls |
| --- | --- |
| `useDepositManagerAddresses` / `useDepositManagerMinDeposit` | `plUsd()`, `usdc()`, `minDeposit()` on `VITE_DEPOSIT_MANAGER_ADDRESS`; read once per page lifetime (`CACHE_FOREVER`) |
| `useRequestDeposit` / `useClaim` | `requestDeposit(amount)`, `claimDeposit(requestId, verifierSignature)` |
| `useRequestWithdrawal` / `useClaimWithdrawal` | `requestWithdrawal(amount)`, `claimWithdrawal(requestId, verifierSignature)` on `VITE_WITHDRAWAL_QUEUE_ADDRESS` |
| `useStakedPlusd*`, `useStake` / `useUnstake` | ERC-4626 `asset`, `convertToShares`, `convertToAssets`, `deposit`, `redeem` on `VITE_STAKED_PLUSD_ADDRESS` |
| `useApproval({ token, spender })` / `useToken` | ERC-20 `allowance`, `approve`, `decimals`, `symbol`, `balanceOf` |

- **PLUSD / USDC addresses.** Both directions take them from the DepositManager (`plUsd()` /
  `usdc()`); the withdrawal queue's own accessors are not used.
- **Zero-address short-circuit.** When a configured contract address is the zero address, reads
  return `undefined` without an RPC call and writes fail with a "not configured" error (stake
  hooks: `StakedPLUSD not configured`; disconnected wallet: `Wallet not connected`).
- **Write return values.** `useWriteContract` resolves to a tx hash only, so the real path returns
  `{ hash }`; `amount` and `shares` are not decoded from the receipt. `useRequestDeposit` and
  `useRequestWithdrawal` additionally decode `requestId` (and `queued`) from the receipt's
  `DepositRequested(uint256 indexed requestId, address indexed user, uint256 amount)` /
  `WithdrawalRequested(address indexed withdrawer, uint256 indexed requestId, uint256 amount, uint256 queued)`
  event (#1658); the voucher API remains the source for claim.
- **Approval.** Deposit needs USDC approved to the DepositManager; withdraw needs PLUSD approved to
  the WithdrawalQueue; stake needs PLUSD approved to the vault; unstake needs none
  (steps: `[Approve, Request/Stake]` as in the step tables above).
- **Voucher.** `useDepositVoucher` / `useWithdrawalVoucher` call
  `GET /v1/{deposits|withdrawals}/{requestId}/voucher?wallet=&chain_id=ENV.EVM_CHAIN_ID`; the
  `signature` is passed unchanged to `claimDeposit` / `claimWithdrawal`. `deadline` is absent.

### Write pipeline

Every write runs `simulateOrFail` (`eth_call`) → `estimateGasCapped` → `writeContract`, and stops
at the first failure, surfacing it on the hook's `error`.

1. **Simulate.** Detects reverts with decoded custom-error names (some public RPCs, e.g. Hoodi
   `publicnode`, strip revert data from `eth_estimateGas` but not `eth_call`); missing client or
   account returns `RPC not ready` / `Wallet not connected`.
2. **Gas.** `estimateContractGas` plus a +20 % buffer (`gas * 12 / 10`), clamped to
   `EVM_TX_GAS_CAP = 16_777_215` (the chain's per-tx cap is `0x1000000`; viem's 21M fallback would
   be rejected before broadcast). The clamped value is passed as `gas`.
3. **Receipt.** `isPending` runs from broadcast until the receipt is mined; `isSuccess` is true only
   for receipt status `success`.

### Network fee estimate

`useNetworkFeeEstimate(direction)` returns a `~0.00053 ETH`-style string (5 decimals, ETH only) for
the representative call: deposit `requestDeposit(max(1000 USDC, minDeposit))`, withdraw
`requestWithdrawal(1000 PLUSD)`, stake `deposit(1000 PLUSD)`, unstake `redeem(1000 sPLUSD)`. It is
`estimateContractGas` (no `stateOverride`) with the +20 % buffer, unclamped, times live `gasPrice`.
On a revert (missing allowance or balance) it falls back to 250 000 / 180 000 / 200 000 / 200 000
gas (deposit / withdraw / stake / unstake). Disconnected, unconfigured or unresolved returns
`feeEth: undefined` (rendered `—`). Refreshes every 60 s. No USD figure (#506, #542).

### Terms acknowledgement

`useTermsAcknowledgement` gates AppKit `open()` per wallet address with the jurisdiction
self-attestation. State is `localStorage["pipeline.wallet.termsAcknowledged.<address>"] === "true"`;
other tabs sync through the `storage` event, the current tab updates directly in `acknowledge()`.
`readTermsAcknowledged(address)` is the non-hook variant for event handlers (`useWallet.connect()`).

### Mock layer

Dev-only overrides under `localStorage` keys `pipeline.mock.wallet.*`; a present key skips the real
wagmi / viem call. Reads are reactive (`useMock`); write hooks read the key at call time. Precedence
for contract reads: named alias (`…contract.depositManager.*`, `…withdrawalQueue.*`,
`…stakedPlusd.*`), then generic `…contract.<address>.<fn>`, then zero-address short-circuit, then
real calls. Keys: `address`, `isConnected`, `chainId`, `balance.<token>`, `allowance.<token>.<spender>`,
`contract.<token>.{decimals,symbol,approve}`, `…depositManager.{plusd,usdc,minDeposit,requestDeposit,claim}`,
`…withdrawalQueue.{requestWithdrawal,claimWithdrawal}`, `…stakedPlusd.{asset,convertToShares,convertToAssets,stake,unstake}`,
`networkFeeEstimate.{deposit,withdraw,stake,unstake}`. Write mocks are JSON (`{ "hash": "0x…",
"requestId"?: "…" }`). `convertToShares` / `convertToAssets` mocks hold one 1e18-scaled rate `r`;
the output is `n * r / 1e18`. The schema and console snippets live in
`packages/frontend/src/wallet/README.md`.

### Chain registry

**Source:** `packages/wallet-connect/src/evm/chains.ts`, consumed by the shared slice
(`getEvmChain()` in `evm/chain.ts`) and by the LP app (`wallet/evm/chain.ts` exports
`evmChain = defineEvmChain(ENV.EVM_CHAIN_ID, ENV.EVM_RPC_URL)`). Each slice keeps its own thin
wrapper (the LP slice is not yet re-pointed at the shared package, #1349); both wrappers are kept in
lockstep. The chain is selected by `VITE_EVM_CHAIN_ID` / `WalletConnectConfig.evmChainId`.

| Chain id | Name             | Explorer                                   | Native | `testnet` |
| -------- | ---------------- | ------------------------------------------ | ------ | --------- |
| `1`      | `Ethereum`       | `Etherscan` — `https://etherscan.io`       | `ETH`  | `false`   |
| `560048` | `Hoodi`          | `Etherscan` — `https://hoodi.etherscan.io` | `ETH`  | `true`    |
| other    | `EVM chain <id>` | none                                       | `ETH`  | `true`    |

- **Generic fallback.** Any other id is testnet-styled (never shown as real funds), mirroring the
  unknown-passphrase rule of `networkIdFromPassphrase`.
- **RPC from config.** The RPC URL always comes from `VITE_EVM_RPC_URL` /
  `WalletConnectConfig.evmRpcUrl`, never from the registry.
- **API.** `evmChainInfo(id)` returns the registry entry (or the generic one);
  `defineEvmChain(id, rpcUrl)` builds the `@reown/appkit/networks` chain, including
  `nativeCurrency`, `rpcUrls` and `blockExplorers`, so wallets that lack the chain can add it
  (`wallet_addEthereumChain`). It is memoized per `chainId|rpcUrl` so repeated calls return the same
  object (AppKit and wagmi compare networks by reference).
- **Lazy config.** The shared slice reads the injected config inside `getEvmChain()`, never at
  module scope (config is set in the app's `main.tsx`, after imports are evaluated).

### Wrong network

Applies in the EVM view only (`useActiveChain().kind === "evm"`) with a connected EVM wallet whose
chain id differs from `ENV.EVM_CHAIN_ID`. The wallet's chain is read through
`useAccount().chainId` in both `useEvmWallet` copies (`useChainId()` returns the configured chain,
never the wallet's, so it could not detect a mismatch). `pipeline.mock.wallet.chainId` overrides it.
`useEvmNetworkGuard()` (`wallet/evm/useEvmNetworkGuard.ts`) exposes `{ expectedChain,
currentChainId, isWrongNetwork, switchNetwork, isSwitching, switchError }`.

1. **Auto-prompt.** Right after an EVM wallet connects or is restored on the wrong chain, the app
   calls wagmi `switchChain({ chainId: ENV.EVM_CHAIN_ID })` once per connection (the wallet adds the
   chain first when it does not know it, e.g. Hoodi in MetaMask). A rejection, or a wallet that
   refuses unknown chains, leaves the app on the inline fallback; it does not re-prompt until the
   next connection.
2. **Inline fallback.** While `isWrongNetwork`, the deposit / withdraw (`useDepositFlow`) and
   stake / unstake (`useStakeFlow`) steps cards disable every step action and show a one-line row
   "Switch your wallet to {chain name}" with a **Switch** button (testid
   `steps-card-chain-notice`), in the steps-card row styling
   ([`ui-components.md#stepscard`](./ui-components.md#stepscard)). Switching in the wallet clears
   the row and re-enables the steps; a failed switch surfaces a danger toast through `toUserError`
   (toast id `evm-switch-chain`). There is no standalone banner.
3. **Pill.** The `NetworkSwitcher` pill shows a wrong-network state (`--color-pipeline-danger`
   dot, label "Wrong network", `data-state="wrong-network"`); its menu's first row
   (`topbar-network-switch-chain`) is "Switch to {chain name}".
4. **Write backstop.** Every wagmi `writeContract` call under `wallet/evm/**` passes
   `chainId: ENV.EVM_CHAIN_ID`, so wagmi throws a chain-mismatch error rather than sending a
   transaction on the wrong chain.
5. **Mock mode.** With `pipeline.mock.wallet.address` set, "Switch" only logs a `console.warn`
   naming `pipeline.mock.wallet.chainId`; no auto-prompt fires and nothing is written to
   localStorage.

## Stellar integration

_Scaffold — to be migrated from `packages/frontend/src/wallet/stellar/**` under #995._

### Withdrawal request decode

`request_withdrawal`'s on-chain return shape changed without notice: the interface doc
(`docs/generated/stellar-protocol-contracts.md`, fetched 2026-06-10) records `-> u128` (the bare
request id), but the deployed contract returns a tuple `(request_id, amount)`. `scValToNative`
turns that tuple into a JS array, and the original `BigInt(String(native))` decode threw
`Cannot convert 0,500000000000 to a BigInt` (the comma is `String([0n, 500000000000n])`) — after
the burn had already succeeded on-chain, so the request id was never persisted and the Claim step
dead-ended (#1024).

`decodeRequestId` (in `useStellarWithdrawalQueue.ts`) therefore accepts **both** shapes: an
array/tuple's first element is the id; a bare bigint/number/string is used as-is. Anything else
throws, preserving the caller's decode-error message. Regenerate the interface doc when the
`stellar` CLI is available to pin the exact tuple types.

### Error normalization

Wallet kits and RPC layers can reject with plain objects, which `new Error(String(err))` rendered
as `[object Object]` (#1024). `toError` normalizes any thrown value into an `Error`:
real `Error`s pass through; objects with a string `.message` use it; strings become the message;
everything else falls back to JSON, then `String`. All withdrawal-queue mutation catches route
through it. As of #1034 `toError` lives in `packages/frontend/src/utils/userError.ts` and is the
first stage of `toUserError`, the mapping layer that turns normalized errors into user-facing copy
— see [`error-handling.md`](./error-handling.md).
