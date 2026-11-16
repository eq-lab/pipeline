# Issue #1923: Trustee: Risk Council security page — list pending operations and execute them with the scheduled args

Source: https://github.com/eq-lab/pipeline/issues/1923 (epic #1920, flow: frontend)

## Scope

On `/risk-council/security/$id` (Stellar), show the loan's pending SecurityRegistry operations served by `GET /v1/loan-book/{id}/security` → `pending_operations` (#1922, PR #1928), and let the scheduling wallet execute one with its **scheduled arguments verbatim** (`args_xdr`), never rebuilt from the form.

In scope:

1. **"Scheduled operations" card**, first card of the right column (above Set terms). One row per pending operation:
   - action label: "Set terms", "Resolve flag · record #N", "Release with consent · record #N";
   - decoded arguments in the form's units (ratios/tolerances %, durations d/h/s via `formatServedDuration`, default rate %, payment-term label, outcome, hashes as the first 10 hex + "…");
   - "Scheduled by": short address, plus "· this wallet" when it equals the connected Stellar wallet;
   - state line: "Waiting · executable from {YYYY-MM-DD HH:MM UTC}", "Ready · expires {YYYY-MM-DD HH:MM UTC}" or "Expired — schedule it again";
   - **Execute** button: enabled only when `state = ready`, connected wallet `== caller`, the SecurityRegistry is not paused (existing `executeGate`), the chain is Stellar, the row's `target` equals the configured `ENV.STELLAR_SECURITY_REGISTRY_ID` (Decision 1), and no execute is in flight. Other wallets see "Only the scheduling wallet ({short}) can execute this." `release_with_consent` keeps the existing confirm dialog (`releaseConfirmText`).
   - Execute = re-check on chain, then `AM.execute(target, function, args, caller)` with `args = decode(args_xdr)`. The re-check runs `hash_operation(caller, target, function, args)` + `get_schedule` (existing `readOperationSchedule`): an id that differs from `operation_id` aborts with a mismatch error; `readyAt == 0` aborts and shows the existing `NO_LONGER_SCHEDULED` copy.
2. **Set terms notice**: while a `set_terms` row in state `waiting` or `ready` exists for the loan: "A terms change is already scheduled — see above. Scheduling again creates a second operation with a new 24 h wait." The form stays usable.
3. **Refresh + optimistic bridge**: schedule / execute success already invalidates `loan-security` at 0 / 5 / 15 s (`invalidateRiskCouncil`); the pending-op execute reuses it. The page-local store (`lib/riskCouncilOps.ts`) becomes a bridge until the indexer catches up, deduplicated by `operation_id`:
   - after a successful `schedule`, the relay reads the schedule once (`readScheduleFor`) and stores `operationId`, `readyAt`, `caller`, `target`, `argsXdr` on the `ScheduledOp`;
   - a session op for this chain + loan whose `operationId` is not yet served shows as a row (state derived locally from `readyAt`, marked "Scheduled from this console. The list catches up within a minute.");
   - an operation executed here (by id) is hidden from both sources until the API drops it, and every `ScheduledOp` with that id gets `executedHere = true` (so the form's "No longer scheduled" line does not fire).
4. **AM error #9 copy** (issue comment, Decision 4): extend `schedule:9` to "This operation is already scheduled. It may have been scheduled outside the indexed window; the scheduling wallet can execute it once it is ready." `execute:6/7/8` unchanged.
5. **Shared building blocks for #1924**: presenter + execute hook + row component are generic over `CouncilCall` so the hub and LoanRegistry pages can reuse them (#1924 adds the LoanRegistry/Minter decoders).

Out of scope: the hub and the LoanRegistry Risk Council pages (#1924, which also closes TD-177), `set_inspectors` (not loan-scoped), cancelling (TD-159), `get_schedule` reconciliation of served rows (TD-187), BUG-38 (#1927), any backend or contract change. No Figma: reuse `Card` / `Row` / `Muted` / `ActionControls` and the bordered row box used by `FlaggedRecord`.

## Assumptions and Risks

- **Dependency: PR #1928 (#1922) is not merged.** This worktree is on `origin/main f74ce5b9`, which lacks the `pending_operations` field and its docs. The frontend compiles and its tests run without it (API mocked). Before editing `docs/exec-plans/tech-debt-tracker.md` (TD-177) and `docs/user-stories/index.md`, merge or rebase `origin/main` once #1928 lands; both files are touched by #1928 and will conflict otherwise. The PR for #1923 must merge after #1928.
- **API contract** (from `origin/feat/1922-pending-operations-api:packages/api/src/pending_operations.rs` and `docs/product-specs/loan-security-state.md#pending-operations`): `pending_operations` is always an array of `{ operation_id (64 hex), nonce, caller, target, target_kind, function, args_xdr (base64 of ScVal::Vec(args)), args (args_json display form), ready_at, expires_at (ISO UTC), state: waiting|ready|expired }`, sorted by `ready_at`. Expired rows are always returned (human decision). Rows without recoverable args are not served. The type is declared optional in the TS response (`?`) and treated as `[]` when absent, so the page works against an API without #1928.
- **`args_json` display form** (`docs/references/access-manager-events.md`): `u32` as number, `u64` as decimal string, bytes as lowercase hex, unit enum variants as a one-element array (`["Lc"]`, `["Accepted"]`), `#[contracttype]` structs as objects with snake_case keys. `set_terms` → `[loan_id, { advance_ratio_bps, attestation_interval, cure_period, default_rate, grace_period, grade_tolerance_bps, inspection_interval, margin_call_at, margin_call_ratio_bps, payment_term, price_stale_after, tolerance_bps }]`; `resolve_flag` → `[record_id, [outcome], reason_hash]`; `release_with_consent` → `[record_id, consent_hash]`. Display only; a shape that does not decode falls back to the raw JSON (Decision 2).
- **Byte identity**: `relay` wraps `args` in `scvVec(args)`; XDR is canonical, so decoding `args_xdr` into its vec elements and re-wrapping reproduces the same bytes, hence the same `operation_id`. Pinned by a real-SDK round-trip test. The `hash_operation` pre-check catches any drift before the wallet signs.
- **AccessManager id** is not served by the API; the console uses `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` as today. A deployment where the API indexer and the console point at different AMs would fail the pre-check (mismatch / `readyAt = 0`), never execute something else.
- **State freshness**: the served `state` is computed at the API clock and refreshed by the 30 s `useLoanSecurity` poll; the button can lag a `waiting → ready` flip by up to 30 s. The contract stays the authority (`execute:7/8` copy). Served rows are not reconciled with `get_schedule` (TD-187), so a row can be stale until the indexer closes it; the pre-check covers execution.
- **Dark indexer**: on a chain without the worker's AccessManager key the API serves `[]`; only session-bridge rows appear. AM error #9 copy covers a re-schedule of an unlisted live operation.
- **Sibling #1924** touches the same files (`-RiskCouncilParts.tsx`, `useRiskCouncil.ts`, `riskCouncilOps.ts`, `-risk-council-hub.ts`). Keep the new pieces generic and in their own module (`-risk-council-pending.ts`) to minimise conflicts.

## Decisions (human, 2026-11-16)

1. **Row target vs configured registry.** When a row's `target` differs from `ENV.STELLAR_SECURITY_REGISTRY_ID`, Execute is disabled with the notice "This operation targets another SecurityRegistry ({short}) than this console is configured for."
2. **Unreadable arguments.** When `args` does not match the expected shape for its function, the raw `args` JSON is shown as served under "Arguments" and Execute stays allowed; the on-chain `hash_operation` pre-check guarantees the executed bytes are the scheduled ones.
3. **Empty card.** The "Scheduled operations" card always renders; with no rows it shows "No scheduled operations found."
4. **AM error #9 copy.** The shared `schedule:9` copy becomes, on every Risk Council page: "This operation is already scheduled. It may have been scheduled outside the indexed window; the scheduling wallet can execute it once it is ready."

## Open Questions

_None_

## Implementation Steps

Run commands from `/Users/aabliazimov/Documents/work/pipeline-feat-1923-rc-security-pending-ops`; yarn is `node .yarn/releases/yarn-4.13.0.cjs`.

1. **wallet-connect: execute with raw args** — new `packages/wallet-connect/src/stellar/contracts/scheduledOperation.ts` (spec header `docs/frontend/trustee-flows.md#risk-council-pending-operations`):
   - `decodeOperationArgs(argsXdr: string): xdr.ScVal[]` — `xdr.ScVal.fromXDR(argsXdr, "base64")`; throw `Error("decodeOperationArgs: args_xdr is not an ScVal vector")` unless `switch().name === "scvVec"` and `vec()` is non-null; bad base64 / XDR throws.
   - `operationArgsXdr(args: xdr.ScVal[]): string` — `xdr.ScVal.scvVec(args).toXDR("base64")`.
   - `readScheduledOperation({ accessManagerId, caller, target, fn, argsXdr, rpcUrl, networkPassphrase }): Promise<OperationSchedule>` — `readOperationSchedule({ ..., args: decodeOperationArgs(argsXdr) })`.
   - `executeScheduledOperation({ accessManagerId, caller, target, fn, argsXdr, rpcUrl, networkPassphrase, signTransaction, onStageChange }): Promise<RelayResult>` — `relay({ mode: "execute", ..., args: decodeOperationArgs(argsXdr) })`.
   - In `securityRegistry.ts` add `securityRegistryArgsXdr(call: SecurityRegistryCall): string` = `operationArgsXdr(encodeSecurityRegistryArgs(call))`.
   - Export all five (plus param types) from `packages/wallet-connect/src/index.ts`.
2. **API type** — new `packages/trustee/src/api/pendingOperations.ts` (spec header to the new section): `PendingOperationState = "waiting" | "ready" | "expired"`, `PendingTargetKind`, `PendingOperation` interface mirroring the API fields. In `api/useLoanSecurity.ts` add `pending_operations?: PendingOperation[]` to `LoanSecurityResponse`. (#1924 adds it to `LoanBookEntry`.)
3. **Page-local store** — `packages/trustee/src/lib/riskCouncilOps.ts`:
   - extend `ScheduledOp` with optional `operationId`, `readyAt` (unix s), `caller`, `target`, `argsXdr`;
   - `recordScheduledOp` accepts those optional fields;
   - add `markOperationExecuted(chainId, operationId)`: adds the id to an executed-id set (part of the snapshot) and sets `executedHere = true` on every op with that id; add `useExecutedOperationIds(chainId)` (stable snapshot like `useScheduledOps`); reset both in `_resetRiskCouncilOpsForTests`.
4. **Hooks** — `packages/trustee/src/api/useRiskCouncil.ts`:
   - `useRiskCouncilRelay`: in `mutationFn`, after a successful `schedule`, run `readScheduleFor(call, …)` once (errors swallowed → no id) and return `{ hash, schedule, caller: address, target: cfg.registryId, argsXdr }` (`argsXdr` via `securityRegistryArgsXdr` for security calls; LoanRegistry calls leave it undefined until #1924). `onSuccess` passes them to `recordScheduledOp`; the `hash` field stays as is for `ActionView.hash`.
   - New `usePendingOperationExecute()` — `useMutation<{ hash }, Error, { chainId, operationId, caller, target, fn, argsXdr }>`: Stellar check (`stellarOnlyActionReason`); AM id = `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` (missing → `NOT_CONFIGURED`); wallet connected and `address === caller` else throw the other-wallet copy; `readScheduledOperation` → `operationId !== input.operationId` throws `PendingArgsMismatchError`, `readyAt === 0` throws `NoLongerScheduledError` (both exported classes); then `executeScheduledOperation`. `onSuccess`: `markOperationExecuted`, `invalidateRiskCouncil` now and at 5 s / 15 s (same as the relay). Expose `{ mutateAsync, isPending, error, hash, stage, reset }` like `useRiskCouncilRelay`.
5. **Copy** — `packages/trustee/src/lib/accessManagerAction.ts`: `RISK_COUNCIL_AM_ERROR_COPY["schedule:9"]` per Decision 4.
6. **Presenter** — new `packages/trustee/src/routes/-risk-council-pending.ts` (generic; #1924 extends the decoder switch):
   - constants: `PENDING_CARD_TITLE = "Scheduled operations"`, `PENDING_EMPTY = "No scheduled operations found."`, `PENDING_SESSION_NOTE = "Scheduled from this console. The list catches up within a minute."`, `PENDING_ARGS_MISMATCH = "The served arguments do not match this operation on chain. Reload the page."`, `PENDING_TARGET_MISMATCH(short)`, `otherWalletCopy(short) = "Only the scheduling wallet (${short}) can execute this."`, `SET_TERMS_PENDING_NOTICE` (issue text).
   - `PendingOpItem { key, operationId, caller, target, fn, argsXdr, readyAt, expiresAt, state, call: CouncilCall | null, rawArgs: unknown, source: "indexed" | "session", loanId: number | null }`.
   - `fromServed(op: PendingOperation): PendingOpItem` (ISO → unix s via `Date.parse`, served `state` verbatim, `call = decodeSecurityCall(op.function, op.args)`).
   - `decodeSecurityCall(fn, args): SecurityRegistryCall | null` for `set_terms` / `resolve_flag` / `release_with_consent` per the shapes in Assumptions (strict: integers for u32, `/^\d+$/` strings for u64, `/^[0-9a-f]{64}$/` hashes, known payment term / outcome); anything else `null`. `set_inspectors` and unknown functions → `null`.
   - `fromSession(op: ScheduledOp, nowSec): PendingOpItem | null` — only when `operationId`, `readyAt > 0`, `caller`, `target`, `argsXdr` are set and `!executedHere`; `expiresAt = readyAt + 604_800` (`EXPIRATION`); state derived from `nowSec`.
   - `mergePendingOps({ served, session, executedIds, chainId, loanId, nowSec })`: served rows minus executed ids; plus session rows of this chain whose `loanId` matches and whose id is neither served nor executed; sorted by `readyAt`, then `operationId`.
   - `pendingActionLabel(item)` ("Set terms", "Resolve flag · record #N", "Release with consent · record #N", else the raw function name) and `pendingArgRows(item): LabelValue[]` — `set_terms`: map the decoded terms to the `LoanSecurityTerms` shape and reuse `formatTermsRows` from `-risk-council-security.ts` (move it, or import it), with the payment-term row from `PAYMENT_TERM_LABELS`; `resolve_flag`: Outcome, Reason hash (10 hex + "…"); `release_with_consent`: Consent hash; undecodable: one row "Arguments" = `JSON.stringify(rawArgs)`.
   - `pendingStateText(item)` using `formatReadyAt`.
   - `usePendingOperationView({ chainId, item, executeGate, expectedTarget }): ActionView` — reads `useStellarWallet().address` and `usePendingOperationExecute()`; returns an `ActionView` so `ActionControls` renders it unchanged: `roleLine` = state text, `buttonLabel = "Execute"`, `disabled` per the Scope gate list, `notice` = first of (`stellarOnlyActionReason`, other-wallet copy, target mismatch, `executeGate` when ready), `noLongerScheduled` = `NO_LONGER_SCHEDULED` when the last error is `NoLongerScheduledError`, `error` = mismatch copy for `PendingArgsMismatchError`, else `riskCouncilErrorCopy("execute", …)` → `securityRegistryErrorCopy` (security targets) → `toUserError`, `chip: null`, `run` → `mutateAsync({ … argsXdr: item.argsXdr })`. Also export `callerText(item, address)` ("G…ABCD · this wallet").
7. **Shared UI** — `packages/trustee/src/routes/-RiskCouncilParts.tsx`:
   - `PendingOperationItem({ prefix, chainId, item, executeGate, expectedTarget, confirmText })`: bordered box (same style as `FlaggedRecord`), `<strong>` action label, `Row`s for the arguments (`${prefix}-args`), "Scheduled by" (`${prefix}-caller`), the session note when `source = "session"` (`${prefix}-session`), then `ActionControls prefix={prefix} view={usePendingOperationView(...)} confirmText={confirmText}`.
   - `PendingOperationsCard({ testId, items, chainId, executeGate, expectedTarget, confirmTextFor })`: `Card title="Scheduled operations"`; empty → `Muted` `${testId}-empty`; rows keyed by `item.key`, prefix `${testId}-${item.operationId}`, row testid `${testId}-row`.
8. **Security page wiring** — `packages/trustee/src/routes/-risk-council-security.ts`:
   - in `useRiskCouncilSecurity`, build `pending: PendingOpItem[]` via `mergePendingOps` from `served?.pending_operations ?? []`, `useScheduledOps(chainId)`, `useExecutedOperationIds(chainId)`, `base.loanId`, `Date.now()/1000`; add `pending` and `expectedTarget: ENV.STELLAR_SECURITY_REGISTRY_ID` to `RiskCouncilSecurityView`;
   - `setTerms.pendingNotice: string | null` = `SET_TERMS_PENDING_NOTICE` when a `set_terms` item in `waiting`/`ready` exists;
   - `pendingConfirmText(item)` = `releaseConfirmText(recordId)` for `release_with_consent`, else `undefined`.
   - `risk-council.security.$id.tsx`: render `PendingOperationsCard testId="risk-council-security-pending"` first in the right column (only in the non-error branch); render `form.pendingNotice` in `SetTermsCard` as `Muted testId="risk-council-security-terms-pending-notice"` above `ActionControls`.
9. **Lint/comments**: new files carry only the one-line `// spec:` header; no JSDoc/body comments. Run `npx tsx scripts/lint-comments.ts` and shrink `scripts/lint-comments.baseline.json` if a touched file is listed.
10. **Docs** (see Docs to Update), then `npx tsx scripts/lint-docs.ts`.
11. **Verify**: `node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/wallet-connect test`, `… workspace @pipeline/wallet-connect lint`, `… workspace @pipeline/trustee test`, `… workspace @pipeline/trustee lint`, `… workspace @pipeline/trustee build` (tsc -b). Optionally run the trustee dev server against stage once #1928 is deployed and the AM indexer key is set, open `/risk-council/security/0?chain=99000001`, and confirm the 2026-11-13 `set_terms` operation is listed (manual; not a gate for this flow).

## Test Strategy

Vitest, colocated as the packages already do (wallet-connect `*.test.ts`, trustee `-*.test.ts(x)`).

- `packages/wallet-connect/src/stellar/contracts/scheduledOperation.test.ts`
  - real SDK (no `@stellar/stellar-sdk` mock): for each of `set_terms`, `resolve_flag`, `release_with_consent`, `securityRegistryArgsXdr(call)` → `decodeOperationArgs` → `operationArgsXdr` returns the identical base64; decoded length equals `encodeSecurityRegistryArgs(call).length`.
  - `decodeOperationArgs` throws on a non-vec ScVal (e.g. base64 of `scvU32(1)`), on garbage base64, and on empty string.
  - with `./accessManager` mocked: `executeScheduledOperation` calls `relay` with `mode: "execute"`, the given `target`/`fn`/`caller`, and args whose `scvVec(...).toXDR("base64")` equals the input; `readScheduledOperation` forwards decoded args to `readOperationSchedule`.
- `packages/trustee/src/lib/-riskCouncilOps.test.ts`: `recordScheduledOp` keeps `operationId`/`readyAt`/`caller`/`target`/`argsXdr`; `markOperationExecuted` flags matching ops, populates `useExecutedOperationIds` per chain only, and is idempotent; reset clears both.
- `packages/trustee/src/routes/-risk-council-pending.test.ts`
  - `decodeSecurityCall`: the three shapes from the reference examples (`[7, {…, payment_term: ["Lc"], cure_period: "604800", …}]`, `[3, ["Accepted"], "ab…"]`, `[3, "cd…"]`) decode; wrong types, negative/float u32, non-decimal u64, 63-hex hash, unknown variant, extra/missing keys, `set_inspectors` → `null`.
  - `pendingArgRows`: % / d / h / s / default-rate / payment-term label / outcome / shortened hashes; undecodable → one raw JSON row.
  - `pendingStateText` for the three states (UTC formatting at a fixed instant).
  - `mergePendingOps`: served-only; session row shown when not served; dropped once served (same id); executed id hides served and session rows; other chain / other loan / missing id / `readyAt = 0` session rows ignored; local state derivation at `now < readyAt`, `readyAt ≤ now < readyAt + 604800`, `≥ expires`; sort order.
  - `usePendingOperationView` (renderHook, mocked `useStellarWallet` and `usePendingOperationExecute`): enabled only for `ready` + caller match + no gate + matching target + Stellar; `waiting`, `expired`, other wallet (copy with short address), disconnected, paused (`executeGate` notice), target mismatch, EVM chain, in-flight each disable; `run` passes `argsXdr` verbatim; error mapping: `NoLongerScheduledError` → `noLongerScheduled`, `PendingArgsMismatchError` → mismatch copy, `Error(Contract, #8)` → `execute:8` copy, `#14` on a security target → SecurityRegistry copy.
- `packages/trustee/src/api/-useRiskCouncil.test.tsx` (mocks `@pipeline/wallet-connect`):
  - `usePendingOperationExecute`: wallet ≠ caller rejects without RPC; id mismatch rejects and never calls `executeScheduledOperation`; `readyAt 0` rejects with `NoLongerScheduledError`; success calls `executeScheduledOperation` with `argsXdr`, `target`, `fn`, `caller` unchanged and AM id from env, then `markOperationExecuted` and invalidates `loan-security`; EVM chain rejects with the Stellar-only reason.
  - `useRiskCouncilRelay` schedule success records `operationId`/`readyAt` from the follow-up schedule read; a failing follow-up read still records the op without id; execute mode unchanged.
- `packages/trustee/src/routes/-risk-council-security-page.test.tsx` (extend mocks: `useStellarWallet`, `usePendingOperationExecute`, `useScheduledOps`/`useExecutedOperationIds` via the real store; fixture `pendingOp(overrides)` in `-riskCouncilFixtures.ts`):
  - card renders above Set terms with one row per served op: labels, decoded args, "Scheduled by … · this wallet", the three state lines; empty state copy.
  - Execute enabled only for the ready + own-wallet row; another wallet's row shows the other-wallet copy; paused disables with the paused note; clicking calls the mutation with the row's `args_xdr`; `release_with_consent` opens the confirm dialog first.
  - Set terms notice visible for a waiting/ready `set_terms`, absent for an expired one or none; form inputs stay enabled.
  - `pending_operations` absent (pre-#1928 API) renders the empty card, no crash; security load error still replaces all cards.
- Existing suites (`-risk-council-security.test.ts`, `-accessManagerAction.test.ts` for the new #9 copy, hub tests) stay green; their `/already scheduled/` matchers still hold for the new `schedule:9` copy (`-repayment-recovery.ts` keeps its own `schedule:9` copy).

## Docs to Update

- `docs/frontend/trustee-flows.md`
  - New `## Risk Council pending operations` section (after "Risk Council security actions"): data source (`pending_operations`, link to `loan-security-state.md#pending-operations`), row content and state copy, Execute gate, the verbatim-args path (`decodeOperationArgs` → `AM.execute`, `hash_operation` + `get_schedule` pre-check, mismatch / no-longer copy), session bridge and dedup by `operation_id`, code pointers (`scheduledOperation.ts`, `api/pendingOperations.ts`, `usePendingOperationExecute`, `-risk-council-pending.ts`, `PendingOperationsCard`), and a note that the hub / LoanRegistry pages follow in #1924.
  - "Risk Council security actions": Sources/code list, the Security page bullets (new card first; Set terms notice), and replace "after a reload the schedule is found by re-entering identical form values … (TD-177)" with the card; keep the re-entry path as a fallback.
  - "Finding a schedule after a reload": the page-local store now also records `operationId`, `readyAt`, `caller`, `target`, `argsXdr` as an indexer bridge.
  - "Errors, config and roles": new `schedule:9` copy.
- `docs/user-stories/epic-1920/1923-rc-security-pending-ops.md` (new): stories — (1) reload after scheduling `set_terms` shows the waiting row and the Set terms notice; (2) after the ready time the scheduling wallet executes it with no retyping and the terms change; (3) another Risk Council wallet / a Trustee-only wallet sees the row read-only with the other-wallet copy; (4) expired row reads "Expired — schedule it again" with Execute disabled; (5) paused registry blocks Execute; (6) cancelled-but-still-served row → Execute shows "No longer scheduled — …" and sends nothing; (7) resolve-flag / release rows show outcome / hashes and release asks for confirmation. Add the row to `docs/user-stories/index.md` (after #1928's 1922 line).
- `docs/exec-plans/tech-debt-tracker.md` TD-177 status: "Security page done (#1923). The hub and LoanRegistry pages (#1924) remain." (after merging #1928's edit of the same line).
- No product-spec change: the API contract is #1922's `loan-security-state.md#pending-operations`; this issue only consumes it.
