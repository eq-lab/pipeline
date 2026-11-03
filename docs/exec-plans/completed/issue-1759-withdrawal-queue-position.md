# Issue #1759: LP: withdrawal queue position, payable-now state, queue aggregates and the recovery rate (user docs)

Source: https://github.com/eq-lab/pipeline/issues/1759

Epic: #1795. Branch `feat/1759-withdrawal-queue-position` (draft PR #1800). App: LP (`packages/frontend`, plus one additive prop in `packages/ui`).

## Scope

Behaviour source of truth: `docs/user-docs/lenders/withdraw.md` (§Flow, §Paid in order, §Queue aggregates, §Delays, §During shutdown), `docs/user-docs/lenders/dashboard.md` ("Withdrawal requests: amount, position in the queue, whether each is payable now, and whether it was claimed"), `docs/user-docs/risks/default-management.md` §Withdrawal queue recovery rate.

No Figma frames will be made for this Issue (decision 2026-10-29 on the Issue and epic #1795). New UI uses the LP theme: `@pipeline/ui` `Card` / `InfoRow` / `StepsCard` / `ActivityRow` and the existing withdraw page and Panel C patterns. Existing frames are style reference only: withdraw page `1498-100351`, Panel C `3283-14893`.

In scope:

1. [x] **Per-request position and payable-now.** Contract reads, values shown as returned.
   - Withdraw page: a queue card under the steps card while a withdrawal request is in flight.
   - Pending `Withdraw` rows on Home (`RecentActivityCard`) and `/transactions`, through `renderRequestRow`.
2. [x] **Queue aggregates.** Total queued and total claimed on the withdraw page queue card and as two more summary cards on Protocol Dashboard Panel C, next to the served In Queue / Requests cards.
3. [x] **Recovery rate.**
   - When the on-chain rate is below 1, a notice on the withdraw page.
   - On the claim step, a "Pays X USDC = Y PLUSD × rate" hint. X is computed by the contract, never by the client.
   - The claim success toast must not report the PLUSD amount as USDC while a rate below 1 is set.
4. [x] **Waiting-state hints** on the claim step. The four §Delays reasons, copied verbatim: no voucher yet, custody account short, voucher expired, queue paused.
   - Claim is disabled while the contract says the request is not payable.
   - `TooEarly` (Stellar `Error(Contract, #2)` on `claim_request`, EVM `WithdrawalQueueTooEarly()`) maps to the custody-short copy.
5. [x] **Request-step copy.** Hint on the withdraw request step: "A request cannot be cancelled. Your PLUSD stays in the queue until it is claimed." Queue card copy: the "Paid in order" explanation.
6. Specs and a user-stories doc.

Out of scope:
- Any backend or API change. This user's manager takes frontend/docs work only. A served `position` / `claimable` / aggregates / rate field would be the better long-term source, so it is tracked as backend issue #1801 (no tech-debt tracker entry).
- Mapping `InvalidRate` (#3) / `AlreadyInShutdown` (#5). They are admin-only and the LP UI can never hit them (stated in the Issue).
- Position on completed (claimed) rows. A claimed row already shows "claimed", and position only matters while a request waits. This also avoids N extra RPC reads per history page.
- Trustee console, and the bank wire-out (#1757).

### Value sources (every value shown)

| Value | Stellar (`VITE_STELLAR_WITHDRAWAL_QUEUE_ID`) | EVM (`VITE_WITHDRAWAL_QUEUE_ADDRESS`) | Served by API? |
|---|---|---|---|
| Request list, status, amount, `request_id` | `GET /v1/requests` (existing `useRequests`) | same | yes, used as is |
| Position | `withdrawal_request_queued(u128) -> i128` (PLUSD, 7 dp) | `withdrawalRequestQueued(uint256) -> uint256` (PLUSD decimals) | no. `/v1/requests` has no position; the indexed `WithdrawalRequested.queued` param is not served |
| Payable now | `claimable(u128) -> bool` | `isClaimable(uint256) -> bool` | no |
| Total queued / total claimed | `total_queued()` / `total_claimed()` -> i128 | `queueMetadata() -> (totalQueued, totalClaimed)` | no. `/v1/withdrawal-queue` `in_queue_usd` is the unclaimed sum, a different number; it stays as the existing In Queue card |
| Recovery rate | `rate() -> i128`, 6 dp (`1_000_000` = 1.0) | No public rate getter on the deployed proxy (`rate()`, `shutdownRate()` and similar all revert). Use `convertToAssets(10^plusdDecimals)`, the contract's USDC payout for 1 PLUSD (`= rate / RATE_ONE`, spec `evm-requests-queue.md` §Shutdown rate), formatted at USDC decimals | no |
| Payout X on the claim step | Return value of a `claim_request(id, sig, deadline)` simulation (i128 USDC, 7 dp). The same call the claim already simulates before signing | `convertToAssets(request.amount)` | no |
| Queue paused | `paused() -> bool` (already in `WithdrawalQueueClient`) | `paused() -> bool` | no |
| Voucher expired | `useStellarWithdrawalVoucher` deadline check (#1760) | n/a. EVM vouchers carry no deadline (#1798) | yes (served `deadline`) |

Checked on 2026-10-29:
- Stellar testnet `CBVXU…XFYQ` (spec pulled from the WASM): `rate`=1000000, `total_queued`=`total_claimed`=10000000000, `claimable(0)`=false on a claimed request, `withdrawal_request_queued(0)`=10000000000. `claim_request` returns `i128`.
- Hoodi `0x3690…7e75`: `RATE_ONE`=1000000, `queueMetadata`=(1e9,1e9), `isClaimable(0)`=false, `withdrawalRequestQueued(0)`=1e9, `convertToAssets(1e6)`=1e6, `paused`=false.

Formatting: token amounts go through `formatTokenAmount(raw, decimals)` (unit formatting only, no rescaling). The rate is `formatUnits(rate, 6)` with trailing zeros trimmed. A value that is not available renders "—". "Rate below 1" means comparing the contract value with its own unit (`rate < 1_000_000`, or EVM `convertToAssets(10^plusdDec) < 10^usdcDec`). That is a display condition, not a computed metric.

## Assumptions and Risks

- **Soroban error codes collide across the WQ and its request-queue library.**
  - On testnet, `get_request(<unknown id>)` fails with `Error(Contract, #2)`. `#4` is already mapped to the request-queue `DeadlineExpired` (#1760, `utils/userError.ts`), but the Issue lists WQ `InvalidAmount = 4`.
  - So `#2 → custody short` must be scoped to the withdraw `claim_request` call only, never added to the global `SOROBAN_ERROR_COPY` table (it would also hit deposit-manager errors).
  - The `#4` mapping stays as is.
  - The claimable gate (step 7) means `#2` is normally never reached; the mapping covers races only.
- **EVM rate via `convertToAssets`.** The deployed EVM queue has no rate getter (checked by probing). The `convertToAssets` read is contract-computed and equals `rate / RATE_ONE` per spec. If a later EVM deploy adds a getter, switch to it.
- **Stellar payout simulation** needs a ready voucher (signature + deadline) and `claimable === true`. Before that, the claim hint shows "Pays — USDC = Y PLUSD × rate". The simulation runs with the lender's address as the read source (auth recording mode, no signature). If simulation fails, X renders "—" and the error is not surfaced as a step error.
- **RPC load.** One `claimable` + one `withdrawal_request_queued` read per pending withdraw row, only for non-`Completed` `Withdraw` rows. Position is immutable (`staleTime: Infinity`). `claimable` polls at 15 s. Totals / rate / paused poll at 30 s / 60 s / 30 s. Expected row counts are small.
- **`useDepositFlow.ts` is 1,648 lines.** New logic goes into a separate chain-agnostic reads hook plus a small hint selector. `useDepositFlow` only wires the results into `step2.hint`, `step3.hint` / `step3.disabled` and a `withdrawQueue` field.
- **Chain scope.** All reads follow the connected wallet: `useWalletView().kind` in the flow and rows (same as `useRequests`), and `useDashboardChain()` (`useActiveChain`) in Panel C. Hooks for the inactive kind are called with `enabled: false` (Rules of Hooks), as in `useBalanceSheetPanel`.
- **Mock layer.** The new hooks must not read `pipeline.mock.*` keys. Verify against real testnet / Hoodi reads only.
- **Stale comments.** The header of `wallet/stellar/contracts/withdrawalQueue.ts` names an old contract id and a 2026-06-10 interface. It is listed in `scripts/lint-comments.baseline.json`, so touching it means shrinking it to a spec-pointer header and shrinking the baseline entry. The same applies to `wallet/evm/abis/withdrawalQueue.ts`.
- No dependency on open work. #1760 (voucher deadline) is merged and supplies the expired state.

## Open Questions

_None_

## Implementation Steps

1. [x] **Stellar client reads** in `packages/frontend/src/wallet/stellar/contracts/withdrawalQueue.ts`. Add these methods through `simulateReadCall`:
   - `rate(): Promise<bigint>`
   - `totalQueued(): Promise<bigint>`
   - `totalClaimed(): Promise<bigint>`
   - `claimable(requestId: bigint): Promise<boolean>`
   - `withdrawalRequestQueued(requestId: bigint): Promise<bigint>`

   Add `simulateClaimPayout(sender: string, requestId: bigint, verifierSignature: Uint8Array, deadline: bigint): Promise<bigint>`. It builds the same `claim_request` op as `buildClaimRequest` on `new Account(sender, "0")`, simulates it, and returns `scValToNative(retval)` as bigint (throws on a simulation error).

   Reduce the file header to a 2–3-line spec pointer (`docs/frontend/wallet-flows.md#withdrawal-queue-reads`) and shrink its `lint-comments.baseline.json` entry.
2. [x] **EVM ABI** in `packages/frontend/src/wallet/evm/abis/withdrawalQueue.ts`. Add view entries:
   - `isClaimable(uint256) -> bool`
   - `withdrawalRequestQueued(uint256) -> uint256`
   - `queueMetadata() -> (uint256 totalQueued, uint256 totalClaimed)`
   - `convertToAssets(uint256) -> uint256`
   - `paused() -> bool`

   Same header and baseline treatment as step 1.
3. [x] **Per-chain read hooks.** Use React Query for Stellar and wagmi `useReadContract` for EVM. Each takes `{ enabled }` and returns raw bigint/boolean values plus `isLoading` / `error`. A missing contract id or zero address short-circuits to `undefined`.
   - New `wallet/stellar/useStellarWithdrawalQueueReads.ts`:
     - `useStellarWithdrawalQueueTotals()` (`total_queued`, `total_claimed`, `rate`, `paused`)
     - `useStellarWithdrawalRequestQueueState(requestId)` (`withdrawal_request_queued`, `claimable`)
     - `useStellarClaimPayout({ requestId, signatureBytes, deadline, sender, enabled })`
   - New `wallet/evm/useEvmWithdrawalQueueReads.ts`:
     - `useEvmWithdrawalQueueTotals()` (`queueMetadata`, `convertToAssets(10^plusdDec)` with PLUSD decimals from `useEvmStakeDecimals`, `paused`)
     - `useEvmWithdrawalRequestQueueState(requestId)` (`withdrawalRequestQueued`, `isClaimable`)
     - `useEvmClaimPayout(amountRaw)` (`convertToAssets`)
4. [x] **Chain-agnostic facade** in new `wallet/useWithdrawalQueueReads.ts`.
   - `useWithdrawalQueueTotals(kind)` returns `{ totalQueued, totalClaimed, rateRaw, rateDecimals, paused, plusdDecimals, usdcDecimals }`.
   - `useWithdrawalRequestQueueState(kind, requestId)` returns `{ position, payableNow }`.
   - Both call both chain hooks and enable only the active kind.
   - Export the helper `isRecoveryRateActive(totals)`. It returns true only when the rate is defined and below its unit.

   Export from `wallet/index.ts`.
5. [x] **Voucher expired flag.** In `api/useStellarWithdrawalVoucher.ts`, add `expired: boolean` to the result (the existing `expired` local). In `api/useWithdrawalVoucher.ts` (EVM), add `expired: false` for a uniform shape. Status semantics stay unchanged.
6. [x] **Claim-step hint selector** in new `wallet/withdrawClaimHint.ts`. It is pure, so it can be unit-tested.

   Signature: `selectWithdrawClaimHint({ paused, voucherExpired, hasVoucher, requestStatus, payableNow, recoveryActive, payout, amount, rate })`. It returns the hint string or `undefined`, in this priority:
   1. `paused === true`: "The withdrawal queue is paused. Check the status page before retrying."
   2. `voucherExpired`: "The voucher expired before you claimed. Your app fetches a new one."
   3. No ready voucher (`PendingVerification`, `VerificationFailed`, or voucher pending/failed): "No voucher yet. Screening is still running, or the request did not screen clean."
   4. `payableNow === false`: "The withdrawal custody account is short. Claims for your position wait until it is funded."
   5. `recoveryActive`: "Pays {X} USDC = {Y} PLUSD × {rate}". X is "—" until the contract payout resolves.

   Before a request exists, the claim step returns `undefined`.
7. [x] **Wire into `useDepositFlow.ts`.** Withdraw direction only; deposit is unchanged.
   - Call the facade with `kind` and the active withdraw request id (`stellarRequestIdBigInt` / `evmRequestId`), and the payout hooks (Stellar: voucher `signatureBytes` + `deadline` + address, enabled when `payableNow === true && recoveryActive`; EVM: `lockedAmountRaw`).
   - Set `step2.hint = "A request cannot be cancelled. Your PLUSD stays in the queue until it is claimed."` while step 2 is idle.
   - Set `step3.hint` from step 6.
   - Add `payableNow === false || paused === true` to `step3.disabled` (strict false/true; `undefined` keeps today's behaviour).
   - Add to `FlowState`: `withdrawQueue: { position, payableNow, totalQueued, totalClaimed, rateRaw, rateDecimals, recoveryActive, payout, plusdDecimals, usdcDecimals } | undefined` (raw values, `undefined` on deposit).
   - Build the withdraw `step3UserError` with `toUserError(err, { context: "withdrawClaim" })` (step 8).
8. [x] **Error mapping** in `utils/userError.ts`. Add an optional second argument `{ context?: "withdrawClaim" }`. With that context, Soroban `#2` maps to the custody-short copy. Globally, also add an EVM match for `WithdrawalQueueTooEarly` (named error, unambiguous) to the same copy, checked before the generic `execution reverted` match. The `#4` mapping is unchanged.
9. [x] **`packages/ui` StepRow / StepsCard hint.** Add optional `hint?: string` to `StepRowProps` and `StepItem`. It renders a muted caption line under the label (`--text-pipeline-caption`, `--color-pipeline-ink-muted`, body font), only when `state !== "error"` (the red error line keeps precedence). Pass it through in `StepsCard`. Update `docs/frontend/ui-components.md#stepscard` / `#steprow`.
10. [x] **Withdraw page queue card.**
    - New `components/withdraw/WithdrawQueueCard.tsx` (view) plus `components/withdraw/useWithdrawQueueCard.ts`, which formats `flow.withdrawQueue`.
    - Content:
      - A `Card variant="white"` titled "Withdrawal queue" with the "Paid in order" copy from withdraw.md verbatim.
      - `InfoRow`s:
        - "Your position" (`{pos} PLUSD`, only while a request id exists)
        - "Payable now" ("Yes" / "Not yet" / "—")
        - "Total queued" (`{n} PLUSD`)
        - "Total claimed" (`{n} PLUSD`)
    - Recovery notice: when `recoveryActive`, a `Card variant="yellow"` above it: "Recovery rate {rate}. Every claim pays USDC equal to the PLUSD burned times this rate." (from withdraw.md §During shutdown).
    - Render both in `routes/deposit.tsx` after the steps card when `!isDeposit && flow.isConnected`. Add test ids `withdraw-queue-card`, `withdraw-queue-position`, `withdraw-queue-payable`, `withdraw-queue-total-queued`, `withdraw-queue-total-claimed`, `withdraw-recovery-rate-notice`.
    - Pass `hint` for steps 2 and 3 in both `StepsCard` call sites.
11. [x] **Claim toast** in `routes/deposit.tsx`, withdraw direction.
    - When `flow.withdrawQueue?.recoveryActive`, title the success toast `Claimed {X} USDC` from the contract payout captured before submit (ref, like `lastClaimAmountRaw`), else "USDC claimed".
    - With the rate at 1, keep today's copy (unchanged behaviour).
12. [x] **Request rows.**
    - New `components/activity/WithdrawRequestQueueMeta.tsx`: a hook-using component that takes `{ chainKind, requestId }` and renders "Position {pos} PLUSD · Payable now" / "Position {pos} PLUSD · Not payable yet", with "—" parts while loading or unavailable.
    - In `renderRequestRow.tsx`'s pending `Withdraw` branch (when `item.request_id` is set), add a third caption line through a new optional `tertiary?: React.ReactNode` prop on `TwoLineAmount`.
    - Completed rows are unchanged.
    - Apply to `RecentActivityCard` and `routes/transactions.tsx` automatically (shared renderer).
13. [x] **Panel C aggregates.**
    - `components/dashboard/useWithdrawalQueuePanel.ts`: read `useWithdrawalQueueTotals(useDashboardChain().kind)` and add `totalQueued` / `totalClaimed` to `WithdrawalQueueSummaryFormatted`. Format them in the panel's style (`formatCompactUsd` of the unit-formatted decimal, the same as In Queue), "—" when unavailable.
    - `WithdrawalQueuePanel.tsx`: two more `SummaryCard`s, "Total queued" and "Total claimed" (test ids `withdrawal-queue-card-total-queued` / `-total-claimed`), after Requests. The mobile scroll row already handles extra 200 px cards. On desktop, `md:flex-1` spreads six cards; verify they don't overflow at 1280 px.
    - Panel state (`loading` / `error` / `empty`) stays driven by the API query only. A failed contract read shows "—", not a panel error.
14. [x] **Lint/build.** Run:
    - `yarn workspace @pipeline/frontend test`
    - `@pipeline/ui` tests
    - `npx tsx scripts/lint-docs.ts`
    - `npx tsx scripts/lint-comments.ts`
    - `yarn build`

    New files get one 2–3-line spec-pointer header and no other comments.

## Test Strategy

Unit tests use Vitest + RTL with `vi.mock` of chain hooks and clients. No localStorage mocks.

- `wallet/stellar/contracts/withdrawalQueue.test.ts` (new or extended): each new read builds the right `contract.call` name and arg types (`u128`), and decodes i128/bool. `simulateClaimPayout` returns the retval bigint and throws on a simulation error.
- `wallet/stellar/useStellarWithdrawalQueueReads.test.tsx` and `wallet/evm/useEvmWithdrawalQueueReads.test.tsx`:
  - disabled without a contract id or zero address, or when `enabled: false`
  - correct values passed through untouched
  - EVM `queueMetadata` tuple mapping
  - `convertToAssets` called with `10^plusdDecimals`
- `wallet/useWithdrawalQueueReads.test.tsx`: only the active kind's hooks are enabled. `isRecoveryRateActive` is false for `undefined`, for exactly 1 (Stellar `1_000_000`; EVM `10^usdcDec`), and true below.
- `wallet/withdrawClaimHint.test.ts`: every priority branch, combined states (paused plus not payable → paused copy), the payout "—" fallback, and `undefined` when nothing applies. The copy strings are asserted verbatim against withdraw.md §Delays.
- `utils/userError.test.ts`:
  - `#2` with `withdrawClaim` context gives the custody copy
  - `#2` without context stays generic
  - `#4` unchanged
  - EVM `WithdrawalQueueTooEarly()` text gives the custody copy
- `wallet/useDepositFlow.test.tsx` (extend):
  - withdraw step 3 disabled when `payableNow === false` or `paused === true`; enabled when `undefined`
  - `step3.hint` set
  - `step2.hint` set on withdraw only
  - deposit direction untouched
  - `withdrawQueue` undefined on deposit
- `api/useStellarWithdrawalVoucher.test.tsx`: the `expired` flag is true after the deadline.
- `packages/ui` `StepRow.dom.test.tsx` / StepsCard: the hint renders muted, is hidden in the error state, and is absent when not passed.
- `components/withdraw/WithdrawQueueCard.test.tsx`:
  - formatted rows
  - "—" for undefined
  - position row hidden without a request
  - recovery notice only when active
- `components/activity/renderRequestRow` test and `RecentActivityCard.test.tsx`: the pending Withdraw row shows the meta line with mocked reads. Completed and Deposit rows have no meta.
- `routes/-deposit.test.tsx`:
  - queue card and notice on withdraw only
  - success toast "Claimed X USDC" from the payout when recovery is active
  - unchanged copy at rate 1
- `components/dashboard/useWithdrawalQueuePanel.test.tsx`: the two new formatted fields, "—" on read failure, and panel state unaffected by read errors.
- **Live verification** on staging (Stellar testnet, then Hoodi), with the DevTools Network tab checked by the human or the QA agent, not by driving the user's browser:
  - Soroban `simulateTransaction` calls for `withdrawal_request_queued` / `claimable` / `total_*` / `rate`
  - the values match a direct contract read
  - "—" while RPC is blocked

  Use the existing withdraw frame `1498-100351` and Panel C `3283-14893` as the style reference only.

## Docs to Update

- `docs/product-specs/withdrawals.md`: new section "Queue position, payable now and recovery rate (LP app)":
  - the value-source table (above)
  - claim gating on `claimable`
  - hint priority and copy
  - payout source (contract only)
  - `TooEarly` mapping scope

  Also fix the Step 4 text to mention the Stellar equivalents.
- `docs/frontend/wallet-flows.md`:
  - new `#withdrawal-queue-reads` section (hooks, cadences, chain scoping)
  - `### Step model`: `hint`, and the step 3 disabled rule for withdraw
- `docs/frontend/error-handling.md`: Soroban table row for `#2` (context-scoped to the withdraw claim), the EVM `WithdrawalQueueTooEarly` match, and the code-collision note.
- `docs/frontend/dashboard-components.md`:
  - `#deposit-and-withdraw-route`: queue card, recovery notice, hints, claim toast under recovery
  - `#renderrequestrow`: tertiary meta line
  - `#withdrawalqueuepanel` / `#usewithdrawalqueuepanel`: six cards, sources
- `docs/frontend/ui-components.md`: `StepRow` / `StepsCard` `hint`.
- `docs/user-stories/epic-1795/1759-withdrawal-queue-position.md` (new, same format as `1760-fresh-voucher-after-deadline.md`). Stories:
  1. position and payable on the withdraw page
  2. custody short → hint + Claim disabled
  3. queue paused
  4. no voucher yet / verification failed
  5. voucher expired (Stellar)
  6. pending rows on Home and `/transactions` show position and payable
  7. Panel C totals match the contract
  8. recovery rate below 1: notice, claim hint with the contract payout, toast amount (testnet setup needs an admin `set_rate`; mark as needing a testnet admin or a dedicated deployment)
  9. EVM parity on Hoodi

  Add the row to `docs/user-stories/index.md` under Epic #1795.
- No tech-debt tracker entry (scope change). The missing served position / payable / queue totals / rate is tracked as backend issue #1801; the withdrawals spec source note and the user story reference #1801. The EVM WQ has no rate getter, noted in the spec.
