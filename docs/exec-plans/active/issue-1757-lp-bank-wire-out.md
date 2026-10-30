# Issue #1757: LP: bank wire-out — request a withdrawal to a bank account (Minter.request_wire_out) and list wire-out requests with status

Source: https://github.com/eq-lab/pipeline/issues/1757

Epic: #1795. Branch `feat/1757-bank-wire-out` (draft PR #1811, base `epic/1795-lp-ui`), stacked on the #1759 branch. App: LP (`packages/frontend`), plus shared bindings in `packages/wallet-connect`.

## Scope

Behaviour source of truth: `docs/user-docs/lenders/withdraw.md` §"Bank wire withdrawals", `docs/user-docs/lenders/dashboard.md` ("Bank wire deposits and wire-out requests recorded for your address, with their status"), `docs/user-docs/lenders/onboarding.md` §Re-screening ("A de-authorised address cannot … request a bank wire-out"), `docs/user-docs/how-it-works/capital-layer.md` (cash book row "Lender wire out — Trustee — Lender's escrowed PLUSD burned"), `docs/user-docs/security/capital-safeguards.md` (every investor passes KYB before its address can be approved).

The rule from withdraw.md: the lender requests a wire-out of an amount of PLUSD. The PLUSD moves into escrow. When the wire is sent, the Trustee settles the request and the PLUSD is burned. The Trustee can cancel instead, and the PLUSD comes back. The address must be authorised to hold PLUSD to request it or to get it back.

**Design.** No Figma frames will be made for this Issue (decision 2026-10-29 on the Issue and on epic #1795). Build from the LP theme: `@pipeline/ui` `Card` (`variant="plain"`, from #1759), `ModalDialog` (#1759), `TokenInput`, `StepsCard` / `StepRow` (with the #1759 `hint`), `InfoRow`, `ActivityRow`, `Button`, `InlineError`. Follow the layout patterns of the withdraw page (`routes/deposit.tsx` withdraw direction, `components/withdraw/*`). Existing frames are **style reference only**: funded home `6701-97136` (the "USD Balance on Trust" card and the "Withdraw funds — Bank transfer" activity row), funding-details modal `6701-97113`, withdraw page `1498-100351`.

In scope:

1. **Request a wire-out** from the withdraw page (`/deposit?direction=withdraw`). Section: "Withdraw to a bank account", then a modal with a PLUSD amount and the chain's steps.
   - Stellar: one transaction.
   - EVM: approve PLUSD, then request.
2. **List the connected wallet's wire-out requests** on the withdraw page, each with its on-chain status: Pending (escrowed), Settled (burned) or Cancelled (returned).
3. **Activity feed rows** for wire-outs on Home `RecentActivityCard` and `/transactions` ("All" and "Sell" tabs), from the same source.
4. **Pre-checks and error copy**:
   - not authorised
   - amount above balance
   - zero amount
   - paused
   - missing PLUSD trustline (Stellar)
5. **Shared contract bindings** in `@pipeline/wallet-connect`, so #1764 (Trustee settle/cancel) can reuse the reader.
6. **Specs and a user-stories doc.**

Out of scope:

- **Trustee settle / cancel.** That is #1764: `settle_wire_out` / `cancel_wire_out`, `settleWireOut` / `cancelWireOut`.
- **Any backend or API change.** This user's manager takes frontend/docs only. A wallet-scoped wire-out endpoint is recommended as a backend follow-up (see Assumptions). It is not filed by this plan.
- **The `AddUsdCard` `funded` variant and its `onWithdraw` seam.**
  - These belong to #1285 (open, `backend`: "LP trust-account USD balance + bank withdraw").
  - That issue predates the user docs. The docs have no LP "trust-account USD balance": a wire-out is PLUSD escrowed in the minter.
  - Leave #1285 alone; the manager may want to reconcile or close it against this issue.
- **Mobile-specific layout.** The section and modal use the same responsive classes as the rest of the withdraw page (`max-w-lg`, `ModalDialog` caps at `calc(100vw - 32px)`).

### Contract calls (verified 2026-10-30 against source and testnet)

**Stellar Minter** (`eq-lab/pipeline-stellar-contracts` `contracts/minter/src/lib.rs`; testnet `CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK`, spec pulled from the deployed WASM):

| Call | Signature | Notes |
|---|---|---|
| Request | `request_wire_out(lp: Address, amount: i128) -> u32` | See the steps below this table. |
| Read one | `wire_out(id: u32) -> WireOut { lp: Address, amount: i128, requested_at: u64, status: WireOutStatus, ref_hash: BytesN<32> }` | `WireOutStatus` = `Pending` \| `Settled` \| `Cancelled` (union, decodes as `["Pending"]`, etc.). An unknown id traps `#10 NonExistentWireOut`. |
| Paused | `paused() -> bool` | Testnet: `false`. |
| Config | `addresses_config() -> { plusd, … }` | Used only to verify the PLUSD the minter escrows (see Risks). |

What `request_wire_out` does, in order:

1. `lp.require_auth()`.
2. `#[when_not_paused]`.
3. `require_positive(amount)`, which traps `#6 InvalidAmount`.
4. `plusd_authorized(lp)`:
   - false traps `#16 LpFrozen`;
   - with no trustline, the SAC traps `#13`.
5. `plusd.transfer(lp → minter, amount)` (SAC `#10` on insufficient balance).
6. Stores `WireOut` and emits `wire_out_requested`. The id is the return value.

The amount is i128 at PLUSD SAC scale (7 dp, `SAC_DECIMALS`). Source account = the LP (`lp` = connected G-address), signed with `useStellarWallet().signTransaction`, simulate → assemble → send → poll. This is the same pattern as `buildRequestWithdrawal`. No mint, so the minter `rate_limit_config` caps do not apply. There is no minimum.

**EVM `PipelineMinter`** (`eq-lab/pipeline-contracts` `src/minter/MinterUpgradeable.sol`; Hoodi v5 proxy `0xE75814d9618285AE4d789D4424672597DC494D3E`):

| Call | Signature | Notes |
|---|---|---|
| Approve | `PLUSD.approve(minter, amount)` | Needed because the request uses `safeTransferFrom`. Reuse `useApproval({ token: plusd, spender: minter })`. |
| Request | `requestWireOut(uint256 amount) returns (uint256 id)` | `lp = msg.sender`; `whenNotPaused` → `EnforcedPause()`; `amount == 0` → `MinterInvalidAmount()`; transfer failures → ERC-20 errors (`ERC20InsufficientBalance`, `ERC20InsufficientAllowance`) or the PLUSD whitelist revert. Emits `WireOutRequested(id, lp, amount)`. |
| Read one | `wireOut(uint256 id) view returns (WireOut { address lp; uint8 status; uint256 amount })` | `status` 0 = Pending, 1 = Settled, 2 = Cancelled. No `requestedAt` field on EVM. Unknown id → `MinterNonExistentWireOut()`. |
| Paused | `paused() view returns (bool)` | From `PausableUpgradeable`. |

### Value sources (every value shown)

| Value | Source | Notes |
|---|---|---|
| The wallet's wire-out ids and request time | `GET /v1/audit-log?chain_id=<active chain id>`. This is public, unauthenticated, unpaginated, chain-scoped and served newest-first. Keep items with `event_name === "WireOutRequested"` and `details.lp === <connected address>`: exact match for Stellar G-addresses; case-insensitive for EVM, whose rows carry the EIP-55 checksum. Read `details.id` and the item `timestamp` (ISO-8601). | Filtering served rows by the wallet, and ordering them by the served timestamp, is selection, not a computed metric. Verified live on staging (Stellar, 2026-10-30): the endpoint responds, and there are no `WireOut*` rows yet. |
| Amount | Contract `wire_out(id).amount` / `wireOut(id).amount` (raw), shown with `formatTokenAmount(raw, plusdDecimals)` and the "PLUSD" unit | Stellar 7 dp; EVM PLUSD decimals from `useEvmStakeDecimals().plusd`. Not the audit-log `details.amount`, so the amount and status come from the same read. "—" while loading or on a read error. |
| Status | Contract `wire_out(id).status` / `wireOut(id).status` | Mapped 1:1 to labels: Pending → "Pending", Settled → "Settled", Cancelled → "Cancelled". Never derived from event presence. "—" on a read error. |
| PLUSD balance (modal) | The same PLUSD balance read the withdraw direction already uses in `useDepositFlow` (`flow.formattedBalance` / raw balance) | No new balance source. |
| PLUSD authorised (Stellar) | `useStellarSacToken(PLUSD).isAuthorized` (Horizon `is_authorized`), already read by the withdraw flow | EVM has no LP-side whitelist read. Rely on the revert mapping. |
| Paused | Minter `paused()` | |
| Chain | `useWalletView().kind`: the connected wallet's chain. Chain id `ENV.STELLAR_CHAIN_ID` / `ENV.EVM_CHAIN_ID`, as in `useRequests` | Never hardcode Stellar. |

## Assumptions and Risks

- **Env vars are missing in the LP app.** The Issue context says the LP env "already has" `VITE_STELLAR_YIELD_MINTER_ID` / `VITE_EVM_MINTER_ADDRESS`. That is not true in code: only `packages/trustee/src/lib/env.ts` and `docker/trustee/entrypoint.sh` read them. `packages/frontend/src/lib/env.ts` and `docker/frontend/entrypoint.sh` do not.
  - This plan adds `STELLAR_MINTER_ID` (`VITE_STELLAR_YIELD_MINTER_ID`, default `""`) and `EVM_MINTER_ADDRESS` (`VITE_EVM_MINTER_ADDRESS`, default zero address) to the LP env and to the LP entrypoint.
  - **The deployment config outside this repo must also set them for the LP container.** Until it does, the section is hidden on that chain (the same short-circuit as the other contract ids). Tell the user when the PR goes up.
- **PLUSD mismatch risk.** The testnet minter's `addresses_config().plusd` is `CDGHLVGY2GH2GKIRPVA2PCC27GVYQONVYHKGEEYF2S5PXTLRP2XEN6AU`. The withdrawal queue in `.env.example` (`CCWP3P…56K6`) has `share()` = `CDKVHAVW25WC6YY3A3T35B7M3NEMO63YXGHYZHOQHLPP5YWWYSTO4KDA`. Those are different PLUSD contracts. Staging's real ids may differ from `.env.example`.
  - Before live verification, the coder confirms on staging that the minter's `plusd` equals the PLUSD SAC whose balance the LP sees.
  - If they differ, the request transfers a PLUSD the LP does not hold and fails with SAC `#13` / `#10`. That is a deployment fix, not a code fix. Report it and don't work around it.
- **List source has no wallet filter.** The audit log is the whole protocol feed, unpaginated, so the download grows with protocol activity.
  - Decision: the frontend filters the served rows client-side (allowed: selecting served rows, not computing a metric). It caches with `staleTime` 30 s and polls at 30 s only while the withdraw page or an activity list is mounted.
  - A wallet-scoped endpoint (e.g. `GET /v1/wire-outs?wallet=&chain_id=` serving `{id, amount, status, requested_at}` from the indexed events) is the right long-term source. It is a backend follow-up for the user to file. It is not created here, per this user's frontend-only rule, and is not a tech-debt entry.
  - The audit log does not depend on an EVM chain being configured in the API. If the API serves no EVM chain, EVM gets `{"items":[]}` and the list is empty.
- **Indexer lag.** A just-submitted request appears in the audit log only after the indexer catches it. The success path keeps the returned id(s) in component state, not localStorage, and renders them through the same contract read. Each one is dropped once the served list contains it. On Stellar the id comes from the tx return value, with a fallback to the `wire_out_requested` event topic (same as `extractWireId`). On EVM it comes from the receipt's `WireOutRequested` log.
- **Soroban error codes collide.**
  - Minter `#10` is `NonExistentWireOut`, but inside `request_wire_out` a `#10` comes from the SAC transfer (`BalanceError`).
  - SAC `#13` is `TrustlineMissing`. The 2026-10-29 Issue comment read `#13` as "not PLUSD-authorised", but that was a random address with no trustline. The real not-authorised code is minter `#16 LpFrozen`.
  - So the wire-out mapping is context-scoped: `toUserError(err, { context: "wireOut" })`, the same mechanism as #1759's `"withdrawClaim"`. Never add these codes to the global table.
  - The pause error comes from `stellar_contract_utils` `when_not_paused`: `PausableError::EnforcedPause = 1000`. Confirm it once by simulating against a paused deployment or reading the crate. If that's not possible, the pre-read `paused()` gate covers the UI path anyway.
- **KYB / bank account prerequisite.** See Open Questions. The docs state only the on-chain gate (authorised to hold PLUSD). KYB precedes authorisation (`capital-safeguards.md`). No API field or endpoint holds an LP bank account; KYB "settlement address" is a Stellar blockchain address, per `kyb-lp-verification.md` §Settlement Address. The plan as written gates only on what is served: on-chain authorisation, balance and paused.
- **Rules.**
  - No localStorage mocks in the new hooks. `useApproval` keeps its existing mock seam untouched.
  - No frontend-computed metrics. "Amount above balance" is a display condition comparing two raw contract values, the same as the existing `flow.exceedsBalance`.
  - Values are shown verbatim through unit formatting only.
  - Comment-minimal code: one 2–3-line spec-pointer header per new file.
- **`useDepositFlow.ts` is large** (≈1.7k lines). Wire-out logic stays out of it in its own hooks. The page reads only the PLUSD balance, decimals and authorisation already exposed on `flow`. If a needed field isn't exposed, add one passthrough field rather than new logic.
- **Dependency.** Stacked on #1759 (PR #1800, unmerged). It reuses `ModalDialog`, `Card variant="plain"`, the `StepRow` `hint` and the `toUserError` context argument. Merge #1800 before #1811.

## Open Questions

- **Prerequisite and destination bank account.**
  - The Issue lists a pre-check that "the LP has a settlement bank account on file (KYB)". No API field or endpoint serves or collects LP bank details. The KYB "settlement address" is a Stellar blockchain address. The user docs require only on-chain PLUSD authorisation to request a wire-out.
  - The plan therefore assumes:
    1. the app neither collects nor shows destination bank details (the Trustee wires to the bank account on the LP's KYB file, off-chain);
    2. the only gates are on-chain authorisation, balance and not-paused. There is no `kyb_status` or session gate, so a wallet-only visitor whose address is authorised can request (consistent with "connected wallet = active account").
  - Confirm, or say if the app should also require a signed-in LP with `kyb_status === "Passed"` (`useAuthFlow().kybStatus`), or show a destination.

## Implementation Steps

1. **LP env.** In `packages/frontend/src/lib/env.ts`, add:
   - `STELLAR_MINTER_ID: readString("VITE_STELLAR_YIELD_MINTER_ID", "")`
   - `EVM_MINTER_ADDRESS: readString("VITE_EVM_MINTER_ADDRESS", "0x0000000000000000000000000000000000000000") as \`0x${string}\``

   Both short-circuit when empty or zero. Add both `--arg` / object entries to `docker/frontend/entrypoint.sh`. Update `.env.example` comments (the LP now reads them too) and the env table in `docs/FRONTEND.md`.
2. **Shared Stellar bindings** in `packages/wallet-connect/src/stellar/contracts/minter.ts`, exported from `src/index.ts`:
   - `encodeRequestWireOutArgs({ lp, amountRaw }: { lp: string; amountRaw: bigint }): xdr.ScVal[]`. Returns `[Address(lp), i128(amountRaw)]` and throws on `amountRaw <= 0n`. Take raw bigint, not a decimal string: the LP input is already parsed at SAC scale.
   - `buildRequestWireOutEnvelope({ minterId, lp, amountRaw, rpcUrl, networkPassphrase }): Promise<string>`. Source = `lp`, op `request_wire_out`, simulate → assemble, throwing `requestWireOut simulation error: …` (same shape as `buildRecordWireInEnvelope`).
   - `requestWireOut({ …build, signTransaction, onStageChange }): Promise<{ hash: string; wireOutId: number | null }>`. Sign → send → poll. The id comes from the return value (`toId(_, 0)`; ids start at 0), else from the `wire_out_requested` event topic[1].
   - `readMinterWireOut({ minterId, id, rpcUrl, networkPassphrase }): Promise<MinterWireOut>` via `simulateRead(minterId, "wire_out", [u32(id)])`. Returns `{ lp: string; amount: string (raw i128 string); requestedAt: number; status: "Pending" | "Settled" | "Cancelled" }`. Decode the union: `scValToNative` gives `["Pending"]`, so take `[0]`. Throw on an unknown variant.
   - `readMinterPaused({ minterId, … }): Promise<boolean>`.

   Tests go in `minter.test.ts`.
3. **Shared EVM ABI.** In `packages/wallet-connect/src/evm/contracts/minter.ts`, add `minterWireOutAbi` (`requestWireOut`, `wireOut` returning the tuple `(address lp, uint8 status, uint256 amount)`, `paused`, event `WireOutRequested(uint256 indexed id, address indexed lp, uint256 amount)`, errors `MinterInvalidAmount`, `MinterNonExistentWireOut`, `EnforcedPause`). Also add `EVM_WIRE_OUT_STATUS = ["Pending", "Settled", "Cancelled"] as const`. Export it from `src/index.ts`.
4. **API hook** `packages/frontend/src/api/useWireOutRequests.ts`, exported from `api/index.ts`.
   - Add `getAuditLog(chainId)` → `apiFetch<{ items: AuditLogItem[] }>(\`/v1/audit-log?chain_id=${chainId}\`)` with no auth header, and a minimal typed `AuditLogItem` (`chain_id`, `timestamp`, `event_name`, `details: Record<string, unknown>`).
   - `useWireOutRequests()` follows `useWalletView().kind`. It takes the address and connection from `useStellarWallet` / `useEvmWallet` and the chain id from ENV, the same as `useRequests` but without the mock-version store.
   - Query key `["wire-out-requests", kind, address, chainId]`.
   - Enabled only when connected and the active chain's minter id/address is configured.
   - `staleTime: 30_000`, optional `refetchInterval`.
   - Returns `{ items: Array<{ id: string; timestamp: string }>, isLoading, error, refetch }`, filtered as in the value-source table and kept in served order (newest first).
5. **Contract read hooks** in `packages/frontend/src/wallet/`:
   - `stellar/useStellarMinterReads.ts`:
     - `useStellarWireOuts(ids: string[], { enabled })` uses `useQueries` over `readMinterWireOut`.
     - Per id: `staleTime: Infinity` once the status is `Settled`/`Cancelled`; `refetchInterval: 30_000` while `Pending`.
     - `useStellarMinterPaused({ enabled })` polls at 30 s.
   - `evm/useEvmMinterReads.ts`: `useEvmWireOuts(ids, { enabled })` via wagmi `useReadContracts` (one `wireOut` call per id), plus `useEvmMinterPaused({ enabled })`. Map `status` through `EVM_WIRE_OUT_STATUS`.
   - Facade `wallet/useWireOutReads.ts`. `useWireOuts(kind, ids)` returns `Record<id, { amountRaw?: string; status?: WireOutStatus; error?: Error }>`. `useMinterPaused(kind)` returns `boolean | undefined`. Call both chain hooks and enable only the active kind. Export from `wallet/index.ts`.
6. **Write hooks.**
   - `wallet/stellar/useStellarRequestWireOut.ts` wraps `requestWireOut` from `@pipeline/wallet-connect` with `ENV.STELLAR_MINTER_ID`, `ENV.STELLAR_RPC_URL`, `ENV.STELLAR_NETWORK_PASSPHRASE` and the wallet's `signTransaction`. It exposes `{ request(amountRaw), isPending, isSuccess, error, wireOutId, reset }` (the same result shape as `useStellarRequestWithdrawal`). Errors pass through `toError`.
   - `wallet/evm/useEvmRequestWireOut.ts` follows `evm/useWithdrawalQueue.ts` `useRequestWithdrawal`: simulate → estimate → `writeContract` `requestWireOut(amount)` → wait for the receipt. It decodes the id from the `WireOutRequested` log (`decodeEventLog` with `minterWireOutAbi`) and exposes the same shape.
   - EVM approve: reuse `useApproval({ token: <PLUSD address used by the withdraw flow>, spender: ENV.EVM_MINTER_ADDRESS })`.
7. **Flow hook** `components/withdraw/useWireOutFlow.ts`, the modal's state machine.
   - Inputs: `kind`, amount input string, the PLUSD balance raw and decimals, and `isAuthorized` (Stellar), all from `flow`.
   - Outputs:
     - `steps`: Stellar = `[Request wire-out]`; EVM = `[Approve PLUSD, Request wire-out]`, with approve `success` once the allowance ≥ amount.
     - `amountRaw`, `exceedsBalance`.
     - `disabledReason`, in this priority: unconfigured → paused → not authorised → zero/empty amount → above balance.
     - `submit`, `reset`, `lastWireOutId`.
   - Step errors come from `toUserError(err, { context: "wireOut" })`.
8. **Error mapping** in `packages/frontend/src/utils/userError.ts`.
   - Extend the context union with `"wireOut"`. With that context:
     - Soroban `#16` → "Your address must be authorised to hold PLUSD to request a bank wire-out."
     - `#6` → "Enter an amount greater than zero."
     - `#10` → "Insufficient PLUSD balance."
     - `#1000` → "Bank wire-outs are paused. Check the status page before retrying."
   - Global `#11` / `#13` copy stays as is. `#13` still reads "A required trustline is missing…", which is correct here.
   - EVM, also in `"wireOut"` context: `EnforcedPause` → the paused copy; `MinterInvalidAmount` → the zero-amount copy; `ERC20InsufficientBalance` → the balance copy. Check these before the generic `execution reverted`.
   - Do not touch the `withdrawClaim` context or `#4`.
9. **Withdraw page section** `components/withdraw/WireOutSection.tsx` (+ `useWireOutSection.ts` for formatting).
   - Rendered in `routes/deposit.tsx` when `!isDeposit && flow.isConnected` and the active chain's minter is configured, after the steps card.
   - Content: a `Card variant="plain"` (test id `wire-out-section`) with:
     - heading "Withdraw to a bank account" (body/medium, same type ramp as the queue block);
     - body text from withdraw.md, verbatim: "You request a wire-out of an amount of PLUSD. The PLUSD moves into escrow. When the wire is sent, the Trustee settles the request and the PLUSD is burned. The Trustee can cancel the request instead, and the PLUSD returns to you.";
     - a `Button variant="primary-dark" size="m"` "Request bank wire-out" (`wire-out-open`);
     - when blocked before any amount (paused / not authorised), the button is disabled and the reason shows as a muted caption (`wire-out-blocked-reason`).
   - Below it, "Your bank wire-outs" (`wire-out-list`): one row per id (`wire-out-row-<id>`) as `ActivityRow`:
     - title "Withdraw funds"
     - timestamp `formatActivityTime(served timestamp)`
     - amount `TwoLineAmount` primary `-{amount} PLUSD`, secondary "Bank transfer · {status label}"
     - Pending: `clock-pending` / `warning`, muted. Settled: `check-circle` / `success`. Cancelled: neutral icon / muted, secondary "Bank transfer · Cancelled".
   - Hidden when empty. "—" parts while loading.
   - Reuse `TwoLineAmount` from `components/activity/renderRequestRow.tsx`. It is already exported, so don't duplicate it.
10. **Modal** `components/withdraw/WireOutModal.tsx`, using `ModalDialog`, title "Withdraw to a bank account".
    - A `TokenInput` (PLUSD token and label; balance label from `flow.formattedBalance`; quick chips 25 % / 50 % / 75 % / Max like the withdraw input, through the same `onQuickAmount` helper semantics). Read the existing quick-amount code and reuse it. Don't re-implement percentage maths if a helper exists; if it lives inside `useDepositFlow`, extract it into a small shared util first.
    - `InlineError` "Insufficient balance" when above balance.
    - A `StepsCard` with the flow's steps; `hint` on the request step: "The PLUSD moves into escrow until the Trustee settles or cancels the request."
    - On success: a toast `Wire-out of {amount} PLUSD requested` (id `wire-out-tx`; pending "Sending…"; danger with a "Details" action into the page's existing `ErrorDetailsDialog` state, the same pattern as the step-2 toast). Then close the modal, push `wireOutId` into the section's just-submitted ids, `refetch()` the audit-log query and refetch the balance.
11. **Activity feeds.**
    - New `components/activity/renderWireOutRow.tsx`, shared by the section, `RecentActivityCard` and `/transactions`. It contains the row visual from step 9.
    - New `components/activity/useActivityFeed.ts`. It merges `useRequests()` items with `useWireOutRequests()` items into a single list ordered by served time (`created_at` / `timestamp`, newest first), tagged `{ kind: "request" | "wireOut" }`.
    - `RecentActivityCard`: slice to `MAX_ROWS` after the merge.
    - `/transactions`: wire-out rows appear under "All" and "Sell". The empty state counts merged rows. The loading/error state stays driven by `useRequests` only; a failed audit-log read just omits wire-out rows.
    - Wire-out rows read status/amount through `useWireOuts`, called once per list, not per row.
12. **Specs headers / lint.** Each new file gets one 2–3-line spec-pointer header (`docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app` or `docs/frontend/bank-transfers.md#wire-out`) and nothing else. Run:
    - `yarn workspace @pipeline/frontend test`
    - `yarn workspace @pipeline/wallet-connect test`
    - `npx tsx scripts/lint-docs.ts`
    - `npx tsx scripts/lint-comments.ts` (shrink the baseline for any listed file touched)
    - `yarn build`

## Test Strategy

Vitest + RTL. Chain hooks and clients are stubbed with `vi.mock`. No localStorage mocks.

- **`wallet-connect` `stellar/contracts/minter.test.ts`**:
  - `encodeRequestWireOutArgs` gives the arg types (`Address`, `i128`) and throws on ≤ 0.
  - `buildRequestWireOutEnvelope` calls `request_wire_out` with the LP as source; simulation error text.
  - `requestWireOut` reads the id from the return value, falls back to the event, and returns `null` when neither has it. Id `0` is accepted.
  - `readMinterWireOut` decodes all three statuses and `requestedAt`, and throws on an unknown variant.
- **`wallet-connect` `evm/contracts/minter.test.ts`**: the ABI round-trips `requestWireOut` / `wireOut` and decodes `WireOutRequested` from a fixture log. `EVM_WIRE_OUT_STATUS` index mapping.
- **`api/useWireOutRequests.test.tsx`**:
  - Stellar keeps only `WireOutRequested` rows whose `lp` equals the G-address.
  - EVM matches case-insensitively against a checksummed `lp`.
  - Other event names and other LPs are dropped. Served order is kept.
  - Disabled when disconnected or the minter is unconfigured. Uses the active `chain_id`. No auth header.
- **`wallet/useWireOutReads.test.tsx`**:
  - Only the active kind is enabled.
  - Values pass through untouched.
  - A per-id read error surfaces as `error` for that id only.
  - Terminal statuses stop polling (`staleTime` / `refetchInterval` assertions on the query options).
- **`wallet/stellar/useStellarRequestWireOut.test.tsx` / `wallet/evm/useEvmRequestWireOut.test.tsx`**: the happy path returns the id; a wallet rejection and a revert surface as `error`; `reset` clears.
- **`components/withdraw/useWireOutFlow.test.tsx`**:
  - Each `disabledReason` branch and its priority (paused beats not authorised beats amount checks).
  - EVM approve step state from the allowance.
  - The Stellar single step.
  - Errors mapped through the `wireOut` context.
- **`utils/userError.test.ts`**:
  - `#16` / `#6` / `#10` / `#1000` map in the `wireOut` context and stay generic or keep their global copy without it (`#10` generic; `#13` keeps the trustline copy).
  - EVM `EnforcedPause` / `MinterInvalidAmount` / `ERC20InsufficientBalance` map in context.
  - `withdrawClaim` behaviour is unchanged.
- **`components/withdraw/WireOutSection.test.tsx` / `WireOutModal.test.tsx`**:
  - The section renders only on the withdraw direction when connected and configured.
  - The verbatim docs copy.
  - Rows for Pending / Settled / Cancelled with the right labels and icons, and "—" while loading.
  - A just-submitted id renders before the audit log has it and de-dupes once it does.
  - Modal: amount input, Max chip, insufficient-balance error, steps per chain, and on success the toast copy, close, and refetch.
- **`components/activity/useActivityFeed.test.ts`**: merge order by served time; slice after merge.
- **`RecentActivityCard.test.tsx` and `routes/-transactions.test.tsx`**: wire-out rows appear under All and Sell, not under Buy / Stake / Unstake. An audit-log failure leaves the request rows and the page state intact.
- **`routes/-deposit.test.tsx`**: the section appears on withdraw only, not on deposit; it is absent when the minter env is empty.
- **Live verification** on staging (Stellar testnet first, then Hoodi once `VITE_EVM_MINTER_ADDRESS` is set). The human or the QA agent checks the DevTools Network tab; don't drive the user's browser.
  1. Confirm the minter's `addresses_config().plusd` matches the LP's PLUSD.
  2. Request a small wire-out. Check the Soroban `simulateTransaction` / `sendTransaction` for `request_wire_out`, the balance drop, and the row showing "Pending" from `wire_out(id)`.
  3. After `GET /v1/audit-log?chain_id=…` returns the `WireOutRequested` row, the row persists across reloads.
  4. A Trustee `cancel_wire_out` (#1764 or a CLI) flips the row to "Cancelled" and the PLUSD returns. A settle flips it to "Settled".
  5. A de-authorised address shows the not-authorised reason.
  6. Use the funded home frame `6701-97136`, the funding modal `6701-97113` and the withdraw page `1498-100351` as the style reference only: tokens, type ramp, spacing. There are no frames for this flow.

## Docs to Update

- **`docs/product-specs/withdrawals.md`**: new section "Bank wire withdrawals (LP app)" (anchor `#bank-wire-withdrawals-lp-app`). It covers:
  - the contract calls per chain, with exact signatures and args (the tables above);
  - the gates and their priority;
  - the value-source table;
  - the list source decision (client-filtered audit log; wallet-scoped endpoint as a recommended backend follow-up);
  - just-submitted ids;
  - the error mapping;
  - that wire-outs cannot be cancelled by the LP (only the Trustee settles or cancels).
- **`docs/frontend/bank-transfers.md`**:
  - New `## Wire-out` section: `WireOutSection`, `WireOutModal`, `useWireOutFlow`, `renderWireOutRow`, copy, test ids.
  - Update the "Seams" and "Out of scope" tables: the wire-out path is now #1757 on the withdraw page; `AddUsdCard.onWithdraw` stays with #1285.
- **`docs/frontend/wallet-flows.md`**: minter reads/writes (`useWireOutReads`, the request hooks), cadences, chain scoping.
- **`docs/frontend/error-handling.md`**: the `wireOut` context rows: Soroban `#16` / `#6` / `#10` / `#1000` (with the collision note: minter `#10` vs SAC `#10`; SAC `#13` is TrustlineMissing, not "not authorised") and the EVM named errors.
- **`docs/frontend/dashboard-components.md`**: `#deposit-and-withdraw-route` (the bank section and modal) and `#renderrequestrow` / RecentActivityCard / transactions (the merged feed, the Sell tab).
- **`docs/FRONTEND.md`**: env table rows for `VITE_STELLAR_YIELD_MINTER_ID` and `VITE_EVM_MINTER_ADDRESS` (LP).
- **`docs/user-stories/epic-1795/1757-bank-wire-out.md`** (new, same format as `1760-fresh-voucher-after-deadline.md`). Stories:
  1. request on Stellar: one signature; PLUSD leaves the balance; Pending row;
  2. request on EVM: approve, then request;
  3. the row persists after reload once indexed;
  4. Trustee settles → Settled;
  5. Trustee cancels → Cancelled, and the PLUSD is back;
  6. not authorised / no trustline → reason and no request;
  7. amount above balance;
  8. minter paused (needs a paused deployment; mark it as needing a testnet admin);
  9. Home and `/transactions` show wire-out rows under All / Sell;
  10. section hidden when the minter env is unset.

  Add the row to `docs/user-stories/index.md` under Epic #1795.
- No tech-debt tracker entry. The missing wallet-scoped wire-out endpoint is called out in the spec as a backend follow-up for the user to file.
