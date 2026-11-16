# Issue #1924: Trustee: Risk Council hub and loan pages — pending operations from the API, execute from any session (closes TD-177)

Source: https://github.com/eq-lab/pipeline/issues/1924 (epic #1920, flow: frontend)

## Scope

Replace the session-only scheduled-operations sources on the Risk Council hub and the LoanRegistry Risk Council pages with `pending_operations` served on every `GET /v1/loan-book` row (#1922, PR #1928). Add the #1923 "Scheduled operations" block (same row, same Execute with `args_xdr` verbatim, caller-only, `get_schedule` pre-check) to the escalate, reterm and writedown pages and to the repayment-recovery dialog. Close TD-177.

In scope:

1. **Hub** (`/risk-council`, `routes/-risk-council-hub.ts`, `routes/risk-council.index.tsx`):
   - rows come from `useLoanBook(chainId).data.loans[].pending_operations`, plus the #1923 session bridge rows (operations this console scheduled whose id the API does not serve yet), merged per loan with `mergePendingOps`;
   - `useRiskCouncilHubLookups`, `hubCallsFor`, `HubLookup`, `callLoanId` and the `"risk-council-hub"` query key are removed;
   - columns: Loan, Action, Arguments, **Scheduled by**, Executable from, State, link. State is "Waiting", "Ready" or "Expired" (expired rows are listed). No Execute on the hub: the link opens the page that executes it (`reverse_repay` links to the loan detail page, where the recovery dialog lives);
   - every wallet sees the rows (the API is not per-caller); the no-role "—" row goes away and the no-role line drops "Pending operations are visible to the scheduling wallet only.";
   - the footnote is replaced with one about non-loan operations (`set_inspectors`) only;
   - `set_inspectors` session rows are no longer listed on the hub.
2. **Per-loan "Scheduled operations" card** (first card of the right column), reusing `PendingOperationsCard`. Every surface lists **all** of the loan's pending operations (Decision 1). A row whose function the surface owns gets Execute; a row owned by another surface gets a link to that surface instead. Ownership:
   - `/risk-council/escalate/$id` owns `set_default`;
   - `/risk-council/reterm/$id` owns `amend_economics` and `adjust_interest`;
   - `/risk-council/writedown/$id` owns `write_down`, `close_defaulted` and `cure`;
   - `/risk-council/security/$id` (#1923) owns `set_terms`, `resolve_flag` and `release_with_consent`;
   - the repayment-recovery dialog (`/loans/$id` → `-RepaymentRecoveryDialog.tsx`, step 1) owns `reverse_repay` (Minter).
   The card is added to escalate, reterm, writedown and the recovery dialog. The #1923 security page is extended the same way (Step 9), because it already has the loan-book entry and the change is a merge of two served lists plus the shared link rendering.
   Execute on owned rows applies the form's status gates for `ready` rows (Decision 2).
3. **Generic pending model** (`routes/-risk-council-pending.ts`): decoders for the six LoanRegistry functions and Minter `reverse_repay`, labels, argument rows in the form's units, per-row `targetKind`, one owner map (function → surface) shared by the cards and the hub links, target-mismatch copy per contract, error copy per contract, per-item execute gate.
4. **Session bridge for LoanRegistry operations**: the relay now stores `argsXdr` for LoanRegistry calls too (new `riskCouncilArgsXdr` in wallet-connect), so a just-scheduled amend / write-down / default shows as a session row until the indexer serves it.
5. **Docs**: `docs/frontend/trustee-flows.md` (hub, Risk Council actions, pending operations, repayment recovery), TD-177 resolved, user stories `docs/user-stories/epic-1920/1924-rc-hub-pending-ops.md`.

Out of scope: cancelling (TD-159), reconciling served rows with `get_schedule` (TD-187), BUG-38 (#1927), `set_inspectors` listing (not loan-scoped, not served), a session bridge for `reverse_repay` (see Assumptions), any backend or contract change (contracts are frozen), Execute on the hub. No Figma: the existing hub table styling and the #1923 card.

## Assumptions and Risks

- **Dependencies.** PR #1928 (#1922, API) and PR #1929 (#1923, this branch's base `cdc64a7d`) are not merged. #1923 is getting review fixes now, and Step 0 rebases onto them before any code. This branch is stacked on #1923 and starts from `origin/main f74ce5b9`, which lacks `pending_operations` on `LoanBookEntry`. The frontend compiles and tests run with the API mocked. Rebase on `main` once both merge. Edits to `docs/exec-plans/tech-debt-tracker.md` (TD-177) and `docs/user-stories/index.md` wait for that rebase: #1928 edits the same TD-177 status line and adds the 1922 index row, and #1923 adds its own row. The PR for #1924 merges after #1928 and #1929.
- **API contract** (`origin/feat/1922-pending-operations-api:packages/api/src/pending_operations.rs`, `docs/product-specs/loan-security-state.md#pending-operations`): each `loans[]` entry carries `pending_operations: PendingOperation[]` (always an array; `[]` on EVM, without the AM indexer key, or for a target whose API key is unset), for every loan-scoped operation on the configured LoanRegistry (`set_default`, `cure`, `amend_economics`, `adjust_interest`, `write_down`, `close_defaulted`), Minter (`reverse_repay`) and SecurityRegistry (`set_terms`, `resolve_flag`, `release_with_consent`), `target_kind` `loan_registry` / `minter` / `security_registry`. It is attached with and without `chain_id`, so both `useLoanBook()` (pages) and `useLoanBook(chainId)` (hub) get it. Sorted by `ready_at`, `operation_id`, `nonce`. Expired rows are served. The TS field is declared optional and read as `?? []`, so the pages work against an API without #1928.
- **`args` display form** (`docs/references/access-manager-events.md`): `u32` as number; `u64` / `i128` / `u128` as decimal strings (`i128` signed); bytes as lowercase hex; a unit enum variant `scvVec([scvSymbol])` as a one-element array. Expected shapes:
  - `set_default`, `cure`: `[loan_id]`;
  - `amend_economics`: `[loan_id, new_rate, "maturity"]`, `new_rate = bps × 100` (`RATE_SCALE`; example `[0, 145000, "1816128000"]` is 1450 bps);
  - `adjust_interest`: `[loan_id, "delta", reason_hash]` (`delta` matches `/^-?\d+$/`);
  - `write_down`: `[loan_id, "amount"]`;
  - `close_defaulted`: `[loan_id, ["Default"]]` or `["OtherWriteDown"]`;
  - `reverse_repay`: `[loan_id, repayment_id, ref_hash]`.
  Display only; a shape that does not decode shows the raw JSON and Execute stays allowed (#1923 Decision 2).
- **Targets.** LoanRegistry rows are executed against `ENV.STELLAR_LOAN_REGISTRY_ID`, `reverse_repay` against `ENV.STELLAR_YIELD_MINTER_ID` (the Minter that `api/useRepaymentRecovery.ts` `recoveryConfig()` uses). The AM is `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` for all. A row whose `target` differs from the configured id gets Execute disabled with "This operation targets another {LoanRegistry|Minter|SecurityRegistry} ({short}) than this console is configured for." (#1923 Decision 1, extended per contract; the SecurityRegistry copy is unchanged).
- **Where `reverse_repay` is triggered.** Only in the repayment-recovery dialog: `RepaymentRecoveryDialog` (`routes/-RepaymentRecoveryDialog.tsx`, opened from the "Repayment recovery" card on `/loans/$id`), state in `routes/-useRepaymentRecoveryDialog.ts`, mutations `useScheduleReverseRepay` / `useExecuteReverseRepay` in `api/useRepaymentRecovery.ts`. Its `ref_hash` is deterministic (`sha256("pipeline:reverse_repay:{minterId}:{loanId}:{repaymentId}")`), so the dialog already finds the connected wallet's own schedule for the selected repayment after a reload. The new block adds operations scheduled by other wallets and for other repayments, and Execute from any session of the scheduler. **No session bridge for `reverse_repay`**: its schedule path is outside `lib/riskCouncilOps.ts`, and the dialog's own role line ("Scheduled. Executable from …") covers the scheduler until the indexer serves the row (about a minute). The existing "Execute reversal" button stays; executing through either path makes the other read `get_schedule = 0`, and the reversed registry flag hides the step-1 button.
- **Hub session bridge.** The issue keeps the optimistic bridge "if the sibling issue keeps it"; #1923 keeps it, so the hub merges session rows per loan with the same `mergePendingOps` (dedup by `operation_id`, executed ids hidden). Only loan-keyed session ops of loans in the book are shown.
- **Freshness.** `useLoanBook` polls every 30 s and the served `state` is computed at the API clock, so a `waiting → ready` flip can lag up to 30 s; the contract stays the authority (`execute:7/8`). Success of an Execute invalidates `loan-book` now, at 5 s and 15 s (`invalidateRiskCouncil`).
- **Hub without a wallet.** Rows used to need a connected wallet (lookups used it as `caller`). Now they render without one; "Scheduled by" then has no "· this wallet".
- **Error copy per contract.** `usePendingOperationView` maps errors by `targetKind`: Minter → `recoveryErrorCopy("execute", …)` first (its `#8` names the Minter bank-cash case, `#25` already reversed), then `riskCouncilErrorCopy`; SecurityRegistry → `riskCouncilErrorCopy` then `securityRegistryErrorCopy` (unchanged); LoanRegistry → `riskCouncilErrorCopy` then `toUserError`.
- **Execute gates on LoanRegistry pages** mirror the forms (Decision 2). They are applied only to owned rows, and only while the row is `ready`, as in #1923.
- **Link rows** never execute: no wallet, gate or target checks run for them. They show the label, arguments, "Scheduled by", the state line and the link. A function with no owner (none is served today) shows the state line only.
- **Shared files with #1923** (`-risk-council-pending.ts`, `-RiskCouncilParts.tsx`, `useRiskCouncil.ts`, `riskCouncilOps.ts`, `-risk-council-security.ts`, trustee-flows): its review fixes change them (Step 0). Names in this plan follow `cdc64a7d`. Where the rebased code moved or renamed something, follow the rebased code and keep the behaviour described here.

## Decisions (human, 2026-11-16)

1. **Every loan page lists all of the loan's pending operations.** Rows the page executes get Execute; rows owned by another page get a link to that page instead of Execute. Owners: escalate `set_default`; reterm `amend_economics`, `adjust_interest`; writedown `write_down`, `close_defaulted`, `cure`; security page `set_terms`, `resolve_flag`, `release_with_consent`; the loan detail recovery dialog `reverse_repay`. This applies to reterm, writedown, escalate and the recovery-dialog block. The #1923 security page lists only SecurityRegistry rows; extending it was left to the planner if cheap, and it is: Step 9 extends it.
2. **Status gates as in the forms, for `ready` owned rows.**
   - Escalate: "This loan is in Default." or the not-available note.
   - Reterm: `notAvailableNote` for `Closed` / `Approved`.
   - Writedown: "This loan is not in Default."; `close_defaulted` also needs `outstanding === "0"` (`CLOSE_GATE`).
   - An unknown on-chain status (read pending or failed) does not block.

## Open Questions

_None_

## Implementation Steps

Run commands from `/Users/aabliazimov/Documents/work/pipeline-feat-1924-rc-hub-pending-ops`; yarn is `PATH=/opt/homebrew/opt/node@22/bin:$PATH node .yarn/releases/yarn-4.13.0.cjs`.

0. **Rebase onto the updated #1923 branch first.**
   - `git fetch origin`, then `git rebase origin/feat/1923-rc-security-pending-ops` (or the local `feat/1923-rc-security-pending-ops` if it is ahead). Re-read `docs/exec-plans/active/issue-1923-rc-security-pending-ops.md` and the changed files before coding.
   - The #1923 review fixes, and how this plan adapts to each:
     - **Release confirm keyed on `fn`.** Use the same mechanism for the escalate `set_default` confirm (Step 6).
     - **`target_kind` filter.** It applies to owned (Execute) rows. Link rows of other kinds are listed on every surface.
     - **Success state kept visible after execute.** Keep it for LoanRegistry and Minter rows too.
     - **Executed-id hiding cleared when the API stops serving the id, and nonce / `ready_at` aware.** Use the rebased `mergePendingOps` / executed-id API unchanged on every surface, including the hub and the dialog.
     - **Form execute marks the op executed.** It now also covers LoanRegistry forms, because the relay records their `operationId` (Step 3).
     - **Target and paused guards moved into `usePendingOperationExecute`.**
       - The target guard must take the expected target per `targetKind`: `security_registry` → `ENV.STELLAR_SECURITY_REGISTRY_ID`, `loan_registry` → `ENV.STELLAR_LOAN_REGISTRY_ID`, `minter` → `ENV.STELLAR_YIELD_MINTER_ID`.
       - The paused guard applies only to `security_registry`.
       - Page status gates (Decision 2) stay in the view, because they depend on page state.
   - If the rebase removes or renames a symbol this plan extends (`PendingOperationsCard`, `usePendingOperationView`, `expectedTarget`, `executeGate`, `fromServed`, `mergePendingOps`), extend the rebased equivalent.

1. **wallet-connect: LoanRegistry args XDR**
   - In `packages/wallet-connect/src/stellar/contracts/riskCouncil.ts`, add `riskCouncilArgsXdr(call: RiskCouncilCall): string` = `operationArgsXdr(encodeRiskCouncilArgs(call))` (import from `./scheduledOperation`).
   - Export it from `packages/wallet-connect/src/index.ts`. No change to the Minter binding.
2. **API type**
   - In `packages/trustee/src/api/useLoanBook.ts`, add `pending_operations?: PendingOperation[]` to `LoanBookEntry` (type import from `./pendingOperations`), with no new JSDoc.
   - Run `npx tsx scripts/lint-comments.ts`; if the file is reported, shrink `scripts/lint-comments.baseline.json` as required, never grow it.
3. **Relay and execute hook** (`packages/trustee/src/api/useRiskCouncil.ts`):
   - In `useRiskCouncilRelay`, set `argsXdr` for every call: `securityRegistryArgsXdr` for security targets, otherwise `riskCouncilArgsXdr(call as RiskCouncilCall)`.
   - In `usePendingOperationExecute`, `onSuccess` also invalidates `repayment-recovery`, `repayment-recovery-access` and `loan-waterfall` (now, at 5 s, at 15 s), so an executed `reverse_repay` refreshes the dialog. Add them to a local key list next to `invalidateRiskCouncil`; do not import from `useRepaymentRecovery.ts`.
   - Remove `"risk-council-hub"` from `invalidateRiskCouncil`.
   - Delete `hubCallsFor`, `useRiskCouncilHubLookups`, `HubLookup`, `SET_DEFAULT_STATUSES`, and the `useQueries` / `LoanBookEntry` imports if they become unused.
4. **Pending model** (`packages/trustee/src/routes/-risk-council-pending.ts`):
   - Types:
     - `ReverseRepayCall = { fn: "reverse_repay"; loanId: number; repaymentId: number; refHash: string }`;
     - `PendingCall = CouncilCall | ReverseRepayCall`.
     - `PendingOpItem.call` becomes `PendingCall | null`. Add `targetKind: PendingTargetKind` to `PendingOpItem`: the served `target_kind`, or `councilTarget(op.call)` for session rows.
   - Decoders, same strictness as `decodeSecurityCall` (`isU32`, `isU64`, `isHash`, `variantOf`, exact length):
     - `decodeLoanRegistryCall(fn, args): RiskCouncilCall | null` for the six functions:
       - `amend_economics` needs `new_rate % 100 === 0` and `1 ≤ new_rate / 100 ≤ 10000`, and a maturity string that is a safe integer `> 0`;
       - `adjust_interest` needs `delta` matching `/^-?\d+$/`;
       - `write_down` needs `amount` matching `U64_DECIMAL`;
       - `close_defaulted` needs `variantOf(["Default", "OtherWriteDown"])`.
     - `decodeReverseRepayCall(fn, args): ReverseRepayCall | null`.
     - `decodePendingCall(fn, args) = decodeSecurityCall ?? decodeLoanRegistryCall ?? decodeReverseRepayCall`.
     - `fromServed` uses `decodePendingCall`.
   - Loan id:
     - `fromServed(op, loanId?: number | null)`: `loanId` argument when given, else `call.loanId` when the call has one, else `null`.
     - `fromSession`: `op.loanId ?? ("loanId" in op.call ? op.call.loanId : null)`, so LoanRegistry session ops (recorded without `loanId`) match their loan.
   - `mergePendingOps`:
     - pass `loanId` to `fromServed`;
     - the session filter compares the derived loan id, not `op.loanId`.
     - Add a `servedExtra` input (or merge before calling) so the security page can pass both `/security` and loan-book rows, de-duplicated by `operation_id` with the `/security` copy kept.
   - Labels and argument rows:
     - `pendingActionLabel`: "Declare default", "Cure", "Amend economics", "Adjust interest", "Write down", "Close defaulted loan", "Reverse repayment · repayment #N" (N from the call, else a `u32` at `rawArgs[1]`). Security labels are unchanged.
     - `pendingArgRows(item, chainId)`:
       - `set_default` / `cure`: `[]`;
       - `amend_economics`: "New rate" `${formatBpsRate(rateBps)} (${rateBps} bps)` and "New maturity" `formatMaturityDate(maturity)`;
       - `adjust_interest`: "Delta" `formatSignedChainAmount(delta, chainId)` and "Reason hash" (10 hex + "…");
       - `write_down`: "Amount" `formatChainAmount(amount, chainId)`;
       - `close_defaulted`: "Closure reason" from a local `{ Default: "Default", OtherWriteDown: "Other write-down" }`, without importing the writedown presenter;
       - `reverse_repay`: "Repayment" `#N` and "Reference hash" (10 hex + "…");
       - undecodable: the raw JSON row, unchanged.
     - Update the caller in `-RiskCouncilParts.tsx`.
   - Contract names and targets:
     - `pendingTargetMismatch(short, contract = "SecurityRegistry")`;
     - `PENDING_CONTRACT_NAMES: Record<PendingTargetKind, string>` (`security_registry` "SecurityRegistry", `loan_registry` "LoanRegistry", `minter` "Minter", `other` "contract");
     - `expectedTargetFor(kind)` returning `ENV.STELLAR_SECURITY_REGISTRY_ID` / `STELLAR_LOAN_REGISTRY_ID` / `STELLAR_YIELD_MINTER_ID` / `""`.
   - `usePendingOperationView`:
     - the mismatch notice uses `PENDING_CONTRACT_NAMES[item.targetKind]`;
     - error mapping by `item.targetKind` as in Assumptions, with `recoveryErrorCopy` imported from `./-repayment-recovery`;
     - drop the `councilTarget(item.fn as …)` cast.
   - Owner map (Decision 1), used by the cards and the hub:
     - `type PendingOwner = "escalate" | "reterm" | "writedown" | "security" | "recovery"`;
     - `PENDING_OWNERS: Record<string, PendingOwner>`:
       - `set_default` → escalate;
       - `amend_economics`, `adjust_interest` → reterm;
       - `write_down`, `close_defaulted`, `cure` → writedown;
       - `set_terms`, `resolve_flag`, `release_with_consent` → security;
       - `reverse_repay` → recovery.
     - `pendingOwner(fn): PendingOwner | null`.
     - `PENDING_OWNER_LINK_LABELS`: escalate "Open Escalate to Default"; reterm "Open Amend economics"; writedown "Open Default resolution"; security "Open Security"; recovery "Open loan · Repayment recovery".
   - `PENDING_STATE_LABELS = { waiting: "Waiting", ready: "Ready", expired: "Expired" }` for the hub.
5. **Shared UI** (`packages/trustee/src/routes/-RiskCouncilParts.tsx`):
   - `OWNER_ROUTE_PATHS: Record<PendingOwner, string>`: escalate `/risk-council/escalate/$id`, reterm `/risk-council/reterm/$id`, writedown `/risk-council/writedown/$id`, security `/risk-council/security/$id`, recovery `/loans/$id`.
   - `PendingOwnerLink({ owner, loanId, chainId, testId, children })`: a TanStack `Link` to that path with `params={{ id }}` and `search={{ chain }}`. The hub's `ActionLink` reuses it, so the paths live in one place.
   - Split `PendingOperationsCard` into `PendingOperationsList({ testId, items, chainId, owner, executeGate, executeGateFor, expectedTarget, confirmTextFor })` and the card. The list renders rows, or `${testId}-empty` "No scheduled operations found."; the card wraps the list in `Card`.
   - In `PendingOperationItem`, `pendingOwner(item.fn) === owner` renders the Execute controls; this part becomes its own component so `usePendingOperationView` is only called for owned rows. Any other row renders:
     - the state line (`${prefix}-role`, `pendingStateText`);
     - a `PendingOwnerLink` (`${prefix}-link`) with the owner's link label, to `item.loanId`;
     - no link when the owner is `null` or `item.loanId` is `null`.
   - `executeGateFor?: (item) => string | null` overrides `executeGate` per owned row.
6. **Escalate** (`-risk-council-escalate.ts`, `risk-council.escalate.$id.tsx`):
   - Build `pending` with `mergePendingOps({ served: base.entry?.pending_operations ?? [], session: useScheduledOps(chainId), executedIds, chainId, loanId: base.loanId, nowSec })`, with no function filter (all of the loan's operations).
   - Add `pending`, `expectedTarget: ENV.STELLAR_LOAN_REGISTRY_ID` and `pendingGate: string | null` to the view (Decision 2):
     - `eligibility.kind === "default"` → "This loan is in Default.";
     - `unavailable` → its note;
     - `eligible` or `unknown` → `null`.
   - Page: wrap the right side in `flex w-full flex-1 flex-col gap-[20px]`. Inside it, `PendingOperationsCard testId="risk-council-escalate-pending" owner="escalate"` comes first, then `DeclareDefaultCard`.
   - Move the confirm text into the presenter as `declareConfirmText(id)` ("Declare default on Loan #{id}? The pocket opens on the first default."). `DeclareDefaultCard` and the card's `confirmTextFor` both use it, so an owned `set_default` Execute also opens the confirm dialog.
7. **Reterm** (`-risk-council-reterm.ts`, `risk-council.reterm.$id.tsx`):
   - Same merge, all of the loan's operations.
   - `pendingGate = notAvailableNote(base.chainStatus)`.
   - `PendingOperationsCard testId="risk-council-reterm-pending" owner="reterm"` first in the right column, above Amend economics.
8. **Writedown** (`-risk-council-writedown.ts`, `risk-council.writedown.$id.tsx`):
   - Same merge, all of the loan's operations.
   - Add `pendingGateFor(item)`: `NOT_IN_DEFAULT` when `notInDefault`, else `closeExecuteGate(outstanding)` for `close_defaulted`, else `null`.
   - `PendingOperationsCard testId="risk-council-writedown-pending" owner="writedown" executeGateFor={view.pendingGateFor}` first in the right column.
9. **Security page extension** (`-risk-council-security.ts`, `risk-council.security.$id.tsx`):
   - Cost: the presenter already has `base.entry` (loan book) and its `/security` rows; the change is one merge plus `owner="security"`.
   - `served` = the `/security` `pending_operations`, plus `base.entry?.pending_operations` rows whose `operation_id` is not already in it.
   - `PendingOperationsCard owner="security"`. Owned rows keep every #1923 behaviour: paused gate, confirm, Set terms notice, `target_kind` filter. LoanRegistry and Minter rows show links.
   - The Set terms notice still looks only at `set_terms` rows.
   - Fallback: if the rebased #1923 presenter makes this more than that merge, skip the step. In that case keep the security page SecurityRegistry-only, and say so in trustee-flows and in the PR description.
10. **Repayment recovery dialog** (`-useRepaymentRecoveryDialog.ts`, `-RepaymentRecoveryDialog.tsx`):
   - In `useRepaymentRecoveryDialog`, read `useLoanBook()` and `findLoanEntry(…, chainId, loanId)`.
   - Build `pending = mergePendingOps({ served: entry?.pending_operations ?? [], session: useScheduledOps(chainId), executedIds, chainId, loanId: Number(loanId), nowSec })`, covering all of the loan's operations.
   - Expose `pending` and `pendingTarget: ENV.STELLAR_YIELD_MINTER_ID`.
   - Dialog step 1: before the radio list, a `SECTION_TITLE` "Scheduled operations" and `PendingOperationsList testId="repayment-recovery-pending" owner="recovery"`. It is always rendered (#1923 Decision 3).
   - Link rows navigate to the Risk Council page, which unmounts the dialog. No extra handling is needed.
   - No confirm text. `busy` also includes an in-flight pending execute only through the row's own disabled state; leave the dialog's Escape and backdrop rules unchanged.
11. **Hub presenter** (`-risk-council-hub.ts`):
    - Inputs: `useLoanBook(chainId)`, `useScheduledOps(chainId)`, `useExecutedOperationIds(chainId)`, `useStellarWallet().address`.
    - Items: for each loan with an integer `loan_id`, `mergePendingOps({ …, loanId })`; then flatten and sort by `readyAt`, then `operationId`.
    - Rows:
      - `ScheduledRow` gains `scheduledBy`;
      - `action = ACTION_LABELS[item.fn] ?? item.fn`, with `ACTION_LABELS` re-keyed to `Record<string, string>` and gaining `reverse_repay: "Reverse repayment"`;
      - `args = item.call ? formatCallArgs(item.call, chainId) : JSON.stringify(item.rawArgs)`, where `formatCallArgs` takes `PendingCall` and adds `reverse_repay` → `repayment #N`;
      - `executableFrom = formatReadyAt(item.readyAt)`;
      - `state = PENDING_STATE_LABELS[item.state]`;
      - `scheduledBy = callerText(item, address)`.
    - Links: the route comes from `pendingOwner(item.fn)` (`ACTION_ROUTES` is removed), and `reverse_repay` goes to `/loans/$id`. The link is `null` for a function with no owner. `HubRoute` becomes `PendingOwner | "inspectors"`.
    - Constants:
      - `HUB_NO_ROLE = "Risk Council actions belong to the Risk Council."`;
      - `HUB_FOOTNOTE = "Inspector panel changes are not tied to a loan and are not listed here; open the Inspector panel to check one."`.
    - Remove `INSPECTORS_ROW_LABEL`, `callLoanId` and the `NO_LONGER_SCHEDULED` use.
    - `loading = loanBook.isLoading`.
12. **Hub page** (`risk-council.index.tsx`):
    - Headers: Loan, Action, Arguments, Scheduled by, Executable from, State.
    - Remove the `noRole` dashes row and the `noRole` prop of `ScheduledTable`.
    - `ActionLink` delegates to `PendingOwnerLink`, which uses `OWNER_ROUTE_PATHS`; the local `ROUTE_PATHS` is removed. The inspectors link stays as is.
    - The empty state shows whenever there are no rows.
13. **Lint and comments.** New code carries no comments beyond existing one-line `// spec:` headers. Run `npx tsx scripts/lint-comments.ts` and shrink the baseline for any touched file it lists.
14. **Docs** (see Docs to Update), then `npx tsx scripts/lint-docs.ts`. TD-177 and `docs/user-stories/index.md` only after rebasing on `main` with #1928 and #1929 merged.
15. **Verify:**
    - `… workspace @pipeline/wallet-connect test`, `… workspace @pipeline/wallet-connect lint`;
    - `… workspace @pipeline/trustee test`, `… workspace @pipeline/trustee lint`, `… workspace @pipeline/trustee build`.
    - Optional manual check (not a gate): once #1928 is on stage with the AM indexer key, open `/risk-council?chain=99000001` and confirm the 2026-11-13 `set_terms` row is listed with "Scheduled by".

## Test Strategy

Vitest, colocated as today.

- `packages/wallet-connect/src/stellar/contracts/riskCouncil.test.ts` (or `scheduledOperation.test.ts`), real SDK: for each of the six LoanRegistry calls, `riskCouncilArgsXdr(call)` → `decodeOperationArgs` → `operationArgsXdr` returns the identical base64, and the decoded length equals `encodeRiskCouncilArgs(call).length`.
- `packages/trustee/src/routes/-risk-council-pending.test.ts` (extend):
  - `decodeLoanRegistryCall` / `decodePendingCall`:
    - each reference shape decodes (`[0, 145000, "1816128000"]` → `rateBps 1450`, `[3, "-1000000", "ab…"]`, `[3, "5000000"]`, `[3, ["OtherWriteDown"]]`, `[3]`, `[3, 2, "cd…"]` for `reverse_repay`);
    - these return `null`: non-multiple-of-100 rate, rate 0 or above 1 000 000, non-decimal amount, unsigned-regex failure, unknown variant, wrong length, and a 63-hex hash.
  - `fromServed`: `targetKind` from the served value; `loanId` from the argument, then the call; LoanRegistry row decoded.
  - `fromSession`: a LoanRegistry op without `loanId` takes it from the call; `targetKind` `loan_registry`.
  - `mergePendingOps`: served items carry the given `loanId`; served lists from two sources are de-duplicated by `operation_id`, keeping the first source's copy.
  - `pendingOwner`: every served function maps to its owner, and `set_inspectors` and unknown functions map to `null`.
  - `pendingActionLabel` and `pendingArgRows(item, chainId)` for the seven new functions (rate %, bps, maturity date, signed amount, amount, closure label, repayment number, shortened hashes); the raw fallback is unchanged.
  - `usePendingOperationView`:
    - a LoanRegistry row against a different `expectedTarget` shows "… another LoanRegistry (…) …", and a Minter row "… another Minter …";
    - the SecurityRegistry copy is unchanged;
    - Minter `Error(Contract, #25)` → "This repayment is already reversed.", and `#8` → the recovery `execute:8` copy;
    - a LoanRegistry `#8` → the `execute:8` RC copy;
    - a per-item gate disables only `ready` rows.
- `packages/trustee/src/api/-useRiskCouncil.test.tsx`:
  - remove the `hubCallsFor` / `useRiskCouncilHubLookups` tests and the `risk-council-hub` invalidation expectation;
  - a relay schedule of `amend_economics` records `argsXdr` equal to `riskCouncilArgsXdr(call)`;
  - `usePendingOperationExecute` success invalidates `repayment-recovery`, `repayment-recovery-access` and `loan-waterfall` as well.
- `packages/trustee/src/routes/-risk-council-hub.test.ts` and `-risk-council.index.test.tsx` (rewrite the lookup-based cases; mock `useLoanBook` with `pending_operations`, `useStellarWallet`, the real ops store):
  - rows from two loans are sorted by ready time, with loan labels, action labels (including "Reverse repayment"), verbatim arguments, "Scheduled by … · this wallet", "Executable from" UTC, and "Waiting" / "Ready" / "Expired";
  - undecodable args show raw JSON;
  - a session row appears until the same id is served, and an executed id is hidden;
  - links: `amend_economics` → reterm, `write_down` / `cure` / `close_defaulted` → writedown, `set_default` → escalate, `set_terms` / `resolve_flag` / `release_with_consent` → security, `reverse_repay` → `/loans/$id`; each carries `chain`;
  - a no-role wallet still sees the rows and the new role line (no dashes row);
  - with no wallet connected the rows still render;
  - the empty state appears, and the new footnote text is shown;
  - `set_inspectors` session ops are not listed;
  - a non-Stellar session renders only the header and the reason;
  - `pending_operations` absent → empty state, no crash.
- Page tests (`-risk-council-escalate-page.test.tsx`, `-risk-council-reterm-page.test.tsx`, `-risk-council-writedown-page.test.tsx`; extend mocks with `useStellarWallet`, `usePendingOperationExecute`, the fixture `pendingOp({ target: LOAN_REGISTRY, target_kind: "loan_registry", function: …, args: … })` added to `-riskCouncilFixtures.ts`):
  - the card renders first in the right column and lists all of the loan's operations;
  - owned rows have Execute; other rows have no button and show a link with the owner's label to the right path, carrying `id` and `chain`:
    - on reterm, a `write_down` row links to writedown and a `set_terms` row links to security;
    - a `reverse_repay` row links to `/loans/$id`;
  - empty state renders;
  - Execute is enabled only for the ready, owned row of the connected scheduler, and clicking calls the mutation with the row's `args_xdr`;
  - a link row never calls `usePendingOperationExecute`'s `mutateAsync`, and status gates do not apply to it;
  - escalate: `set_default` Execute opens the confirm dialog first, and a `Default` loan disables it with "This loan is in Default.";
  - reterm: a `Closed` loan disables rows with "Not available for a Closed loan.";
  - writedown: a non-Default loan disables rows with "This loan is not in Default."; a ready `close_defaulted` row with `outstanding !== "0"` shows "Executable once the outstanding principal is zero.", and with `"0"` it is enabled.
- `-RepaymentRecoveryDialog.test.tsx` (extend):
  - a `reverse_repay` row shows "Reverse repayment · repayment #N", repayment and reference hash rows, and "Scheduled by";
  - an `amend_economics` row of the same loan shows the "Open Amend economics" link instead of Execute;
  - Execute is enabled for the scheduler on a ready row, and another wallet sees the other-wallet copy;
  - a Minter-target mismatch is disabled with the Minter copy;
  - the empty state renders;
  - the existing step-1 and step-2 behaviour is unchanged.
- `-risk-council-security-page.test.tsx` (Step 9):
  - a loan-book `write_down` row appears with a writedown link;
  - an operation served by both sources is listed once;
  - SecurityRegistry rows keep Execute, the paused gate and the confirm.
- Existing suites (security page, `-risk-council-security.test.ts`, `-accessManagerAction.test.ts`, `-riskCouncilOps.test.ts`) stay green.

## Docs to Update

- `docs/frontend/trustee-flows.md`:
  - **Risk Council actions**:
    - Sources/code list: drop `hub` lookups, add `-risk-council-pending.ts`.
    - Rewrite "Finding a schedule after a reload": every per-loan page and the hub list pending operations from `pending_operations`; re-entering form values still finds a schedule as a fallback; the store now bridges LoanRegistry operations too.
    - Rewrite the **Hub** bullet: data source; columns with "Scheduled by"; states Waiting / Ready / Expired; links, with `reverse_repay` → loan detail; session bridge; rows visible to every wallet; new no-role line and footnote.
    - Add the "Scheduled operations" card to the Escalate, Amend economics and Default resolution bullets.
    - "Errors, config and roles": drop "listing operations scheduled elsewhere (TD-177)" from "Not in the app".
  - **Risk Council security actions**:
    - "Encoding": drop "The hub cannot find these operations unless … (TD-177, #1924)".
    - Rewrite "Hub additions" (labels and argument formats kept; rows no longer come from the page-local store; `set_inspectors` is not listed).
  - **Risk Council pending operations**:
    - Sources: `api/useLoanBook.ts` and #1924.
    - Intro: the hub and the five per-loan surfaces (escalate, reterm, writedown, security, recovery dialog). Each lists all of the loan's operations, with Execute on owned rows and owner links on the others; give the owner table and the expected target per contract.
    - Rows: the LoanRegistry and `reverse_repay` labels and argument units.
    - Execute: per-contract target-mismatch copy, per-page status gates for `ready` owned rows (Decision 2), per-contract error copy.
    - Session bridge: LoanRegistry ops too; none for `reverse_repay`.
    - "Not covered": drop the #1924 line.
  - **Repayment recovery (#1711)**: a dialog bullet for the step-1 "Scheduled operations" block (`reverse_repay` rows, Minter target, Execute rules, coexistence with the deterministic "Execute reversal").
- `docs/user-stories/epic-1920/1924-rc-hub-pending-ops.md` (new). Stories:
  1. Hub lists an `amend_economics` scheduled from another browser after a reload, with Scheduled by and the reterm link.
  2. An expired row reads "Expired".
  3. A Trustee-only wallet sees the rows and the role line.
  4. The scheduler executes `amend_economics` from the reterm card with no retyping; another RC wallet sees the other-wallet copy.
  4a. On the reterm page a pending `write_down` of the same loan shows "Open Default resolution" instead of Execute, and the link opens the writedown page, where it can be executed.
  5. Writedown `close_defaulted` ready with outstanding above 0 is blocked with the close gate.
  6. Escalate `set_default` row executes after the confirm dialog and disappears.
  7. Recovery dialog lists a `reverse_repay` scheduled by another wallet; its scheduler executes it and step 1 shows "reversed on-chain".
  8. A just-scheduled write-down shows the session note, then the indexed row.
  9. The hub footnote names the inspector panel, and `set_inspectors` is not listed.

  Add the index row in `docs/user-stories/index.md` under Epic #1920, after rebase.
- `docs/exec-plans/tech-debt-tracker.md` TD-177: heading suffix `[RESOLVED 2026-11-?? / #1924]`, with the status line "Done: indexer #1921, API #1922, Security page #1923, hub and LoanRegistry / Minter pages #1924". Write this after rebase onto #1928's wording.
- No product-spec change: the API contract is #1922's `loan-security-state.md#pending-operations` and the `trustee-dashboard.md` loan-book row (#1928).
