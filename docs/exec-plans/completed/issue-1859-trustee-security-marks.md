# Issue #1859: Trustee: price marks, extension consent and check coverage (SecurityRegistry revalue / record_extension_consent / check_coverage)

Source: https://github.com/<org>/pipeline/issues/1859 (sub-issue of epic #1795; frontend pair of backend #1783)

## Scope

Three SecurityRegistry writes from the Trustee app (`packages/trustee`), all on the loan detail page (`routes/loans.$id.tsx`), Stellar loans only:

1. **Revalue** a goods record: `revalue(record_id: u32, value_per_unit: i128, benchmark: Symbol, report_hash: BytesN<32>)`, `#[only_owner]`, reached through `access_manager.execute` by a TRUSTEE wallet (delay 0). The form prefills `suggested_mark.value_per_unit` / `suggested_mark.benchmark` and shows `mark_due`, `mark_due_reasons`, `move_bps`, `mark_due_at`, `suggestion_status` and the stale chips exactly as served by `GET /v1/loan-book/{loan_id}/security` (#1780 + #1783, spec `docs/product-specs/loan-security-state.md#mark-suggestions`). Zero is allowed, negative is rejected client-side (input validation only, no arithmetic on served values). A USD record's mark is data only (copy note).
2. **Record extension consent**: `record_extension_consent(loan_id: u32, new_maturity: u64, consent_hash: BytesN<32>)` via `access_manager.execute` (TRUSTEE). The served `extension_consents[]` list is shown verbatim next to the form. The extension itself stays the Risk Council `amend_economics` (#1761), out of scope.
3. **Check coverage**: `check_coverage(loan_id: u32)`, permissionless, invoked directly on the SecurityRegistry (no AccessManager) from any connected Stellar wallet.

After each success: invalidate `loan-security` (+ `loan-book`, `audit-log`), refetch, nothing computed client-side.

What the API already serves (verified in `docs/product-specs/loan-security-state.md` and the `/security` example): `records[].suggested_mark {value_per_unit, benchmark, source_price, source_at, asset, price_provider, quote_unit, mode, report, report_hash, ...}`, `records[].suggestion_status`, `move_bps`, `mark_due`, `mark_due_reasons`, `mark_due_at`, `records[].mark.report_hash`, `prices {mark_age, price_stale, mark_max_age, mark_move_bps, marks_due}`, `extension_consents[]`, `margin_call.open_call_curable` / `ltv_above_ratio_no_onchain_call`. None of these are mirrored in `useLoanSecurity.ts` yet except `mark` (without `report_hash`) and `prices.price_stale`.

Already in place (no work): `VITE_STELLAR_SECURITY_REGISTRY_ID` exists in `.env.example`, `docker/trustee/entrypoint.sh` and `packages/trustee/src/lib/env.ts` (#1858). Only the argocd values entry needs checking (step 9).

Out of scope: `amend_economics`; Risk Council security actions (#1858); EVM SecurityRegistry; any client-side LTV/valuation/move computation.

## Assumptions and Risks

- Contract signatures are taken from the Issue body and `docs/references/security-registry-events.md` (`revalued` event carries `value_per_unit`, `benchmark` Symbol, `report_hash`); the contracts repo (`pipeline-stellar-contracts@e9881ac`) is not checked out locally. The coder must confirm arg order/types and the revalue / record_extension_consent / check_coverage error codes against the contract source before finishing the error-copy map; if unavailable, unknown codes fall back to the generic error text with raw details behind "View details".
- `benchmark` is a Soroban `Symbol`: validate `[A-Za-z0-9_]{1,32}` client-side (matches the backend benchmark config rule).
- `value_per_unit` is a 7-dp decimal string in the API and an i128 raw on chain. Converting the user's typed decimal string to raw i128 is encoding (same as `parseUsdDollarsToI128` in `minter.ts`), not a metric; the prefill uses the served string verbatim.
- Role holder: the Issue and `deployments/justfile setup-access` say TRUSTEE holds `revalue`; the user-docs glossary says the Risk Council "may set a manual price". The UI gates on `readCanCall` at runtime (`accessAction`), so it works for whichever role holds it; `no-role` shows the standard no-role copy.
- `check_coverage` needs a direct-invoke envelope builder (pattern: `buildRecordWireInEnvelope` in `minter.ts`, `contract.call(...)` + simulate + assemble + sign + submit). There is no generic helper yet; adding one inside `securityRegistry.ts` is acceptable.
- Blocked-on issues #1780 and #1783 are closed; data should be live on staging only if `SECURITY_MARK_COMMODITIES` is configured — otherwise `suggestion_status` is `unmapped`/null and the form starts empty (expected, render "—").
- No Figma frames exist for any of the three actions (see Open Questions).

## Open Questions

1. **No Figma frames.** No design exists for the revalue dialog, extension-consent form or check-coverage action, and this Issue has no no-design exception. Proposal: build from existing loan-detail primitives (`CARD_CLASS`, `CardTitle`, `KeyValueRow`, `chipStyle`, `Button`, the `DisburseAction` / `RegisterDebtTokenAction` card+dialog pattern and the risk-council form parts): a "Revalue" button per open goods record in `SecurityRecordsCard` opening a dialog, and one new "Security actions" card (check coverage + extension consent) under the records card. Is building without frames approved for #1859, or should it park for design?
2. **report_hash when the Trustee overrides the suggestion.** The spec says "if the Trustee overrides the value, the suggestion's hash no longer describes the mark, so the UI hashes its own evidence (#1859)". Proposal: unchanged value+benchmark → submit `suggested_mark.report_hash` verbatim; otherwise require an evidence text field (source/reference) and submit `sha256(trimmed text)` via the existing `securityReasonHash`. Confirm, or specify what the evidence is (file upload hash?).
3. **consent_hash source.** Proposal: a required "Buyer consent reference" text (document ref / email id), hashed with `securityReasonHash` like #1858's reason hashes. Or should it hash an uploaded consent document?
4. **new_maturity input.** Proposal: a UTC date input converted to unix seconds at 00:00 UTC (as `valueDateSeconds` does for disburse). Is midnight UTC correct, or must it match the maturity time-of-day of the loan?
5. **Who sees check coverage.** The Issue says "any wallet". Proposal: show it whenever a Stellar wallet is connected and the security card is ready, with a hint line when `margin_call.open_call_curable === true` or `ltv_above_ratio_no_onchain_call === true` (served flags). Confirm no further gating (e.g. hide when no margin call).
6. Role wording: glossary says Risk Council may set a manual price, Issue says TRUSTEE. UI gates on `can_call` at runtime; confirm no copy should name a role.

## Implementation Steps

1. [x] **wallet-connect encoders** — `packages/wallet-connect/src/stellar/contracts/securityRegistry.ts`:
   - Extend `SecurityRegistryCall` with `{ fn: "revalue"; recordId: number; valuePerUnit: string /* 7-dp decimal */; benchmark: string; reportHash: string }` and `{ fn: "record_extension_consent"; loanId: number; newMaturity: number | string; consentHash: string }`.
   - Encode: `u32` record/loan id; `value_per_unit` as i128 via a strict 7-dp decimal parser (reject negatives, >7 dp, non-decimal; allow `0`) — reuse/generalise `parseUsdDollarsToI128` from `minter.ts` if its rules match, otherwise a local `decimal7ToI128`; `benchmark` via `xdr.ScVal.scvSymbol` after `/^[A-Za-z0-9_]{1,32}$/`; hashes via `hashArg`; `new_maturity` via `u64Arg`.
   - `relaySecurityRegistry` already works (mode execute) — reuse it for both.
   - Add `buildCheckCoverageEnvelope({ registryId, loanId, caller, rpcUrl, networkPassphrase })` and `checkCoverage(...)` (sign + submit + poll), following `buildRecordWireInEnvelope` / `recordWireIn` in `minter.ts`, returning `{ hash }` and accepting an `onStage` callback compatible with `RelayStage`.
   - Export new symbols from the package index.
2. [x] **Types** — `packages/trustee/src/api/useLoanSecurity.ts`: mirror (all optional) `LoanSecurityRecord.suggested_mark` (`value_per_unit`, `benchmark`, `source_price`, `source_at`, `asset`, `price_provider`, `quote_unit`, `mode`, `report_hash`), `suggestion_status`, `move_bps`, `mark_due`, `mark_due_reasons`, `mark_due_at`, `mark.report_hash`; `LoanSecurityPrices` `mark_age`, `mark_max_age`, `mark_move_bps`, `marks_due`; top-level `extension_consents[]` (`position`, `consent_hash`, `new_maturity`, `ledger`, `at`); `margin_call.open_call_curable` already present.
3. [x] **Hooks** — new `packages/trustee/src/api/useSecurityMarks.ts` (spec header `trustee-flows.md#security-marks-1859`):
   - `useSecurityRegistryAccess(fn)` — `readCanCall` for the connected wallet against `ENV.STELLAR_SECURITY_REGISTRY_ID` (pattern: `useDisburseAccess`).
   - `useRevalue()`, `useRecordExtensionConsent()` — mutations calling `relaySecurityRegistry` with the AccessManager id from ENV; `useCheckCoverage()` calling `checkCoverage`. Each exposes the relay stage, invalidates `["loan-security"]`, `loan-book`, `audit-log` on success with the `RECHECK_DELAYS_MS` refetch pattern of `useDisburse`.
   - `securityMarksConfigured()` — `!!ENV.STELLAR_SECURITY_REGISTRY_ID && !!AccessManager id`; check coverage needs only the registry id.
4. [x] **Pure view builders** (`packages/trustee/src/lib/securityMarks.ts`, tested): per record `markView(record)` returns served strings / "—": suggestion status label, mark-due chip + reasons (`missing` / `age` / `moved` → copy), `move_bps` shown as served bps, `mark_due_at` date; `revalueFormError(input)` (negative, >7 dp, bad benchmark, missing evidence when overridden); `reportHashFor(input, suggestion)` per Open Question 2; `extensionConsentFormError`; error-code copy map `SECURITY_MARKS_ERROR_COPY` extending `SECURITY_REGISTRY_ERROR_COPY` (12/14 already exist) with `amErrorCode`.
5. [x] **Revalue UI** — `packages/trustee/src/routes/-RevalueDialog.tsx` + a "Revalue" button per open goods record (`suggestion_status != null` or `protection` is goods per served data — use `suggestion_status !== undefined && record.open === true`; confirm field in code) in `-SecurityRecordsCard.tsx`, plus a "Mark due" chip and a "Suggested" row (`{benchmark} · $x per {unit}` from `suggested_mark`, "—" when null, status text when not `ok`). Dialog: prefilled value (served string), benchmark, evidence text (shown when overridden), current mark verbatim, flags; access-action gating via `accessAction` (execute-now / no-role); `stageLabel` on the submit button; `InlineError` with raw details. Remove the "Not shown here: mark suggestions…" sentence from the spec section accordingly.
6. [x] **Security actions card** — `packages/trustee/src/routes/-SecurityActionsCard.tsx`, rendered under `SecurityRecordsCard` in all three layout branches of `loans.$id.tsx` (lines ~1343, ~1390, ~1438), hidden when the summary security card is not ready:
   - "Check coverage" button + served hint notes (`CURABLE_NOTE`, `ABOVE_RATIO_NO_CALL_NOTE` reused from `-loanSecurity.ts`); requires a connected Stellar wallet.
   - "Extension consents" list (`extension_consents[]` verbatim: position, new maturity date, consent hash truncated, recorded at) + "Record buyer consent" form (new maturity date, consent reference) gated by `can_call` for `record_extension_consent`.
7. [x] **Comment rule** — each new file gets one 2–3-line spec-pointer header; no other comments.
8. [x] **Spec** — `docs/frontend/trustee-flows.md`: new section `### Security marks, extension consent and coverage check (#1859)` under Loan detail (states, gating, hashing rules, test ids, error copy); update the Security records card section (new chips/rows/button).
9. [x] **Deployment** (test values carry the id; prod values have no `VITE_STELLAR_SECURITY_REGISTRY_ID`, left to the argocd owner) — verify argocd trustee values carry `VITE_STELLAR_SECURITY_REGISTRY_ID` (testnet `CDTUMAT6XMYRX6XWHXZF3RDSQIVMRUPFXXXO57NT4VTMUU2R77SWZLUX`); add if missing (repo `argocd` sibling, per #1858 plan `docs/exec-plans/completed/issue-1858-rc-security-actions.md`).
10. [x] **User stories** — `docs/user-stories/epic-1795/1859-trustee-security-marks.md`: revalue with suggestion, revalue override (evidence), zero price, rejected negative, no-role wallet, extension consent, check coverage from a non-trustee wallet, "—" rendering when suggestion is unmapped.

## Test Strategy

- `packages/wallet-connect/src/stellar/contracts/securityRegistry.test.ts`: encode `revalue` (i128 for `"0"`, `"1250.5"`, `"100.0000000"`; rejects `-1`, 8 dp, empty, bad symbol, 33-char symbol, bad hash), `record_extension_consent` (u64 bounds), `check_coverage` envelope builds `check_coverage` with a u32 arg (mock RPC as in existing minter tests).
- `packages/trustee/src/lib/securityMarks.test.ts`: view builders render served values verbatim and "—" for null/missing/partial 200; mark-due reasons copy; `reportHashFor` uses the served hash when unchanged and the evidence hash when overridden; form errors.
- `packages/trustee/src/api/-useSecurityMarks.test.tsx`: mutations call `relaySecurityRegistry` with the right call/ids, `checkCoverage` direct; invalidate `loan-security`; error code mapping.
- Component tests: `-RevalueDialog.test.tsx`, `-SecurityActionsCard.test.tsx`, extend `-loans.$id.test.tsx` (card hidden for EVM / not configured / no terms; button disabled with no-role).
- Run `scripts/check-changes.sh` (or `yarn workspace` lint/test/build for trustee + wallet-connect); `npx vite build` in trustee if a route is added (none planned).
- Manual testnet check (acceptance): each call from a TRUSTEE wallet, check coverage from a non-trustee wallet; values update after refetch. The user verifies in their own browser (no driving of the live session).

## Docs to Update

- `docs/frontend/trustee-flows.md` — new #1859 section; Security records card section update.
- `docs/user-stories/epic-1795/1859-trustee-security-marks.md` — new.
- `docs/product-specs/loan-security-state.md` — only if the report-hash decision (Open Question 2) needs recording on the backend side.
- `.env.example` — no change (variable present); argocd values if missing.
