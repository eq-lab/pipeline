# Issue #1094: Trustee Audit Log — show loan name in Reference, loan number in Scope

Source: https://github.com/eq-lab/pipeline/issues/1094

## Scope

`GET /v1/audit-log` currently returns the on-chain **tx hash** as each item's `reference`,
and the Trustee page shows the friendly loan name in the **Scope** column (via a frontend
loan-book join). This swaps the two columns and re-sources the name server-side:

- **Reference** → friendly loan name `originator — commodity` (e.g. `Open Mineral — Copper Concentrate`).
- **Scope** → loan number `Loan #<loan_id>` (already the server `scope.label`).
- `YieldMinted` (protocol-scoped, no `loan_id`) → Scope `Protocol`, Reference `—`.

The loan name is sourced **server-side** from `params->'snapshot'->>'originator'` /
`->>'commodity'` (enriched by `packages/worker/src/indexer/loan_mapper.rs`), NOT from the
frontend loan-book join. The audit feed includes `LoanClosed`/`LoanDefaulted` events; the
loan book only contains **active** loans, so a frontend-only join renders `—` for exactly
the closed/defaulted loans an auditor most wants named.

In scope:

- Backend DTO + mapping (`packages/api/src/routes/audit_log.rs`).
- Repo SELECT to expose the snapshot name fields (`packages/shared/src/contract_logs_repo.rs`).
- Frontend render swap + removal of the loan-book enrichment path
  (`packages/trustee/src/routes/-useAuditLog.ts`, `audit-log.tsx`, `api/useAuditLog.ts`).
- Backend unit tests (`packages/api/tests/audit_log.rs`) + presenter tests if present.
- Doc updates (product spec + frontend spec).

Out of scope (per issue non-goals):

- `event_name`, `action`, `details` semantics are unchanged (but see the latent bug below —
  flagged, not fixed inline unless it blocks this change).
- No change to which events appear in the feed.
- No pagination changes (still the unpaginated feed; backend follow-up #1006).

## Assumptions and Risks

- **`params` nesting (confirmed).** Loan events route through `LoanEventMapper` →
  `do_insert` (`loan_mapper.rs:457`), which restructures params into
  `{loan_id, event: {…parser fields…}, snapshot: {…}}`. So originator/commodity live at
  `params->'snapshot'->>'originator'` / `->>'commodity'`. `LoanSnapshot`
  (`packages/shared/src/loan_snapshot.rs:12,14`) serializes them as snake_case `originator`
  / `commodity`. Verified on both chains: Stellar loan events use the same
  `LoanEventMapper` (`stellar/poller.rs:188`); Stellar `YieldMinted` uses `StellarLogMapper`
  (flat), matching EVM `YieldMinted` (`ContractLogMapper`, flat).
- **`YieldMinted` has no snapshot.** It is persisted flat (`{s_plusd_amount, treasury_amount}`),
  no `loan_id`, no `snapshot`. The name read must tolerate a missing `params->'snapshot'` and
  yield `None` → Reference `—`. Covered by the protocol-scoped branch.
- **Latent bug in `format_action` (flag, do not fix inline).** `format_action`
  (`audit_log.rs:195`) reads flat keys — `param_str(params, "senior_interest")`,
  `params.get("new_ccr")`, `param_str(params, "status")`, `param_str(params, "closure_reason")`,
  etc. But for loan events those parser fields are nested under `params->'event'` after
  `do_insert`. So `PaymentRecorded`, `LoanClosed`, `LoanStatusUpdated`, `LoanCCRUpdated`,
  `LoanDefaulted`, `LoanRolledOver`, `EconomicsAmended` almost certainly render **generic
  actions with null `details`** in production today (they read keys that no longer exist at the
  top level). `LoanDrawn`/`LoanLocationUpdated` are unaffected (read nothing). `YieldMinted`
  is unaffected (genuinely flat). This is pre-existing and orthogonal to the column swap — see
  Open Questions #3 for the decision on whether to fix it here or log it. Do NOT silently
  change action/details behavior as a side effect of this issue without that decision.
- **Backend/frontend contract.** This is labelled `backend`; the frontend render change ships
  in the same PR (the DTO field is new). The frontend must not break if the backend field is
  ever absent — keep a defensive fallback.
- **No Figma change.** The issue references no Figma node; the column layout/tokens are
  unchanged. The Reference column now holds text (loan name) instead of a monospace hash — the
  monospace styling + hover `title` for the hash cell must be reconsidered (Open Question #2).
- **Tests convention.** Backend unit tests stay in `packages/api/tests/audit_log.rs`, pure (no
  DB, no `DATABASE_URL`/`POSTGRES_URL`). Repo SQL changes are not unit-testable without a DB and
  must not introduce a DB-gated test.

## Open Questions

**RESOLVED (final, narrowed scope — see issue comments).** An earlier pass on this branch
over-implemented all three recommendations below; the scope was subsequently narrowed to
#1 only, with #2 and #3 explicitly reversed/split out. The final decisions:

1. **RESOLVED — Field design: keep `reference`, change its value only.** `AuditLogItem`
   keeps the existing `pub reference: String` field (no new `reference_name` field, no
   `Option`). Its value changes from the on-chain tx hash to the friendly loan name
   (`"<originator> — <commodity>"`, empty string when unavailable). **The response shape is
   byte-identical to pre-#1094** — this is a pure value change on an existing field. The UI's
   **Reference column** renders `item.reference || "—"`.
2. **RESOLVED (reversed from the earlier pass) — Tx hash is dropped from the response, not
   relocated.** The earlier pass moved `row.tx_hash` into `details.tx_hash` for every event.
   That is reverted: `details` is exactly `format_action`'s untouched curated object again;
   the tx hash is no longer present anywhere in `GET /v1/audit-log`'s response. Frontend
   `truncateReference`/`referenceFull`/the cell `title` hover remain removed (that part of
   the earlier pass was correct and is kept).
3. **RESOLVED (split out) — `params` read path / latent bug: NOT part of this issue.** The
   earlier pass added a `format_action`-nesting fix (`event_params` helper reading
   `params->'event'`) reasoning that the same nesting the name-read needed also applied to
   the action formatter. On reflection this widens the change beyond the `reference`-value
   swap and touches `action`/`details` semantics for every loan event — explicitly a non-goal
   of this issue. `format_action` is fully reverted to read flat top-level `params` (as on
   `origin/main`), and the nesting fix is tracked separately as **issue #1096**.

## Implementation Steps

1. **DONE. Repo — expose snapshot name fields** (`packages/shared/src/contract_logs_repo.rs`).
   - Extend the `AuditLogRow` struct (`:178`) with two optional fields, e.g.
     `pub originator: Option<String>` and `pub commodity: Option<String>` (or a single
     `pub loan_name: Option<String>`, but two raw fields keep formatting in the API layer per
     the struct's "raw" doc-comment).
   - Extend the `list_audit_log` SELECT (`:1019`) to project them:
     `params->'snapshot'->>'originator' AS originator`,
     `params->'snapshot'->>'commodity' AS commodity`. These are `NULL` for `YieldMinted`
     (no snapshot) → `Option::None`. Bind/`try_get` the two new columns in the row mapper
     (`:1037`).
   - Update the `AuditLogRow` doc-comment to note the two snapshot-derived fields.

2. **DONE. API DTO + mapping** (`packages/api/src/routes/audit_log.rs`).
   - Per Open Question #1 (final): `AuditLogItem.reference` stays `pub reference: String` (no
     new field, no `Option`). Doc-comment updated to describe the friendly-name value and the
     empty-string fallback.
   - In `map_item`: build the friendly name from `row.originator` + `row.commodity` via the
     `build_reference_name` helper; `reference =
     build_reference_name(...).unwrap_or_default()`. Loan-scoped rows with a full snapshot →
     the name; protocol-scoped rows (`YieldMinted`) or rows missing either snapshot field →
     `""`.
   - Scope is already `Loan #<id>` / `Protocol` — no change to `AuditScope`.
   - Per Open Question #2 (final): `details` is untouched — `format_action`'s return value
     passed straight through, no `tx_hash` insertion. The tx hash is dropped from the response
     entirely (not relocated).
   - Updated the module header doc-comment to describe the unchanged response shape and the
     single value-only change to `reference`.
   - No new schema fields — `AuditLogItem`/`AuditScope` are unchanged in shape, only a
     doc-comment/value update; no `ToSchema` changes needed.

3. **REVERTED — `format_action` nesting is NOT part of this issue.** Per Open Question #3
   (final), the `event_params` helper and its call site in `format_action` were removed;
   `format_action` is now byte-identical to `origin/main` (flat top-level `params` reads). The
   nesting fix is tracked separately as **issue #1096**.

4. **DONE. Frontend data hook** (`packages/trustee/src/api/useAuditLog.ts`).
   - `AuditLogItem.reference_name: string | null` reverted back to `reference: string`
     (shape now matches the backend's unchanged DTO).

5. **DONE. Frontend presenter** (`packages/trustee/src/routes/-useAuditLog.ts`).
   - Loan-book enrichment stays removed (this part of the earlier pass was correct): no
     `useLoanBook` import, no `loanNames` `useMemo`/`resolveScopeLabel`.
   - `scopeLabel` comes straight from `item.scope.label` (`Loan #<id>` / `Protocol`).
   - `reference` = `item.reference || "—"` (empty-string fallback, matching the DTO's
     `String` — not `?? "—"`, since the field is never `null`).
   - `truncateReference`/`referenceFull` stay removed. `AuditRow` shape stays minimal:
     `{ key, time, action, scopeLabel, reference }`.

6. **DONE (unchanged from the earlier pass). Frontend view**
   (`packages/trustee/src/routes/audit-log.tsx`) — renders `row.reference` as plain body text
   (no monospace/hover), `GRID_TEMPLATE_COLUMNS` rebalanced. No further change needed; this
   file does not reference the DTO field name directly.

7. **DONE. Backend unit tests** (`packages/api/tests/audit_log.rs`).
   - Kept the `row(...)`/`row_with_snapshot(...)` fixtures (originator/commodity plumbing is
     unchanged — `contract_logs_repo.rs` is correct as committed).
   - Removed the `enriched_params(...)` helper and every test's dependency on it —
     `format_action` tests now build flat fixtures again (matching `origin/main`), and the
     `loan_event_missing_the_event_key_falls_back_to_flat_params` regression test (specific to
     the reverted nesting fix) was deleted.
   - Mapping tests assert `item.reference == "<name>"` for a snapshot-bearing row and
     `item.reference == ""` for protocol-scoped/missing-name rows (was
     `item.reference_name == Some(...)`/`None`). Removed all `details["tx_hash"]` assertions;
     the ordering test now distinguishes rows by `event_name` instead of `tx_hash`.
   - 24 tests pass: `cargo test -p pipeline-api --test audit_log` (down from 25 — the removed
     `loan_event_missing_the_event_key_falls_back_to_flat_params` was the only test exclusively
     about the reverted `event_params` behavior; the `details["tx_hash"]` assertions were edited
     in place on existing tests rather than being separate tests).

8. **DONE. Lint / build.** See the coder's final report on this issue for the exact commands
   and output re-run against the narrowed diff.

## Test Strategy

- **Backend (pure unit, no DB):** `packages/api/tests/audit_log.rs`.
  - `build_response` mapping: loan-scoped row with originator+commodity →
    `reference == "Open Mineral — Copper Concentrate"`, `scope.label = "Loan #4492"`,
    `scope.loan_id = Some("4492")`.
  - Protocol-scoped (`YieldMinted`, no snapshot) → `reference == ""`, `scope.label =
    "Protocol"`, `scope.loan_id = None`.
  - Defensive: originator present but commodity `None`/empty (or vice versa) → `reference ==
    ""` (no dangling `" — "`).
  - `format_action`: flat-params fixtures for every event, matching `origin/main` exactly —
    this issue does not touch action/details semantics (see #1096 for the nesting fix).
  - OpenAPI smoke test (`openapi_doc_exposes_the_route`) stays green.
- **Repo SELECT:** not unit-testable without a DB (and DB-gated tests are prohibited); unchanged
  from the earlier pass — `contract_logs_repo.rs` needed no rework.
- **Frontend:** `-useAuditLog.test.ts` and `-audit-log.test.tsx` updated to the reverted
  `reference: string` shape (no `reference_name`).
- **Edge cases:** missing snapshot (YieldMinted), partial snapshot (one of the two fields
  null/empty), a loan event for a closed/defaulted loan (the whole point — must still render the
  name from `snapshot`, independent of the loan book).

## Docs to Update

- `docs/product-specs/audit-logging.md` — describes `reference` as still `String`-typed, value
  changed from tx hash to friendly loan name; tx hash dropped (not relocated to `details`).
- `docs/frontend/trustee-flows.md` — Reference = `item.reference || "—"` (friendly loan name);
  Scope = `scope.label`; no loan-book enrichment; no monospace/hover for Reference; no mention
  of `details.tx_hash` (that never shipped in the final version).
- `format_action`'s params-nesting bug is **not** fixed in this issue — tracked as #1096. Do not
  describe it as fixed in any doc touched by this issue.
- No new product-spec surface is created; these are edits to existing specs.
