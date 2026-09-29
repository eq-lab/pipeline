# Issue #1379: Backend: ungate POST /v1/lps/me/link-address from kyb_status

Source: https://github.com/eq-lab/pipeline/issues/1379

Part of epic #1376 (KYB review lifecycle). Spec of record:
`docs/product-specs/kyb-lp-verification.md` § "Settlement Address" — currently on
branch `docs/kyb-review-lifecycle` (open PR #1382), not yet on `main`.
Read it with `git show origin/docs/kyb-review-lifecycle:docs/product-specs/kyb-lp-verification.md`.

## Scope

`POST /v1/lps/me/link-address` is dead code today. Its update predicate carries
`WHERE kyb_status = 'Passed' AND stellar_address IS NULL`, nothing ever writes
`Passed`, so every call returns `409`. The DB backs the same rule with
`lps_stellar_address_passed_ck CHECK (stellar_address IS NULL OR kyb_status = 'Passed')`.

The rule becomes: **the address may be set at any `kyb_status`, and replaced
freely until KYB passes; once `Passed`, it is fixed.** An LP names its settlement
address when it has one, not when a reviewer happens to have finished.

In scope:

1. **Migration** — drop `lps_stellar_address_passed_ck`. New file, see step 1 for
   the version stamp.
2. **Predicate** — `LpRepo::link_address`'s `WHERE` becomes
   `id = $1 AND (stellar_address IS NULL OR kyb_status <> 'Passed')`.
   `address_linked_at = now()` stays: it is rewritten on each successful set.
3. **Policy as a pure function** — `KybStatus::allows_address_write(has_address)`
   in `packages/shared/src/lp_repo.rs`, the single *statement* of the rule, which
   the SQL restates and the handler pre-checks for a precise `409` message.
4. **Handler** — `link_address` in `packages/api/src/routes/lps.rs` gains that
   pre-check and two distinct `409` messages; it stays **exempt from the
   `writable` freeze** (it already is — it does not call `guard_writable`, and it
   must not start).
5. **Comment cleanup** — four doc comments in `lp_repo.rs` and three in
   `routes/lps.rs` assert the old rule. They become false and must be rewritten,
   not left standing.
6. **TD-57 impact update** in `docs/exec-plans/tech-debt-tracker.md` — the gap
   changes from theoretical (unreachable endpoint) to live.

Unchanged, deliberately:

- **Uniqueness across LPs.** `lps.stellar_address` stays `UNIQUE`; a second LP
  claiming an address another LP currently holds still gets `409` via the
  existing `is_unique_violation` branch.
- **Authorization.** `/me` + `owner_account_id`. No change.
- **The route path.** It is still `link-address` even though it now also
  replaces. Nothing consumes it yet (no frontend caller —
  `grep -rn "link-address\|linkAddress" packages/frontend/src` is empty), but
  renaming a public path buys nothing.
- **Response shape.** `LpResponse` gains no field.

Out of scope — each is a sibling sub-issue of #1376, do not touch:

- The state machine, `POST /v1/lps/me/submit`, the trustee verdict endpoint → **#1274**
- `notify_on_review` and the narrowed write freeze → **#1377**
- Decision emails → **#1378**
- Making `accounts.status = 'Suspended'` actually gate requests → **#1380**
- **Proof of address ownership (TD-57).** Do **not** add a signature check here
  and do **not** close TD-57. See Security below.
- EVM settlement addresses. An LP models a Stellar address only.
- LP-app and Trustee-dashboard UI.

## Security — read before implementing

After this change, **authorization is the only control on this endpoint**. `/me`
plus `owner_account_id` means only the account owning an LP can set that LP's
address. Pipeline still does **not** require proof that the LP controls the key
behind the address it names. That is **TD-57**, it is a deliberate product
decision made by the user, and it **stays open**.

- Do not plan or write a signature/challenge check here. It would need self-serve
  wallet-to-account linking first, which does not exist.
- Do not mark TD-57 resolved. Only its **Impact** paragraph changes, because the
  gap stops being theoretical: until now the endpoint could not be reached at
  all, and the blast radius widens further — an address can now be entered
  *before* any review has looked at the entity, and a wrong entry both misdirects
  settlement and, through the UNIQUE column, denies that address to its real
  holder.

## Merge sequencing — settle this before merging, not after

Today this endpoint is unreachable. **#1274 is what first makes `Passed`
reachable**, and the moment it merges the OLD gating becomes live for the first
time ever.

| Order | Result |
|---|---|
| **#1379 before #1274** | **Zero window.** `Passed` is still unreachable, so `kyb_status <> 'Passed'` is always true and the endpoint behaves exactly as the final spec intends for every LP that can exist. The CHECK is dropped before any row could contend with it. |
| **Co-merge** | Same result, more coupling between two PRs that are otherwise independent. |
| **#1274 before #1379** | A live window in which the *old, stricter* gate applies: an LP cannot name an address until it passes, and — the real cost — an address typo'd during that window is **permanently uncorrectable through the API**, because the old predicate is one-shot (`stellar_address IS NULL`) and the new one also refuses a replace once `Passed`. Correcting it is manual DB intervention. |

**Recommendation: merge this PR before #1274, or in the same batch. Do not merge
it after.** This issue has no dependency on #1274 whatsoever — it is correct on
`main` as it stands — so there is no technical reason to sequence it second. This
also answers #1274's Open Question 1 ("co-merge or land immediately after"):
neither is needed if #1379 goes first.

## Migration version ordering

`sqlx::migrate!("../shared/migrations")` (`packages/api/src/main.rs:46`), sqlx
0.8.6. Two facts about the runner, verified in
`sqlx-core-0.8.6/src/migrate/migrator.rs`:

- **Out-of-order application is tolerated.** `run()` applies any resolved version
  not already in `_sqlx_migrations`, regardless of whether a higher version has
  already been applied. It only errors on a checksum mismatch for an applied
  version (`VersionMismatch`).
- **Renaming an applied migration is fatal.** `validate_applied_migrations` runs
  with `ignore_missing = false`, so an applied version that no longer resolves to
  a file raises `VersionMissing`. A rename changes the version (the filename
  prefix), so **any rename must happen before merge/deploy**, never after.

Sibling plans reserve `20260929000001` (#1274) and `20260929000002` (#1377).
Neither branch has committed its migration file yet — both are still plans — so
verify before writing:

```bash
git ls-tree --name-only origin/feat/1274-kyb-state-machine packages/shared/migrations/ | tail -3
git ls-tree --name-only origin/feat/1377-notify-on-review  packages/shared/migrations/ | tail -3
git ls-tree --name-only origin/main                        packages/shared/migrations/ | tail -3
```

**Take `20260929000003_drop_lps_stellar_address_passed_ck.sql`.** If a sibling has
claimed that stamp by implementation time, bump to the next free one and say so in
the PR. Out-of-order relative to #1274/#1377 is harmless here on the merits: this
migration drops one CHECK on `lps` and touches nothing either sibling touches, so
the three are statement-independent in either application order.

## Assumptions and Risks

- **The spec is unmerged.** PR #1382 carries § Settlement Address. If it changes
  before merge, re-read it. Its decisions were settled with the user — do not
  re-litigate them.
- **Dropping the CHECK leaves the rule enforced in exactly one place.** That is
  unavoidable, not a shortcut: "replaceable until `Passed`" is a *transition*
  rule over (old row, new row), which no `CHECK` can express — it would take a
  trigger. So the `UPDATE … WHERE` predicate becomes the sole enforcement, which
  is why the policy is also written once as a pure function and why the SQL must
  be a faithful restatement of it.
- **Re-linking the identical address to a `Passed` LP returns `409`.** The
  predicate says "a replace attempt on a `Passed` LP returns 409", and setting the
  same value is literally a replace attempt. Consequence: a client that retries
  after a dropped response gets `409` on an operation that in fact succeeded. This
  is accepted as-is — a no-op-success special case would put a second, subtler
  rule in the predicate. The client distinguishes the two with `GET /v1/lps/me`.
- **A `Passed` LP with no address can still set one.** The `stellar_address IS
  NULL` half of the predicate carries this. Without it, an LP that passes KYB
  before ever naming an address would be locked out permanently. Verify it by hand
  (manual check 6) — it is the least obvious branch of the new predicate.
- **Replacing an address frees the old one.** The column is overwritten, so the
  previous value becomes claimable by another LP. That follows from `UNIQUE` on a
  mutable column and is intended; it is also the reason a *hostile* entry burns an
  address only for as long as the squatting LP keeps it. Worth one line in the PR
  description.
- **#1274 and this branch both edit `KybStatus`'s doc comments in
  `packages/shared/src/lp_repo.rs`** (that block names
  `lps_stellar_address_passed_ck`). A textual conflict, easy to resolve, but real.
  New tests go in a **new** file rather than `packages/shared/tests/kyb_status.rs`,
  which #1274 rewrites wholesale — see Test Strategy.
- **After this change `writable: false` no longer means "nothing on this record is
  editable"** — the settlement address stays editable while `UnderReview`, and
  after #1377 so does `notify_on_review`. Whether the LP app needs an explicit
  signal beyond `writable` is #1377's Open Question 2; it is not re-asked here and
  needs no work in this issue.
- **No integration coverage, by rule.** Tests must not read `DATABASE_URL`,
  `POSTGRES_URL` or any env var, and must not reach a real Postgres. So the SQL
  predicate and the dropped constraint — the actual enforcement — cannot be
  automatically covered. The manual checklist below is the compensating control
  and must actually be run before the PR leaves draft.

## Open Questions

1. **Confirm the merge order.** This plan requires PR #1386 to merge **before**
   #1274, or in the same batch. Merging it after #1274 opens a window whose
   failure mode is irreversible through the API (an address linked during it can
   never be corrected). Confirm that ordering is acceptable, since the merge is a
   human action across two PRs and this plan cannot execute it.

## Implementation Steps

### 1. Migration

Add `packages/shared/migrations/20260929000003_drop_lps_stellar_address_passed_ck.sql`
(verify the stamp is free first — see "Migration version ordering").

House style, following `20260924000001_kyb_documents_untyped_and_storage.sql`: a
module comment stating the intent, the inverse SQL in a comment (migrations are
forward-only), every statement written to survive a re-run.

```sql
ALTER TABLE lps DROP CONSTRAINT IF EXISTS lps_stellar_address_passed_ck;
```

The comment must record, in prose:

- why the constraint goes: an LP names its settlement address when it has one,
  not when a reviewer has finished;
- that the replacement rule ("replaceable until `Passed`, fixed after") is a
  transition rule and therefore **cannot** be re-expressed as a `CHECK` — it
  lives in `LpRepo::link_address`'s `UPDATE … WHERE` predicate, which is now the
  only enforcement;
- the inverse, with its caveat:
  `ALTER TABLE lps ADD CONSTRAINT lps_stellar_address_passed_ck CHECK (stellar_address IS NULL OR kyb_status = 'Passed');`
  — which will fail on any row that linked an address before passing.

**Do not edit `20260915000001_kyb_lps_and_documents.sql`.** It is applied
everywhere; changing a byte of it changes its checksum and every deploy then
fails with `VersionMismatch`. Its lines 4–6, 15–16 and 43 describe behaviour this
migration supersedes, and they stay exactly as they are — the new migration's
comment is where the correction is recorded.

### 2. `shared::lp_repo::KybStatus` — the policy, stated once

In `packages/shared/src/lp_repo.rs`, in the `impl KybStatus` block:

```rust
/// Whether the settlement address may be written now — `has_address` is
/// whether one is already linked (spec § Settlement Address).
///
/// It may be set at any status, and replaced freely until KYB passes; once
/// `Passed` it is fixed, because downstream systems treat it from then on as
/// the account money moves to. Mirrored by the
/// `stellar_address IS NULL OR kyb_status <> 'Passed'` predicate in
/// [`LpRepo::link_address`], which is what actually enforces it — this is
/// where the rule is *stated*, and the SQL must keep restating it faithfully.
pub fn allows_address_write(&self, has_address: bool) -> bool {
    !has_address || *self != KybStatus::Passed
}
```

Total over every variant, pure, no DB. Deliberately **not** folded into
`allows_owner_writes`/`OWNER_WRITABLE`: this endpoint is exempt from the write
freeze, so reusing that set would couple two rules that must move independently
(and #1377 narrows the freeze further).

### 3. `LpRepo::link_address`

Same file. Only the `WHERE` changes:

```rust
pub async fn link_address(&self, id: i64, stellar_address: &str) -> Result<bool, sqlx::Error> {
    let affected = sqlx::query(
        "UPDATE lps SET stellar_address = $2, address_linked_at = now(), updated_at = now() \
         WHERE id = $1 AND (stellar_address IS NULL OR kyb_status <> 'Passed')",
    )
    ...
}
```

Note the parentheses — without them the `OR` swallows the `id = $1` conjunct and
the statement rewrites every LP in the table. This is the single highest-risk line
in the issue; an assertion cannot catch it, so read it twice and cover it in
manual check 1.

Rewrite the method doc comment, which currently says "Link a Stellar address to an
LP whose KYB has passed… Only rows with `kyb_status = 'Passed'` and no address
linked yet are updated". It must now say: sets or replaces; refused only when the
LP is `Passed` *and* already holds an address; `address_linked_at` is rewritten on
every successful set; the returned `bool` distinguishes "fixed" from success; a
unique violation (another LP holds this address) still surfaces as a DB error for
the caller to map to `409`.

### 4. Comment cleanup in `lp_repo.rs` (do not skip)

Three more places assert the dropped rule:

- **Module header, line 5** — "identified internally by `id`, not by wallet, until
  KYB passes and the LP links a Stellar account via `link_address`". The linking is
  no longer tied to passing.
- **`KybStatus` doc, lines 25–26** — "`stellar_address` may only be set once this
  reaches `Passed` (enforced by the `lps_stellar_address_passed_ck` DB
  constraint)". Both halves are now false and the named constraint no longer
  exists. Replace with a pointer to `allows_address_write`.
- **`LpRow::stellar_address`, line ~113** — "Set only once `kyb_status` is
  `Passed`". Now: set at any status, fixed once `Passed`.

Stay inside the repo comment budget (AGENTS.md § Lint & style): rewrite existing
doc comments on public items, add no new inline comments.

### 5. Handler — `packages/api/src/routes/lps.rs`

In `link_address`, after `let lp = my_lp(&claims, &state).await?;` and before the
repo call:

```rust
let status =
    KybStatus::from_str(&lp.kyb_status).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
if !status.allows_address_write(lp.stellar_address.is_some()) {
    return Err(ApiError::Conflict(format!(
        "LP {} has passed KYB; its settlement address is fixed",
        lp.id
    )));
}
```

(`ApiError::Internal` on an unparseable stored status matches what `guard_writable`
already does; the column has a CHECK, so it cannot occur.)

The existing post-call branch stays, with a message that now means something
different — a lost race against a concurrent verdict, the SQL predicate being the
authority:

```rust
if !linked {
    return Err(ApiError::Conflict(format!(
        "LP {} is no longer eligible to set a settlement address",
        lp.id
    )));
}
```

Leave everything else alone: `validate_stellar_address`, the `is_unique_violation`
→ `409` branch, the re-read through `find` + `with_documents`, and in particular
the **absence** of a `guard_writable` call. The exemption from the freeze is the
point — add a clause to the handler's doc comment saying so, so nobody "fixes" the
missing guard later.

Rewrite the handler doc comment, which currently reads "LP ties a Stellar account
after KYB passes. One-shot: only an LP with `kyb_status = Passed` and no address
linked yet is eligible. Deliberately not folded into `upsert_my_lp`: it requires
`Passed`, which is exactly when the upsert is frozen." The new reason it is not
folded into `upsert_my_lp` is the freeze exemption: the address is not evidence a
review decision was made about, so it stays settable while the profile is frozen.

Update the `#[utoipa::path]` `409` description — currently "KYB has not passed, an
address is already linked, or stellar_address belongs to another LP" → "This LP's
KYB has passed and its address is fixed, or stellar_address belongs to another
LP".

### 6. Comment cleanup in `routes/lps.rs` (do not skip)

- **Module header, line 12** — "`POST /v1/lps/me/link-address` ties a Stellar
  account once KYB passes" → sets or replaces the settlement account, at any
  status, fixed once `Passed`.
- **Module header, the two numbered freeze rules (~lines 27–33)** — point 1 says
  the gate "reads `kyb_status` and never writes it — transitions are #1274's job,
  so this gate is inert until that lands". #1274 owns rewriting that sentence; do
  not fight it here. What this issue must add is the exemption: the settlement
  address sits outside the freeze, because it is not evidence a decision was made
  about. Keep the edit minimal and confined to that clause to limit the conflict
  surface with #1274 and #1377, both of which also edit this header.
- **Module header, lines 38–41** — the `stellar_address`/TD-57 paragraph. Still
  true, but strengthen: authorization is now the *only* control, since no status
  gate remains.

### 7. Lint

`cargo clippy --all -- -D warnings` must pass. `docs/` is touched (step 9), so run
`npx tsx scripts/lint-docs.ts` too.

### 8. Manual verification (required — this is the only coverage the enforcement gets)

Against a local Postgres, before the PR leaves draft. Statuses that are not
reachable yet (`Passed`) are set by direct `UPDATE`, since #1274 is not merged.

1. `NotStarted` LP sets an address → `200`; `stellar_address` and
   `address_linked_at` are set. Then confirm **no other `lps` row changed** — this
   is the check that catches a missing parenthesis in the predicate.
2. Same LP sets a *different* address → `200`; the column is replaced and
   `address_linked_at` is strictly greater than before.
3. The abandoned address from (2) is claimable: a second LP sets it → `200`.
4. A second LP claims an address another LP *currently* holds → `409`, via the
   unique-violation branch, with the "already linked to another LP" message.
5. `UPDATE lps SET kyb_status = 'Passed'` on an LP that holds an address → a
   replace attempt returns `409` with the "settlement address is fixed" message,
   and the row is unchanged. Re-sending the **same** address also returns `409`
   (documented behaviour, see Assumptions).
6. An LP at `Passed` with `stellar_address IS NULL` → setting one succeeds
   (`200`); a subsequent replace returns `409`.
7. The constraint is gone: an LP at `NotStarted` with an address linked exists in
   the table and `\d lps` no longer lists `lps_stellar_address_passed_ck`.
8. Freeze exemption: an LP at `UnderReview` (`writable: false` in `GET
   /v1/lps/me`) still sets its address → `200`, while `POST /v1/lps/me` on the
   same LP still returns `409`.

Record the outcome in the PR description.

## Test Strategy

Pure unit tests only — **no** test may read `DATABASE_URL`, `POSTGRES_URL` or any
env var, and none may reach a real Postgres. Rust tests live in
`packages/<pkg>/tests/<topic>.rs`; never an inline `#[cfg(test)] mod tests` inside
`src/`. That constraint is exactly why the policy is factored as
`allows_address_write` instead of living only in the SQL.

**New file `packages/shared/tests/settlement_address.rs`** — a new topic file, not
an extension of `packages/shared/tests/kyb_status.rs`, which #1274 rewrites
wholesale (avoid the conflict). Module comment naming the spec section and this
issue.

- `an_unlinked_lp_may_set_an_address_at_any_status` — for every status, with
  `has_address = false`, the write is allowed. This is the whole point of the
  issue and must fail loudly if the gate ever comes back.
- `a_linked_address_may_be_replaced_until_kyb_passes` — every status except
  `Passed`, with `has_address = true`, allows the write.
- `a_passed_lp_freezes_its_address` — `Passed` + `has_address = true` refuses;
  `Passed` + `has_address = false` **allows** (an LP that passed before naming an
  address must not be locked out).
- `the_policy_is_total_and_classifies_every_status_deliberately` — drive
  `allows_address_write` across every status × `{true, false}` against a local
  expectation helper written as an **exhaustive `match`** on `KybStatus`:

  ```rust
  fn expected(status: KybStatus, has_address: bool) -> bool {
      match status {
          KybStatus::NotStarted
          | KybStatus::InProgress
          | KybStatus::UnderReview
          | KybStatus::Failed => true,
          KybStatus::Passed => !has_address,
      }
  }
  ```

  The match is the mechanism: when #1274 adds `ChangesRequested`, this file stops
  compiling until someone classifies the new status on purpose. Say so in the
  assertion message.
- `the_policy_is_independent_of_the_write_freeze` — assert
  `allows_address_write` is `true` for a status where `allows_owner_writes` is
  `false` (`UnderReview`), pinning the exemption as a decision rather than an
  accident.

**`packages/api/tests/lps.rs`** (extend, using the existing `openapi_json()` and
`has_type` helpers):

- `POST /v1/lps/me/link-address` is still present in the document and still
  documents `200`/`400`/`401`/`404`/`409`.
- `LinkAddressRequest` exposes `stellar_address` as a required string.
- The `409` description no longer claims KYB must have passed — assert on the
  text, since that string is the endpoint's public contract and is the thing most
  likely to be left stale.

**Explicitly not covered, and stated as such in the PR description:** the
`UPDATE … WHERE` predicate itself, the constraint drop, the uniqueness `409`, and
the freeze exemption end to end. Those are the manual checklist in step 8.

## Docs to Update

- **`docs/exec-plans/tech-debt-tracker.md` — TD-57 (required).** Do **not** mark
  it resolved and do not change its **Suggested fix**. Update the **Date** line
  with a "widened <today>" note in the existing style ("narrowed 2026-09-15 — see
  below"), and rewrite the **Impact** paragraph: the endpoint was unreachable
  (`kyb_status = 'Passed'` was never true), so the gap was theoretical; #1379
  removes the status gate and #1274 makes the status reachable, so it is now
  live. Add that the exposure widens in two ways — an address can be recorded
  *before* any review has looked at the entity, and authorization is the only
  remaining control on the endpoint. Also correct the stale mechanism in the
  **Gap** paragraph: it still describes `lp_owner_guard` matching JWT
  `(chain_id, sub)` against `lps.(owner_chain_id, owner_address)`; the endpoint is
  now `/me`-keyed on `owner_account_id` (`my_lp`), and `owner_chain_id`/
  `owner_address` are history, not authorization (TD-82).
- **`docs/product-specs/kyb-lp-verification.md`** — no content change. PR #1382 §
  Settlement Address already specifies this exactly ("may be set at any KYB
  status, and replaced freely until KYB passes; once `Passed` the address is
  fixed"). If #1382 has merged by implementation time, re-read it from `main` and
  confirm nothing drifted; if it has not, **this branch must not duplicate the
  spec file**.
- **`docs/exec-plans/active/issue-1379-ungate-link-address.md`** — this plan;
  append a decision log entry for anything decided during implementation that
  differs from it, and record the manual-verification outcome.
- **No frontend or user-docs changes.** Nothing in `packages/frontend/src` calls
  this endpoint.
- Run `npx tsx scripts/lint-docs.ts` after touching `docs/`.
