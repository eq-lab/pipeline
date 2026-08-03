# Issue #1000: Backend: GET endpoint for the Trustee Audit Log page

Source: https://github.com/eq-lab/pipeline/issues/1000

## Scope

Add a read-only `GET /v1/audit-log` endpoint that backs Surface 17 ("Audit Log") of the
Trustee dashboard (prototype `trustee-dashboard-prototype-v4_1.html`, `screenAudit()` ~L1601).
The page renders an append-only, reverse-chronological table with four columns: **Time**,
**Action**, **Loan / scope**, **Reference** (tx hash).

**In scope (v1):** a paginated, newest-first feed sourced from the `contract_logs` table —
the indexed on-chain event store that already backs the other Trustee endpoints
(`loan_book`, `withdrawal_queue`, `ccr_history`). Each item carries a server-rendered
human-readable `action`, the resolved loan/scope label, an ISO-8601 timestamp, the on-chain
`tx_hash` reference, and the raw `event_name` for optional frontend re-formatting.

**Explicitly out of scope (v1):** off-chain audit entries — fiat wire confirmations, MPC
co-signatures, USDC↔USYC swaps, operator/console actions — and the full spec-defined
"protocol audit log" store (`docs/product-specs/audit-logging.md`: `action_type`, `trigger`,
`invariant_before/after`, `input_parameters`). That store is **not persisted in Postgres
today** (it is mirrored to an external SIEM/log sink), so it cannot back a queryable endpoint
yet. Building it is tracked as a follow-up (see Open Questions / Docs).

## Assumptions and Risks

- **Source substrate mismatch with the spec.** `trustee-dashboard.md` Surface 17 names "the
  protocol audit log" (per `audit-logging.md`) as the source. That log is not queryable from
  Postgres today; no `audit_log` table/migration/repo exists. This plan uses `contract_logs`
  as the pragmatic interim source and documents the divergence. If the answer to Open
  Question 1 is "build the real audit-log store first," this plan is superseded by a larger
  cross-cutting effort (worker write path + migration + repo + endpoint) that depends on
  unfinished work — flag and re-plan.
- `contract_logs` only holds **on-chain** events, so several prototype rows (fiat wires, MPC
  co-signatures, batch off-ramps) will simply not appear in v1. The endpoint doc + footnote
  must not over-promise "every Trustee action."
- Loan display labels ("Company — Commodity") are resolved from loan metadata
  (`shared::loan_metadata::LoanMetadataFetcher`, as in `loan_book`), which may require a
  `tokenURI` fetch. Reuse the existing fetcher/caching; do not add new network calls per row —
  batch/resolve once per distinct `loan_id`.
- Some events are protocol-scoped with no `loan_id` (`YieldMinted` → `s_plusd_amount` /
  `treasury_amount`); represent their scope generically (e.g. "Protocol" / "Capital Wallet").
- Amounts in params are base-6 on-chain units — format with `formatting::base6_to_decimal_string`.

## Open Questions

_Resolved (user decision, 2026-08-03):_

1. **Data source for v1 — RESOLVED: `contract_logs` now.** Back the endpoint with the
   on-chain `contract_logs` feed and track the spec-faithful persisted "protocol audit log"
   store (fiat/MPC/operator actions) as a separate follow-up issue. This is the small,
   self-contained endpoint scope.
2. **Action-string ownership — RESOLVED (recommended default): API-rendered.** The API renders
   the human-readable `action` string *and* returns raw `event_name` + selected params so the
   frontend can re-format if it prefers.
3. **Event set — RESOLVED: loan lifecycle + yield.** Include `LoanDrawn`, `PaymentRecorded`,
   `YieldMinted`, `LoanCCRUpdated`, `LoanStatusUpdated`, `LoanClosed`, `LoanDefaulted`,
   `LoanRolledOver`, `EconomicsAmended`, `LoanLocationUpdated`. Exclude LP/deposit/withdrawal/
   staking/transfer events.

_None outstanding._

## Implementation Steps

_Status: all steps complete (2026-08-03). Deviations noted in the report / issue comment:
the feed is returned **in full, newest-first — no pagination/cursor** (per user request),
so the repo method is `list_audit_log(chain_id, event_names)` and the response is just
`{ items }`; scope label is `"Loan #<id>"` + raw `loan_id` (frontend resolves the friendly
name) rather than a metadata-fetched company name; `LoanCCRUpdated` action stays generic
("CCR written on-chain") with the raw value in `details` because the on-chain CCR scale is
ambiguous._

1. **Repo query** — add `AuditLogRepo` (or a method on the existing `contract_logs` repo) in
   `packages/shared/src/contract_logs_repo.rs`:
   - `async fn audit_log_page(pool, chain_id, event_names: &[&str], limit, before_id: Option<i64>) -> Vec<AuditLogRow>`.
   - `SELECT id, event_name, block_timestamp, tx_hash, params FROM contract_logs
     WHERE chain_id = $1 AND event_name = ANY($2) [AND id < $before] ORDER BY id DESC LIMIT $limit+1`.
   - Use `id` (BIGSERIAL, insertion order) for a stable keyset cursor and tiebreak; return
     `has_more` by fetching `limit + 1`.
   - Define `AuditLogRow { id, event_name, block_timestamp, tx_hash, params: serde_json::Value }`.
2. **Route module** — new `packages/api/src/routes/audit_log.rs`, mirroring
   `routes/withdrawal_queue.rs` conventions (Axum `Router`, `utoipa` `OpenApi` doc, `ChainQuery`
   defaulting to `DEFAULT_CHAIN_ID`):
   - Query params (`IntoParams`): `chain_id?`, `limit?` (default e.g. 50, cap e.g. 200),
     `cursor?` (opaque = last `id` seen), optional `loan_id?` filter.
   - DTOs: `AuditLogItem { timestamp: String (ISO-8601 via iso_utc_from_unix), action: String,
     scope: AuditScope, reference: String (tx_hash), event_name: String }`,
     `AuditScope { loan_id: Option<String>, label: String }`,
     `AuditLogResponse { items: Vec<AuditLogItem>, next_cursor: Option<String> }`.
   - Handler: resolve chain → call repo → resolve distinct `loan_id`s to labels via
     `LoanMetadataFetcher` (reuse `loan_book`'s approach) → map each row to an item via a
     pure `format_action(event_name, &params) -> String` helper → build `next_cursor` from the
     last row's `id` when `has_more`.
3. **Action formatter** — implement `format_action` as a pure function (event_name + params →
   display string), covering the confirmed event set (Open Q3). Examples:
   `LoanDrawn` → "Loan approved & minted"; `PaymentRecorded` → "Repayment recorded — …" (derive
   interest/principal wording from params); `YieldMinted` → "Coupon minted — $X vault + $Y
   treasury"; `LoanCCRUpdated` → "CCR X% written on-chain"; `LoanStatusUpdated` → "Status →
   {status}"; `LoanClosed` → "Loan closed — {closure_reason}"; `LoanDefaulted` → "Loan
   defaulted"; `LoanRolledOver` / `EconomicsAmended` → rate/maturity wording;
   `LoanLocationUpdated` → "Location updated". Keep it a plain function so it is unit-testable
   without a DB (see Test Strategy + memory: no DB in tests).
4. **Wire up** — register in `packages/api/src/main.rs`:
   `.nest("/v1", pipeline_api::routes::audit_log::router())` and
   `api_docs.merge(pipeline_api::routes::audit_log::AuditLogDoc::openapi())`. Add
   `pub mod audit_log;` to `packages/api/src/routes/mod.rs`.
5. **Docs** — update `docs/product-specs/trustee-dashboard.md` Surface 17 row and
   `docs/product-specs/audit-logging.md` to state that the Trustee Audit Log page is backed by
   the on-chain `contract_logs` feed in v1, that it is a subset of the full protocol audit log,
   and note the follow-up to serve off-chain entries. Regenerate any endpoint/OpenAPI docs.

## Test Strategy

- **Unit (no DB, per repo test conventions — tests live in `packages/api/tests/audit_log.rs`):**
  exercise `format_action` for every event in the confirmed set, including param-driven
  branches (`PaymentRecorded` interest-only vs principal+interest; `YieldMinted` amount
  formatting; `LoanStatusUpdated` status names; `LoanClosed` reason). Assert base-6 amounts
  render correctly and protocol-scoped events get a non-loan `label`.
- **Cursor/pagination logic:** unit-test the `has_more` / `next_cursor` derivation over a
  synthetic `Vec<AuditLogRow>` (pure, no DB) — first page, middle page, last page (no cursor).
- **Edge cases:** unknown/unmapped `event_name` (should be filtered by the `event_names`
  allow-list, never reach the formatter — assert the allow-list gates it); missing/extra params
  handled without panic; empty result → `items: []`, `next_cursor: null`.
- Follow existing test style in `packages/api/tests/` (e.g. `withdrawal_queue`-adjacent tests);
  no `DATABASE_URL`/`POSTGRES_URL` gating.

## Docs to Update

- `docs/product-specs/trustee-dashboard.md` — Surface 17 source note (on-chain `contract_logs`
  feed; subset of full audit log).
- `docs/product-specs/audit-logging.md` — clarify the Trustee UI feed vs. the full
  relayer/operator protocol audit log; note the off-chain follow-up.
- OpenAPI (auto via `utoipa` `AuditLogDoc`) + any generated endpoint reference.
