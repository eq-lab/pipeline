# Issue #710: Loan submission workflow: originator submit + trustee review (approve/reject)

Source: https://github.com/eq-lab/pipeline/issues/710

## Scope

Replace the `501` stub in `POST /v1/loan-book/loan` with a persisted loan-submission
review workflow, and add the trustee-facing triage endpoints.

In scope:
- New `submitted_loans` table + `SubmittedLoanRepo` in `packages/shared`.
- `POST /v1/loan-book/loan` (originator) — validate + persist a submission as `InReview`.
- `GET /v1/loan-book/submissions` (trustee) — list submissions, optional `status` filter (default = all).
- `POST /v1/loan-book/submissions/{id}/review` (trustee) — approve or reject by submission id; reject requires a `reason`.
- A `submit_loan` request payload carrying **every** `draw_loan` input (see §"Payload").
- Wire `protection` **end-to-end** (resolved Open Question): add it to `LoanMetadataJson`,
  `LoanSnapshot`, both snapshot composers, and surface it in `LoanBookEntry` — closing TODO #706.
- Add `NotFound` (404) and `Conflict` (409) variants to `ApiError`.

Out of scope:
- Calling `draw_loan` on-chain when a submission is approved (follow-up).
- Any frontend / UI work.
- An admin endpoint to manage `auth_users` roles (trustee/originator rows are seeded manually, per the existing auth model).

## Assumptions and Risks

- **Roles are pre-seeded.** `auth_users.roles` already supports arbitrary role strings; `trustee`
  rows are inserted manually like `originator`, no schema change needed. The `originator` role
  constant exists in `routes::loan_book`; add a `TRUSTEE_ROLE = "trustee"` sibling.
- **`submitted_loans.id` is NOT an on-chain loan id.** The on-chain `loan_id` does not exist until
  `draw_loan` runs. The review path keys on the submission's own surrogate PK. The Issue text says
  "loan_id" but means the submission id — the plan uses `id` to avoid confusion.
- **Payload stored verbatim as JSONB.** Persisted in `loan_data` so the eventual on-chain draw has
  the exact submitted bytes; typed columns are only for queryable metadata (`status`, `originator`,
  `created_at`).
- **`protection` back-compat — TWO structs, both `deny_unknown_fields`.** Both `LoanMetadataJson`
  (IPFS doc) and `LoanSnapshot` (the JSONB stored in `contract_logs.params.snapshot`) use
  `#[serde(deny_unknown_fields)]`. `protection` must be `#[serde(default)] pub protection: String`
  on **both**: missing-key on the IPFS DTO covers legacy documents; missing-key on `LoanSnapshot`
  covers all **existing JSONB rows** which the API deserializes via `serde_json::from_value` —
  without `default` the loan-book read would start failing on historical rows. (Resolved per user:
  optional, empty default.)
- **Tests are pure unit tests** (per project convention + memory: no `DATABASE_URL`/Postgres in tests).
  Repo SQL is verified by `cargo build`/`clippy` and manual smoke only; all validation logic must be
  extracted into pure functions so it is unit-testable without a DB.

## Open Questions

_None._ Both were resolved with the user during planning:
- **`protection` scope** → wire **end-to-end** now (LoanMetadataJson → LoanSnapshot → composers →
  LoanBookEntry), closing TODO #706 in this Issue.
- **`protection` serde** → optional, `#[serde(default)]` empty-string on both `deny_unknown_fields` structs.

Resolved by planner (sensible defaults; flip during approval if wrong):
- **Status storage** → `TEXT` + `CHECK` constraint (matches `LoanSnapshot.status`, `auth_users.roles`).
- **Re-review semantics** → only `InReview` submissions are reviewable; reviewing an already-decided
  submission returns `409 Conflict`. Decisions are final (no un-reject).

## Implementation Steps

### 1. Migration — `packages/shared/migrations/2026MMDD000001_submitted_loans.sql`
Use the next available date-ordered filename (after `20260626000001_auth_users.sql`). Forward-only, with
an inverse SQL comment block matching the house style.

```sql
CREATE TABLE submitted_loans (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_data  JSONB       NOT NULL,
    status     TEXT        NOT NULL DEFAULT 'InReview'
                           CHECK (status IN ('InReview', 'Approved', 'Rejected')),
    reason     TEXT,
    originator TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A rejected submission must carry a reason; non-rejected must not.
    CONSTRAINT submitted_loans_reason_ck CHECK (
        (status = 'Rejected' AND reason IS NOT NULL) OR
        (status <> 'Rejected' AND reason IS NULL)
    )
);
CREATE INDEX submitted_loans_status_idx ON submitted_loans (status);
```

### 2. Repo — `packages/shared/src/submitted_loan_repo.rs` (+ `pub mod` in `lib.rs`)
Mirror `auth_user_repo.rs` (struct holds `pool: PgPool`, `sqlx::FromRow` row type, `serde_json::Value`
for the JSONB column as in `contract_logs_repo`).

- `SubmissionStatus` enum (`InReview`/`Approved`/`Rejected`) with `as_str` / `from_str` (or `FromStr`),
  used by both the repo and the API filter — extract so it is unit-testable.
- `SubmittedLoanRow { id: i64, loan_data: serde_json::Value, status: String, reason: Option<String>, originator: String, created_at, updated_at }`.
- `insert(loan_data: &serde_json::Value, originator: &str) -> Result<i64, sqlx::Error>` — inserts `InReview`, returns new id.
- `list(status: Option<SubmissionStatus>) -> Result<Vec<SubmittedLoanRow>, sqlx::Error>` — `None` ⇒ all, ordered `created_at DESC`.
- `find(id: i64) -> Result<Option<SubmittedLoanRow>, sqlx::Error>`.
- `review(id, new_status, reason: Option<&str>) -> Result<bool, sqlx::Error>` — `UPDATE ... WHERE id = $1 AND status = 'InReview'`; returns `rows_affected > 0` so the handler can distinguish "not found" (find first) from "already decided" (409).

### 3. AppState wiring
- `packages/api/src/lib.rs`: add `pub submitted_loan_repo: SubmittedLoanRepo` to `AppState`.
- `packages/api/src/main.rs`: `let submitted_loan_repo = SubmittedLoanRepo::new(pool.clone());` and add to the `AppState { … }` literal.

### 4. ApiError variants — `packages/api/src/error.rs`
Add `NotFound(String)` → 404 and `Conflict(String)` → 409 variants with matching `IntoResponse` arms
(same `{"error": msg}` body shape as the others).

### 5. Endpoints — `packages/api/src/routes/loan_book.rs`
- Add `const TRUSTEE_ROLE: &str = "trustee";`.
- **Payload DTO** `SubmitLoanRequest` (`Deserialize, ToSchema`) — see §Payload. Add nested DTOs
  `EconomicsInput`, `LocationInput`, with `location_type` as a String validated against
  `Vessel|Warehouse|TankFarm|Other`.
- **Pure validation** `fn validate_submission(req: &SubmitLoanRequest) -> Result<(), String>` mirroring
  the `draw_loan` invariants: `senior + equity == facility_size`, `maturity > origination`,
  `offtaker_price >= facility_size`, `ccr >= 1_0000000` (ONE — confirm scale from the contract `ONE` const),
  non-empty `to` / `metadata_uri`, valid `location_type`. Extracted for unit testing.
- `submit_loan` (originator): role-gate → `validate_submission` (→ `BadRequest`) → serialize payload to
  `serde_json::Value` → `repo.insert` → `201 Created` with `{ id }` (`SubmitLoanResponse`).
- `list_submissions` (trustee): `Query<SubmissionsQuery { status: Option<String> }>`; parse the string to
  `SubmissionStatus` (invalid ⇒ `BadRequest`); `repo.list` → `Vec<SubmissionView>` (id, status, reason,
  originator, created_at, and `loan_data` passed through).
- `review_submission` (trustee): `Path<i64>` + `Json<ReviewRequest { decision: "Approved"|"Rejected", reason: Option<String> }>`.
  Validate: reject without reason ⇒ `BadRequest`; approve with reason ⇒ ignore/`BadRequest` (decide, document).
  `repo.find` `None` ⇒ `NotFound`; else `repo.review(...)` returns false ⇒ `Conflict` ("already decided"); true ⇒ `200`.
- Register the three routes in `router()` and add all new paths/schemas to `LoanBookDoc`
  (`paths(get_loan_book, submit_loan, list_submissions, review_submission)` + components).
- Update the existing `submit_loan` doc comment / `#[utoipa::path]` responses (drop `501`, add `201/400/404/409`).

### 6. `protection` end-to-end wiring (resolved Open Question)

**6a. IPFS DTO** — `packages/worker/src/indexer/loan_metadata.rs`, add to `LoanMetadataJson`:
```rust
#[serde(default)]
pub protection: String,
```
(Keep `deny_unknown_fields`; `default` covers legacy documents that omit the key.)

**6b. Snapshot struct** — `packages/shared/src/loan_snapshot.rs`, add to `LoanSnapshot` (IPFS-sourced group):
```rust
#[serde(default)]
pub protection: String,
```
`#[serde(default)]` is **required** — `LoanSnapshot` is `deny_unknown_fields` and is deserialized from
existing `contract_logs.params.snapshot` JSONB rows that have no `protection` key.

**6c. Composers** — `packages/worker/src/indexer/loan_mapper.rs`:
- `compose_drawn_snapshot`: set `protection: json.protection` in the `LoanSnapshot { … }` literal.
- `compose_lifecycle_snapshot`: extend the `match refreshed_json` tuple to carry `protection` from
  `json.protection` (refresh) / `prior.protection` (carry-forward), and set it in the literal.

**6d. Loan-book API surface** — `packages/api/src/routes/loan_book.rs`, in `compute_loan_book`:
- Replace the hard-coded `protection: None` with a mapping from the snapshot:
  `protection: (!s.protection.is_empty()).then(|| s.protection.clone())` (empty string ⇒ `None`).
- Remove the `// TODO #706: protection …` comment on that line and update the `LoanBookEntry.protection`
  doc-comment (drop the "field will be added soon" note).

### 7. Lint
`cargo clippy --all -- -D warnings` and `npx tsx scripts/lint-docs.ts` must pass.

## Test Strategy

Pure unit tests only (no DB / no `DATABASE_URL`), in external `tests/` files per convention.

- `packages/api/tests/loan_submission.rs` (new):
  - `validate_submission`: happy path; each invariant failure (bad tranches, maturity ≤ origination,
    offtaker_price < facility, ccr < ONE, empty `to`/`metadata_uri`, bad `location_type`).
  - `SubmissionStatus` round-trip (`as_str`/`from_str`) + rejection of unknown status strings.
  - `ReviewRequest` validation: reject-without-reason rejected; approve path accepted.
  - serde round-trip of `SubmitLoanRequest` from a representative JSON body covering all `draw_loan` fields.
- `packages/worker/tests/loan_mapper.rs` (extend):
  - `LoanMetadataJson` deserializes a document **with** `protection`, and a legacy document
    **without** it (defaults to "") — guards back-compat.
  - `compose_drawn_snapshot` carries `protection` from the IPFS JSON into the snapshot.
  - `compose_lifecycle_snapshot` carries `protection` forward from `prior` (no refresh) and from
    `refreshed_json` (on refresh).
- `LoanSnapshot` back-compat (in `packages/shared` or the loan-book test): deserialize a JSONB snapshot
  **without** `protection` → defaults to "" (guards existing `contract_logs` rows under `deny_unknown_fields`).
- `packages/api/tests/loan_book.rs` (extend): a snapshot with non-empty `protection` surfaces as
  `LoanBookEntry.protection = Some(...)`; empty `protection` surfaces as `None`.
- Repo SQL (`SubmittedLoanRepo`) is not unit-tested (no DB in tests); verified via `cargo build` + clippy
  and noted for manual smoke testing against a dev Postgres.

## Docs to Update

- `docs/product-specs/api-authorization.md` — update the API Contract table: `POST /v1/loan-book/loan`
  now persists (201, not 501); add `GET /v1/loan-book/submissions` and
  `POST /v1/loan-book/submissions/{id}/review` (both bearer + `trustee`).
- Consider a short `docs/product-specs/` section (or extend the loan-book spec if one exists) describing
  the submission lifecycle `InReview → Approved | Rejected` and the `submitted_loans` data model.

## Payload (`SubmitLoanRequest`) — all `draw_loan` inputs

From `pipeline-stellar-contracts/contracts/loan-registry/src/lib.rs::draw_loan`:
- `to: String` — loan-holder address.
- `metadata_uri: String`.
- Off-chain metadata (the `LoanMetadataJson` document fields): `originator`, `borrower_id`, `commodity`,
  `corridor`, `governing_law`, optional `metadata_uri` (secondary), and **`protection`**.
- `economics: EconomicsInput` (`ImmutableLoanData`): `original_facility_size`, `original_senior_tranche`,
  `original_equity_tranche`, `original_offtaker_price` (base-6 USDC strings, matching loan-book conventions),
  `senior_interest_rate` (bps, u32), `origination_date` (u64), `original_maturity_date` (u64).
- `initial_ccr: u32`.
- `initial_location: LocationInput` (`LocationUpdate`): `location_type` (Vessel/Warehouse/TankFarm/Other),
  `location_identifier`, `tracking_url`, `updated_at` (u64).
