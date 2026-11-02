# Issue #1815: Backend: GET /v1/lps/me/payment-details — system bank details + per-request payment reference

Source: https://github.com/eq-lab/pipeline/issues/1815

Settles #1311 and #1700 (both closed, superseded by this issue). Backend flow. No Figma link
on the issue: this is a backend-only change. The `FundingDetailsModal` design (Figma node
`6701-97113`, see #1311) is checked by the frontend wiring issue #1817, not here.

> **Revised 2026-11-02 (user decision).** The payment reference is now issued **per HTTP request**,
> not once per LP. Every successful call generates a new `payment_details`, inserts a new row, and
> keeps the full history. Nothing is reused and the call is not idempotent.
> `lp_requested_bank_details` becomes a history table. The earlier `ON CONFLICT (lp_id)` re-read and
> race logic is removed and must not be implemented.
>
> **Method (user decision).** The endpoint stays `GET /v1/lps/me/payment-details` and answers `200 OK`.
> It is a GET with a side effect: each successful call issues and stores a new reference.
> - The frontend (#1817) must call it exactly once per modal open, with automatic refetching and retries
>   turned off: `staleTime: Infinity`, and `refetchOnWindowFocus`, `refetchOnMount` and `retry` all off.
>   Otherwise background refetches would fill the history with references nobody saw.
> - The response carries `Cache-Control: no-store`, so no HTTP cache serves one LP's reference again.

## Scope

**In scope**

1. Migration `packages/shared/migrations/20261102000001_system_configuration_lp_payment_details.sql`:
   - `system_configuration (type TEXT PK CHECK IN ('system_bank_details'), value JSONB NOT NULL)`,
     with a CHECK constraint that a `system_bank_details` row's `value` is an object carrying all six
     keys as JSON strings. The migration seeds that row with an empty string in every field.
   - `lp_requested_bank_details` is a history table:
     - `id BIGSERIAL PK`
     - `lp_id BIGINT NOT NULL → lps(id)`, not unique, indexed
     - `payment_details VARCHAR(140) NOT NULL UNIQUE` with a charset CHECK
     - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
2. Two shared repos, each behind a small trait so the request logic can be unit-tested without a
   database. This is the same seam pattern `WireInMatcher` uses in `lp_bank_deposit_repo.rs`.
   - `SystemConfigurationRepo` reads the bank-details row. It sits behind the `BankDetailsSource` trait.
   - `LpRequestedBankDetailsRepo` inserts a reference row. It sits behind the `PaymentDetailsStore` trait.
3. `GET /v1/lps/me/payment-details` in `packages/api/src/routes/lp_bank_deposits.rs`. It answers `200`
   with `Cache-Control: no-store`, and is documented with utoipa under the `LpBankDeposits` tag. Each
   successful call issues a new reference, by user decision.
4. Pure unit tests in `packages/api/tests/` and `packages/shared/tests/`. None of them connects to a database.
5. Spec and doc updates (see **Docs to Update**).

**Out of scope** (per the issue)

- Any write or admin endpoint for `system_configuration`. Values are set by hand in the DB.
- Matching incoming wires to LPs by `payment_details` in `POST /v1/lps/{id}/bank-deposits`. That is a
  follow-up: it will find the LP by any of the references issued to it. The manager should file it if it
  does not exist yet.
- Frontend wiring of `FundingDetailsModal`, including the `swift_bic` → `swift_bic_code` rename and
  calling the endpoint once per modal open with automatic refetch and retry disabled. That is #1817.
- Rate-limiting or capping how many references a single LP can request. This is logged as tech debt (see **Docs to Update → 5**).
- Stellar contracts. They are frozen, and no contract interaction is involved.

### Settled decisions

**D1. Refusal status: `409 Conflict`.** This follows the existing `/v1/lps/me/*` convention.
Every refusal there that depends on the LP's state is `ApiError::Conflict`: `link-address` on
`Passed`/`Failed`, `submit` on the wrong status, document writes while frozen, and `guard_writable`.
`403` is reserved for role failures (`require_trustee`), and `ApiError::Forbidden`'s doc says
"lacks the required role". The 409 body names every unmet precondition, e.g.
`"payment details require a linked settlement address and KYB status Passed (this LP is UnderReview with no linked address)"`.
The frontend can also tell the cases apart from `GET /v1/lps/me`.
- No LP for the caller → `404`, via the shared `my_lp` helper (same message as the other `/me` routes).
- Trustee tokens: the route follows the `/me` convention and adds no explicit role check. A trustee
  account owns no LP, so it gets `404`, the same as on every other `/v1/lps/me/*` route.

**D2. `payment_details` format: `PL-XXXX-XXXX-XXXX`.**
- `PL-` is a fixed prefix, followed by 12 symbols from the Crockford base32 alphabet
  `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, in three groups of four separated by `-`. The alphabet leaves out
  `I`, `L`, `O` and `U`, so the code has no 0/O or 1/I/L misreads when typed into a banking portal.
  Example: `PL-7K3M-Q9TX-H2CD`.
- Length is **17**. That fits:
  - the 18-char UK Faster Payments / BACS reference field
  - a single 35-char SWIFT MT103 field-70 line
  - the 140-char column limit

  The charset is a strict subset of `[A-Z0-9-]`, which is SWIFT/SEPA-safe.
- The 12 symbols encode 60 bits taken from the OS CSPRNG (`rand::rngs::OsRng::next_u64`, low 60 bits).
  The value is random, not derived from `lp_id`. It reveals neither the LP's id, nor the LP count, nor
  how many references an LP has requested, and it cannot be enumerated.
- The hyphens sit at fixed positions, so if a bank strips them the 12 symbols still identify the
  reference. The follow-up matching work should compare with `-` and whitespace removed. This is noted in the spec.
- The DB also enforces the charset: `CHECK (payment_details ~ '^[A-Z0-9-]{1,140}$')`.
- **The collision argument still holds with unbounded history.** Each new draw collides with an existing
  row with probability N / 2⁶⁰, where N is the number of rows already stored.
  - At 1 million stored references that is about 9 × 10⁻¹³ per draw. At 1 billion it is about 9 × 10⁻¹⁰.
  - For three draws in a row to all collide at 1 billion rows, the probability is below 10⁻²⁷.
  - The birthday bound over the whole table reaches 50% only at about 1.1 × 10⁹ rows. Even then, a collision
    costs one redraw, not a duplicate, because the `UNIQUE` constraint refuses the second row.
  - 60 bits is therefore enough for any realistic history. The cost of a collision is a retry, not an error.
- On a collision (SQLSTATE 23505 on `payment_details`) the handler draws again, up to
  `MAX_ISSUE_ATTEMPTS = 3`, and then returns `500`.

**D3. Per-request issuance with history (replaces the earlier reuse logic).**
- Every successful `GET` inserts one new row
  (`INSERT INTO lp_requested_bank_details (lp_id, payment_details) VALUES ($1, $2)`) and returns that row's value.
- Nothing is read back first, and earlier rows are never updated or deleted.
- `lp_id` is not unique, so there is no `ON CONFLICT` clause. The only unique column a plain insert can
  violate is `payment_details`, so any 23505 is a reference collision and triggers a redraw.
- Concurrent requests from the same LP need no coordination. Each one inserts its own row with its own value.

**D4. Ordering, and no row on refusal or misconfiguration.** The handler runs these steps in order:
1. `my_lp` (`404`)
2. the access gate (`409`)
3. read the bank details (`500` if the row is missing or malformed)
4. insert the reference

A refused caller, or a misconfigured system, therefore never creates a `lp_requested_bank_details` row.
Steps 2–4 live in one pure-ish function over the two traits, so a unit test can prove this ordering.

There is no time-of-check/time-of-use gap between the gate and the insert:
- `Passed` is terminal: `KybStatus::may_transition_to` has no exit from `Passed`.
- `allows_address_write` fixes the address once `Passed` holds one.

So once the gate passes, it cannot stop being true.

**D5. The bank-details shape is enforced in the DB as well as in Rust.**
- The CHECK constraint rejects a manual `UPDATE` that drops a key or stores a non-string, so the operator
  sees the error at edit time.
- Rust deserializes the six keys strictly: all six are required, and unknown keys are ignored.
- If the row is missing or malformed despite the CHECK, the response is `500` and the error is logged.
  The endpoint never returns a partial body, and inserts no reference row in that case.
- Empty strings pass through unchanged.

## Assumptions and Risks

- **Two "payment reference" concepts must not be conflated.**
  - `lp_requested_bank_details.payment_details` is a code we issue to the LP for it to quote on a wire.
    An LP may hold many of them, and may quote the same one on more than one wire if it does not reopen the modal.
  - `lp_bank_deposits.payment_reference` is the bank's per-wire reference: unique per deposit, and
    hashed into the minter's single-use `ref_hash`.
  - A trustee who typed an LP code as the deposit `payment_reference` would get `409` as soon as that
    code showed up on a second wire. The spec text below says this explicitly.
  - Reconciling the two is the out-of-scope matching follow-up.
- **Unbounded per-LP history.** An eligible LP can call the endpoint any number of times, and each call
  adds a row of about 60 bytes. Only `Passed` LPs with a linked address get through the gate, and there is
  no rate limit on `/v1/lps/me/*` today. The risk is accepted for now and logged as tech debt (Docs to Update → 5).
  The frontend (#1817) calls the endpoint once per modal open, not on every render.
- **A GET with a side effect (user decision).** Clients, proxies and tooling treat `GET` as safe and
  repeatable, so any automatic repeat adds a row to the history.
  - **HTTP caches must not serve it.** The handler sets `Cache-Control: no-store` on the `200` response,
    so no browser, proxy or CDN stores one LP's reference and serves it again. A cache could otherwise
    serve a reference to a later request without the server issuing one, or, behind a misconfigured
    shared cache, serve it to another session. An error response does not need the header, because it
    carries no reference.
  - **The client must not repeat it.** #1817 calls it exactly once per modal open, with `staleTime: Infinity`
    and `refetchOnWindowFocus`, `refetchOnMount` and `retry` all off.
  - **Remaining exposure.** Browser prefetch and link scanners are not an issue: the route needs a bearer
    token, so an unauthenticated request gets `401` and inserts nothing. Swagger UI "Try it out" and manual
    `curl` calls do add rows. That is acceptable, because each row is still attributed to its LP.
- **Spam weakens the "which LP sent this" signal slightly.** It does not break it. Every row records
  its `lp_id`, so any code that appears on a wire still resolves to exactly one LP.
- **CHECK on JSONB with NULL semantics.** `jsonb_typeof(value->'missing_key')` is `NULL`, and a CHECK
  passes on `NULL`. Every key test must therefore be written as
  `jsonb_typeof(value->'k') IS NOT DISTINCT FROM 'string'` (or `COALESCE(…, '') = 'string'`), never as a
  bare `= 'string'`. The shared migration test asserts this form.
- **`type` column name.** `type` is a non-reserved keyword in Postgres, so it is legal unquoted as a column name.
  In Rust it is a keyword, so repo SQL selects `value` only and never maps `type` into a struct field.
- **`BIGSERIAL` vs identity.** The table uses `BIGSERIAL` as the user specified. Other recent tables use
  `BIGINT GENERATED ALWAYS AS IDENTITY`. For this table the two behave the same, because nothing ever
  supplies `id` explicitly.
- **AppState churn.** Adding two repo fields to `AppState` means updating every struct literal. Today
  those are `packages/api/src/main.rs` plus 10 test files (listed in step 6). The build fails until all of them are updated.
- **New dependency.** `rand = "0.8"` is added to `packages/api/Cargo.toml`. It is already in `Cargo.lock`
  (0.8.6) via `packages/worker`, so no new crate is downloaded.
- **Route coexistence.** `/v1/lps/me/payment-details` (static `me`) sits beside `/v1/lps/{id}/bank-deposits`
  in the same router, and next to `lps::router`'s `/lps/me/*` and `/lps/{id}/*`. matchit gives a static
  segment priority over a param. The existing `the_deposit_routes_merge_under_v1_beside_the_lp_routes`
  test builds the merged router and will panic on an overlap.
- **TD-110 is only half closed.** The backend source now exists, but the frontend still renders the
  placeholder until #1817 lands. #1282 must still not mount the modal against real users
  until then. TD-89 (Contact Support destination) is unaffected.
- **Real values.** The seeded row is all empty strings. Until an operator fills it in, the endpoint serves
  `""` for every bank field and the frontend renders `—`. Each call still issues a reference. This is
  intended (issue body).
- No dependency on unmerged work. The branch `feat/1815-lp-payment-details` is based on current `main`.

## Open Questions

_None_

## Implementation Steps

1. **Spec first.** Add the section drafted under **Docs to Update → 1** to
   `docs/product-specs/deposits.md`, and make the other doc edits listed there in the same step.

2. **Migration**: create `packages/shared/migrations/20261102000001_system_configuration_lp_payment_details.sql`.
   - Header comment covers:
     - purpose: #1815, which settles #1311/#1700
     - one system-wide bank-details record
     - the reference is per request with history kept, and its format (D2)
     - the CHECK/NULL caveat
     - the difference between `payment_details` and the per-wire `lp_bank_deposits.payment_reference`
     - inverse SQL as `--` lines: `DROP TABLE lp_requested_bank_details; DROP TABLE system_configuration;`
   - Body:
     ```sql
     CREATE TABLE system_configuration (
         type  TEXT  PRIMARY KEY
                     CONSTRAINT system_configuration_type_ck CHECK (type IN ('system_bank_details')),
         value JSONB NOT NULL,
         CONSTRAINT system_configuration_bank_details_shape_ck CHECK (
             type <> 'system_bank_details' OR (
                 jsonb_typeof(value) = 'object'
                 AND jsonb_typeof(value->'company_name')   IS NOT DISTINCT FROM 'string'
                 AND jsonb_typeof(value->'bank_name')      IS NOT DISTINCT FROM 'string'
                 AND jsonb_typeof(value->'bank_address')   IS NOT DISTINCT FROM 'string'
                 AND jsonb_typeof(value->'account_number') IS NOT DISTINCT FROM 'string'
                 AND jsonb_typeof(value->'iban')           IS NOT DISTINCT FROM 'string'
                 AND jsonb_typeof(value->'swift_bic_code') IS NOT DISTINCT FROM 'string'
             )
         )
     );

     INSERT INTO system_configuration (type, value) VALUES (
         'system_bank_details',
         '{"company_name": "", "bank_name": "", "bank_address": "", "account_number": "", "iban": "", "swift_bic_code": ""}'
     );

     CREATE TABLE lp_requested_bank_details (
         id              BIGSERIAL    PRIMARY KEY,
         lp_id           BIGINT       NOT NULL REFERENCES lps(id),
         payment_details VARCHAR(140) NOT NULL
                         CONSTRAINT lp_requested_bank_details_payment_details_key UNIQUE
                         CONSTRAINT lp_requested_bank_details_payment_details_ck
                             CHECK (payment_details ~ '^[A-Z0-9-]{1,140}$'),
         created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
     );

     CREATE INDEX idx_lp_requested_bank_details_lp_id_created_at
         ON lp_requested_bank_details (lp_id, created_at DESC);
     ```

3. **Shared: system configuration repo**: new `packages/shared/src/system_configuration_repo.rs`
   (register `pub mod system_configuration_repo;` in `packages/shared/src/lib.rs`).
   - One `// spec:` header line pointing at `docs/product-specs/deposits.md` § LP Funding Details, and
     no other comments (AGENTS.md comment rule).
   - `pub enum SystemConfigurationType { SystemBankDetails }` with `as_str() -> "system_bank_details"`.
   - `#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)] pub struct SystemBankDetails { company_name, bank_name, bank_address, account_number, iban, swift_bic_code: String }`.
     Do not use `#[serde(default)]` and do not use `deny_unknown_fields` (D5).
   - `#[async_trait] pub trait BankDetailsSource: Send + Sync { async fn bank_details(&self) -> anyhow::Result<Option<SystemBankDetails>>; }`.
   - `pub struct SystemConfigurationRepo { pool: PgPool }` has:
     - `new`
     - `async fn value(&self, ty: SystemConfigurationType) -> Result<Option<serde_json::Value>, sqlx::Error>`,
       running `SELECT value FROM system_configuration WHERE type = $1`
     - an implementation of `BankDetailsSource`. It deserializes the value and reports a malformed value
       as an `anyhow` error naming the row.

4. **Shared: per-request reference repo**: new `packages/shared/src/lp_requested_bank_details_repo.rs`
   (register in `lib.rs`).
   - `pub enum InsertOutcome { Inserted, ReferenceTaken }`.
   - `#[async_trait] pub trait PaymentDetailsStore: Send + Sync { async fn insert(&self, lp_id: i64, payment_details: &str) -> Result<InsertOutcome, sqlx::Error>; }`.
   - `pub struct LpRequestedBankDetailsRepo { pool: PgPool }` implements `insert` as follows:
     - SQL: `INSERT INTO lp_requested_bank_details (lp_id, payment_details) VALUES ($1, $2)`, run with `execute`.
     - `Ok` maps to `Inserted`.
     - An error where `e.as_database_error().is_some_and(|d| d.is_unique_violation())` maps to `ReferenceTaken`.
     - Any other error propagates, including an FK violation, which cannot happen in practice because `lp_id` comes from `my_lp`.
   - Do not add a read or list method. Nothing in this issue reads the history back, and the matching
     follow-up will add its own lookup.

5. **API: route, DTO, pure logic**: edit `packages/api/src/routes/lp_bank_deposits.rs`.
   - Make `my_lp` in `packages/api/src/routes/lps.rs` `pub(crate)` and reuse it. Do not duplicate it.
   - Add `rand = "0.8"` to `packages/api/Cargo.toml` `[dependencies]`.
   - DTO: `#[derive(Debug, Serialize, ToSchema)] pub struct PaymentDetailsResponse { company_name, bank_name, bank_address, account_number, iban, swift_bic_code, payment_details: String }`
     with `pub fn new(details: SystemBankDetails, payment_details: String) -> Self`.
   - Pure gate: `pub fn payment_details_access(kyb_status: KybStatus, stellar_address: Option<&str>) -> Result<(), String>`.
     - Returns `Ok` only for `Passed` together with `Some(_)`.
     - Otherwise the `Err` message names every unmet precondition and the current status.
   - Pure generator:
     - `pub const PAYMENT_DETAILS_PREFIX: &str = "PL";`
     - `const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";`
     - `pub fn payment_details_from(random: u64) -> String` takes the low 60 bits, emits 12 symbols
       most-significant first (5 bits each), and formats them as `PL-XXXX-XXXX-XXXX`.
     - `fn new_payment_details() -> String { payment_details_from(OsRng.next_u64()) }`, using
       `rand::rngs::OsRng` and `rand::RngCore`.
   - Issue: `pub const MAX_ISSUE_ATTEMPTS: usize = 3;` and
     `pub async fn issue_payment_details<S: PaymentDetailsStore + ?Sized>(store: &S, lp_id: i64, mut next: impl FnMut() -> String) -> Result<String, ApiError>`:
     1. Repeat up to `MAX_ISSUE_ATTEMPTS` times: `let candidate = next();` then `store.insert(lp_id, &candidate)`.
        - `Inserted` → return `candidate`.
        - `ReferenceTaken` → draw again.
        - `Err(e)` → `ApiError::from(e)`.
     2. If every attempt collided → `ApiError::Internal(anyhow!("could not issue a unique payment reference for LP {lp_id} after {MAX_ISSUE_ATTEMPTS} attempts"))`.
   - Request orchestration (pure-ish, testable with fakes):
     `pub async fn request_payment_details(bank: &(impl BankDetailsSource + ?Sized), store: &(impl PaymentDetailsStore + ?Sized), lp_id: i64, kyb_status: KybStatus, stellar_address: Option<&str>, next: impl FnMut() -> String) -> Result<PaymentDetailsResponse, ApiError>`.
     It runs, in D4 order:
     1. `payment_details_access(..).map_err(ApiError::Conflict)?`
     2. `bank.bank_details().await?`, where `None` → `ApiError::Internal(anyhow!("system_bank_details row is missing"))`
     3. `issue_payment_details(store, lp_id, next).await?`
     4. `PaymentDetailsResponse::new(..)`
   - Handler: `get_my_payment_details(AuthClaims(claims), State(state)) -> Result<impl IntoResponse, ApiError>`.
     1. `my_lp`.
     2. `KybStatus::from_str` (`Internal` on failure, as in `lps.rs`).
     3. Call `request_payment_details(&state.system_configuration_repo, &state.lp_requested_bank_details_repo, lp.id, status, lp.stellar_address.as_deref(), new_payment_details)`.
     4. Return `payment_details_reply(body)`. This is a small `pub fn payment_details_reply(body: PaymentDetailsResponse) -> axum::response::Response`
        that builds `(StatusCode::OK, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()`.
        It is a separate function so a pure test can check the header.
   - utoipa: `#[utoipa::path(get, path = "/v1/lps/me/payment-details", responses((200, "The bank details with a newly issued payment reference; every call issues a new one", body = PaymentDetailsResponse), (401 "Missing, invalid, or expired token"), (404 "This account has not registered an LP yet"), (409 "No linked settlement address, or KYB status is not Passed")), security(("bearer_auth" = [])), tag = "LpBankDeposits")]`.
     There is no `request_body`.
   - `LpBankDepositsDoc`: add the path to `paths(...)` and `PaymentDetailsResponse` to `components(schemas(...))`.
     Widen the tag description to cover both halves, e.g. "Per-LP wires: where an LP sends a wire, and
     the record of wires received from it".
   - Router: add `.route("/lps/me/payment-details", get(get_my_payment_details))`. `get` is already imported.
   - Update the `// spec:` header to also reference Issue #1815 (still one header, at most 2–3 lines).

6. **AppState wiring**
   - `packages/api/src/lib.rs`: add `pub system_configuration_repo: SystemConfigurationRepo` and
     `pub lp_requested_bank_details_repo: LpRequestedBankDetailsRepo` to `AppState`.
   - `packages/api/src/main.rs`: construct both with `pool.clone()` and pass them into the state literal.
   - Add both fields (built on the existing lazy/unreachable pool) to every `AppState { … }` literal in
     these 10 files under `packages/api/tests/`:
     - `vouchers_chain_required.rs`
     - `loan_registry_scope.rs`
     - `dashboard_auditlog_chain.rs`
     - `analytics_pnl_positions_chain.rs`
     - `voucher_signing.rs`
     - `ramp_kyc_chain.rs`
     - `chains.rs`
     - `auth_chain_required.rs`
     - `loan_chain_required.rs`
     - `stats_prices_vaults_yield_chain.rs`

     Find them with `grep -rln "AppState {" packages/api/tests`. Building a repo on a `connect_lazy` pool
     opens no connection.

7. **Tests**: see **Test Strategy**.

8. **Verify**: run these:
   - `cargo build --all`
   - `cargo test -p pipeline-api -p shared` (pure tests only, no DB env)
   - `cargo clippy --all -- -D warnings`
   - `cargo fmt --all -- --check`
   - `npx tsx scripts/lint-docs.ts` for the doc edits

## Test Strategy

All tests are pure. Nothing reads `DATABASE_URL` or `POSTGRES_URL`, and nothing opens a Postgres connection. They live
in external test files, never inline `#[cfg(test)]`.

**`packages/api/tests/lp_payment_details.rs`** (new)

- *Access gate* (`payment_details_access`):
  - `Passed` + `Some(addr)` → `Ok`.
  - `Passed` + `None` → `Err`, and the message mentions the settlement address.
  - Every other status in `KybStatus::ALL` with `Some(addr)` → `Err`, and the message names the status and `Passed`.
  - `NotStarted` + `None` → `Err` naming both preconditions.
- *Generator* (`payment_details_from`):
  - Fixed vectors:
    - `0` → `"PL-0000-0000-0000"`
    - `1` → `"PL-0000-0000-0001"`
    - `32` → `"PL-0000-0000-0010"`
    - `(1<<60)-1` → `"PL-ZZZZ-ZZZZ-ZZZZ"`
  - The high 4 bits are ignored: `payment_details_from(0xF << 60) == payment_details_from(0)`.
  - Sweep of inputs: `u64::MAX`, `0`, alternating bit patterns, and 1,000 pseudo-random values from a
    fixed LCG (no `rand` in tests). For each one:
    - length is exactly 17 (so also ≤ 140)
    - the value has the shape `PL-` plus three groups of four Crockford symbols, checked by hand-rolled
      character checks with no regex dependency
    - no character falls outside `[A-Z0-9-]` or is one of `I`, `L`, `O`, `U`
  - Injective over the sweep: distinct low-60-bit inputs give distinct outputs (collect into a `HashSet`).
- *Issuance* (`issue_payment_details`) against an in-memory `FakeStore`, using `#[tokio::test]`.
  The fake holds a `Mutex<Vec<(i64, String)>>` of rows and returns `ReferenceTaken` when the value
  already exists in any row. Cases:
  - **Every call returns a new value.** Three calls for LP 1 return three distinct values, the generator
    is called three times, and LP 1 ends up with three rows in insertion order. Nothing is reused.
  - **Rows accumulate per LP.** After calls for LP 1, LP 2, LP 1, the row counts are LP 1 → 2 and LP 2 → 1.
  - **Two LPs never share a value.** All values across both LPs are distinct.
  - **Collision retry.** The fake is pre-seeded with a row holding `"PL-AAAA-AAAA-AAAA"` for LP 2, and the
    scripted generator yields that value first and then `"PL-BBBB-BBBB-BBBB"`. The call for LP 1 returns
    the second value, and exactly one new row is added.
  - **All retries collide.** The generator always yields a value that is already taken. The call returns
    `Err(ApiError::Internal)` after exactly `MAX_ISSUE_ATTEMPTS` draws, and no row is added.
  - **Other store errors.** The fake's `insert` returns a non-unique `sqlx::Error` (e.g.
    `sqlx::Error::PoolTimedOut`). The error propagates as `Internal`, and the generator is called once (no retry).
- *Orchestration* (`request_payment_details`) with `FakeStore` and a `FakeBankDetails` that counts its reads:
  - **No insert on refusal.**
    - For each refused gate input (`UnderReview` + address; `Passed` + no address):
      `Err(ApiError::Conflict)`, zero rows, zero generator calls, and zero bank-details reads.
  - **No insert on misconfiguration.** `FakeBankDetails` returns `Ok(None)`, or `Err`:
    `Err(ApiError::Internal)`, zero rows, and zero generator calls.
  - **Happy path.** The response carries the six bank fields verbatim (including `""`) and the newly
    issued `payment_details`, which equals the one stored row.
  - **Two requests, two values.** The second response's `payment_details` differs from the first, and
    the bank fields are identical.
- *Response shape*: build `PaymentDetailsResponse::new(SystemBankDetails { all "" }, "PL-…")` and
  serialize it.
  - It has exactly seven keys: `company_name`, `bank_name`, `bank_address`, `account_number`, `iban`,
    `swift_bic_code`, `payment_details`.
  - Empty strings are preserved as `""` (not null, not omitted).
  - There is no `swift_bic` key.
- *Reply headers* (`payment_details_reply`): the status is `200`, `Cache-Control` is exactly `no-store`,
  and the body is the JSON for the seven fields.
- *OpenAPI* (`LpBankDepositsDoc`):
  - `paths["/v1/lps/me/payment-details"]["get"]` exists and is tagged `LpBankDeposits`.
  - There is no `post` on that path, no `requestBody`, and no path params.
  - Responses are `200`, `401`, `404`, `409`, and there is no `201`.
  - The `PaymentDetailsResponse` schema lists all seven properties as `string`, and all are `required`.

**`packages/api/tests/lp_bank_deposits.rs`** (existing)

- `the_deposit_routes_merge_under_v1_beside_the_lp_routes` already builds the merged router and now covers
  the new route as well. No change is needed beyond confirming that it still passes.

**`packages/shared/tests/system_configuration.rs`** (new)

- `SystemBankDetails` deserializes from a JSON object with all six keys set to `""`.
- An extra key is ignored.
- A missing key, or a non-string value (`"iban": 123`), is an `Err`.
- `SystemConfigurationType::SystemBankDetails.as_str() == "system_bank_details"`.

**`packages/shared/tests/migration_lp_payment_details.rs`** (new; pure, using `include_str!` on the migration,
following the pattern of `packages/shared/tests/migrations.rs`)

- Both tables are created. `type TEXT PRIMARY KEY` is present along with its `IN ('system_bank_details')` CHECK.
- The seed `INSERT` contains each of the six keys with `""`.
- Every key test in the shape CHECK uses `IS NOT DISTINCT FROM 'string'`: six occurrences, and no bare
  `= 'string'` on a `value->` path.
- `lp_requested_bank_details` has:
  - `id BIGSERIAL PRIMARY KEY`
  - `lp_id BIGINT NOT NULL REFERENCES lps(id)`
  - `VARCHAR(140)`
  - the `lp_requested_bank_details_payment_details_key UNIQUE` constraint
  - the `^[A-Z0-9-]{1,140}$` CHECK
  - the `idx_lp_requested_bank_details_lp_id_created_at` index
- `lp_id` is not unique: there is no `PRIMARY KEY` or `UNIQUE` on the `lp_id` line, and no `ON CONFLICT`
  anywhere in the file.
- The rollback SQL lines start with `--`.

Not covered by unit tests: the real-DB behaviour of the unique constraint and the SQLSTATE mapping in
`LpRequestedBankDetailsRepo::insert`. They follow from D3 and the constraints asserted above, and the project
rule forbids DB-backed tests.

## Docs to Update

1. **`docs/product-specs/deposits.md`**: new section `## LP Funding Details`, placed before
   `## Stellar PLUSD Mint Leg`. Content:
   - **The endpoint.** `GET /v1/lps/me/payment-details` (LP session; `LpBankDeposits` group) answers
     `200 OK` with:
     - the trust account's receiving bank details
     - a **newly issued** payment reference for the LP to quote on the wire

     Show the response example with the seven fields. By user decision this is a `GET` with a side
     effect: every successful call issues and stores a new reference. The response carries
     `Cache-Control: no-store`. The client calls it exactly once each time it shows the funding details
     (one modal open), with automatic refetching and retries off (`staleTime: Infinity`, and
     `refetchOnWindowFocus`, `refetchOnMount` and `retry` all off), so the history holds only
     references that were actually shown.
   - **Bank details.** They are one system-wide record (`system_configuration`, type `system_bank_details`),
     seeded empty and set by hand in the DB. There is no write endpoint. Values are served verbatim, and an
     empty field is served as `""`, which the client renders as `—`.
   - **Access.** The LP needs a linked settlement address (see kyb-lp-verification.md § Settlement Address)
     **and** `kyb_status = Passed`. Otherwise:
     - The response is `409`, naming the unmet precondition, and no reference is issued.
     - No LP → `404`.
     - If the bank-details record is missing, the response is `500` and no reference is issued.
   - **Reference.**
     - Every successful call issues a new reference and stores it in `lp_requested_bank_details` with the
       LP's id and a timestamp.
     - The full history is kept. Earlier references stay valid and still belong to that LP.
     - Format `PL-XXXX-XXXX-XXXX` (Crockford base32, 60 random bits, 17 chars).
     - It is unique across all references ever issued, and it fits the 18-char UK/BACS reference field and
       a single 35-char SWIFT line.
   - **Wire matching (follow-up).** Attributing an arriving wire finds the LP by **any** reference
     ever issued to it, comparing with `-` and whitespace removed.
   - **Not the per-wire reference.** Explicitly: this issued reference is **not**
     `lp_bank_deposits.payment_reference`, which is the bank's per-wire reference, unique per deposit and
     hashed into the minter's single-use `ref_hash`. An LP may quote one issued reference on more than one wire.
2. **`docs/product-specs/index.md`**: add "LP funding details (`GET /v1/lps/me/payment-details`)" to the
   `deposits.md` row's summary.
3. **`docs/frontend/bank-transfers.md`**:
   - **Seams table, `FundingDetailsModal.details` row.** It now has a backend source:
     `GET /v1/lps/me/payment-details` (#1815).
     - Each call returns a fresh `payment_details` and adds a row to the history.
     - The client calls it exactly once per modal open, with `staleTime: Infinity` and
       `refetchOnWindowFocus`, `refetchOnMount` and `retry` all off.
     - The payload uses `swift_bic_code`.
     - The client wiring is owned by #1817.
   - **"Wire attribution is parked" paragraph.**
     - The backend now issues a reference on every request for the LP to quote, and keeps every issued
       reference against the LP.
     - The modal needs a seventh row for it (designer ask, as already noted in #1311).
     - Wire matching, which looks the LP up by any of its issued references, is still a follow-up.
4. **`docs/exec-plans/tech-debt-tracker.md`**: update TD-110 in place.
   - Add a line saying the backend source landed in #1815 (`GET /v1/lps/me/payment-details`) and that
     only the frontend wiring (#1817) remains.
   - Do not mark it `[RESOLVED]` until #1817 merges.
5. **`docs/exec-plans/tech-debt-tracker.md`**: add a new entry using the next free TD number, and bump
   the "Next free number" line.
   - Title: "`GET /v1/lps/me/payment-details` issues an unbounded number of references per LP".
   - **Location:** `packages/api/src/routes/lp_bank_deposits.rs`, `lp_requested_bank_details`.
   - **Gap:** there is no rate limit or per-LP cap, and every call adds a row.
   - **Impact:** an eligible LP (`Passed` with a linked address) can grow the table without bound. Every
     row still resolves to one LP, so attribution is not at risk.
   - **Suggested fix:** a per-LP rate limit, or reusing the most recent reference within a short window,
     if product agrees.
6. When done, move this plan to `docs/exec-plans/completed/`. The manager or coder handles that at completion per `docs/PLANS.md`.
