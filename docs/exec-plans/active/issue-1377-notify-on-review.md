# Issue #1377: Backend: notify_on_review flag on POST /v1/lps/me + narrowed write freeze

Source: https://github.com/eq-lab/pipeline/issues/1377

Part of epic #1376 (KYB review lifecycle). Branch `feat/1377-notify-on-review`, draft PR #1384.

Spec of record: `docs/product-specs/kyb-lp-verification.md` § "Review Notifications", plus the
freeze paragraph under § "LP Entity Registration and KYB Documents". The file is **not on `main`**
— it is on branch `docs/kyb-review-lifecycle` (open PR #1382). Read it with:

```bash
git show origin/docs/kyb-review-lifecycle:docs/product-specs/kyb-lp-verification.md
```

The spec plus the Issue body is the design of record. Its decisions were settled with the user and
are not open for re-litigation: the flag lives on `lps` (not `accounts`), it rides in the body of
`POST /v1/lps/me` (not a separate route), and it defaults to `false`.

## Scope

Two changes, one endpoint.

1. **The preference.** `lps.notify_on_review BOOLEAN NOT NULL DEFAULT false`, settable through
   `POST /v1/lps/me` (`notify_on_review: Option<bool>`, absent = *do not change*, so it is
   explicitly **not** part of the profile's full-replace semantics), and read back on `LpResponse`.
2. **The narrowed freeze.** `POST /v1/lps/me` stops refusing the whole request when the LP is not
   writable, and starts refusing only a profile *change*:

| LP exists? | `allows_owner_writes()` | submitted profile vs stored | result |
|---|---|---|---|
| no | — | — | `201`, insert; preference written, `false` when absent |
| yes | `true` | anything | `200`, full replace + preference (behaviour unchanged) |
| yes | `false` | identical | `200`, **only** `notify_on_review` written |
| yes | `false` | different | `409`, **nothing** written, preference included |

"Not writable" is whatever `KybStatus::allows_owner_writes` says at the time this lands — today
`UnderReview` / `Passed`; after #1274, `UnderReview` / `Passed` / `Failed`. This issue reads that
predicate and never restates the list.

Out of scope — each is a sibling sub-issue of #1376, do not touch:

- **#1274** — the `kyb_status` state machine, `POST /v1/lps/me/submit`, the trustee verdict
  endpoint, `ChangesRequested`, and the removal of `Failed` from `OWNER_WRITABLE`.
- **#1378** — the decision emails that *read* this flag. This issue writes and returns it; nothing
  consumes it yet, and that is expected.
- **#1379** — ungating `POST /v1/lps/me/link-address`.
- **#1380** — enforcing `accounts.status = 'Suspended'`.
- The same narrowing for `POST /v1/lps/me/documents` and `DELETE /v1/lps/me/documents/{doc}`.
  Those stay hard-frozen: a document *is* the evidence a decision is made about, so
  `guard_writable` is left exactly as it is at both call sites.
- LP-app UI for the toggle (not yet filed) and any frontend change. `packages/frontend/src/api/lps.ts`
  gains nothing — a new response field is additive and the existing `LpResponse` interface stays valid.

## Overlap with #1274 (read before writing a line of code)

Sibling #1274 (KYB state machine) has an approved plan at
`docs/exec-plans/active/issue-1274-kyb-state-machine.md` on branch `feat/1274-kyb-state-machine`:

```bash
git show origin/feat/1274-kyb-state-machine:docs/exec-plans/active/issue-1274-kyb-state-machine.md
```

**Files both issues touch:**

| File | #1274 does | #1377 does | conflict shape |
|---|---|---|---|
| `packages/shared/src/lp_repo.rs` | adds `ChangesRequested`; `OWNER_WRITABLE` drops `Failed`, gains `ChangesRequested`; adds `may_transition_to`, `submittable_strs`, `submit_for_review`, `decide_kyb`; adds 4 columns to `LpRow`; factors the repeated SELECT list into `const COLUMNS` | adds `notify_on_review` to `LpRow` and every SELECT list; rewrites `upsert_by_owner_account_id`'s SQL | textual, in the same hunks |
| `packages/api/src/routes/lps.rs` | adds 2 routes, 2 handlers, 3 `LpResponse` fields, 2 `LpSummary` fields, 3 pure fns; rewrites the module header | adds 1 `UpsertLpRequest` field, 1 `LpResponse` field, 2 pure fns; rewrites `upsert_my_lp` | textual, mostly disjoint hunks |
| `packages/api/tests/lps.rs` | appends tests | appends tests, **edits the `form()` helper** | textual, at the helper |
| `packages/shared/migrations/` | new file `20260929000001_kyb_review_lifecycle.sql` | new file, different name | none, but see version ordering |
| `packages/shared/tests/kyb_status.rs` | rewrites it | **does not touch it** | none |

**Semantic coupling, both directions:**

- #1274 removes `Failed` from `OWNER_WRITABLE`. Because this issue keys the narrowed freeze off
  `allows_owner_writes()` / `owner_writable_strs()` and never writes a literal status list, the
  narrowing simply extends to `Failed` for free. Consequence to state in the PR description: after
  both land, an LP terminally refused at `Failed` can still toggle its notification preference. That
  is consistent with the spec ("switchable at any point, including while the record is frozen") and
  harmless — but it is a behaviour reached indirectly, so call it out rather than leave it implicit.
- #1274 adds `ChangesRequested` to `OWNER_WRITABLE`, so an LP handed back for correction takes the
  plain writable path here. Nothing to do.
- This issue does **not** need `may_transition_to`, `submittable_strs`, or any new status. It is
  orthogonal to the state machine; it only cares whether the record is writable *right now*.

**Recommended order: #1274 first, #1377 rebases onto it.** Reasons: #1274 makes the larger
structural change to `lp_repo.rs` (the `const COLUMNS` refactor plus four new `LpRow` fields), and
it rewrites `packages/shared/tests/kyb_status.rs` wholesale. Rebasing #1377 over that is mechanical
— one extra column name in one `const COLUMNS`, instead of the same edit in three SELECT lists.
Rebasing #1274 over #1377 means re-applying a refactor across a file someone else just edited.

**If #1274 lands first, #1377 rebases by:**

1. Adding `notify_on_review` to #1274's `const COLUMNS` (one place) instead of to each of the three
   SELECT lists, and keeping the `LpRow` field beside #1274's four new ones.
2. Renaming its migration so the version sorts after `20260929000001_kyb_review_lifecycle.sql`.
3. Nothing else. `upsert_by_owner_account_id` is untouched by #1274.

**If #1377 lands first, #1274 rebases by:**

1. Adding its four columns beside `notify_on_review` in whatever SELECT-list shape exists, and doing
   the `const COLUMNS` refactor over it.
2. **Not reverting `upsert_by_owner_account_id`.** Its new `ON CONFLICT … DO UPDATE … WHERE` clause
   is a compound predicate (freeze **OR** profile-unchanged) plus a `COALESCE`d preference. A rebase
   that restores the old one-line `WHERE lps.kyb_status = ANY($7)` silently reinstates the wide
   freeze and drops the preference write. This is the single highest-risk merge hazard in the epic.
3. Renaming its migration so the version sorts last.

**Migration version ordering, whichever lands second:** rename the file so its timestamp sorts after
every migration already on `main`. A migration must not be edited once applied (sqlx checksums it),
so the rename has to happen *before* merge. The branch that lands second owns this.

## Assumptions and Risks

- **The spec is unmerged.** PR #1382 carries § "Review Notifications". If it changes before merge,
  re-read it. This branch must not duplicate or fork the spec file — see Docs to Update.
- **Where the comparison lives is the crux, and Rust alone is not enough.** `upsert_my_lp` does
  `find_by_owner_account_id`, then `upsert_by_owner_account_id` — two round trips. A trustee moving
  the record to `UnderReview` between them would let a profile edit through if the only check were
  the Rust one made against the earlier read. The SQL predicate must therefore carry the whole rule,
  exactly as it carries the freeze today ("the DB predicate below is what actually enforces the
  freeze"). Conversely, SQL alone is not enough either: the repo forbids tests that reach a real
  Postgres, so the rule would be untestable, and a `None` return cannot name the current status in
  the refusal message. **Decision: the rule is stated once as a pure Rust function (tested, and the
  place the policy is written down), and restated in SQL (untested, and the place it is enforced).**
  The duplication is deliberate; keep them adjacent in review.
- **`=` is the wrong SQL operator for `country`.** `country` is nullable, and an absent country is
  stored as `NULL` (the profile is a full replace — `validate_profile` already collapses blank to
  `None`). `lps.country = EXCLUDED.country` yields `NULL`, not `true`, when both sides are `NULL`;
  the surrounding `AND` then collapses to `NULL`, the `WHERE` treats it as false, and **every**
  frozen LP with no country gets a spurious `409` on a pure preference toggle. Use
  `IS NOT DISTINCT FROM` on all three columns. This is the one failure mode most likely to ship
  unnoticed, because the tests are pure Rust and cannot catch it.
- **`EXCLUDED.notify_on_review` is the wrong reference on the update path.** If the insert's
  `VALUES` list carries `COALESCE($8, false)`, then `EXCLUDED.notify_on_review` is `false` whenever
  the caller omitted the field — so `SET notify_on_review = EXCLUDED.notify_on_review` would silently
  opt an LP *out* on every profile edit that did not mention the preference. The update path must
  reference the bind parameter directly: `COALESCE($8, lps.notify_on_review)`.
- **An explicit `NULL` in `VALUES` overrides a column `DEFAULT`.** Binding `Option<bool>` straight
  into the insert would write `NULL` into a `NOT NULL` column and fail. `COALESCE($8, false)` is
  required on the insert path too, not just cosmetic.
- **Comparison is over the *validated* profile, not the raw request.** `validate_profile` trims all
  three fields and collapses a blank `country` to `None`; those trimmed values are what would be
  written, so those are what must be compared. Comparing `req.legal_name` raw would make
  `" Acme "` against a stored `"Acme"` read as a change and `409` a request that would have written
  nothing. Comparison is otherwise exact and **case-sensitive** — resubmitting `ops@ACME.example`
  against a stored `ops@acme.example` is a change and is refused. That is the honest reading: it is
  a different string and would be a different stored value. In practice it never fires, because the
  LP app disables the profile inputs on `writable: false` and echoes back what `GET /v1/lps/me`
  returned.
- **`updated_at` bumps on a preference-only write.** Decided, not asked: a write is a write, it is
  one statement, and `updated_at` is not exposed on any response DTO
  (`LpResponse` carries `created_at`; `LpSummary` carries `created_at`), so no reader can misread it
  as "the record changed during review". A request that is frozen, identical, *and* omits
  `notify_on_review` therefore bumps `updated_at` for nothing. Accepted as noise.
- **No integration coverage of the SQL, by repo rule.** The predicate that actually enforces this is
  untestable here. Verify it by hand against a local DB before marking PR #1384 ready — the checklist
  is in Test Strategy.
- **Nothing reads the flag yet.** #1378 is what sends the emails. Shipping a written-but-unread
  column is intended, not an oversight.

## Open Questions

1. **Merge order with #1274.** This plan recommends #1274 first and #1377 rebased onto it (rationale
   in the Overlap section), but the two are independent enough to land in either order and the
   manager owns the sequencing. Confirm the order, so the branch that lands second knows to rename
   its migration and — if that branch is #1274 — knows not to revert `upsert_by_owner_account_id`.
2. **Does the LP-app contract need anything beyond `writable` to tell it the toggle is never
   frozen?** After this change `writable: false` means "profile and documents are frozen" while
   `notify_on_review` stays editable, so a client that disables the whole form on `writable: false`
   would disable the one control the spec insists must stay live. This plan adds no second flag —
   the client is simply expected not to gate the toggle on `writable`, and the field's doc comment
   says so. Confirm that is the contract wanted by the (not-yet-filed) LP-side toggle UI issue,
   rather than an explicit hint field on `LpResponse`.

## Implementation Steps

### 1. Migration

Add `packages/shared/migrations/20260929000002_lps_notify_on_review.sql` (the `…002` stamp leaves
`…001` to #1274; if #1274 has already merged, bump so this sorts last — see Overlap).

House style, following `20260924000001_kyb_documents_untyped_and_storage.sql`: a module comment
stating the intent, the inverse SQL in a comment (migrations are forward-only), and every statement
written to survive a re-run.

```sql
ALTER TABLE lps
    ADD COLUMN IF NOT EXISTS notify_on_review BOOLEAN NOT NULL DEFAULT false;
```

`NOT NULL DEFAULT false` backfills every existing row to opt-out, which is the spec's default. The
`DEFAULT` stays on the column permanently — it is the value a row takes when the insert path has no
preference to write.

The comment should record *why* the column is on `lps` and not on `accounts`: the preference is
about a decision made on an entity, one account owns at most one LP, and the address it is delivered
to is `lps.contact_email`.

### 2. `packages/shared/src/lp_repo.rs`

**`LpRow`** gains:

```rust
/// Whether the owner asked to be emailed each trustee decision. Opt-in;
/// outside the write freeze (spec § Review Notifications).
pub notify_on_review: bool,
```

Add `notify_on_review` to the SELECT list of **all three** readers —
`find_by_owner_account_id`, `list`, `find`. (If #1274 landed first, add it to its `const COLUMNS`
instead; four SELECTs drifting apart is the predictable failure, which is why #1274 factors them.)

**`upsert_by_owner_account_id`** gains a `notify_on_review: Option<bool>` parameter and a rewritten
statement:

```sql
INSERT INTO lps (legal_name, country, contact_email, owner_account_id,
                 owner_chain_id, owner_address, notify_on_review)
VALUES ($1, $2, $3, $4, $5, $6, COALESCE($8::boolean, false))
ON CONFLICT (owner_account_id) DO UPDATE SET
    legal_name       = EXCLUDED.legal_name,
    country          = EXCLUDED.country,
    contact_email    = EXCLUDED.contact_email,
    notify_on_review = COALESCE($8::boolean, lps.notify_on_review),
    updated_at       = now()
WHERE lps.kyb_status = ANY($7)
   OR (lps.legal_name    IS NOT DISTINCT FROM EXCLUDED.legal_name
   AND lps.country       IS NOT DISTINCT FROM EXCLUDED.country
   AND lps.contact_email IS NOT DISTINCT FROM EXCLUDED.contact_email)
RETURNING id, (xmax = 0) AS created
```

Four things are load-bearing and must not be "simplified" in review:

- `IS NOT DISTINCT FROM`, not `=` — see Assumptions and Risks.
- `COALESCE($8, lps.notify_on_review)` on the update path, **not** `EXCLUDED.notify_on_review`.
- `COALESCE($8, false)` on the insert path — a bare `$8` writes `NULL` into a `NOT NULL` column.
- The `::boolean` cast, so Postgres can infer the parameter type inside `COALESCE`.

`None` still means "the row existed and the write was refused" — but the refusal now means
*the profile differs on a frozen record*, not merely *the record is frozen*. Rewrite the method's
doc comment accordingly: the `WHERE` is no longer the freeze restated, it is the freeze **narrowed**
to a profile change, and the pure `profile_is_unchanged` in `routes::lps` is where that rule is
stated. Point at it by name, and point at the spec section. Keep the existing paragraphs about
full-replace semantics, `owner_chain_id`/`owner_address` being insert-only, and why the predicate
lives in SQL rather than in a prior read — all three are still true and still the reason this is
shaped the way it is.

Note in the doc comment that `KybDocumentRepo::insert` / `::delete` keep the **un**narrowed
predicate: documents are the evidence, and only the profile comparison is exempted.

`writable_statuses()` is unchanged and still binds `$7`.

### 3. `packages/api/src/routes/lps.rs` — DTOs

**`UpsertLpRequest`** gains:

```rust
/// Absent means *do not change*. Deliberately outside the profile's
/// full-replace semantics: an omitted `country` clears the column, an omitted
/// `notify_on_review` leaves the preference alone.
#[serde(default)]
#[schema(example = true, nullable)]
pub notify_on_review: Option<bool>,
```

`#[derive(Default)]` still works. Update the struct's doc comment: it is no longer purely "a full
replace", it is a full replace of the profile *plus* an optional preference that is not part of it.

**`LpResponse`** gains `pub notify_on_review: bool`, set in `LpResponse::new` from
`row.notify_on_review`. Doc comment: opt-in, emailed on each trustee decision, and **editable at any
`kyb_status`** — explicitly not gated by `writable`.

Extend `LpResponse::writable`'s doc comment to say what it now does *not* cover: it is the freeze on
the profile and documents; `notify_on_review` is outside it.

**`LpSummary` is unchanged.** The trustee listing has no use for an LP's notification preference,
and #1378 reads the flag from `LpRow` server-side, not from a DTO.

### 4. `packages/api/src/routes/lps.rs` — pure compute

Both go in the `// ── Compute (pure) ──` section, `pub` so `packages/api/tests/lps.rs` can drive
them with no HTTP and no DB — the same shape as `validate_profile` / `resolve_document_review`.

```rust
/// The three profile columns the narrowed freeze compares, borrowed from an
/// `LpRow`. A borrowed struct rather than `LpRow` itself so the tests need no
/// `Uuid`/`DateTime` fixtures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoredProfile<'a> {
    pub legal_name: &'a str,
    pub country: Option<&'a str>,
    pub contact_email: &'a str,
}

impl<'a> From<&'a LpRow> for StoredProfile<'a> { /* country: row.country.as_deref() */ }

/// What `POST /v1/lps/me` may do with this request (spec § Review Notifications).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpsertOutcome {
    /// No LP yet, or the LP is writable: full replace plus the preference.
    Write,
    /// Frozen, but the submitted profile is identical: only the preference is written.
    PreferenceOnly,
    /// Frozen and the profile differs: nothing is written.
    Refuse,
}

/// Whether the submitted profile would leave the stored one unchanged.
///
/// Compares the *validated* fields, because those are what would be written —
/// a trimmed resubmission of the same values is not a change. `None == None`
/// on `country` mirrors the SQL's `IS NOT DISTINCT FROM`; `=` there would
/// refuse every frozen LP that has no country.
pub fn profile_is_unchanged(stored: StoredProfile<'_>, submitted: &ValidatedProfile<'_>) -> bool;

/// The narrowed freeze, in one place. `writable` is
/// `KybStatus::allows_owner_writes` for the stored row.
pub fn decide_upsert(
    stored: Option<StoredProfile<'_>>,
    writable: bool,
    submitted: &ValidatedProfile<'_>,
) -> UpsertOutcome;
```

`decide_upsert`: `None` ⇒ `Write`; `writable` ⇒ `Write`; otherwise `profile_is_unchanged` ⇒
`PreferenceOnly`, else `Refuse`.

### 5. `packages/api/src/routes/lps.rs` — `upsert_my_lp`

Replace the `guard_writable(&lp)?` early exit. `guard_writable` itself stays exactly as it is —
`upload_my_documents` and `delete_my_document` still need the wide freeze.

```rust
let profile = validate_profile(&req)?;

// The early exit is for a clear refusal that can name the current status; the
// DB predicate below is what actually enforces the narrowed freeze, because a
// trustee may freeze the record between this read and that write.
if let Some(lp) = state.lp_repo.find_by_owner_account_id(claims.account_id).await? {
    let writable =
        KybStatus::from_str(&lp.kyb_status).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?
            .allows_owner_writes();
    if decide_upsert(Some(StoredProfile::from(&lp)), writable, &profile) == UpsertOutcome::Refuse {
        return Err(ApiError::Conflict(format!(
            "this LP is {} and its profile can no longer be changed; \
             notify_on_review may still be updated",
            lp.kyb_status
        )));
    }
}
```

Parse-failure handling matches `guard_writable`'s (`ApiError::Internal` — the column has a CHECK, so
it cannot occur).

Pass `req.notify_on_review` through to `upsert_by_owner_account_id`. Rewrite the `None` fallback
message, which currently says "this LP is under review and can no longer be changed" — that is now
false in two ways (the LP may be `Passed`/`Failed`, and only the *profile* is refused). It is now
only reachable as a lost race, so say so:

```rust
.ok_or_else(|| ApiError::Conflict(
    "this LP was frozen before the change was applied, and the submitted profile \
     differs from the stored one".to_owned()
))?
```

Everything after — the re-read, `201` vs `200`, `with_documents` — is unchanged. Note that the
frozen-and-identical path yields `created = false` and therefore `200`, which is what the Issue
specifies.

Update the handler's `#[utoipa::path]`:

- `(status = 409, …)` description becomes "the LP is frozen and the submitted profile differs from
  the stored one" (it currently says "KYB is UnderReview or Passed").
- `(status = 200, …)` description: "LP updated, or only the notification preference updated".

Update the handler's doc comment: it is still a full replace of the profile, and it now also carries
a preference that is not part of that replace and is accepted at any `kyb_status`.

### 6. Module header

`routes/lps.rs`'s header lists the two rules governing every owner write. Rule 1 currently reads
"[`KybStatus::allows_owner_writes`] freezes the whole record while `UnderReview` or `Passed`".
Narrow it: the freeze covers the profile and the documents, and `notify_on_review` is exempt because
the preference is not evidence any decision was made about — an LP frozen mid-review must still be
able to opt in to hearing that review's outcome.

Do **not** touch the clause about transitions being #1274's job — that is #1274's line to rewrite,
and editing it here creates a conflict for no benefit.

Respect AGENTS.md § Lint & style: rewrite existing comments, add no new inline ones.

### 7. OpenAPI

No new schema types, so `LpsDoc`'s `components(schemas(...))` and `paths(...)` are unchanged — the
two new fields ride on `UpsertLpRequest` and `LpResponse`, which are already registered.

### 8. Lint

`cargo clippy --all -- -D warnings` must pass. No TypeScript changes; run
`npx tsx scripts/lint-docs.ts` only if a file under `docs/` is touched (see Docs to Update).

## Test Strategy

Pure unit tests only. No test may read `DATABASE_URL`, `POSTGRES_URL`, or any env var, and none may
reach a real Postgres. Rust tests live in `packages/<pkg>/tests/<topic>.rs` — never an inline
`#[cfg(test)] mod tests` in `src/`. This is exactly why `profile_is_unchanged` and `decide_upsert`
are pure functions rather than logic inlined into the handler.

**`packages/shared/tests/kyb_status.rs` — do not touch.** The writable set is unchanged by this
issue, and that file is rewritten wholesale by #1274.

**`packages/api/tests/lps.rs`** (extend; it already has the `form()` helper and `openapi_json()`):

- Update the `form(legal_name, country, contact_email)` helper to set `notify_on_review: None`, and
  add a `form_with_preference(..., Option<bool>)` (or use struct-update over `form(...)`) for the
  cases that need it. Every existing `validate_profile` test must keep passing unchanged.

`profile_is_unchanged`:

- identical values → `true`.
- submitted values that differ only by surrounding whitespace → `true` (they are compared *after*
  `validate_profile` trims, and the trimmed value is what would be written).
- stored `country = None`, submitted `None` → `true`.
- stored `country = None`, submitted `Some("  ")` → `true` (validation collapses blank to `None`) —
  this is the Rust twin of the SQL's `IS NOT DISTINCT FROM`, and the test comment should say so.
- stored `country = None`, submitted `Some("NL")` → `false`.
- stored `country = Some("NL")`, submitted `None` → `false` (an omitted country is a clear).
- `legal_name` differing only in case → `false`; `contact_email` differing only in case → `false`.
  Assert these deliberately, so the case-sensitivity is a decision rather than an accident.
- each of the three fields differing on its own → `false` (three assertions, so a comparison that
  forgets one field cannot pass).

`decide_upsert` — drive the whole table from the Scope section:

- `stored = None`, `writable` either way → `Write`.
- `stored = Some(_)`, `writable = true`, profile changed → `Write`.
- `stored = Some(_)`, `writable = true`, profile identical → `Write`.
- `stored = Some(_)`, `writable = false`, profile identical → `PreferenceOnly`.
- `stored = Some(_)`, `writable = false`, profile changed → `Refuse`.
- One assertion naming the invariant in the message: `Refuse` is reachable **only** when
  `writable == false`, so a writable LP can never be refused a profile edit by this rule.

OpenAPI, via the existing `openapi_json()` helper and `has_type()`:

- `UpsertLpRequest.properties.notify_on_review` has type `boolean` (accept 3.1's
  `["boolean","null"]` union — extend `has_type` or assert against both spellings).
- `notify_on_review` is **not** in `UpsertLpRequest.required` — absent means "do not change", and a
  required field would make every profile edit restate the preference.
- `legal_name` and `contact_email` are still required, and `country` still is not (the existing
  `only_the_entity_fields_are_required` test; extend rather than duplicate it).
- `LpResponse.properties.notify_on_review` has type `boolean` and **is** in `LpResponse.required` —
  it is a non-`Option` field, so a reader never has to handle its absence.

**Not covered, by rule — verify by hand against a local DB before marking PR #1384 ready, and say so
in the PR description.** The SQL predicate is the actual enforcement and none of the above touches
it. At minimum:

1. Frozen LP (`UPDATE lps SET kyb_status = 'UnderReview'`), resubmit the *identical* profile with
   `notify_on_review: true` → `200`, flag flipped, profile untouched.
2. Same, with `country` `NULL` on both sides → `200`. **This is the `IS NOT DISTINCT FROM` case; an
   `=` would 409 here and no unit test can catch it.**
3. Frozen LP, one changed character in `legal_name` → `409`, and `SELECT notify_on_review` shows it
   did **not** move.
4. Frozen LP, `country` stored `NULL` and submitted `"NL"` → `409`, nothing written.
5. Writable LP, full profile change with `notify_on_review` omitted → `200`, profile replaced,
   preference **unchanged** (this is the `EXCLUDED.notify_on_review` trap).
6. New LP with `notify_on_review` omitted → `201`, column is `false`.
7. New LP with `notify_on_review: true` → `201`, column is `true`.
8. Frozen LP, upload a document → still `409` (the narrowing must not have leaked into
   `KybDocumentRepo::insert`).

## Docs to Update

- **`docs/product-specs/kyb-lp-verification.md` — do not add it to this branch while PR #1382 is
  open.** The spec's § "Review Notifications" already establishes the preference and its exemption
  from the freeze, which is what this issue implements. What it does **not** yet state is the
  endpoint-level contract this issue settles: *identical profile on a frozen LP → `200` with only
  the preference written; differing profile → `409` with nothing written*. That is a behavioural
  rule and belongs in the spec's freeze paragraph (§ "LP Entity Registration and KYB Documents",
  which currently says only that "two things sit outside the freeze entirely").
  - If #1382 has **merged** by implementation time: re-read the spec from `main` and add that one
    sentence on this branch.
  - If #1382 is **still open**: do not fork the file. Raise the sentence as a review comment on
    #1382 instead, and note in PR #1384 that the spec sentence is pending there.
- **`docs/exec-plans/active/issue-1377-notify-on-review.md`** — this plan. Append a decision-log
  entry for anything decided during implementation that differs from it, in particular the resolution
  of either Open Question.
- **`docs/frontend/account-page.md` — no change.** Line 27 ("The API's `writable` flag disables
  profile and document writes for `UnderReview` and `Passed`") stays true: the flag still means
  exactly that for the profile and documents, and the file documents *frontend* behaviour, which
  does not change here — there is no toggle in the LP app yet. Whoever files the LP-side toggle UI
  issue extends this line then.
- **No `packages/frontend` changes**, and no generated docs to regenerate (`docs/generated/` holds
  only `stellar-protocol-contracts.md`; there is no checked-in OpenAPI dump).
- Run `npx tsx scripts/lint-docs.ts` if any file under `docs/` is touched.
