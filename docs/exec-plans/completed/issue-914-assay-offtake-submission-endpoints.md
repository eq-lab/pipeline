# Issue #914: Add assay and offtake-terms submission endpoints (Operations Console inputs)

Source: https://github.com/eq-lab/pipeline/issues/914

## Scope

Add two `POST` endpoints so a `MetalConcentrate`-mode loan's assay and offtake-terms
records can actually be submitted — today `loan_assays`/`loan_offtake_terms` exist only
as tables with **read** methods (`latest_assay`, `latest_offtake`, `CollateralValuationRepo`)
and a GET route (`GET /v1/loan-book/{loan_id}/valuations`) that reports
`missing_inputs: ["assay","offtake"]` with no way to clear it.

**In scope:**
- `POST /v1/loan-book/{loan_id}/assay` — insert a new `loan_assays` row.
- `POST /v1/loan-book/{loan_id}/offtake` — insert a new `loan_offtake_terms` row.
- `CollateralValuationRepo::insert_assay` / `insert_offtake` (new write methods,
  `packages/shared/src/collateral_valuation_repo.rs`).
- Request-payload validation mirroring the existing `validate_submission` style in
  `packages/api/src/routes/loan_book.rs` — decimal parsing, range checks, enum checks.
- Trustee-only authz (existing `AuthClaims`/`has_role` pattern), matching
  `review_submission`.
- Unit tests for the new pure validation functions (no DB — matches this repo's
  "tests never touch a live Postgres" convention).

**Out of scope (explicitly):**
- A "team"/"operations" role distinct from `trustee` — see Open Questions.
- History/list endpoints for past assay/offtake versions (only `latest_*` exists
  today; no issue requirement to list all versions).
- DB-level `REVOKE UPDATE, DELETE` on `loan_assays`/`loan_offtake_terms` — already
  called out as "deferred to a follow-up migration" in the migration files
  themselves (`20260708000003_loan_assays.sql`, `20260708000004_loan_offtake_terms.sql`).
  Not re-scoped here; logged to `tech-debt-tracker.md` instead (see Implementation
  Steps) so it isn't lost.
- Any new migration — both tables already exist with the exact shape needed.
- A generic cross-cutting audit-log table. Append-only rows with `recorded_by`
  (from the JWT `sub`, never client-supplied) + `created_at` + never-updated rows
  **are** this feature's audit trail, per the migrations' own design intent.

## Assumptions and Risks

- **Both submission endpoints require an existing `MetalConcentrate` valuation
  anchor for the loan** (`CollateralValuationRepo::get_anchor`). A loan with no
  anchor (not yet drawn/linked) or a `StandardGoods` anchor rejects the request
  with `400` — assay/offtake data is meaningless outside concentrate mode (the
  spec: "Standard-goods loans leave the concentrate-only fields empty").
- **`effective_at` is a required, caller-supplied Unix-seconds timestamp** (`u64`,
  matching the existing `LocationInput.updated_at` convention in `loan_book.rs`),
  not server-generated `now()`. Rationale: an assay certificate or signed offtake
  has its own real-world effective date, which may predate when an operator gets
  around to entering it — silently stamping `now()` would corrupt the
  `ORDER BY effective_at DESC` "latest wins" semantics `latest_assay`/`latest_offtake`
  already rely on. **Flagged as an Open Question below** in case product wants a
  different default.
- **`packages/shared/src/collateral_valuation/mod.rs:154`** divides by each penalty
  tier's `step_pct` (`excess / &p.step_pct`) with no zero-guard today. A submitted
  `step` of `0` would surface as a division-by-zero the next time anyone reads
  `GET /v1/loan-book/{loan_id}/valuations` for this loan (or the worker recomputes
  CCR) — a bug in a different file, but this endpoint is the only place such a value
  can enter the system, so it must validate `step > 0` at the door.
- **No existing test file covers `packages/api/src/routes/collateral_valuation.rs`.**
  This plan adds `packages/api/tests/collateral_valuation.rs` net-new.
- **Local `.env`/dev DB is unaffected** — no migration, so nothing to run against a
  local Postgres to pick this up beyond a normal `cargo build`.

## Open Questions

_Resolved during planning review (see issue comments):_

1. ~~**Role gating.**~~ Resolved: `trustee`-only, matching every other privileged
   write endpoint in `loan_book.rs`. Introducing a separate "Team" role is a new
   authz concept out of scope for this issue.
2. ~~**`effective_at` default behavior**~~ Resolved: required, caller-supplied Unix
   seconds — not server-generated `now()`.

## Implementation Steps

1. ✅ **`packages/shared/src/collateral_valuation_repo.rs`** — add two insert methods
   next to `insert_pending`, following its exact style (bind params, no ON CONFLICT —
   plain `INSERT`, since both tables are append-only by design):
   - `insert_assay(&self, chain_id: i64, loan_id: &BigDecimal, assay_status: &str, moisture_pct: Option<&BigDecimal>, assays: &[AssayMetalJson], deleterious: &[DeleteriousJson], certificate_uri: Option<&str>, effective_at: DateTime<Utc>, recorded_by: &str) -> Result<i64, sqlx::Error>` — `INSERT INTO loan_assays (...) VALUES (...) RETURNING id`.
   - `insert_offtake(&self, chain_id: i64, loan_id: &BigDecimal, payable_terms: &[PayableTermJson], treatment_charge_per_dmt: &BigDecimal, refining_charges: &[RefiningChargeJson], penalty_schedule: &[PenaltyTierJson], realisation_costs: &BigDecimal, quotational_period: Option<&str>, pricing_reference: Option<&str>, incoterm: Option<&str>, effective_at: DateTime<Utc>, recorded_by: &str) -> Result<i64, sqlx::Error>` — same shape, `loan_offtake_terms`.
   - Both take `&self` (use `&self.pool` directly) since — unlike `insert_pending` —
     these aren't part of the loan-submission transaction; each is its own atomic
     write.
   - Add `ToSchema` derive to none of the existing JSON shape structs
     (`AssayMetalJson`, `DeleteriousJson`, `PayableTermJson`, `RefiningChargeJson`,
     `PenaltyTierJson`) — keep them storage-only. The API layer defines its own
     request-facing mirror types (next step), matching the existing
     `CollateralValuationInput` (API) vs. `CollateralValuationRow` (shared/storage)
     split.

2. ✅ **`packages/api/src/routes/collateral_valuation.rs`** — add request DTOs, two
   handlers, and extend the router:
   - `const TRUSTEE_ROLE: &str = "trustee";` (local const, mirrors `loan_book.rs` —
     no cross-module dependency).
   - Request DTOs (all `Debug, Clone, Deserialize, Serialize, ToSchema`, `pub`):
     `SubmitAssayRequest { assay_status: String, moisture_pct: Option<String>, assays: Vec<AssayMetalInput>, deleterious: Vec<DeleteriousInput> (#[serde(default)]), certificate_uri: Option<String>, effective_at: u64 }`,
     `AssayMetalInput { metal: String, grade_g_per_t: String }`,
     `DeleteriousInput { element: String, level: String, unit: String }`,
     `SubmitOfftakeRequest { payable_terms: Vec<PayableTermInput>, treatment_charge_per_dmt: String, refining_charges: Vec<RefiningChargeInput> (#[serde(default)]), penalty_schedule: Vec<PenaltyTierInput> (#[serde(default)]), realisation_costs: String, quotational_period: Option<String>, pricing_reference: Option<String>, incoterm: Option<String>, effective_at: u64 }`,
     `PayableTermInput { metal: String, payable_pct: String, min_deduction_g_per_t: String }`,
     `RefiningChargeInput { metal: String, rc_per_oz: String }`,
     `PenaltyTierInput { element: String, threshold: String, step: String, rate_per_dmt: String, escalating: bool (#[serde(default)]) }`.
     Response DTOs: `SubmitAssayResponse { id: i64 }`, `SubmitOfftakeResponse { id: i64 }`.
   - `pub fn validate_assay(req: &SubmitAssayRequest) -> Result<(), String>` (pure,
     mirrors `loan_book::validate_submission`):
     - `assay_status` ∈ `{"Provisional","Final","UmpirePending"}` (matches the DB
       `CHECK`).
     - `assays` must be non-empty.
     - Each `assays[i].grade_g_per_t` parses as `BigDecimal` and is `>= 0`.
     - Each `deleterious[i].level` parses as `BigDecimal` and is `>= 0`;
       `deleterious[i].unit` ∈ `{"Pct","Ppm"}`.
     - `moisture_pct`, if present, parses as `BigDecimal` in `[0, 100]`.
   - `pub fn validate_offtake(req: &SubmitOfftakeRequest) -> Result<(), String>`:
     - `payable_terms` must be non-empty. Each `payable_pct` parses and is in
       `[0, 1]`; each `min_deduction_g_per_t` parses and is `>= 0`.
     - `treatment_charge_per_dmt` parses and is `>= 0`. `realisation_costs` parses
       and is `>= 0`.
     - Each `refining_charges[i].rc_per_oz` parses and is `>= 0`.
     - Each `penalty_schedule[i]`: `threshold` parses and is `>= 0`; `step` parses
       and is **`> 0`** (the division-by-zero guard from Assumptions above —
       reference the `collateral_valuation::mod.rs:154` division in the code
       comment so a future reader knows why); `rate_per_dmt` parses and is `>= 0`.
     - `incoterm`, if present, ∈ `{"FOB","CFR","CIF"}` (per
       `docs/product-specs/collateral-valuation.md:99`).
   - Two handlers, `submit_assay` and `submit_offtake`, both:
     ```rust
     async fn submit_assay(
         AuthClaims(claims): AuthClaims,
         State(state): State<Arc<AppState>>,
         Path(loan_id): Path<String>,
         Query(query): Query<ChainQuery>,
         Json(payload): Json<SubmitAssayRequest>,
     ) -> Result<(StatusCode, Json<SubmitAssayResponse>), ApiError>
     ```
     1. `claims.has_role(TRUSTEE_ROLE)` else `403`.
     2. Parse `loan_id` (`BigDecimal::from_str`, `400` on failure — same pattern as
        `get_collateral_valuation`). Resolve `chain_id` via `resolve_chain`.
     3. `validate_assay(&payload)` / `validate_offtake(&payload)` → `400` on `Err`.
     4. `repo.get_anchor(chain_id, &loan_id)` → `404` if `None`; `400` if
        `anchor.valuation_mode != ValuationMode::MetalConcentrate` ("assay/offtake
        inputs only apply to MetalConcentrate-mode loans").
     5. Convert request DTO fields into the shared JSON types
        (`AssayMetalJson`/`DeleteriousJson` or `PayableTermJson`/
        `RefiningChargeJson`/`PenaltyTierJson`) and parsed `BigDecimal`s.
     6. Convert `effective_at: u64` → `DateTime<Utc>` via
        `DateTime::from_timestamp(effective_at as i64, 0)` (`400` if it somehow
        fails to construct, though a valid `u64` practically always succeeds).
     7. Call `repo.insert_assay(...)` / `repo.insert_offtake(...)` with
        `recorded_by: &claims.sub` — never client-supplied.
     8. Return `(StatusCode::CREATED, Json(SubmitAssayResponse { id }))`.
   - Extend `router()`:
     ```rust
     pub fn router() -> Router<Arc<AppState>> {
         Router::new()
             .route("/loan-book/{loan_id}/valuations", get(get_collateral_valuation))
             .route("/loan-book/{loan_id}/assay", post(submit_assay))
             .route("/loan-book/{loan_id}/offtake", post(submit_offtake))
     }
     ```
     (add `axum::routing::post` to the existing `use axum::routing::get;` import).
   - Add `#[utoipa::path(...)]` blocks for both handlers (mirror
     `get_collateral_valuation`'s doc-comment + status-code style: `201`, `400`,
     `401`, `403`, `404`), and extend `CollateralValuationDoc`'s `#[openapi(paths(...), components(schemas(...)))]` to include the two new handlers and all new DTO
     types. No `main.rs` change needed — it already merges
     `CollateralValuationDoc::openapi()`.

3. ✅ **Tests — `packages/api/tests/collateral_valuation.rs`** (new file, no DB/env,
   matches project convention):
   - `validate_assay` — happy path; unknown `assay_status`; empty `assays`; negative
     `grade_g_per_t`; unknown `deleterious` unit; `moisture_pct` out of `[0,100]`.
   - `validate_offtake` — happy path; empty `payable_terms`; `payable_pct` out of
     `[0,1]`; negative `treatment_charge_per_dmt`/`realisation_costs`; **`step == 0`
     rejected** (the division-by-zero regression guard — name the test something
     like `penalty_step_zero_is_rejected` and comment why); unknown `incoterm`.
   - If useful, a light `serde` round-trip test for the two request DTOs (JSON →
     struct → back), matching `loan_metadata_json_deserializes_*`-style tests
     elsewhere.

4. ✅ **`docs/exec-plans/tech-debt-tracker.md`** — add an entry noting DB-level
   `REVOKE UPDATE, DELETE` on `loan_assays`/`loan_offtake_terms` is still deferred
   (currently only documented inline in the two migration files' comments, not in
   the tracker), so application-level append-only discipline is the only guard
   until that migration lands.

## Test Strategy

- `cargo test -p pipeline-api --test collateral_valuation` — all new
  `validate_assay`/`validate_offtake` cases above, pure/no DB.
- `cargo build -p shared -p pipeline-api` + `cargo clippy --all -- -D warnings` —
  confirms the new repo methods and route wiring type-check.
- Manual smoke check (per this repo's no-DB-in-tests rule, this step is
  human/manual, not automated): `POST` a valid assay and offtake for a
  `MetalConcentrate` test loan against a local dev DB, then confirm
  `GET /v1/loan-book/{loan_id}/valuations` no longer reports `"assay"`/`"offtake"`
  in `missing_inputs` and returns a non-null `collateral_value`.

## Docs to Update

- `docs/product-specs/collateral-valuation.md` — no content change needed (the
  endpoints implement the spec's existing "Operations Console" description
  as-written); optionally add a one-line cross-reference to the new routes near
  §"Per-loan valuation record" once merged.
- `docs/exec-plans/tech-debt-tracker.md` — new entry per Implementation Step 4.
- On completion, move this plan to `docs/exec-plans/completed/` (manager step).
