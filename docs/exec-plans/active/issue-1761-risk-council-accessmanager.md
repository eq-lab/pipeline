# Issue #1761: Trustee: Risk Council pages on the AccessManager model — immediate set_default, scheduled 24 h amend / write-down / cure, no Safe or proposals

Source: https://github.com/eq-lab/pipeline/issues/1761

Epic #1795 (user-docs realignment). Branch `feat/1761-trustee-risk-council-accessmanager`, draft PR #1873. Flow: frontend.

## Scope

Rebuild the Trustee console's Risk Council pages on the mechanism the user docs and the contracts describe. A Risk Council wallet calls the AccessManager (AM). It runs a single `execute` when `can_call` returns `immediate`. Otherwise it runs `schedule`, waits for the delay, then runs `execute`. There are no Safe, proposals, votes or timers. Sources of truth: `docs/user-docs/governance/risk-committee.md`, `governance/multisig-roles.md`, `governance/fiduciary-trustee.md` §"Independence", `how-it-works/protocol-layer.md` §"Roles", `risks/default-management.md` (closure table, §"Declaration", §"Write-down", §"Cure"), `security/emergency-response.md`.

Contract facts, read on 2026-11-09 from the deployed Stellar testnet contracts with `contract.Client.from` and simulated reads only (nothing was submitted):

- LoanRegistry `CDWN5…VXZQ`. Its owner is the AM `CDP7…WHTW` (`VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`). `get_target_function_role(registry, fn)` = `RISK_COUNCIL` for all six functions below, and the role guardian is `GUARDIAN`.
  - `set_default(loan_id: u32)`
  - `cure(loan_id: u32)`
  - `amend_economics(loan_id: u32, new_rate: u32, new_maturity_timestamp: u64)`. `new_rate` uses the same bps × 100 scale as `rollover` (`encodeRolloverArgs`; the worker reader divides `current_rate` by 100).
  - `adjust_interest(loan_id: u32, delta: i128, reason_hash: BytesN<32>)`
  - `write_down(loan_id: u32, amount: u128)`. The amount is in 7-decimal SAC base units.
  - `close_defaulted(loan_id: u32, reason: ClosureReason)`. `reason` is `Default` or `OtherWriteDown`, encoded like `close_loan` as `scvVec([scvSymbol(reason)])`.
  - Reads: `loan_money(loan_id) -> LoanMoney { accrued_interest, carved_out, disbursed, outstanding, repaid, written_down }` and `mutable_loan_data(loan_id) -> MutableLoanData { status, closure_reason, current_rate, current_maturity_timestamp, interest_adjustment, written_down, carved_out, … }`.
- AM: `can_call`, `hash_operation(caller, target, fn, args)` (the id covers the caller), `get_schedule(id) -> u64`, `schedule(target, fn, args, when, caller)`, `execute(target, fn, args, caller)`, `cancel(…, canceller)`. Errors: #6 NotScheduled, #7 NotReady, #8 Expired, #9 AlreadyScheduled, #11 UnauthorizedCancel.

In scope (Stellar):

1. A shared Risk Council AM action layer: `@pipeline/wallet-connect` encoders and reads, plus one trustee hook pair (access + relay) used by every page. It mirrors #1711's `useReverseRepayAccess` / `useReverseRepayMutation`.
2. **Escalate to Default** (`/risk-council/escalate/$id`, flow 10). Calls `set_default`, following `can_call` exactly like #1711. Removes the proposal name/text builder, the Draft → Submitted state, the Safe guardrail list and chips, and the mock "→ Y% if defaulted" projection.
3. **Amend economics** (`/risk-council/reterm/$id`, flow 11). Real `amend_economics` form (new rate %, new maturity date) and `adjust_interest` form (signed USD delta, reason). Both are scheduled, then executed. Removes `MOCK_PROPOSAL_TIMESTAMP`, `MOCK_PROPOSED_TERMS` and "View Safe proposal".
4. **Default resolution** (`/risk-council/writedown/$id`, flow 12). `write_down`, then `close_defaulted` (reason `Default` / `OtherWriteDown`), plus **Cure** (`cure`). Removes the signer/voting panel, the mock close payload, the queue timer and the recovery/write-down literals.
5. **Risk Council hub** (`/risk-council`). Scheduled operations, built from (a) operations this console scheduled in this browser session (page-local, in memory) and (b) deterministic `set_default` / `cure` lookups for each loan on the session's chain. Plus a per-loan action index. "—" where nothing can be read.
6. Role-driven availability. Every action button is enabled only per `can_call` for the connected wallet. A wallet with `immediate: false, delay: 0` (for example Trustee-only) sees the pages read-only with the docs' wording ("… belongs to the Risk Council").
7. After every mutation, refetch and display chain state. Nothing is computed client-side.
8. Docs: rewrite `docs/frontend/trustee-flows.md` §"Risk Council actions", `docs/product-specs/trustee-dashboard.md` §"Type 3" (and its row in "Four types"), and `docs/product-specs/trustee-risk-watchlist.md` §"Escalation" (and the Past Due bullet). Fix the RISK_COUNCIL bullet in `loans-data.md`. Add a user-stories doc. Add tech-debt entries.

Out of scope:

- **EVM arm** (#1573/#1574). EVM is **read-only, not hidden**. On a per-loan page for a non-Stellar loan, the loan evidence still renders. The chain-state card shows "—". Every action card is disabled and prints `stellarOnlyActionReason(chainId)` (TD-152 pattern, as in #1711). On the hub, when `useSessionState().chainId` is not Stellar, the page shows only the header and the same reason line. No EVM reads, no EVM encoders.
- **Full hub list.** Nothing indexes AM `OperationScheduled`. Operations with arguments (`amend_economics`, `adjust_interest`, `write_down`, `close_defaulted`) that another session or browser scheduled cannot be listed. This needs a worker parser and an API route, which is backend work and not planned here (TD entry, Step 7).
- **Cancelling** a scheduled call (`AM.cancel`). The docs allow the scheduler, the Guardian or the Admin to cancel. TD-159 already records that the app cannot cancel. Extend it to the Risk Council operations; do not build it.
- #1756 (deployment delays), #938 (Watchlist current-stage card: stays hidden; its body copy is left to #938), #1767 (security registry / LTV: the CCR rows on the escalate ledger card stay as they are).
- Repayment reversal (#1711) behaviour: unchanged. Only its pure helpers move (Step 1).
- Any new Figma work. The existing page shells, cards, chips and tokens are reused for styling only.

## Assumptions and Risks

- **Contract preconditions are not readable here.** The contract source lives in the separate contracts repo. The UI gates follow the docs:
  - `set_default`: chain status `Performing` or `WatchList`.
  - `cure`, `write_down`, `close_defaulted`: status `Default`.
  - `amend_economics`, `adjust_interest`: any status except `Closed` or `Approved`.

  The contract stays the authority. Simulation errors surface through `toUserError` and the AM error copy. If a gate turns out to be wrong on chain, fix the gate (one constant per function).
- **close_defaulted gating (decision).** The docs say a defaulted loan "can be closed only after its outstanding principal is zero". Scheduling is not closing. So **Schedule close** is allowed whenever the status is `Default`, which lets it run in parallel with the write-down delay. **Execute close** is enabled only when chain `loan_money.outstanding` is the string `"0"` (a string comparison, like #1711's `ZERO_SERVED`). Otherwise the copy reads "Executable once the outstanding principal is zero." A close scheduled too early can expire (7 days after its ready time, per `loan-repayment-recovery.md`).
- **Write-down amount (decision).** A USD input prefilled with the chain `loan_money.outstanding`, formatted verbatim by `formatChainAmount`. It is converted with `usdInputToSacBaseUnits` (7 decimals). The default fills the field only; nothing is subtracted.
- **adjust_interest reason hash (decision).** `reason_hash = sha256(utf8(reason.trim()))`. The signed delta is entered as USD with an optional leading `-` (negative = waiver, per the `InterestAdjusted` parser doc) and converted to i128 base units. The hash hex is shown under the field, so the same reason re-entered after a reload finds the pending schedule.
- **Finding schedules after a reload.** `hash_operation` covers the caller and byte-identical args.
  - `set_default` / `cure` are looked up from `[loan_id]` alone, on every page load and on the hub.
  - The forms with arguments run `readOperationSchedule` on the form's current valid args, the same way #1711 recomputes `ref_hash`. Re-entering the same values shows "Scheduled. Executable from …".
  - No `localStorage`.
  - Lookups use the connected wallet as `caller`. A Trustee-only session therefore never sees the Risk Council's pending operations, and the hub says so ("—" plus the indexer note). No env var for the Risk Council account is added.
- **A schedule that disappears.** `get_schedule` reads `0` after `execute`, after `cancel` and (assumed, OZ semantics) after expiry. The AM state cannot tell these apart. For an operation in the page-local store that this console did not execute, the state reads: "No longer scheduled — cancelled by the Guardian or the Admin, or executed from another session." The chain-state card next to it shows what actually happened. An execute after expiry fails with #8 and gets its own copy.
- **Rate scale.** `amend_economics` uses `new_rate = bps × 100`, matching `rollover` and the worker reader (`loan_registry_reader.rs:263`). A wrong scale would write a 100× rate, so the encoder test pins it, and the chain-state card shows `current_rate / 100` bps after the execute. Decoding the contract's fixed unit is the same kind of step as `chainAmountDecimals`. It is not a derived metric.
- **Testnet state.** On 2026-11-09 `next_loan_id()` on `CDWN5…` returned `0`. Live verification needs a loan on the configured registry and a Risk Council wallet that is also in the API `auth_users` trustee allow-list. On the current deployment the whole role is delayed (#1756), so `set_default` takes the scheduled path there. The immediate path needs no app change once #1756 lands.
- **Overlap with #1768** (docs realignment, open). That issue lists the same three spec sections. This issue owns the Risk Council sections. Leave a short comment on #1768 when the PR opens (manager), so it does not rewrite them twice.
- **User-stories location.** The issue body says `docs/user-stories/epic-1521/`. Epic #1795 moved the issue and names `docs/user-stories/epic-1795/` as the QA source. Use `epic-1795`.
- **Spec line cap.** `trustee-dashboard.md` is at **199** lines (cap 200). The §"Type 3" rewrite must not add net lines. Extra detail goes to `docs/frontend/trustee-flows.md` (no cap). `trustee-risk-watchlist.md` is at 52 and `loans-data.md` at 197; keep both ≤ 200.
- **RPC load on the hub.** One `can_call` plus 2 simulations (hash + schedule) per eligible loan. Query only loans whose chain status makes the call valid (`set_default` for Performing/WatchList, `cure` for Default), on the session's chain. Use one React Query per loan with `staleTime` 30 s.

## Open Questions

_None_

## Implementation Steps

Land the steps in order. Each step keeps `yarn workspace @pipeline/trustee test`, `tsc` and lint green. Every new or rewritten file gets exactly one `// spec:` header line (2–3 lines max) and no other comments. When a rewritten file is listed in `scripts/lint-comments.baseline.json` (the `-risk-council-*` test files are, lines 762–790), remove its entry.

### Step 1 — Shared AccessManager action layer

**1a. `@pipeline/wallet-connect`.** New `packages/wallet-connect/src/stellar/contracts/riskCouncil.ts`, header `// spec: docs/frontend/trustee-flows.md#risk-council-actions`.

- `export type RiskCouncilCall` is a discriminated union on `fn`:
  - `{ fn: "set_default"; loanId }`
  - `{ fn: "cure"; loanId }`
  - `{ fn: "amend_economics"; loanId; rateBps; maturity }`
  - `{ fn: "adjust_interest"; loanId; delta: string /* signed base units */; reasonHash: string /* hex */ }`
  - `{ fn: "write_down"; loanId; amount: string /* base units */ }`
  - `{ fn: "close_defaulted"; loanId; reason: "Default" | "OtherWriteDown" }`
- `encodeRiskCouncilArgs(call): xdr.ScVal[]`:
  - Validates `loanId` (u32 integer ≥ 0).
  - `rateBps` is an integer in 1..10 000, encoded as `u32(rateBps * 100)`.
  - `maturity` is a positive integer, encoded as `u64`.
  - `amount` is a positive base-unit integer string, encoded as `u128`.
  - `delta` is a non-zero signed integer string, encoded as `i128` via `nativeToScVal(BigInt, { type: "i128" })`.
  - `reasonHash` is 64 hex chars, encoded via `hexToBytes32ScVal`.
  - `reason` is encoded as `scvVec([scvSymbol])`.
  - It throws `encodeRiskCouncilArgs: …` on bad input.
- `relayRiskCouncil({ mode, call, accessManagerId, registryId, caller, rpcUrl, networkPassphrase, signTransaction, onStageChange })` calls the existing `relay` with `target: registryId, fn: call.fn, args: encodeRiskCouncilArgs(call)`.
- `readRiskCouncilSchedule({ call, accessManagerId, registryId, caller, … })` calls the existing `readOperationSchedule`.
- `riskCouncilReasonHash(reason: string): Promise<string>` returns sha256 hex of the trimmed UTF-8 reason. Move `sha256Hex` from `minter.ts` into a small shared `stellar/contracts/hash.ts` and import it in both files. Keep `reverseRepayRefHash` byte-identical.
- `readLoanMoney({ registryId, loanId, rpcUrl, networkPassphrase })` returns `LoanMoney` with every u128 as a decimal string and `carvedOut: boolean`.
- `readLoanChainState(...)` reads `mutable_loan_data` and returns `{ status, closureReason, currentRate: number (raw), currentMaturity: number, interestAdjustment: string, writtenDown: string, carvedOut: boolean }`. Decode unit-enum unions from `scValToNative` (an array `["Default"]`) to their tag string. Use `simulateRead`, mirroring `readRepaymentData`.
- Export all of the above, plus their types, from `packages/wallet-connect/src/index.ts`, next to the existing `accessManager` block.

**1b. Trustee shared helpers.** New `packages/trustee/src/lib/accessManagerAction.ts`. Move these pure helpers out of `routes/-repayment-recovery.ts` and re-export them there under the same names, so #1711 code and tests are untouched: `reverseAction` (generalised as `accessAction`, with `reverseAction = accessAction`), `formatDelayHours`, `formatReadyAt`, `stageLabel`. Add:

- `amErrorCode(details): string | null`, which extracts the `Error(Contract, #N)` code. `recoveryErrorCopy` reuses it.
- `RISK_COUNCIL_AM_ERROR_COPY` for `execute:6`, `execute:7`, `execute:8` ("expired, schedule it again") and `schedule:9`.
- `riskCouncilRoleLine(action, delaySeconds, readyAt, noRoleCopy)`. Docs wording:
  - `execute-now`: "Risk Council: this executes at once, with one signature."
  - `schedule`: "Risk Council: this deployment applies a {N h} delay. Schedule it, then execute after the ready time. The Guardian or the Admin can cancel it during the wait."
  - `execute-scheduled`: "Scheduled. Executable from {UTC}."
  - `no-role`: the per-action copy, e.g. "Declaring a default belongs to the Risk Council."

**1c. Trustee API hooks.** New `packages/trustee/src/api/useRiskCouncil.ts`:

- `riskCouncilConfig()` needs `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` and `ENV.STELLAR_LOAN_REGISTRY_ID`. If either is missing: "On-chain Risk Council actions are not configured for this environment."
- `useRiskCouncilAccess(chainId, call | null, fn)` is a `useQuery` with key `["risk-council-access", address, fn, callKey]`, where `callKey` is a stable JSON of the call or `null`. It is enabled only for a Stellar `chainId` with a connected address. It reads `readCanCall(fn)`. When `!immediate && delay > 0` and `call !== null`, it also reads `readRiskCouncilSchedule`. It returns `{ canCall, schedule }`. `staleTime` 5 s, `retry: false`.
- `useRiskCouncilRelay()` is a `useMutation<{hash}, Error, { mode, call, chainId }>`, with stage state like `useReverseRepayMutation`. On success:
  - invalidate `risk-council-access`, `risk-council-loan`, `risk-council-hub`, `loan-book`, `loan-financials` and `audit-log` immediately, then again at 5 s and 15 s;
  - for `mode === "schedule"`, `recordScheduledOp({ chainId, call })`;
  - for `mode === "execute"`, `markExecuted(call)` (see 1d).
- `useRiskCouncilLoanState(chainId, loanId)` is a `useQuery` with key `["risk-council-loan", chainId, loanId]`, Stellar only. It runs `Promise.all([readLoanChainState, readLoanMoney])` with `staleTime` 15 s and returns raw chain values.

**1d. Page-local scheduled-ops store.** New `packages/trustee/src/lib/riskCouncilOps.ts`. It is an in-memory module store with `useSyncExternalStore`, the same shape as `auth/sessionStore.ts`, and no storage.

- `recordScheduledOp`, `markExecuted`, `useScheduledOps(chainId)` and `_resetRiskCouncilOpsForTests`.
- An entry is `{ chainId, call, scheduledAt: number /* Date.now at record, display only */, executedHere: boolean }`, keyed by `fn + callKey`.

### Step 2 — Escalate to Default (flow 10)

- **`routes/-risk-council-escalate.ts`** (rewrite; one `// spec:` header).
  - Keep the real ledger wiring: `formatFacilityLine`, `buildCollateralLabel`, `formatCcrLine`, `classifyCcr`, CCR trend, days on watchlist, current at-risk %, concentration.
  - Delete `MOCK_AT_RISK_PROJECTED_PCT`, `buildAtRiskLine`'s projected half, `buildRepaidToDate` (client subtraction) and all proposal state.
  - Replace "Repaid to date" with "Principal repaid" from chain `loan_money.repaid` via `formatChainAmount(raw, chainId)`.
  - Add `chainState: LabelValue[]`: Status (on chain), Outstanding principal, Written down, Pocket opened (`carved_out` → "Yes"/"No"), each "—" when unread.
  - Add `action`: from `useRiskCouncilAccess(chain, {fn:"set_default", loanId}, "set_default")`, `accessAction`, the role line with no-role copy "Declaring a default belongs to the Risk Council.", stage, error (AM copy) and the success hash.
  - `eligibility`: enabled when chain status ∈ {Performing, WatchList}. For `Default`, show the line "This loan is in Default." with a link to `/risk-council/writedown/$id`. For `Closed`/`Approved`, show "Not available for a {status} loan."
  - `blockedReason = stellarOnlyActionReason(chain)`.
  - Expose `effects` copy from `default-management.md` §"Declaration": "The loan moves to Default. On the first default its outstanding principal moves out of the staking vault into a pocket for this loan; the sPLUSD share price falls by the amount moved."
- **`routes/risk-council.escalate.$id.tsx`.**
  - Keep the page shell, back link, title ("Escalate to Default — {originator}") and the ledger card (minus the projected span).
  - Replace `ProposalBuilderCard` with `DeclareDefaultCard`: card title "Declare default", the role line, the effects text, a primary button, the stage text, inline error, the success hash, then a chain-state list (`chainState`) that re-renders after the refetch.
  - Button label by action: `execute-now` "Declare default", `schedule` "Schedule default", `execute-scheduled` "Execute default".
  - The primary button opens a confirm dialog (`role="dialog"`, the `aria-modal` / Escape / backdrop pattern of `DisbursementConfirmDialog` in `loans.$id.tsx`, copied locally) with "Declare default on Loan #{id}? The pocket opens on the first default." Confirm triggers the relay.
  - Replace the chips "Risk Council Safe · 24h timelock" / "Draft|Submitted" with one chip from `can_call`: "Risk Council · executes at once", "Risk Council · {N h} delay" or "Risk Council only".
  - Add links to "Amend economics →" (`/risk-council/reterm/$id`, same `chain` search).
- **`routes/-loanDetailStatic.ts`.** Change every "…they are Risk Council proposals under a 24h timelock." note to: "Declaring default, cure, write-down and amendments belong to the Risk Council." Labels are unchanged. Update the matching `-loans.$id.test.tsx` assertions.

### Step 3 — Amend economics + adjust interest (flow 11)

- **`routes/-risk-council-reterm.ts`** (rewrite).
  - Delete `MOCK_PROPOSAL_TIMESTAMP` and `MOCK_PROPOSED_TERMS`.
  - Current terms come from chain via `useRiskCouncilLoanState`: rate as `formatBpsRate(currentRate / 100)`, maturity as `formatMaturityDate` of `current_maturity_timestamp`, accrued interest and interest adjustment as `formatChainAmount`. Keep the loan label (`formatLoanLabel`) and CCR from the loan book. The `formatCurrentCoupon` fallback is no longer needed; drop it with its tests.
  - Amend form state: `ratePercent` (`percentToBps`), `maturityDate` (date input converted to unix UTC midnight). Extract the rollover dialog's inline conversion into `utils/formatDate.ts` `dateInputToUnixUtc` and use it in both places. `call` is non-null only when both fields are valid. `useRiskCouncilAccess(chain, call, "amend_economics")` finds an existing schedule for those exact args.
  - Adjust-interest form state: `deltaUsd` (optional leading `-`, then `usdInputToSacBaseUnits` on the absolute value, then the sign reapplied) and `reason` (non-empty → `riskCouncilReasonHash`, async, held in state). `call` is non-null when both are valid.
  - Eligibility: status not in {Closed, Approved}. Non-Stellar → `blockedReason`. No-role copy: "Changing loan economics belongs to the Risk Council."
- **`routes/risk-council.reterm.$id.tsx`.**
  - Keep the shell and `CurrentTermsCard` (now chain-sourced).
  - Replace `ProposedTermsCard` with `AmendEconomicsCard`: rate % with a live "= N bps" echo like rollover, a date input, the role line, the action button, stage, error and hash.
  - Add `AdjustInterestCard`: delta, reason, reason hash (hex, read-only), the role line, button, stage, error and hash.
  - Remove the timestamp line, the "24h timelock" chip, the footer copy and "View Safe proposal". The chip follows the can_call pattern from Step 2.

### Step 4 — Default resolution: write-down, close, cure (flow 12)

- **`routes/-risk-council-writedown.ts`** (rewrite). Delete all `MOCK_*`, `SignerStatus` and `ClosePayload`.
  - Chain-state rows: Status, Outstanding principal, Disbursed, Repaid, Written down, Pocket opened, Closure reason.
  - `writeDown`: amount input prefilled once from `formatChainAmount(outstanding)` (the input's initial value, editable), `call` `{fn:"write_down", amount}`, access, action, role line, stage, error, hash. Enabled when status is `Default`.
  - `close`: reason radio (`Default` default-selected, `OtherWriteDown`), `call` `{fn:"close_defaulted", reason}`, access. Schedule is enabled when status is `Default`. Execute (both `execute-now` and `execute-scheduled`) additionally requires `loanMoney.outstanding === "0"`; otherwise the gate copy is "Executable once the outstanding principal is zero."
  - `cure`: `call` `{fn:"cure"}`, enabled when status is `Default`. Effects copy from `default-management.md` §"Cure": "The loan returns to WatchList. The pocket stays open; later repayments still go to the pocket holders."
  - No-role copy: "Writing down, closing a defaulted loan and curing belong to the Risk Council."
  - A non-Default loan shows "This loan is not in Default." and links back to escalate.
- **`routes/risk-council.writedown.$id.tsx`.**
  - Title "Default resolution — {loan}".
  - Left card: chain state.
  - Right column: three action cards, in order Write down, Close defaulted loan, Cure. Each has the role line, button, stage, error and hash.
  - The close card also renders the closure table rows for Default / Other write-down ("Risk Council only · 24 hours"), verbatim from the docs.
  - Delete `SignerRow`, `ClosePayloadCard`, the code block, the queue chip and the "Safe proposal" footer.
  - Each action card shows "No longer scheduled — cancelled by the Guardian or the Admin, or executed from another session." when its page-local op exists, `executedHere` is false and the schedule now reads `0`.

### Step 5 — Risk Council hub

- **New `routes/-risk-council-hub.ts`** (presenter).
  - `chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID` (chain-scope rule). If it is not Stellar, return `{ blockedReason }` only.
  - `useLoanBook(chainId)` gives the loans.
  - `useRiskCouncilHubLookups(chainId, loans)`, a new query in `api/useRiskCouncil.ts` with key `["risk-council-hub", address, chainId, loanIds]`, runs for each loan:
    - `onchain_status ∈ {Performing, WatchList}` → `readRiskCouncilSchedule(set_default)`;
    - `Default` → `readRiskCouncilSchedule(cure)`.

    It keeps only `readyAt > 0`.
  - Merge with `useScheduledOps(chainId)`, re-reading each page-local op's schedule in the same query.
  - Rows: `{ loanLabel, action label, args (verbatim: rate bps / maturity date / USD amount / reason / delta), executableFrom: formatReadyAt(readyAt) | "—", state: "Scheduled" | "No longer scheduled — …", link }`.
  - Plus a `loans` index: each session-chain loan with its on-chain status and links. Performing/WatchList → "Declare default", "Amend economics". Default → "Resolve default", "Amend economics". Closed → none.
  - Role line from `can_call(set_default)` for the connected wallet. A no-role wallet sees "Risk Council actions belong to the Risk Council. Pending operations are visible to the scheduling wallet only." with the scheduled table showing "—".
- **`routes/risk-council.index.tsx`.**
  - Heading from nav, then the docs sentence: "The Risk Council acts through the access manager. Declaring a default executes at once; every other Risk Council action waits 24 hours, and the Guardian or the Admin can cancel it during the wait."
  - A "Scheduled operations" table, an empty state "No scheduled operations found.", and the footnote: "Lists operations scheduled from this console in this session, and declared defaults or cures pending for any loan. Other scheduled operations need an indexer and are not listed yet."
  - A "Loans" table. Styling reuses the Loans table tokens.
- **`lib/nav.ts`.** Risk Council description: "Risk Council actions through the access manager: declare default, amend, write down, close, cure."

### Step 6 — Tests (per step; see Test Strategy) and lint

Run `yarn workspace @pipeline/wallet-connect test`, `yarn workspace @pipeline/trustee test`, `npx vite build` then `yarn build` in `packages/trustee` (no new route files, so `routeTree.gen.ts` should not change; commit it if it does), `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts` (shrink the baseline) and the ESLint `no-restricted-imports` boundary (the trustee must not import `@stellar/stellar-sdk`).

### Step 7 — Docs

- **`docs/frontend/trustee-flows.md` §"Risk Council actions".** Rewrite in full:
  - sources;
  - the AM model with the contract signatures above and the bps × 100 note;
  - `can_call` gating and the four action states;
  - schedule lookup rules (arg-free vs re-entered args, caller-scoped);
  - the page-local store;
  - each page's rows, gates and copy;
  - the close-defaulted schedule/execute split;
  - the hub sources and their indexer gap;
  - EVM read-only;
  - config and roles (`auth_users`);
  - error copy (#6/#7/#8/#9);
  - "Not in the app: cancel (TD-159)".

  Delete the proposal-builder and real-vs-mock text. Update the "Stellar-only gate" bullet in §"Wired actions", which calls Escalate a "read-only page".
- **`docs/product-specs/trustee-dashboard.md`** (199 lines; net lines ≤ 0). "Four types" row 3: "Risk Council action | A Risk Council wallet calls the access manager | Nobody (the Risk Council is one multisig account) | None for default and repayment reversal; 24 h for the rest, Guardian/Admin-cancelable | Execute, or schedule then execute; the Trustee role cannot". Rewrite §"Type 3" to the AM model, with the flow table rows using `set_default(loan_id)`, `amend_economics` / `adjust_interest`, `write_down` → `close_defaulted(Default | OtherWriteDown)` and `cure`. Link `risk-committee.md` and `default-management.md`. Detail lives in trustee-flows.
- **`docs/product-specs/trustee-risk-watchlist.md`.** Rewrite §"Escalation": the Trustee cannot declare default, cure, write down or close with a loss. It escalates off-chain. The Risk Council declares default on the loan registry at once (scheduled while #1756 is open), and the rest waits 24 h. The console shows the evidence and the Risk Council's action pages. Update the Past Due "Escalate to default" bullet (drop "24h timelock").
- **`docs/product-specs/loans-data.md`** (197 lines). Replace the "3-of-5 multisig under a 24h AccessManager timelock" bullet, without adding net lines, with: "Stellar Risk Council functions, all `RISK_COUNCIL` through the AccessManager: `set_default(loan_id: u32)`, `cure(loan_id)`, `amend_economics(loan_id, new_rate: u32 /* bps×100 */, new_maturity_timestamp: u64)`, `adjust_interest(loan_id, delta: i128, reason_hash: BytesN<32>)`, `write_down(loan_id, amount: u128)`, `close_defaulted(loan_id, reason: ClosureReason)`; default and reversal immediate per the user docs, the rest 24 h (#1756 for the current deployment)."
- **New `docs/user-stories/epic-1795/1761-risk-council-access-manager.md`.** Same format as `epic-1521/1711-repayment-recovery.md`. Stories:
  1. A Trustee-only wallet sees all three pages and the hub read-only, with the "belongs to the Risk Council" lines.
  2. A Risk Council wallet with a delay schedules `set_default`, then reloads and sees "Executable from …".
  3. It executes after the ready time; the status reads Default and the pocket reads Yes after the refetch.
  4. Amend economics is scheduled; re-entering the same values after a reload finds the schedule.
  5. Adjust interest is scheduled with a reason.
  6. Write-down is scheduled and executed, and the outstanding principal reads 0.
  7. Close-defaulted can be scheduled, but its execute is gated until the outstanding principal is 0, then the loan reads Closed with the reason.
  8. Cure returns the loan to WatchList with the pocket still open.
  9. The hub lists the pending default/cure, and an op scheduled from this session.
  10. A scheduled op cancelled by the Guardian shows "No longer scheduled".
  11. An EVM loan or EVM session is read-only with the Stellar-only reason.
  12. The immediate path (after #1756) is a single execute.
- **`docs/exec-plans/tech-debt-tracker.md`.**
  - New **TD-175**: "Risk Council hub cannot list operations scheduled elsewhere". Location `routes/-risk-council-hub.ts`. Gap: no `OperationScheduled` / `OperationCanceled` / `OperationExecuted` indexer or API. Fix: worker parser + `/v1/risk-council/operations` (backend).
  - Extend TD-159's location and gap to the Risk Council operations.
  - TD-152: add the Risk Council pages to the EVM-gated list.

## Test Strategy

Unit and component tests with Vitest. Stub wallet-connect reads and relays with `vi.mock("@pipeline/wallet-connect")`, as `-useRepaymentRecovery.test.tsx` does. No live RPC in tests.

**Step 1**

- `riskCouncil.test.ts` (wallet-connect):
  - each `encodeRiskCouncilArgs` arm produces the exact ScVal types and order. Pin: `set_default` → `[u32]`; `amend_economics` rate `1450` bps → `u32(145000)`, maturity `u64`; `adjust_interest` negative delta → `i128` with the sign, reason hash → `bytes32`; `write_down` → `u128`; `close_defaulted` → `vec[symbol "OtherWriteDown"]`;
  - rejects a negative/non-integer loanId, rate 0 or > 10 000, a zero amount or delta, and a bad hex;
  - `relayRiskCouncil` passes `target = registryId`, `fn` and the encoded args to `relay` in both modes;
  - `readRiskCouncilSchedule` forwards to `readOperationSchedule`;
  - `readLoanMoney` / `readLoanChainState` map a `scValToNative` fixture, including the `["Default"]` enum decode and the bigint → string conversion;
  - `riskCouncilReasonHash` gives the known sha256 vector;
  - `reverseRepayRefHash` is unchanged after the `sha256Hex` move (the existing test stays green).
- `-accessManagerAction.test.ts`: `accessAction` returns all five outcomes; the `reverseAction` alias stays identical; `riskCouncilRoleLine` covers each state; `amErrorCode` and the copy map. The existing `-repayment-recovery.test.ts` passes unchanged.
- `-useRiskCouncil.test.tsx`:
  - access reads `can_call` only when immediate;
  - it reads the schedule when delayed and the call is non-null;
  - it does not read the schedule when the call is null;
  - it is disabled for an EVM chain or without an address;
  - the relay calls schedule/execute with the right params;
  - the relay invalidates the listed keys, including the 5 s / 15 s timers (fake timers);
  - schedule records into the ops store; execute marks it executed;
  - the not-configured error.
- `-riskCouncilOps.test.ts`: record, dedupe by key, mark executed, chain filtering, subscription notifications.

**Step 2**

- `-risk-council-escalate.test.ts`: chain-state rows for each `carved_out` value and "—" when unread; the eligibility matrix by status; "Principal repaid" is formatted from raw; no `MOCK_` export remains.
- `-risk-council-escalate-page.test.tsx` (rewrite):
  - the Trustee-only wallet (`delay 0, immediate false`) sees the disabled button and "Declaring a default belongs to the Risk Council.";
  - delayed + no schedule shows "Schedule default", and confirm calls the relay with `mode: "schedule"`;
  - delayed + scheduled shows "Executable from 2026-… UTC" and "Execute default";
  - immediate shows "Declare default" and runs a single execute;
  - the confirm dialog's Escape/backdrop cancels without relaying;
  - the stage texts render;
  - AM #7 shows its copy;
  - a Default loan shows the link to the resolution page;
  - an EVM loan shows the Stellar-only reason with the evidence still rendered;
  - no "Safe", "proposal" or "timelock" text remains anywhere on the page.
- `-loans.$id.test.tsx`: the new note copy.

**Step 3**

- `-risk-council-reterm.test.ts`: current terms come from the chain fixture (rate `145000` → `formatBpsRate(1450)` = "14.5%"); the call is null until both fields are valid; delta sign handling (`-1,000.5` → `-10005000000`); the reason hash is wired.
- `-risk-council-reterm-page.test.tsx`: the "= N bps" echo; invalid rate error; schedule/execute per access; re-entered args show "Scheduled. Executable from …"; the adjust-interest card flow; the Trustee-only read-only line; no "View Safe proposal".
- `-formatDate.test.ts`: `dateInputToUnixUtc`. The rollover dialog tests stay green.

**Step 4**

- `-risk-council-writedown.test.ts`: the amount prefill comes from raw outstanding; the close execute gate (`"0"` vs `"1"`) with the schedule still allowed; cure eligibility; the non-Default path.
- `-risk-council-writedown-page.test.tsx`:
  - three cards with their role lines;
  - write-down schedule → execute;
  - close: radio reason sent as `OtherWriteDown`, execute disabled with the copy while outstanding > 0, enabled at `"0"`;
  - cure schedule;
  - "No longer scheduled — …" when the page-local op exists, is not executed here and the schedule reads 0;
  - no signer rows, no code block;
  - EVM read-only.

**Step 5**

- `-risk-council-hub.test.ts` + `-risk-council.index.test.tsx` (rewrite):
  - an EVM session shows the reason only;
  - lookups run only for eligible statuses (spy counts);
  - the merge of page-local and deterministic rows, without duplicates;
  - "—" for the no-role wallet;
  - the empty state and footnote;
  - the loans index links carry `chain`;
  - the heading is still "Risk Council".

**Build and lint:** `tsc`, `vite build`, ESLint, `lint-docs` (product specs ≤ 200: check `wc -l` of `trustee-dashboard.md` ≤ 200), `lint-comments`.

**Manual (coder, not a QA phase).** Have the user hard-refresh their running dev server; do not drive their browser. Ask them to report the Network/console output for one delayed `set_default` schedule on testnet, if a Risk Council wallet and a loan exist on the configured registry. Without them, the unit coverage above is the gate, and the user-stories doc carries the live checks.

## Docs to Update

- `docs/frontend/trustee-flows.md` §"Risk Council actions" (full rewrite) and §"Wired actions" "Stellar-only gate" bullet.
- `docs/product-specs/trustee-dashboard.md` "Four types" row 3 and §"Type 3" (199 lines now; keep ≤ 200, net lines ≤ 0).
- `docs/product-specs/trustee-risk-watchlist.md` §"Escalation" and the Past Due bullet (52 lines now).
- `docs/product-specs/loans-data.md` RISK_COUNCIL security bullet (197 lines now; net lines ≤ 0).
- `docs/user-stories/epic-1795/1761-risk-council-access-manager.md` (new).
- `docs/exec-plans/tech-debt-tracker.md`: TD-175 (new), TD-159 and TD-152 (extended).
- `scripts/lint-comments.baseline.json`: remove entries for the rewritten `-risk-council-*` test files.
