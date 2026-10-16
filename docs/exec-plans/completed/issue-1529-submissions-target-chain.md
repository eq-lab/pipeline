# Issue #1529: LoanBook API: submissions carry a target chain

Source: https://github.com/eq-lab/pipeline/issues/1529

Parent epic: #1521 (LoanBook API — multi-chain). The epic's "Decisions (human, 2026-10-15)"
section is authoritative. Merged prerequisites: #1528 (`AppState.chains`, `ChainFilter` /
`RequiredChain` / `parse_chain_filter` in `packages/api/src/routes/common.rs`) and epic #1520,
including #1526 (per-chain API `loan_registry_addresses`; `list_submissions` skips unconfigured
chains). Siblings planned in parallel: #1530 (`GET /v1/loan-book` across chains) and #1531
(per-loan endpoints require `chain_id`). Neither sibling touches `submitted_loans` or the
submission handlers.

Backend only. There is no Figma reference, so there is no visual verification step. Frontend
follow-up: #1536 (Trustee form sends `chain_id`, shows the target chain).

## Scope

### In scope

1. **Migration** `packages/shared/migrations/20261015000001_submitted_loans_target_chain.sql`:
   - Add `submitted_loans.target_chain_id BIGINT`.
   - Pre-check that no `(chain_id, loan_id)` is linked to two submissions. If one is, abort.
   - Backfill: drawn rows get `target_chain_id = chain_id`. Rows that are not drawn get
     `DEFAULT_CHAIN_ID`, passed in through a session GUC (see Implementation Step 2).
   - `SET NOT NULL`.
   - Add the CHECK `chain_id IS NULL OR chain_id = target_chain_id`, so a drawn link always
     sits on its target chain.
   - Replace the non-unique `submitted_loans_loan_lookup_idx` with
     `UNIQUE (chain_id, loan_id) WHERE loan_id IS NOT NULL`.
   - Add a `target_chain_id` index for the list filter.
   - Document the rollback in the header.
2. **Migration runner.** Add a shared helper that runs the migrations on one connection with the
   `pipeline.default_chain_id` GUC set. Both binaries pass it. The API passes its validated
   `DEFAULT_CHAIN_ID`. The worker reads `DEFAULT_CHAIN_ID` optionally (argocd already sets it
   for the worker) and passes `Option<i64>`.
3. **`SubmittedLoanRepo`** (`packages/shared/src/submitted_loan_repo.rs`):
   - `SubmittedLoanRow.target_chain_id: i64`.
   - `insert` takes `target_chain_id`.
   - `list` filters by status and by an optional single target chain.
   - `resubmit` stays unchanged, so the target is kept.
   - `link_drawn` matches on `(target_chain_id = draw chain, metadata_uri)`. It never takes a
     `(chain_id, loan_id)` that is already linked, and returns a `LinkOutcome` for diagnostics.
   - All SQL moves to `pub const`s.
4. **`POST /v1/loan-book/loan`** takes an optional query `chain_id`. It defaults to
   `state.default_chain_id`, and an id that is not in `CHAINS` returns 400. The value is stored
   in `target_chain_id`. It is not stored in `loan_data`.
5. **`POST /v1/loan-book/submissions/{id}/resubmit`** keeps the stored target chain. It takes
   no `chain_id`, and it stays keyed by submission id.
6. **`GET /v1/loan-book/submissions`** gets an optional `chain_id`:
   - If given, it is validated against `CHAINS` (400 if unknown or malformed) and filters by
     `target_chain_id`.
   - If omitted, it returns **all rows**, including submissions whose target chain is no longer
     in `CHAINS`. This keeps today's behavior. It deliberately does not use
     `ChainFilter::resolve` (all *configured* chains).
7. **`SubmissionView`** exposes `target_chain_id: i64`. The existing `chain_id` (drawn chain,
   nullable) and `loan_id` stay.
8. **Indexer** (`packages/worker/src/indexer/loan_mapper.rs`, `LoanDrawn` branch): it logs the
   `LinkOutcome`. A draw on a chain other than the target leaves the submission unlinked, with a
   `warn`. It never fails indexing.
9. Product spec, tech-debt and tests (see below).

### Out of scope

- `review` (keyed by submission id, unchanged).
- `GET /v1/loan-book` (#1530) and per-loan endpoints (#1531).
- Trustee/frontend changes (#1536).
- Readers that join through the drawn pointer `(chain_id, loan_id)`:
  - `CollateralValuationRepo::get_anchor` / `all_anchors` / `distinct_providers_for_drawn_loans`
    / `distinct_concentrate_metal_providers` (`packages/shared/src/collateral_valuation_repo.rs:356-478`)
  - `LoanFeeScheduleRepo::get_fee_schedule` (`packages/shared/src/loan_fee_schedule_repo.rs:89-93`)
  - the worker `assert_live_loans_use_market_providers`

  These need **no change**. They key on the *drawn* chain, which is the correct identity for an
  on-chain loan. The new unique index makes each `(chain_id, loan_id)` join resolve to at most
  one submission, so the `fetch_optional` / per-loan maps can no longer silently pick one of two
  rows. `target_chain_id` matters only before the draw (routing the link) and for the list
  filter.
- Changing `submitted_loans_metadata_uri_unlinked_uk`, the global partial unique index on
  `metadata_uri WHERE loan_id IS NULL`. It stays global: one document can have at most one open
  submission across all chains. This is stricter than needed, but safe (see Assumptions).
- Registry-scoping the submission link. The human decided against it: no registry address on
  the link or the index. The gap is tech debt tracked in #1545.

## Assumptions and Risks

- **Backfill default in the migration (resolved decision 1).**
  - Both binaries run `sqlx::migrate!` at startup: `packages/api/src/main.rs:48` and
    `packages/worker/src/main.rs:32`.
  - The API already requires and validates `DEFAULT_CHAIN_ID` (`ChainsConfig::default_chain_id`,
    `shared::chains::parse_default_chain_id`). The worker does not parse it today, but argocd
    already sets it for the worker. The worker reads it **optionally**: absent is `None`, and a
    malformed value is a startup error.
  - Each binary runs the migrations on one connection after
    `SELECT set_config('pipeline.default_chain_id', '<id>', false)`. The migration reads
    `NULLIF(current_setting('pipeline.default_chain_id', true), '')::bigint`.
  - If a row needs the default and the value is absent, the migration raises a clear error.
    sqlx 0.8.6 runs each migration in a transaction, so a failure records nothing and leaves no
    dirty state.
  - Both binaries supply the value, so the outcome does not depend on start order.
  - On a fresh DB, or when every row is already drawn, the setting is never needed. This keeps
    CI working.
  - The `contract_logs` derivation precedent (`20260606000001`) is not used. Dev already runs
    `CHAINS=560048,99000001`, so derivation would be ambiguous.
- **Existing duplicate links (resolved decision 2a).** These are possible today: `link_drawn`
  matched only unlinked rows by `metadata_uri`. A second submission reusing the same URI could
  be linked to an already-linked `(chain_id, loan_id)` by a re-index. The `20260713000001`
  backfill could do the same.
  - The migration **stops** and lists the offending pairs for manual cleanup.
  - Operator pre-flight query (also in the migration header):
    ```sql
    SELECT chain_id, loan_id, array_agg(id ORDER BY id) AS submission_ids
      FROM submitted_loans WHERE loan_id IS NOT NULL
     GROUP BY chain_id, loan_id HAVING count(*) > 1;
    ```
- **LoanRegistry redeploy versus `UNIQUE (chain_id, loan_id)` (resolved decision 2b).**
  - Each registry numbers loans from the start (the #1526 rationale). After a redeploy on the
    same chain, the new registry's loan 1 collides with an old-registry link to loan 1.
  - Without a guard, `link_drawn` would hit a `23505` inside the indexer transaction, and the
    indexer would retry the same block forever.
  - The plan guards the UPDATE with `NOT EXISTS (… chain_id = $2 AND loan_id = $3)` and logs
    `LinkOutcome::Conflict`/`AlreadyLinked` at `warn`. The new submission then stays unlinked
    until an operator clears the stale link.
  - The link and the index stay `(chain_id, loan_id)`, with no registry address. The gap is
    recorded as tech debt that references #1545.
- **Default target versus where the Trustee actually draws.** Until #1536 ships, every new
  submission targets `DEFAULT_CHAIN_ID`. If a trustee draws it on another chain, it stays
  unlinked (a `warn` log), where today it would link. The Trustee approve flow is Stellar-only
  today (`docs/product-specs/trustee-dashboard.md`, `execute(target, "draw_loan", …)` on
  Soroban), and dev has `DEFAULT_CHAIN_ID=99000001` (Stellar), so this is expected to be a no-op
  in practice. A deployment whose default is an EVM chain would see unlinked draws until #1536.
- **`GET /submissions` with `chain_id` omitted (resolved decision 4).** It returns every row,
  as today. This is a deliberate exception to the epic's "omitted = all configured chains"
  wording. The handler reads `ChainFilter::chain_id()`, which is `None` when the parameter is
  omitted, and never calls `resolve`. `ChainFilter` still rejects an unknown or malformed id with
  400.
- **Extractor ordering on `POST /loan`.** `ChainFilter` is an extractor, so an unknown
  `chain_id` returns 400 before the in-handler `originator` role check (403). `AuthClaims` still
  runs first (401). This matches the #1528 extractor design and is accepted.
- **`chain_id` stays out of `loan_data`.** `SubmitLoanRequest` is persisted verbatim and models
  the `draw_loan` inputs. The target chain is not a `draw_loan` input, so it is a query parameter
  (the epic's "Parameter: `chain_id` (query)"), and `loan_data` is unchanged (resolved
  decision 3).
- **`SubmissionsQuery` coexists with `ChainFilter`.** It has no `deny_unknown_fields`, and the
  extractor reads only `chain_id` from the URI (#1528 Assumptions).
- **`AppState` is unchanged**, so `tests/voucher_signing.rs` / `tests/loan_registry_scope.rs`
  `make_test_state` need no edits.
- **Comment-less code (AGENTS.md).** Add no new doc comments or field JSDoc. Existing comments
  that become false (for example the `link_drawn` docstring and the `loan_mapper.rs:668-672`
  comment) must be corrected or removed, not extended. The migration file keeps the
  repo-standard header (rationale and rollback), as every migration does.
- No open blockers: #1528 and #1520 are merged.

## Resolved decisions (human, 2026-10-15)

1. **Backfill default.** The session setting `pipeline.default_chain_id` is set by the shared
   migration runner, and **both** the API and the worker pass it.
   - The worker reads `DEFAULT_CHAIN_ID` optionally (argocd already sets it for the worker).
   - If a row needs the default and the value is absent, the migration fails with a clear error.
   - There is no dependency on start order.
2. **Duplicates.**
   - (a) An existing `(chain_id, loan_id)` linked to two submissions makes the migration stop
     and list the pairs for manual cleanup.
   - (b) Loan-id reuse after a redeploy is `warn`-logged and the submission is left unlinked.
     This is recorded as tech debt referencing #1545. No registry address is added to the link
     or the index.
3. **`POST /v1/loan-book/loan`** receives the target chain as the query parameter
   `?chain_id=`, not as a body field.
4. **`GET /v1/loan-book/submissions`** without `chain_id` returns **all** rows, including
   submissions whose target chain is no longer in `CHAINS`, which keeps today's behavior. With
   `chain_id`, it filters by `target_chain_id`.

## Open Questions

_None_

## Implementation Steps

1. **Migration** `packages/shared/migrations/20261015000001_submitted_loans_target_chain.sql`.
   Write it in this order. A test pins the order.
   1. Header: rationale (epic #1521 decision), the backfill source rules, the GUC contract
      (`pipeline.default_chain_id`, set by the shared runner in both the API and the worker), the duplicate pre-flight query,
      and the inverse SQL:
      ```sql
      --   DROP INDEX submitted_loans_target_chain_idx;
      --   DROP INDEX submitted_loans_chain_loan_uk;
      --   CREATE INDEX submitted_loans_loan_lookup_idx ON submitted_loans (chain_id, loan_id);
      --   ALTER TABLE submitted_loans DROP CONSTRAINT submitted_loans_link_on_target_ck;
      --   ALTER TABLE submitted_loans DROP COLUMN target_chain_id;
      ```
   2. `ALTER TABLE submitted_loans ADD COLUMN target_chain_id BIGINT;`
   3. `DO $$` duplicate pre-check: `SELECT string_agg(format('(chain_id=%s, loan_id=%s) -> submissions %s', …), '; ')`
      over the pre-flight grouping. If it is non-null, `RAISE EXCEPTION` with that list and an
      instruction to unlink the wrong rows (`UPDATE submitted_loans SET chain_id = NULL, loan_id = NULL WHERE id = …`).
      This follows the `string_agg` + `RAISE` style in `20260922000001_accounts_email_password_auth.sql:66`.
   4. `UPDATE submitted_loans SET target_chain_id = chain_id WHERE chain_id IS NOT NULL;`
      Leave `updated_at` untouched, because this is a schema backfill, not a business change.
   5. `DO $$` default backfill:
      - Exit if `NOT EXISTS (SELECT 1 FROM submitted_loans WHERE target_chain_id IS NULL)`.
      - Otherwise read `v := NULLIF(current_setting('pipeline.default_chain_id', true), '')::bigint`.
        If it is NULL, `RAISE EXCEPTION 'submitted_loans.target_chain_id backfill needs DEFAULT_CHAIN_ID: % rows have no drawn chain and pipeline.default_chain_id is unset; set DEFAULT_CHAIN_ID for the migrating service'`.
      - Then `UPDATE … SET target_chain_id = v WHERE target_chain_id IS NULL`, followed by a
        `RAISE NOTICE` with the count.
   6. `ALTER TABLE submitted_loans ALTER COLUMN target_chain_id SET NOT NULL;`
   7. `ALTER TABLE submitted_loans ADD CONSTRAINT submitted_loans_link_on_target_ck CHECK (chain_id IS NULL OR chain_id = target_chain_id);`
   8. `DROP INDEX submitted_loans_loan_lookup_idx;`, then
      `CREATE UNIQUE INDEX submitted_loans_chain_loan_uk ON submitted_loans (chain_id, loan_id) WHERE loan_id IS NOT NULL;`
   9. `CREATE INDEX submitted_loans_target_chain_idx ON submitted_loans (target_chain_id, created_at DESC);`

2. **Shared migration runner** `packages/shared/src/migrations.rs` (new; register it in
   `packages/shared/src/lib.rs`):
   ```rust
   pub const DEFAULT_CHAIN_GUC: &str = "pipeline.default_chain_id";
   pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
   pub async fn run(pool: &PgPool, default_chain_id: Option<i64>) -> anyhow::Result<()>;
   pub fn parse_optional_default_chain_id(raw: Option<&str>) -> anyhow::Result<Option<i64>>;
   ```
   `parse_optional_default_chain_id` is pure, so tests pass strings and never read env. It works
   as follows:
   - `None`, or empty after trimming, gives `Ok(None)`.
   - A valid integer gives `Ok(Some(id))`.
   - Anything else gives `Err("DEFAULT_CHAIN_ID must be a valid integer")`.
   `run` does the following:
   - Acquire one pooled connection.
   - If `Some(id)`: `SELECT set_config($1, $2, false)` binding `DEFAULT_CHAIN_GUC`,
     `id.to_string()`.
   - `MIGRATOR.run(&mut *conn)`. `Migrator::run` takes `A: Acquire`, and `&mut PgConnection`
     qualifies.
   - Then `SELECT set_config($1, '', false)` to clear it, so the pooled connection does not keep
     the setting.

   `anyhow` is already a `shared` dependency, so `run` returns `anyhow::Result<()>`.

   - `packages/api/src/main.rs`: delete the line-48 `sqlx::migrate!(…)`. After
     `let chains_config = ChainsConfig::from_env()?;` (currently line 105; env-only, no DB), call
     `shared::migrations::run(&pool, Some(chains_config.default_chain_id)).await?;`. Then confirm
     that nothing between the old and new positions touches the DB before migrations. Repos are
     only constructed there. If something does, move the `ChainsConfig::from_env()` call up
     instead.
   - `packages/worker/src/main.rs:32`: replace it with:
     ```rust
     let default_chain_id = shared::migrations::parse_optional_default_chain_id(std::env::var("DEFAULT_CHAIN_ID").ok().as_deref())?;
     shared::migrations::run(&pool, default_chain_id).await?;
     ```
     This is the only env read, and it lives in `main`. The worker does not validate the value
     against `CHAINS`, because the API is the authority on that. Document the worker's optional
     `DEFAULT_CHAIN_ID` in `.env.example`, next to the existing `DEFAULT_CHAIN_ID` line, as
     "worker: optional, used only by the migration backfill".
   - `sqlx::migrate!` path semantics: the macro resolves relative to the invoking crate's
     `CARGO_MANIFEST_DIR`, so the shared crate uses `"./migrations"`. Remove the now-unused
     `"../shared/migrations"` invocations so the migration set is embedded once.

3. **`SubmittedLoanRepo`** (`packages/shared/src/submitted_loan_repo.rs`):
   - `SubmittedLoanRow`: add `pub target_chain_id: i64`. No doc comment. Correct the existing
     `chain_id` field doc ("Chain the linked loan was drawn on") only if it becomes misleading.
     It does not, so leave it.
   - Extract the SQL to `pub const`s (the #1526 / #1523 convention):
     - `SUBMISSION_COLUMNS`: the shared projection `id, loan_data, status, reason, originator, target_chain_id, chain_id, loan_id, created_at, updated_at`.
       If concatenating into a `const` is awkward, inline it in each const. Each SELECT const
       must contain `target_chain_id`.
     - `INSERT_SUBMISSION_SQL`: `INSERT INTO submitted_loans (loan_data, originator, target_chain_id) VALUES ($1, $2, $3) RETURNING id`.
     - `LIST_SUBMISSIONS_SQL`: `… FROM submitted_loans WHERE ($1::text IS NULL OR status = $1) AND ($2::bigint IS NULL OR target_chain_id = $2) ORDER BY created_at DESC, id DESC`.
       This replaces the two-branch `match` in `list`.
     - `FIND_SUBMISSION_SQL`: by `id`.
     - `RESUBMIT_SQL`: the current text, unchanged. It must **not** mention `target_chain_id`,
       and a test pins that.
     - `LINK_DRAWN_SQL`:
       ```sql
       UPDATE submitted_loans
          SET chain_id = $2, loan_id = $3, updated_at = now()
        WHERE loan_data->>'metadata_uri' = $1
          AND loan_id IS NULL
          AND target_chain_id = $2
          AND NOT EXISTS (SELECT 1 FROM submitted_loans o WHERE o.chain_id = $2 AND o.loan_id = $3)
       RETURNING id
       ```
     - `UNLINKED_DRAW_CANDIDATES_SQL`, run only when the UPDATE returned no row:
       ```sql
       SELECT id, target_chain_id, chain_id, loan_id FROM submitted_loans
        WHERE (chain_id = $2 AND loan_id = $3)
           OR (loan_data->>'metadata_uri' = $1 AND loan_id IS NULL)
       ```
       The `metadata_uri_unlinked_uk` index means it returns at most two rows.
   - `insert(conn, loan_data, originator, target_chain_id: i64)`.
   - `list(&self, status: Option<SubmissionStatus>, target_chain_id: Option<i64>)`. Bind
     `status.map(|s| s.as_str())` and `target_chain_id`. `None` means no chain predicate, so
     every row is returned, including targets that are no longer in `CHAINS`.
   - `resubmit`: switch to `RESUBMIT_SQL`, with no behavior change. Its docstring already
     describes the behavior. Do not extend it.
   - `link_drawn(conn, metadata_uri, chain_id, loan_id) -> Result<LinkOutcome, sqlx::Error>`:
     run `LINK_DRAWN_SQL` (`fetch_optional` of `id`). `Some(id)` → `LinkOutcome::Linked { submission_id }`.
     Otherwise fetch `UNLINKED_DRAW_CANDIDATES_SQL` into `Vec<LinkCandidate>` and return
     `classify_unlinked_draw(&candidates, chain_id, loan_id)`.
   - New pure types and functions in the same module (public for tests):
     ```rust
     #[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
     pub struct LinkCandidate { pub id: i64, pub target_chain_id: i64, pub chain_id: Option<i64>, pub loan_id: Option<BigDecimal> }

     #[derive(Debug, Clone, PartialEq, Eq)]
     pub enum LinkOutcome {
         Linked { submission_id: i64 },
         NoSubmission,
         AlreadyLinked { submission_id: i64 },
         TargetMismatch { submission_id: i64, target_chain_id: i64 },
         Conflict { linked_submission_id: i64, candidate_submission_id: i64 },
     }

     pub fn classify_unlinked_draw(candidates: &[LinkCandidate], chain_id: i64, loan_id: &BigDecimal) -> LinkOutcome;
     ```
     Rules:
     - `linked` = the candidate with `chain_id == Some(chain_id) && loan_id == Some(loan_id)`.
     - `open` = the candidate with `loan_id.is_none()`.
     - `(Some(l), Some(o))` → `Conflict` if `o.target_chain_id == chain_id`, else
       `AlreadyLinked { l }` (the open one targets another chain, so the existing link is what
       matters).
     - `(Some(l), None)` → `AlreadyLinked`.
     - `(None, Some(o))` → `TargetMismatch { o.id, o.target_chain_id }`. The NOT EXISTS guard is
       not the cause here, so only a target mismatch can explain it. If
       `o.target_chain_id == chain_id`, which is unreachable barring a race, return `Conflict`
       with `linked_submission_id = o.id`; the indexer is single-writer per chain. Decide during
       implementation and pin the behavior in a test.
     - `(None, None)` → `NoSubmission`.

     Also add `pub fn is_unexpected(&self) -> bool` on `LinkOutcome`. It is `true` for
     `TargetMismatch` and `Conflict`, and the indexer uses it to choose `warn` over `info`.
   - Update or trim the `link_drawn` docstring so it no longer states the "matching by
     `metadata_uri`" rule alone. One line stating chain + `metadata_uri` matching is enough.

4. **Indexer** (`packages/worker/src/indexer/loan_mapper.rs:667-688`):
   - Bind `let outcome = SubmittedLoanRepo::link_drawn(…).await?;`.
   - If `outcome.is_unexpected()`, emit `tracing::warn!(chain_id, loan_id, metadata_uri, ?outcome, "LoanDrawn: submission not linked")`.
     Otherwise emit `tracing::info!(…, ?outcome, "LoanDrawn: submission link")`.
   - Indexing never fails on any outcome. Only `sqlx::Error` propagates, as today.
   - Trim the existing comment block to stay accurate (chain + `metadata_uri`). Do not add new
     prose.
   - `LoanDisbursementRepo::mark_drawn` is unchanged.

5. **API: `POST /v1/loan-book/loan`** (`packages/api/src/routes/loan_book.rs:579-627`):
   - Add the extractor `chain: ChainFilter`, after `State`, before `Json`.
   - Add the pure helper `pub fn resolve_target_chain(chain: &ChainFilter, default_chain_id: i64) -> i64 { chain.chain_id().unwrap_or(default_chain_id) }`.
     `parse_default_chain_id` already guarantees that the default is in `CHAINS`.
   - `SubmittedLoanRepo::insert(&mut tx, &loan_data, &claims.sub, target_chain_id)`.
   - `#[utoipa::path]`: `params(("chain_id" = Option<i64>, Query, description = "Target chain for the submission. Optional — defaults to DEFAULT_CHAIN_ID. Malformed or not in CHAINS → 400."))`.
     Do not use `params(ChainFilter)`, because its description says "omit for all". Extend the
     `400` description to "Payload failed validation, or unknown/malformed chain_id".
   - The response is unchanged (`{ id }`).

6. **API: resubmit** (`loan_book.rs:686-764`): no code change. `RESUBMIT_SQL` leaves
   `target_chain_id` alone. The utoipa description may add "the target chain is kept".
   Description strings are not comments, so this is allowed.

7. **API: `GET /v1/loan-book/submissions`** (`loan_book.rs:766-834`):
   - Add the extractor `chain: ChainFilter`. It validates a given id against `CHAINS` (400 if
     unknown or malformed). Its `resolve` ("all configured chains") is **not** used here
     (resolved decision 4).
   - Call `state.submitted_loan_repo.list(status, chain.chain_id())`. When `chain_id` is omitted,
     `None` returns every row.
   - OpenAPI: do not use `params(ChainFilter)`, because its description says "omit for all
     configured chains". Use `params(SubmissionsQuery, ("chain_id" = Option<i64>, Query, description = "Filter by target chain. Optional — omit for all submissions (including targets no longer in CHAINS). Malformed or not in CHAINS → 400."))`,
     and add `(status = 400, …)` for an unknown or malformed chain.
   - The on-chain status override loop is unchanged. It still groups by the *drawn* `chain_id`
     and skips unconfigured chains, which keep their stored status.
   - Import `ChainFilter`.

8. **`SubmissionView`** (`loan_book.rs:414-473`):
   - Add `pub target_chain_id: i64` next to `chain_id`, with no doc comment.
   - Map it in `From<SubmittedLoanRow>`.
   - Update the module-level `//!` header (lines 1-7) only if it now contradicts the code. It
     mentions `chain_id?` defaulting to `DEFAULT_CHAIN_ID`, which #1530/#1531 will also touch.
     Leave it to them unless the header is wrong for submissions; at most add a one-line spec
     pointer.

9. **Lint/build**: `cargo clippy --all -- -D warnings`, `cargo test -p shared -p pipeline-api -p pipeline-worker`
   (check the exact package names in each `Cargo.toml`), and `npx tsx scripts/lint-docs.ts`
   after the docs edits.

## Test Strategy

The tests are pure unit tests only. No test reads `DATABASE_URL`/`POSTGRES_URL` or any env var
to reach Postgres. A lazy pool (`PgPool::connect_lazy`) is acceptable only where a struct needs
one and no query runs. Tests live in external files only, with no inline `#[cfg(test)]`.

1. **`packages/shared/tests/submitted_loan_repo.rs`** (new):
   - SQL text:
     - `LINK_DRAWN_SQL` contains `target_chain_id = $2`, `loan_id IS NULL`, the `NOT EXISTS`
       guard on `o.chain_id = $2 AND o.loan_id = $3`, and `RETURNING id`.
     - `LIST_SUBMISSIONS_SQL` contains `($2::bigint IS NULL OR target_chain_id = $2)`, the
       nullable status predicate, and `ORDER BY created_at DESC, id DESC`. It does **not**
       contain `ANY(`, so omitting the filter never restricts results to configured chains.
     - `INSERT_SUBMISSION_SQL` writes `target_chain_id`.
     - `FIND_SUBMISSION_SQL` / `LIST_SUBMISSIONS_SQL` project `target_chain_id`.
     - `RESUBMIT_SQL` does **not** contain `target_chain_id` (target is kept) and still guards
       `status = 'ChangesRequested'`.
     - `UNLINKED_DRAW_CANDIDATES_SQL` contains both disjuncts.
   - `classify_unlinked_draw`:
     - no candidates → `NoSubmission`
     - only a row linked to the same `(chain, loan)` → `AlreadyLinked`
     - only an open row targeting another chain → `TargetMismatch` with that row's
       `target_chain_id`
     - a linked row plus an open row targeting the draw chain → `Conflict`
     - a linked row plus an open row targeting another chain → `AlreadyLinked`
     - the "open row targets the draw chain but was not linked" case → the behavior chosen in
       Step 3
     - a linked row on the same chain but a different `loan_id` is ignored. Use a loan id
       greater than `u64` to cover `NUMERIC(78,0)`.
   - `LinkOutcome::is_unexpected` truth table.
2. **`packages/shared/tests/migrations.rs`** (new), using
   `include_str!("../migrations/20261015000001_submitted_loans_target_chain.sql")`:
   - It contains `ADD COLUMN target_chain_id BIGINT`, and the
     `current_setting('<DEFAULT_CHAIN_GUC>', true)` read (built from `shared::migrations::DEFAULT_CHAIN_GUC`,
     so the constant and the SQL cannot drift), `SET NOT NULL`,
     `submitted_loans_link_on_target_ck`, `DROP INDEX submitted_loans_loan_lookup_idx`, and
     `CREATE UNIQUE INDEX submitted_loans_chain_loan_uk ON submitted_loans (chain_id, loan_id) WHERE loan_id IS NOT NULL`.
   - Ordering via `str::find` positions: duplicate `RAISE` check < drawn-link backfill < GUC
     backfill < `SET NOT NULL` < unique index.
   - The header documents the inverse SQL: it contains `DROP COLUMN target_chain_id` in a
     comment line.
   - `shared::migrations::MIGRATOR` includes a migration with version `20261015000001`.
     Iterating `MIGRATOR.iter()` is pure and embedded at compile time.
   - `parse_optional_default_chain_id`:
     - `None` → `Ok(None)`
     - `Some("")` / `Some("  ")` → `Ok(None)`
     - `Some("99000001")` → `Ok(Some(99000001))`
     - `Some(" 1 ")` → `Ok(Some(1))`
     - `Some("abc")` → `Err` mentioning `DEFAULT_CHAIN_ID`

     These are string inputs only, with no env access.
   - The RAISE message for a missing default names `DEFAULT_CHAIN_ID` and does **not** tell the
     operator to "start the API first", because start order is irrelevant.
3. **`packages/api/tests/loan_submission.rs`** (extend):
   - `resolve_target_chain`: `ChainFilter(None)` → default, and `ChainFilter(Some(c))` →
     `c.chain_id`.
   - `SubmissionView::from(SubmittedLoanRow { target_chain_id: 7, chain_id: None, … })`
     serializes `"target_chain_id": 7` and `"chain_id": null`. A drawn row serializes both.
   - The OpenAPI doc (`LoanBookDoc::openapi()`): `/v1/loan-book/loan` POST has an optional
     `chain_id` query param, and `/v1/loan-book/submissions` GET has an optional `chain_id`
     query param alongside `status`. `SubmissionView` has a required `target_chain_id`
     property.
   - The 400 paths for unknown/malformed `chain_id` are already covered by
     `packages/api/tests/chain_param.rs` (`parse_chain_filter`). Do not duplicate them.
4. **Worker**: there is no new test file. `loan_mapper.rs` only maps the outcome to a log level
   through `LinkOutcome::is_unexpected`, which is tested in shared. The existing
   `packages/worker/tests/loan_mapper.rs` must still compile and pass.
5. Manual (optional, by the human, not CI): apply the migration on a copy of the dev DB, started
   from either binary. Check that every row has `target_chain_id`, and that drawn rows match
   their `chain_id`.

## Docs to Update

- `docs/product-specs/api-authorization.md`:
  - Endpoint table rows (lines 63-66):
    - `POST /v1/loan-book/loan`: optional `?chain_id` (target chain; defaults to
      `DEFAULT_CHAIN_ID`; not in `CHAINS` → 400).
    - `GET /v1/loan-book/submissions?status&chain_id`: filter by target chain; omitted = all
      submissions (including targets no longer in `CHAINS`); unknown → 400.
    - `resubmit`: the target chain is kept.
  - "Loan submission" section: add a short **Target chain** paragraph. It covers how the target
    is set at submission, kept on resubmit, and the drawn loan linked only on the target chain
    by `metadata_uri`. A draw on another chain stays unlinked (and is logged).
  - `submitted_loans` table: add rows for `target_chain_id` (`BIGINT NOT NULL`), plus the
    already-missing `chain_id` / `loan_id` drawn pointer, noting the
    `(chain_id, loan_id) WHERE loan_id IS NOT NULL` uniqueness.
- `docs/exec-plans/tech-debt-tracker.md`: a new entry. The submission link is not
  registry-scoped, so after a LoanRegistry redeploy a reused `loan_id` cannot link (it is
  `warn`-logged by the indexer and needs manual unlinking). Reference #1545 (the follow-up),
  #1526 and this issue.
- `.env.example`: note that `DEFAULT_CHAIN_ID` is also read optionally by the worker, for the
  migration backfill only.
- The migration header documents the `pipeline.default_chain_id` contract (set by both
  binaries from `DEFAULT_CHAIN_ID`) and the duplicate pre-flight query.
- No `ARCHITECTURE.md` change. Migrations still live in `packages/shared/migrations`, and the
  runner moves into `shared`, which is consistent with the existing dependency direction
  (api/worker → shared).

## Addendum (human, 2026-10-16, integration review)

- `GET /v1/loan-book/submissions`: a well-formed `chain_id` not in `CHAINS` returns `200` with an
  empty list (same lenient semantics as `GET /v1/loan-book`); malformed or repeated is `400`;
  omitted returns all rows; a configured id filters by `target_chain_id`. #1530 introduces
  `LenientChainFilter`, so the merge reconciles this branch's minimal `LenientChainId`.
- LP frontend `useLoanSubmissions` sends no `chain_id` (the In Origination tab shows all
  submissions). The Trustee app is unchanged.
- Migration header rollback adds `DELETE FROM _sqlx_migrations WHERE version = 20261015000001;`
  and states it must run in one transaction, together with rolling back the images.
- `shared::migrations::run`: a failure resetting the session setting is logged and does not mask
  the migration result.
- Worker validates `DEFAULT_CHAIN_ID` against `CHAINS` when set (absent stays allowed).
- Docs updated: ARCHITECTURE.md, dashboards, dashboard-components, trustee-flows, trustee-dashboard,
  api-authorization (`GET /submissions` is public), the loan-submission spec and user story.
- Accepted: loans drawn on Hoodi (test) stay unlinked until #1536 sends the target chain.
