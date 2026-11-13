# Issue #1858: Trustee: Risk Council security actions — set terms, resolve flag, release with consent, inspector panel (SecurityRegistry, scheduled 24 h)

Source: https://github.com/eq-lab/pipeline/issues/1858

## Scope

Add the four Risk Council (`RISK_COUNCIL`) SecurityRegistry actions to the Trustee app, on the AccessManager model #1761 shipped (`can_call` → `execute` at once, or `schedule` → wait → `execute`; Guardian/Admin cancel; no Safe, no proposals):

| Action | Contract call (`pipeline-stellar-contracts@e9881ac`, `contracts/security-registry/src/lib.rs`) |
|---|---|
| Set / change terms | `set_terms(loan_id: u32, terms: Terms)` (lib.rs:594) |
| Settle an inspection flag | `resolve_flag(record_id: u32, outcome: FlagOutcome, reason_hash: BytesN<32>)` (lib.rs:518) |
| Release a record with lenders' consent | `release_with_consent(record_id: u32, consent_hash: BytesN<32>)` (lib.rs:505) |
| Approved inspection companies | `set_inspectors(inspectors: Vec<Address>)` (lib.rs:555) |

All four are `#[only_owner]` + `#[when_not_paused]`; the owner is the AccessManager, and `deployments/justfile` `setup-access` maps them to `RISK_COUNCIL` (line 724). Same AM contract as the loan registry (`ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID`); target is the new `ENV.STELLAR_SECURITY_REGISTRY_ID`.

In scope:
- `packages/wallet-connect`: new `securityRegistry.ts` encoder + relay/schedule wrappers (and an `inspectors()` view read, see Open Questions).
- Trustee: generalise the Risk Council hooks / page-local op store to a second target; one per-loan page `/risk-council/security/$id` (terms, flag resolution, consent release) and one contract-wide page `/risk-council/inspectors`; hub rows/links; a link from the loan-detail Security card.
- New env `VITE_STELLAR_SECURITY_REGISTRY_ID` (trustee `env.ts`, `docker/trustee/entrypoint.sh`, `.env.example`); argocd entry is in the separate `argocd` repo (see Risks).
- Docs: `docs/frontend/trustee-flows.md` Risk Council section, user-stories doc.

Out of scope: any contract change (frozen); any AccessManager indexing (decision 2026-11-03) — scheduled-op discovery stays page-local + deterministic lookups; `AM.cancel` (TD-159); backend changes (all reads already served by #1780 `GET /v1/loan-book/{id}/security`); Trustee-role SecurityRegistry functions (`revalue`, `record_extension_consent`); SECURITY_AGENT / INSPECTION_OPERATOR flows.

## Assumptions and Risks

- Blockers #1780 and #1761 are merged (see issue comment 2026-11). Plumbing (`readCanCall`, `readOperationSchedule`, `relay`) is on `main` in `packages/wallet-connect/src/stellar/contracts/accessManager.ts`.
- **Struct encoding.** `Terms` is a `#[contracttype]` struct → `scvMap` with `Symbol` keys sorted lexicographically (all 12 fields, including `margin_call_at`, which `set_terms` ignores — send `u64(0)`). Reuse the sorted-map pattern of `loanRegistry.ts` `scMap` (extract it to a shared helper, e.g. `scval.ts`, rather than duplicating). Enums (`PaymentTerm`, `FlagOutcome`) are unit variants → `scvVec([scvSymbol(name)])`, same as `close_defaulted`'s `ClosureReason`. Field types: `advance_ratio_bps`, `margin_call_ratio_bps`, `default_rate`, `tolerance_bps`, `grade_tolerance_bps` = `u32`; `cure_period`, `price_stale_after`, `grace_period`, `attestation_interval`, `inspection_interval`, `margin_call_at` = `u64`; `payment_term` ∈ `Lc | Dp | Da | OpenAccount`. A wrong key or type fails only at simulation, so an encoder test must pin the exact map.
- **Op identity covers args.** `hash_operation(caller, target, fn, args)`: re-entering identical form values is how a schedule is found after reload. For `set_terms` this means all 12 fields must reproduce exactly; prefilling from served terms helps only for unchanged values. Documented limitation (TD-177 stays).
- Contract preconditions the UI mirrors (contract stays the authority): `margin_call_ratio_bps >= advance_ratio_bps` (else `InvalidRatio #15`); `resolve_flag` needs `flagged_by != 0` (else `NotFlagged #32`); `release_with_consent` needs an open record (status not `Released`/`Enforced`, else `WrongRecordStatus #12`); `set_terms` needs a loan the loan registry knows; all revert when paused. Because served state lags (fold every 30 s, `refresh_pending`), a gate based on served state can be stale at execute time; surface simulation errors via `toUserError` and add local copy for codes 12, 14, 15, 32 keyed to the SecurityRegistry (codes collide across contracts, so map only when target is the SecurityRegistry).
- `resolve_flag` / `release_with_consent` are keyed by `record_id`, not `loan_id`; the hub's per-row loan label must come from the call context (store `loanId` alongside in the page-local op), not from the args.
- `release_with_consent` burns the record NFT; it is irreversible — confirm dialog required.
- Delay: 24 h on test/prod; until #1756 the whole role may be delayed, so all four take the schedule path on stage. Scheduled ops expire 7 days after ready time.
- The argocd manifests live in `/Users/aabliazimov/Documents/work/argocd` (separate repo); the coder cannot ship that in this PR. Testnet value: `CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX` (already used by `CHAIN_99000001_STELLAR_API_SECURITY_REGISTRY_ADDRESS` in `argocd/pipeline/test.yaml`). Missing env → "not configured" copy, never a crash.
- Testnet acceptance ("schedule → execute after the delay works on testnet") needs a RISK_COUNCIL wallet and a 24 h wait; it can be done by QA after merge, not inside the coder run. Unit tests cover encoding and gating.

## Open Questions

1. Inspector panel read: the backend serves `inspectors` only inside the per-loan `GET /v1/loan-book/{id}/security`. Proposed: the `/risk-council/inspectors` page reads the current list on-chain via `simulateRead` of the SecurityRegistry `inspectors()` view (contract config, not a computed metric; same pattern as the RC pages' `loan_money` reads). Alternatives: take `inspectors` from `/security` of any loan in the loan book, or add a small backend endpoint. Which do you want?
2. `consent_hash` input for `release_with_consent`: proposed a text field "Consent reference" hashed as `sha256(utf8(text.trim()))` (same rule as `adjust_interest` / `resolve_flag` reasons), with an alternative "paste a 64-hex hash" toggle for a hash computed off-app (e.g. of the signed consent PDF). Is text-hash enough, or must the app hash an uploaded consent file?
3. Terms form units: proposed ratios/tolerances entered in % (≤2 dp → bps), `default_rate` in % (≤4 dp → ×10 000, loan-registry scale `ONE = 1e6`), `cure_period`/`grace_period`/`attestation_interval`/`inspection_interval` in days and `price_stale_after` in hours (integer → seconds), each with a live raw echo ("= 604800 s"). OK, or enter raw contract units?

## Implementation Steps

1. **Shared ScVal helpers.** Move `scMap` (and `u64`/`u128` helpers if useful) from `packages/wallet-connect/src/stellar/contracts/loanRegistry.ts` to a new `packages/wallet-connect/src/stellar/contracts/scval.ts`; `loanRegistry.ts` imports it (no behaviour change; existing `loanRegistry.test.ts` must stay green).
2. **Encoder** `packages/wallet-connect/src/stellar/contracts/securityRegistry.ts` (header `// spec: docs/frontend/trustee-flows.md#risk-council-security-actions`), modelled on `riskCouncil.ts`:
   - `export type SecurityPaymentTerm = "Lc" | "Dp" | "Da" | "OpenAccount"`, `export type FlagOutcome = "Accepted" | "TopUpRequired" | "Escalated"`.
   - `export interface SecurityTermsInput { advanceRatioBps; marginCallRatioBps; curePeriod; priceStaleAfter; paymentTerm; gracePeriod; defaultRate; attestationInterval; inspectionInterval; toleranceBps; gradeToleranceBps }` (u64 fields as decimal strings or integers; validate).
   - `export type SecurityRegistryCall = { fn: "set_terms"; loanId; terms } | { fn: "resolve_flag"; recordId; outcome; reasonHash } | { fn: "release_with_consent"; recordId; consentHash } | { fn: "set_inspectors"; inspectors: string[] }`.
   - `encodeSecurityRegistryArgs(call): xdr.ScVal[]` — validation: u32 ranges; `marginCallRatioBps >= advanceRatioBps`; hashes `/^[0-9a-f]{64}$/` via `hexToBytes32ScVal`; inspectors: each a valid `G…`/`C…` Strkey (`StrKey.isValidEd25519PublicKey` / `isValidContract`) encoded with `new Address(s).toScVal()`, no duplicates, list may be empty (contract allows it; UI warns). `Terms` → `scMap` with all 12 snake_case keys, `margin_call_at: u64(0)`.
   - `relaySecurityRegistry({ call, registryId, ... })`, `readSecurityRegistrySchedule(...)` (thin wrappers over `relay` / `readOperationSchedule`, same shape as `relayRiskCouncil` / `readRiskCouncilSchedule`).
   - `readSecurityInspectors({ registryId, rpcUrl, networkPassphrase })` via `simulateRead` → `string[]` (pending Open Question 1).
   - `securityReasonHash(text) = sha256Hex(text.trim())`.
   - Export all from `packages/wallet-connect/src/index.ts` next to the riskCouncil exports.
3. **Env.** `packages/trustee/src/lib/env.ts`: `STELLAR_SECURITY_REGISTRY_ID: readString("VITE_STELLAR_SECURITY_REGISTRY_ID", "")` with doc comment (contract stored under `collateral_registry` in `addresses.json`); add to `docker/trustee/entrypoint.sh` `--arg` list and `.env.example`.
4. **Generalise the Risk Council hooks** (`packages/trustee/src/api/useRiskCouncil.ts`, `packages/trustee/src/lib/riskCouncilOps.ts`):
   - Introduce `export type CouncilCall = RiskCouncilCall | SecurityRegistryCall` and `councilTarget(call | fn): "loan_registry" | "security_registry"` (fn names are disjoint). Config resolver returns `{ accessManagerId, targetId }` per target; missing `STELLAR_SECURITY_REGISTRY_ID` → "On-chain SecurityRegistry actions are not configured for this environment."
   - `useRiskCouncilAccess(chainId, call, fn)` / `useRiskCouncilRelay()` accept `CouncilCall` and dispatch to the right encoder/target; query keys include the target. `riskCouncilCallKey` already sorts keys — keep it, keyed by `${chainId}:${key}`; for array args (`inspectors`) the JSON form is order-sensitive, which matches the contract (order matters for the op hash).
   - `ScheduledOp` gains optional `loanId` (context for record-keyed calls).
   - Invalidate also `loan-security` (already listed) after a SecurityRegistry relay.
   - Keep existing callers/types source-compatible (`RiskCouncilCall` still exported).
5. **Shared action view.** `routes/-risk-council-shared.ts` `useRiskCouncilActionView` takes `CouncilCall`; `mapRelayError` adds SecurityRegistry contract-error copy (new map in `lib/accessManagerAction.ts`, e.g. `SECURITY_REGISTRY_ERROR_COPY` for `#12`, `#14`, `#15`, `#32`, applied only when target is the SecurityRegistry) and a paused notice when served `paused === true`.
6. **Extend the `/security` client type** `packages/trustee/src/api/useLoanSecurity.ts`: add the served fields the pages need, all optional: `paused`, `inspectors`, full `terms` (12 fields as served: numbers for u32, strings for u64, `payment_term`), `records[]` (`record_id`, `lot_id`, `protection`, `commodity`, `unit`, `status`, `open`, `flagged_by`, `reference_quantity`, `release_reason_hash`, `released_by_consent`, `inspections[]` with `inspection_id`, `inspector`, `kind`, `quantity`, `grade`, the variances, `flagged`, `resolution`). No client-side computation.
7. **Per-loan page** `/risk-council/security/$id`: presenter `routes/-risk-council-security.ts` (`useRiskCouncilSecurity(chain, id)`, built on `useRiskCouncilLoanBase` + `useLoanSecurity`) and view `routes/risk-council.security.$id.tsx` using `-RiskCouncilParts.tsx`. Validates `chain` with `parseLoanRouteSearch`.
   - Left card "Current security terms": served terms verbatim (ratios as %, durations with units, `payment_term`), `paused`, `refresh_pending` note; "No security terms are set for this loan." when `terms: null`.
   - **Set terms** card: 11 inputs (+ payment-term select), prefilled from served terms when present; inline validation (ratio order, integers, ranges); raw echo per field; buttons "Set terms" / "Schedule terms" / "Execute terms". No-role copy: "Setting security terms belongs to the Risk Council."
   - **Flagged records** card: one row per record with `flagged_by != null` (served), showing protection, lot, the flagging inspection (kind, inspector, quantity, grade, variances, verbatim). Per row: outcome radio (Accepted / TopUpRequired / Escalated with one-line effect text from the contract docs; TopUpRequired: "Opens a margin call if LTV is above the advance ratio"), reason text + sha256 hash; buttons "Resolve flag" / "Schedule resolution" / "Execute resolution". Empty: "No flagged records."
   - **Release with consent** card: select among open records (`open === true`), consent input + hash, confirm dialog ("Release record #{id}? This burns the record NFT and cannot be undone.", `role="dialog"`, Escape/backdrop cancel, reuse Escalate's dialog pattern); buttons "Release with consent" / "Schedule release" / "Execute release".
   - EVM loan / not configured: read-only with `stellarOnlyActionReason` / not-configured copy, same as other RC pages. Every value is "—" when not served.
8. **Inspector panel page** `/risk-council/inspectors`: presenter `routes/-risk-council-inspectors.ts`, view `routes/risk-council.inspectors.tsx`. Shows the current list (source per Open Question 1), an editable list (add Strkey with validation, remove, reorder not needed — keep current order and append), the resulting full list echoed, buttons "Set inspectors" / "Schedule inspector panel" / "Execute inspector panel". Note: "Applies to inspections entered from now on." No-role copy: "Setting the inspector panel belongs to the Risk Council." Chain = session chain (`useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`).
9. **Hub** (`routes/-risk-council-hub.ts`, `risk-council.index.tsx`): add `ACTION_LABELS` / routes for the four fns (`HubRoute` gains `"security"` and `"inspectors"`); `formatCallArgs` for them (terms summary "advance {a}% · margin call {m}%", outcome + record id, record id + consent hash prefix, inspector count); loan label for record-keyed calls from `ScheduledOp.loanId`; loan index adds a "Security" link for every listed loan that is not `Closed`; a header link "Inspector panel". No new deterministic lookups (arguments are not derivable), so these appear only when scheduled from this console in this session; update `HUB_FOOTNOTE` accordingly. Add route links to `TrusteeSidebar` only if the existing RC entry has children (it does not today — keep hub links).
10. **Loan detail** (`routes/loans.$id.tsx`, Security card ~line 263): add a "Security actions" link to `/risk-council/security/$id` (with `chain`) on Stellar loans, next to the existing Escalate link pattern (~line 1275); in the `terms: null` state the link reads "Set security terms".
11. Run `pnpm` route generation so `routeTree.gen.ts` picks up the two new routes.

## Test Strategy

Colocated per existing conventions (`packages/wallet-connect/src/stellar/contracts/*.test.ts`, trustee `routes/-*.test.ts`, `api/-*.test.tsx`):
- `securityRegistry.test.ts`: exact ScVal for each fn (mocked `xdr` like `riskCouncil.test.ts`/`loanRegistry.test.ts`): `Terms` map keys sorted and complete (12), `margin_call_at` = 0, u32 vs u64 types, enum vector shape for `PaymentTerm` / `FlagOutcome`, `Address` encoding for inspectors; rejections: ratio order, bad hex hash, bad Strkey, duplicate inspector, out-of-range u32, non-integer durations. Relay/schedule wrappers pass `target = registryId`, `fn`, encoded args.
- `scval` extraction: existing `loanRegistry.test.ts` unchanged and green.
- `lib/-riskCouncilOps.test.ts`: security calls recorded/keyed with target; `loanId` context kept.
- `api/-useRiskCouncil.test.tsx`: target dispatch (loan vs security registry), not-configured error when `STELLAR_SECURITY_REGISTRY_ID` empty, invalidation list.
- `routes/-risk-council-security.test.ts`: unit conversions (% → bps, % → default-rate scale, days/hours → seconds), prefill from served terms, flagged-record list from `flagged_by`, open-record list, no-role / EVM / not-configured / paused states, SecurityRegistry error-code copy.
- `routes/-risk-council-inspectors.test.ts`: list editing and validation, call built from list.
- `routes/-risk-council-hub.test.ts`: labels/args/routes for the four fns, footnote.
- A page render test for the security page like `-risk-council-reterm-page.test.tsx`, including the release confirm dialog.
- Run `/test-fast` (lint, typecheck, unit). No DB, no env-gated tests.
- Manual / QA (after merge, testnet, RISK_COUNCIL wallet): schedule each of the four, confirm "Scheduled. Executable from …" from `get_schedule`, execute after 24 h, confirm `/security` reflects it after `refresh_pending` clears; a Trustee-only wallet sees read-only.

## Docs to Update

- `docs/frontend/trustee-flows.md` §"Risk Council actions": add a SecurityRegistry function table (target `ENV.STELLAR_SECURITY_REGISTRY_ID`, same AM), encoding notes (Terms map, enums, Address vec), the two pages, hub additions, config var, error copy; anchor `#risk-council-security-actions`.
- `docs/user-stories/epic-1795/1858-risk-council-security-actions.md` (new): stories for each action, no-role, EVM, not configured, reload-and-re-enter to find a schedule.
- `docs/product-specs/trustee-dashboard.md` §"Type 3" — one line referencing the new actions if that section enumerates RC actions.
- `docs/exec-plans/tech-debt-tracker.md`: extend TD-177 (hub cannot list SecurityRegistry ops scheduled elsewhere); add an entry if Open Question 1 resolves to the on-chain read.
- `.env.example` and the trustee env reference in `docs/references/` if it lists `VITE_STELLAR_*`; note the separate argocd change (`VITE_STELLAR_SECURITY_REGISTRY_ID` in `argocd/pipeline/test.yaml`, and `prod.yaml` once deployed).
