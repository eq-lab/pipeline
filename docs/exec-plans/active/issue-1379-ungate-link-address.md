# Issue #1379: Backend: ungate POST /v1/lps/me/link-address from kyb_status

Source: https://github.com/eq-lab/pipeline/issues/1379

Part of epic #1376 (KYB review lifecycle). Spec of record:
`docs/product-specs/kyb-lp-verification.md` § "Settlement Address" — **merged to
`main`** in PR #1382 (commit `d509486`). Read it from the working tree. The
branch `docs/kyb-review-lifecycle` is deleted; do not try to read it from a ref.

> **Revised 2026-09-30 after the review of #1382, and again the same day once
> Open Question 2 was answered.** `Failed` now closes the settlement-address
> endpoint **outright** — whether or not an address is already stored — and
> `Passed` fixes whatever address is already held. The single-status form
> (`kyb_status <> 'Passed'`) this plan originally carried is wrong and must not
> be implemented, and neither is the intermediate two-status form
> (`kyb_status NOT IN ('Passed','Failed')` *inside* the `IS NULL` disjunction),
> which still lets a `Failed` LP with no address through. See "Why `Failed`
> closes the endpoint" below, and read step 3 before writing any SQL.

## Scope

`POST /v1/lps/me/link-address` is dead code today. Its update predicate carries
`WHERE kyb_status = 'Passed' AND stellar_address IS NULL`, nothing ever writes
`Passed`, so every call returns `409`. The DB backs the same rule with
`lps_stellar_address_passed_ck CHECK (stellar_address IS NULL OR kyb_status = 'Passed')`.

The rule becomes: **the address may be set at any `kyb_status` short of a
terminal verdict, and replaced freely until the decision is final. `Passed` fixes
the address the LP already holds — an LP that passed before naming one may still
name it once. `Failed` closes the endpoint outright, address or no address.** An
LP names its settlement address when it has one, not when a reviewer happens to
have finished.

In scope:

1. **Migration** — drop `lps_stellar_address_passed_ck`. New file, see step 1 for
   the version stamp.
2. **Predicate** — `LpRepo::link_address`'s `WHERE` becomes
   `id = $1 AND kyb_status <> 'Failed' AND (stellar_address IS NULL OR kyb_status <> 'Passed')`.
   The `Failed` exclusion sits **outside** the disjunction, and that placement is
   load-bearing — see step 3. `address_linked_at = now()` stays: it is rewritten
   on each successful set.
3. **Policy as a pure function** — `KybStatus::allows_address_write(has_address)`
   in `packages/shared/src/lp_repo.rs`, the single *statement* of the rule, which
   the SQL restates and the handler pre-checks for a precise `409` message.
   `Failed` is classified closed **unconditionally**; `Passed` closed only once an
   address is held (see below).
4. **Handler** — `link_address` in `packages/api/src/routes/lps.rs` gains that
   pre-check and three distinct `409` messages (refused at KYB / address fixed /
   lost a race); it stays **exempt from the `writable` freeze** (it already is —
   it does not call `guard_writable`, and it must not start).
5. **Comment cleanup** — four doc comments in `lp_repo.rs` and **four** in
   `routes/lps.rs` assert the old rule. They become false and must be rewritten,
   not left standing. One of the four in `routes/lps.rs` —
   `LpResponse::stellar_address` — is rendered into the published OpenAPI
   document, so it is a public contract, not just a comment.
6. **TD-57 impact update** in `docs/exec-plans/tech-debt-tracker.md` — the gap
   changes from theoretical (unreachable endpoint) to live.
7. **Spec amendment** — `docs/product-specs/kyb-lp-verification.md` §
   "Settlement Address" says the address "may be set at any KYB status", which
   under this rule is false for `Failed`. One sentence group is rewritten; see
   step 9.

Unchanged, deliberately:

- **Uniqueness across LPs.** `lps.stellar_address` stays `UNIQUE`; a second LP
  claiming an address another LP currently holds still gets `409` via the
  existing `is_unique_violation` branch. That the column is unique *and* mutable
  is the whole reason `Failed` has to close the address — see below.
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

## Why `Failed` closes the endpoint

This is the one substantive change from the plan's first revision, and the
reasoning has to survive in the code, not just here.

The original rule fixed the address only at `Passed`. A terminally refused LP
never reaches `Passed` — so under that rule it kept **unlimited** write access to
a column that is `UNIQUE` across every LP in the system. A rejected applicant
could point `stellar_address` at an address belonging to a real LP, then the
next, then the next; each write it holds is an address its true holder can never
claim, because the unique index refuses them with `409`. That is verbatim the
harm the spec's own § Security Considerations names ("a hostile one also burns
the address for its real holder, since the column is unique across LPs"), and the
terminal verdict did nothing whatsoever to stop it. Closing the write at `Failed`
costs one status in a list and removes the entire attack.

### `Passed` and `Failed` are not symmetric — this is the crux

They close the endpoint for different reasons, and the difference decides what
happens to an LP that reaches a verdict **without** ever having named an address.

- **`Passed` with no address → allowed, exactly once.** It *must* be. An LP that
  passes KYB before naming an address would otherwise be locked out forever, and
  it has a real, ongoing use for the field — it will settle, and money has to go
  somewhere. Refusing here would break a legitimate user with no security gain.
- **`Failed` with no address → refused.** A refused LP is terminal: it will never
  settle and will never receive funds, so there is **no legitimate use** for the
  write at all. Permitting it buys exactly nothing — and still permits one burn
  of a real LP's address through the `UNIQUE` constraint. Zero benefit against
  nonzero harm decides it; that is the whole argument, and it does not depend on
  how large the harm is.

So `allows_address_write` is `false` for `Failed` unconditionally, and
`!has_address` for `Passed`. The two terminal statuses genuinely differ, and any
code or test that treats them as one case is wrong — including the tempting
`NOT IN ('Passed', 'Failed')` spelling, which quietly makes them identical. See
step 3.

**The rule deliberately does not lean on account suspension.** `Failed` also sets
`accounts.status = 'Suspended'`, and a suspended account should never reach this
handler at all — but suspension is enforced **nowhere** today (that is #1380, and
the spec says so explicitly: "which today means nothing"). An invariant this
cheap must not be contingent on another issue having landed. Both controls should
exist; this one holds on its own either way. Do not "simplify" it away when #1380
merges.

Note the resulting shape, because it is counter-intuitive and a reader will be
tempted to collapse it:

| Status | `allows_owner_writes` (profile/docs) | `allows_address_write` (settlement address) |
|---|---|---|
| `NotStarted` | open | open |
| `InProgress` | open | open |
| `UnderReview` | **frozen** | **open** (freeze exemption) |
| `Passed` | frozen | closed **once an address is held** — a first write is still allowed |
| `Failed` | **open** (the record reopens) | **closed unconditionally** |

Neither set is a subset of the other — they cross at `UnderReview` and again, in
the opposite direction, at `Failed`. Step 2's instruction not to fold
`allows_address_write` into `OWNER_WRITABLE` is therefore not a stylistic
preference: the two policies are genuinely different functions of the same enum,
and expressing one in terms of the other is not possible without a fudge.

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
  holder. The `Failed` close bounds the worst case — a refused applicant cannot
  keep cycling through other LPs' addresses — but it does not close TD-57, which
  is about an LP proving it controls the address it names at all.

## Merge sequencing — settle this before merging, not after

Today this endpoint is unreachable. Verified on `main` at revision time: **nothing
anywhere writes `lps.kyb_status`** — `grep -rn "kyb_status" packages/api/src
packages/shared/src` shows only reads, binds and the column list; every row sits
at the `NotStarted` column default. So neither `Passed` nor `Failed` is reachable
today. **#1274 is what first makes both reachable**, and the moment it merges the
OLD gating becomes live for the first time ever.

| Order | Result |
|---|---|
| **#1379 before #1274** | **Zero window.** Neither terminal status is reachable, so both terminal clauses of the predicate are vacuously true and the endpoint behaves exactly as the final spec intends for every LP that can exist. The CHECK is dropped before any row could contend with it. |
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

**Re-verified 2026-09-30** (after `main` moved for the #1382 spec merge): all
three branches — `origin/main`, `origin/feat/1274-kyb-state-machine`,
`origin/feat/1377-notify-on-review` — still end at
`20260924000001_kyb_documents_untyped_and_storage.sql`. Nothing has taken
`20260929000003`, and in fact neither sibling has committed a migration file at
all yet. Re-run the three `git ls-tree` commands above anyway at implementation
time; they are cheap and the branches move.

**Take `20260929000003_drop_lps_stellar_address_passed_ck.sql`.** If a sibling has
claimed that stamp by implementation time, bump to the next free one and say so in
the PR. Out-of-order relative to #1274/#1377 is harmless here on the merits: this
migration drops one CHECK on `lps` and touches nothing either sibling touches, so
the three are statement-independent in either application order.

## Assumptions and Risks

- **The spec is merged** (PR #1382, `main` commit `d509486`). Read
  `docs/product-specs/kyb-lp-verification.md` § Settlement Address from the
  working tree. Its decisions were settled with the user — do not re-litigate
  them, and in particular do not restore the single-status rule.
- **Dropping the CHECK leaves the rule enforced in exactly one place.** That is
  unavoidable, not a shortcut: "replaceable until `Passed`" is a *transition*
  rule over (old row, new row), which no `CHECK` can express — it would take a
  trigger. So the `UPDATE … WHERE` predicate becomes the sole enforcement, which
  is why the policy is also written once as a pure function and why the SQL must
  be a faithful restatement of it.
- **Re-linking the identical address to a `Passed`/`Failed` LP returns `409`.**
  The predicate says "a replace attempt on a terminal LP returns 409", and
  setting the same value is literally a replace attempt. Consequence: a client that retries
  after a dropped response gets `409` on an operation that in fact succeeded. This
  is accepted as-is — a no-op-success special case would put a second, subtler
  rule in the predicate. The client distinguishes the two with `GET /v1/lps/me`.
- **A `Passed` LP with no address can still set one; a `Failed` LP cannot.** The
  `stellar_address IS NULL` disjunct carries the `Passed` case — without it, an
  LP that passed before ever naming an address would be locked out permanently.
  The separate `kyb_status <> 'Failed'` conjunct is what stops that same disjunct
  from also letting a refused LP through. These are the two least obvious cells
  of the predicate and they pull in opposite directions, which is why they are
  written as two structurally different clauses rather than one list of statuses.
  Verify both by hand (manual checks 6 and 6b).
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

1. ~~**Confirm the merge order.**~~ **Answered 2026-09-30:** this issue lands
   **before #1274, or in the same batch** — never after. Nothing further is
   needed from a human on this point; the constraint is recorded in "Merge
   sequencing" above and must be honoured when the PRs are merged. It also
   settles #1274's own Open Question 1.

2. ~~**May a `Failed` LP that has never linked an address link one?**~~
   **Answered 2026-09-30: no — refuse.** A `Failed` LP cannot set a settlement
   address at all, whether or not one is already stored. The reasoning is
   recorded in "`Passed` and `Failed` are not symmetric" above: a `Passed` LP
   with no address has a legitimate, ongoing use for the write and would
   otherwise be locked out forever; a `Failed` LP is terminal, will never settle
   and will never receive funds, so the write buys nothing while still permitting
   one burn of a real LP's address through the `UNIQUE` column.

   Two consequences, both already folded into the steps below: the predicate
   needs the `Failed` exclusion **outside** the `IS NULL` disjunction (step 3),
   and the merged spec's "may be set at any KYB status" is now inaccurate and is
   amended by this PR (step 9).

_No open questions remain._

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
- that the replacement rule ("replaceable until the decision is final; `Passed`
  fixes the address already held, `Failed` refuses outright") is a transition
  rule and therefore **cannot** be re-expressed as a `CHECK` — it lives in
  `LpRepo::link_address`'s `UPDATE … WHERE` predicate, which is now the only
  enforcement;
- one clause on why `Failed` closes the endpoint outright rather than merely
  fixing what is stored — a unique, mutable column plus an applicant with
  nothing left to lose and no legitimate use for the field — and that this does
  **not** rely on account suspension (#1380), which is enforced nowhere yet;
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
/// It may be set at any status short of a terminal verdict, and replaced
/// freely until the decision is final. `Passed` fixes the address already
/// held — downstream systems treat it from then on as the account money moves
/// to — but an LP that passed before naming one may still name it once.
/// `Failed` refuses outright: the column is UNIQUE across LPs, so a refused
/// applicant left writable could burn real LPs' addresses, and a refused LP
/// will never settle, so even a first write buys nothing. That does not lean
/// on the suspension `Failed` also sets (#1380), which is enforced nowhere
/// yet. Mirrored by the
/// `kyb_status <> 'Failed' AND (stellar_address IS NULL OR kyb_status <> 'Passed')`
/// predicate in [`LpRepo::link_address`], which is what actually enforces it —
/// this is where the rule is *stated*, and the SQL must keep restating it
/// faithfully.
pub fn allows_address_write(&self, has_address: bool) -> bool {
    match self {
        KybStatus::Failed => false,
        KybStatus::Passed => !has_address,
        KybStatus::NotStarted | KybStatus::InProgress | KybStatus::UnderReview => true,
    }
}
```

Write it as an **exhaustive `match`**, not as a boolean expression. Two reasons,
and they are the same two that make the test helper a `match`: the three cases
genuinely differ (`Failed` ignores `has_address`, `Passed` consumes it, the rest
ignore it the other way), so a `!has_address || …` one-liner has to smuggle that
asymmetry into operator precedence; and when #1274 adds `ChangesRequested` the
compiler stops the build until someone classifies it. No `_ =>` arm, here or in
the test.

Total over every variant, pure, no DB. Deliberately **not** folded into
`allows_owner_writes`/`OWNER_WRITABLE`, and after this revision that is not a
judgement call: `Failed` **is** in `OWNER_WRITABLE` (the record reopens so the
owner is not permanently stuck) while being closed here, and `UnderReview` is
the reverse. The two sets cross in both directions — see the table in "Why
`Failed` closes the endpoint" — so neither can be expressed in terms of the
other. #1377 narrows the freeze further still.

### 3. `LpRepo::link_address`

Same file. Only the `WHERE` changes:

```rust
pub async fn link_address(&self, id: i64, stellar_address: &str) -> Result<bool, sqlx::Error> {
    let affected = sqlx::query(
        "UPDATE lps SET stellar_address = $2, address_linked_at = now(), updated_at = now() \
         WHERE id = $1 AND kyb_status <> 'Failed' \
           AND (stellar_address IS NULL OR kyb_status <> 'Passed')",
    )
    ...
}
```

**There are two independent ways to get this line wrong. Both are silent.**

**Trap 1 — the `Failed` exclusion must sit outside the disjunction.** The
obvious spelling of "the address is fixed at `Passed` or `Failed`" is
`(stellar_address IS NULL OR kyb_status NOT IN ('Passed', 'Failed'))`, and it is
**wrong**: the `stellar_address IS NULL` disjunct short-circuits the whole
parenthesis, so a `Failed` LP that has never linked an address sails straight
through and gets its one write — exactly the cell Open Question 2 closed.
`Failed` is unconditional, `Passed` is conditional on `has_address`, so they
cannot share a status list; the `Failed` test has to be its own conjunct. Note
what this means for coverage: **a `Failed`-with-address test does not catch this
bug** — that row is refused by the `IS NULL` disjunct being false either way.
Only a `Failed`-*without*-address test catches it. That asymmetry is why the test
plan below insists on all four terminal combinations rather than two.

**Trap 2 — the parentheses.** The current line (`WHERE id = $1 AND kyb_status = 'Passed' AND stellar_address IS
NULL`, `packages/shared/src/lp_repo.rs:257`) is a flat conjunction, so this change
introduces the repo's first `OR` inside an `UPDATE … WHERE`. **The parentheses are
still the single highest-risk characters in the issue.** `AND` binds tighter than
`OR`, so dropping them re-parses the clause as
`… AND kyb_status <> 'Failed' AND (id = $1 AND stellar_address IS NULL) OR kyb_status <> 'Passed'`
— which rewrites **every LP that is not `Passed`**, i.e. on `main` today, where
nothing writes `kyb_status`, literally every row in the table. No assertion
catches it: `rows_affected() > 0` is still true.
Read the line twice and cover it in manual check 1, which exists only for this.

Keep the two-clause shape as written above — it is the clause-for-clause
transcription of the `match` in step 2 (`Failed => false` is the standalone
conjunct; `Passed => !has_address` is the parenthesised disjunction), and that
correspondence is the property that keeps the Rust statement of the rule and its
SQL restatement from drifting. Do **not** reach for
`KybStatus::owner_writable_strs()`-style binding here — that helper is the
*freeze* set and `Failed` is in it, so binding it would silently implement the
opposite rule on the one status that matters most.

Rewrite the method doc comment, which currently says "Link a Stellar address to an
LP whose KYB has passed… Only rows with `kyb_status = 'Passed'` and no address
linked yet are updated". It must now say: sets or replaces; refused outright at
`Failed`, and at `Passed` only when the LP already holds an address;
`address_linked_at` is rewritten on every successful set; the returned `bool`
distinguishes "not eligible" from success; a unique violation (another LP holds
this address) still surfaces as a DB error for the caller to map to `409`.

### 4. Comment cleanup in `lp_repo.rs` (do not skip)

Three more places assert the dropped rule. **Line numbers re-verified against
this branch on 2026-09-30** — the #1382 spec merge touched only `docs/` and
`packages/frontend/src/api/lps.ts`, so nothing in Rust moved and all three still
point where they did:

- **Module header, line 5** — "identified internally by `id`, not by wallet, until
  KYB passes and the LP links a Stellar account via `link_address`". The linking is
  no longer tied to passing.
- **`KybStatus` doc, lines 24–26** (the sentence spans 25–26) —
  "`stellar_address` may only be set once this reaches `Passed` (enforced by the
  `lps_stellar_address_passed_ck` DB constraint)". Both halves are now false and
  the named constraint no longer exists. Replace with a pointer to
  `allows_address_write`.
- **`LpRow::stellar_address`, line 113** — "Set only once `kyb_status` is
  `Passed` (see [`KybStatus`])". Now: settable at any status short of a terminal
  verdict, fixed once `Passed` holds one, and never settable at `Failed`.

Verify with `grep -n "link_address\|Set only once\|may only be set" packages/shared/src/lp_repo.rs`
before editing rather than trusting the numbers — the sibling branches move this
file.

Stay inside the repo comment budget (AGENTS.md § Lint & style): rewrite existing
doc comments on public items, add no new inline comments.

### 5. Handler — `packages/api/src/routes/lps.rs`

In `link_address`, after `let lp = my_lp(&claims, &state).await?;` and before the
repo call:

```rust
let status =
    KybStatus::from_str(&lp.kyb_status).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
if !status.allows_address_write(lp.stellar_address.is_some()) {
    return Err(ApiError::Conflict(match status {
        KybStatus::Failed => format!(
            "LP {} was refused at KYB and cannot set a settlement address",
            lp.id
        ),
        _ => format!(
            "LP {} has passed KYB; its settlement address is fixed",
            lp.id
        ),
    }));
}
```

The two refusals are different facts and must read differently — "your address is
locked in" versus "you will not be settling at all". A single merged message would
send a rejected applicant hunting for a way to change an address it never had.
This is the one place a `_ =>` arm is fine: it is formatting a message, not
classifying a status, and `allows_address_write` has already decided.

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

Rewrite the handler doc comment (`packages/api/src/routes/lps.rs:689–693`), which
currently reads "LP ties a Stellar account after KYB passes. One-shot: only an LP
with `kyb_status = Passed` and no address linked yet is eligible. Deliberately not
folded into `upsert_my_lp`: it requires `Passed`, which is exactly when the upsert
is frozen." The new reason it is not folded into `upsert_my_lp` is the freeze
exemption: the address is not evidence a review decision was made about, so it
stays settable while the profile is frozen — and, in the other direction, it stops
being settable at `Failed` exactly where the profile reopens.

Update the `#[utoipa::path]` `409` description (line 704) — currently "KYB has not
passed, an address is already linked, or stellar_address belongs to another LP" →
"This LP was refused at KYB, or has passed and its address is fixed, or
stellar_address belongs to another LP".

**Also update `LpResponse::stellar_address`, `packages/api/src/routes/lps.rs:82`**
— "Set only once `kyb_status` is `Passed`." This is a *response schema* doc
comment, so utoipa renders it into the published OpenAPI document: leaving it is
not an internal comment rot but a false public contract. The first revision of
this plan missed it. Now: settable at any status short of a terminal verdict,
fixed once `Passed` holds one, never settable at `Failed`.

### 6. Comment cleanup in `routes/lps.rs` (do not skip)

Line numbers re-verified on this branch 2026-09-30; all three still hold
(`grep -n "link-address\|allows_owner_writes\|still trusts" packages/api/src/routes/lps.rs`).

- **Module header, line 12** — "`POST /v1/lps/me/link-address` ties a Stellar
  account once KYB passes" → sets or replaces the settlement account at any
  status short of a terminal verdict; fixed once `Passed` holds one, refused
  outright at `Failed`.
- **Module header, the two numbered freeze rules (lines 26–33; point 1 is 28–30,
  point 2 is 31–33)** — point 1 says
  the gate "reads `kyb_status` and never writes it — transitions are #1274's job,
  so this gate is inert until that lands". #1274 owns rewriting that sentence; do
  not fight it here. What this issue must add is the exemption: the settlement
  address sits outside the freeze, because it is not evidence a decision was made
  about — it follows its own rule ([`KybStatus::allows_address_write`]), which is
  open at `UnderReview` where the freeze bites and closed at `Failed` where the
  freeze lifts. Keep the edit minimal and confined to that clause to limit the
  conflict surface with #1274 and #1377, both of which also edit this header.
- **Module header, lines 38–41** — the `stellar_address`/TD-57 paragraph. Still
  true, but strengthen: authorization is now the *only* control, since no status
  gate remains.

### 7. Lint

`cargo clippy --all -- -D warnings` must pass. `docs/` is touched (step 9 and
"Docs to Update"), so run `npx tsx scripts/lint-docs.ts` too. It must stay at
**0 errors**; the warning count on this repo is nonzero and pre-existing, so
compare against a run on `main` rather than expecting silence.

### 8. Manual verification (required — this is the only coverage the enforcement gets)

Against a local Postgres, before the PR leaves draft. Statuses that are not
reachable yet (`Passed`, `Failed` — nothing writes `kyb_status` on `main`) are set
by direct `UPDATE`, since #1274 is not merged.

1. `NotStarted` LP sets an address → `200`; `stellar_address` and
   `address_linked_at` are set. Then confirm **no other `lps` row changed** — this
   is the check that catches a missing parenthesis in the predicate. **Set this
   up deliberately:** the table must contain at least one *other* `NotStarted` LP
   with an address already linked, because the mis-parsed predicate only rewrites
   non-terminal rows. Snapshot `SELECT id, stellar_address, updated_at FROM lps
   ORDER BY id` before and after and diff it; a `Passed`-only control row would
   pass while the bug was live.
2. Same LP sets a *different* address → `200`; the column is replaced and
   `address_linked_at` is strictly greater than before.
3. The abandoned address from (2) is claimable: a second LP sets it → `200`.
4. A second LP claims an address another LP *currently* holds → `409`, via the
   unique-violation branch, with the "already linked to another LP" message.
5. `UPDATE lps SET kyb_status = 'Passed'` on an LP that holds an address → a
   replace attempt returns `409` with the "settlement address is fixed" message,
   and the row is unchanged. Re-sending the **same** address also returns `409`
   (documented behaviour, see Assumptions).
   - **Check 5b.** `UPDATE lps SET kyb_status = 'Failed'` on an LP that holds an
     address → a replace attempt returns `409` with the "was refused at KYB"
     message, row unchanged.
6. An LP at `Passed` with `stellar_address IS NULL` → setting one succeeds
   (`200`); a subsequent replace returns `409`.
   - **Check 6b — the one check that must not be skipped.** An LP at `Failed`
     with `stellar_address IS NULL` → `409` on the **first** attempt, and the row
     still has `stellar_address IS NULL` afterwards. This is the only check in the
     list that catches Trap 1 from step 3: with the `Failed` exclusion wrongly
     folded inside the `IS NULL` disjunction, checks 5b and 6 both still pass and
     this one returns `200`. Confirm it twice over — once through the handler
     pre-check, and once by calling `LpRepo::link_address` against that row
     directly (or running the `UPDATE` by hand) so the **SQL predicate** is shown
     to refuse it on its own. A passing pre-check would otherwise mask a
     predicate that never got the extra conjunct.
7. The constraint is gone: an LP at `NotStarted` with an address linked exists in
   the table and `\d lps` no longer lists `lps_stellar_address_passed_ck`.
8. Freeze exemption: an LP at `UnderReview` (`writable: false` in `GET
   /v1/lps/me`) still sets its address → `200`, while `POST /v1/lps/me` on the
   same LP still returns `409`.

Record the outcome in the PR description.

### 9. Spec amendment — `docs/product-specs/kyb-lp-verification.md`

**The merged spec is now wrong on one point and this PR fixes it.** § "Settlement
Address" (line 67 on `main` at `d509486`) says the address "may be set at any KYB
status". Under the answer to Open Question 2 that is false for `Failed`: the
endpoint is closed to a refused LP outright, not merely fixed at whatever it
holds. Documentation leads and code follows (AGENTS.md § Docs-first), so the spec
states the rule the code implements — it does not get corrected afterwards.

Replace this sentence group inside the § "Settlement Address" paragraph:

> It may be set at any KYB status, and replaced freely until the KYB decision is
> final; once `Passed` or `Failed`, the address is fixed. `Passed` fixes it
> because from that point downstream systems treat it as the account money moves
> to. `Failed` fixes it for a different reason: addresses are unique across all
> LPs, so an applicant who could keep rewriting the field after a terminal
> refusal could burn one real LP's address after another purely by naming them.

with:

> It may be set at any KYB status short of a terminal verdict, and replaced
> freely until the decision is final. `Passed` fixes the address already held,
> because from that point downstream systems treat it as the account money moves
> to — an LP that passed before naming one may still name it, once. `Failed`
> closes the endpoint outright, whether or not an address is stored: addresses
> are unique across all LPs, so an applicant who could keep rewriting the field
> after a terminal refusal could burn one real LP's address after another purely
> by naming them, and a refused LP will never settle, so permitting even a first
> write buys nothing against that.

Constraints on the edit:

- **Minimal and in the document's existing voice.** Three sentences replace
  three. Do not restructure § "Settlement Address", do not add a heading, and do
  not touch its other three paragraphs — the freeze/account-gate paragraph
  (line 69) stays exactly as it is and remains accurate, including its point that
  the rule does not depend on suspension being enforced.
- **Do not touch § "Security Considerations".** Its `stellar_address` bullet and
  its TD-80 bullet are unaffected.
- `kyb-lp-verification.md` is 83 lines against the 200-line hard ceiling, so
  length is not a constraint here; `npx tsx scripts/lint-docs.ts` must stay at
  0 errors.
- Re-read the section from the working tree before editing — quote the live text
  rather than trusting the block above, in case the file has moved again.

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

- `an_unlinked_lp_may_set_an_address_at_any_non_terminal_status` — for
  `NotStarted`, `InProgress` and `UnderReview`, with `has_address = false`, the
  write is allowed. This is the whole point of the issue and must fail loudly if
  the gate ever comes back. (Renamed from
  `an_unlinked_lp_may_set_an_address_at_any_status`, which is no longer true of
  `Failed`.)
- `a_linked_address_may_be_replaced_until_the_decision_is_final` — every status
  except `Passed` **and `Failed`**, with `has_address = true`, allows the write.
  (Renamed from `a_linked_address_may_be_replaced_until_kyb_passes`.)
- `the_two_terminal_statuses_close_the_address_differently` — the security test
  of this revision. It must assert **all four** terminal combinations, and the
  point of the test is that the two statuses do *not* agree:

  | | `has_address = true` | `has_address = false` |
  |---|---|---|
  | `Passed` | refused | **allowed** |
  | `Failed` | refused | **refused** |

  - `Passed` + `true` → refused (the address is fixed once downstream systems
    treat it as where money moves).
  - `Passed` + `false` → **allowed**. An LP that passed before naming an address
    must not be locked out forever; this is a legitimate, ongoing use.
  - `Failed` + `true` → refused. Assert with a message naming the reason — a
    refused applicant left writable could burn real LPs' addresses through the
    UNIQUE column, one after another — so a future reader who sees it fail knows
    it is load-bearing and not tidy-up.
  - `Failed` + `false` → **refused, and this is the assertion that guards Trap 1
    from step 3.** A `Failed` LP is terminal: it will never settle and never
    receive funds, so the write has no legitimate use and would still permit one
    burn. Zero benefit against nonzero harm. Give it its own assertion line whose
    **failure message** says that the `Failed` exclusion has to sit outside the
    `IS NULL` disjunction — this is the only unit assertion that fails if the
    predicate is written the obvious-but-wrong way. Put the pointer in the
    message, not in a comment: the repo's comment budget (AGENTS.md § Lint &
    style) allows the file one spec-pointer header and no body comments.

  (Renamed from `a_passed_lp_freezes_its_address`; do not collapse it back into a
  single "terminal statuses refuse" loop, which would delete the asymmetry the
  test exists to pin.)
- `the_policy_is_total_and_classifies_every_status_deliberately` — drive
  `allows_address_write` across every status × `{true, false}` against a local
  expectation helper written as an **exhaustive `match`** on `KybStatus`:

  ```rust
  fn expected(status: KybStatus, has_address: bool) -> bool {
      match status {
          KybStatus::Failed => false,
          KybStatus::Passed => !has_address,
          KybStatus::NotStarted | KybStatus::InProgress | KybStatus::UnderReview => true,
      }
  }
  ```

  All five variants × `{true, false}` = ten cases, and the helper must produce
  three structurally different answers — `Failed` ignores `has_address`, `Passed`
  consumes it, the rest ignore it the other way. Write it with `Failed` in its own
  arm, exactly as `allows_address_write` does. Note what changed across this
  plan's revisions: `Failed` started in the unconditional-`true` arm, and a
  two-status form would have put it in the `!has_address` arm beside `Passed`.
  Both are wrong, and only the four-combination test above tells them apart from
  the right answer. The helper is not decoration — it is the mechanism that forces
  a deliberate classification, and it does that twice over here:

  1. **Now.** Writing these arms is what makes a coder state, in code, that
     `Failed` is closed outright and `Passed` only conditionally. A helper that
     still listed `Failed` alongside `NotStarted` would pass against a predicate
     that had never been updated, so the whole revision could land green and
     wrong. Verify the test actually fails against **both** discarded bodies
     before trusting it: the original `!has_address || *self != KybStatus::Passed`
     and the intermediate `!has_address || !matches!(self, Passed | Failed)`.
  2. **Later.** When #1274 adds `ChangesRequested`, the `match` is non-exhaustive
     and this file stops compiling until someone classifies the new status on
     purpose. Say so in the assertion message.

  Do not add a `_ => …` catch-all arm under any circumstances; it silently
  destroys both properties.
- `the_policy_is_independent_of_the_write_freeze` — assert the two policies cross
  in **both** directions, which after this revision they demonstrably do:
  `allows_address_write` is `true` at `UnderReview` where `allows_owner_writes` is
  `false` (the freeze exemption), **and** `allows_address_write(true)` is `false`
  at `Failed` where `allows_owner_writes` is `true` (`Failed` is in
  `OWNER_WRITABLE`). Neither set contains the other, so this pins the separation
  as a decision rather than an accident and blocks any later refactor that tries
  to define one in terms of the other.

**`packages/api/tests/lps.rs`** (extend, using the existing `openapi_json()` and
`has_type` helpers):

- `POST /v1/lps/me/link-address` is still present in the document and still
  documents `200`/`400`/`401`/`404`/`409`.
- `LinkAddressRequest` exposes `stellar_address` as a required string.
- The `409` description no longer claims KYB must have passed, and does mention
  the refusal case — assert on the text, since that string is the endpoint's
  public contract and is the thing most likely to be left stale.
- **`LpResponse.stellar_address`'s schema description no longer says "Set only
  once `kyb_status` is `Passed`."** This is the doc comment at
  `packages/api/src/routes/lps.rs:82`, which utoipa publishes; the existing
  `openapi_json()` helper reaches it at
  `components.schemas.LpResponse.properties.stellar_address.description`. Assert
  on it for the same reason as the `409` text — a rendered description is a
  contract, and this one was missed in the first pass of this plan.

**Explicitly not covered, and stated as such in the PR description:** the
`UPDATE … WHERE` predicate itself — including both traps from step 3, since the
unit tests cover the Rust *statement* of the rule and not its SQL restatement —
plus the constraint drop, the uniqueness `409`, and the freeze exemption end to
end. Those are the manual checklist in step 8, and **manual check 6b is what
actually proves the `Failed` rule reached the database**. A green `cargo test`
here does not mean the security fix landed.

## Docs to Update

> **Anchoring hazard in `tech-debt-tracker.md` — read before editing it.** The
> tracker reuses TD numbers. `### TD-80` appears three times (line 1268
> "Wallet-namespace labels diverge three ways across the app", and lines 1471 and
> 1508, which are two copies of "Email/password sessions cannot be revoked" — the
> true duplicate, filed as BUG-24). `### TD-82` appears three times too (lines
> 1290 and 1487, two copies of "No mobile frames for the Account page", and line
> 1524 "`lps.owner_chain_id` / `owner_address` are dead authorization columns").
> Consequences for this issue, both concrete:
>
> - **The TD-57 edit is safe** — `grep -c "^### TD-57"` returns `1`, verified
>   2026-09-30. Anchor the edit on the `### TD-57:` heading and its following
>   `- **Date:**` / `- **Gap:**` / `- **Impact:**` bullets; do not anchor on line
>   numbers or on a `sed` range.
> - **The TD-82 cross-reference below is not safe as a bare number.** Write it as
>   TD-82 *plus its subtitle* ("`lps.owner_chain_id` / `owner_address` are dead
>   authorization columns"), or a reader following the number lands on a mobile
>   Figma gap.
>
> Do **not** deduplicate the tracker in this PR — that is BUG-24's job and it
> would bury a one-paragraph security edit under an unrelated docs diff.

- **`docs/exec-plans/tech-debt-tracker.md` — TD-57 (required).** Do **not** mark
  it resolved and do not change its **Suggested fix**. Update the **Date** line
  with a "widened <today>" note in the existing style ("narrowed 2026-09-15 — see
  below"), and rewrite the **Impact** paragraph: the endpoint was unreachable
  (`kyb_status = 'Passed'` was never true), so the gap was theoretical; #1379
  removes the status gate and #1274 makes the status reachable, so it is now
  live. Add that the exposure widens in two ways — an address can be recorded
  *before* any review has looked at the entity, and authorization is the only
  remaining control on the endpoint. **Then state the bound**, which this
  revision adds and which keeps the entry honest: the address is fixed once the
  KYB decision is final, and a refused LP cannot set one at all — so the exposure
  is at most one address per LP that reaches `Passed`, and none for one that is
  refused, rather than unbounded. That bound is a property of the predicate alone
  and deliberately
  does not rely on the account suspension `Failed` also sets, which is enforced
  nowhere until #1380. Do not let this read as a partial fix for TD-57: TD-57 is
  about an LP proving it controls the address it names, which is untouched.
  Also correct the stale mechanism in the **Gap** paragraph: it still describes
  `lp_owner_guard` matching JWT `(chain_id, sub)` against
  `lps.(owner_chain_id, owner_address)`; the endpoint is now `/me`-keyed on
  `owner_account_id` (`my_lp`), and `owner_chain_id`/`owner_address` are history,
  not authorization — TD-82 "`lps.owner_chain_id` / `owner_address` are dead
  authorization columns" (cite it by subtitle; see the anchoring hazard above).
- **`docs/product-specs/kyb-lp-verification.md` — one sentence group changes; see
  step 9 for the exact before/after.** It is on `main` (PR #1382, commit
  `d509486`) and § Settlement Address currently says the address "may be set at
  any KYB status", which the answer to Open Question 2 makes false for `Failed`.
  This is the one place this branch may edit the spec, and the edit is confined
  to those three sentences. Everywhere else the rule remains: if the code and the
  spec disagree, the code is wrong.
- **`docs/exec-plans/active/issue-1379-ungate-link-address.md`** — this plan;
  append a decision log entry for anything decided during implementation that
  differs from it, and record the manual-verification outcome — manual check 6b
  in particular, since it is the only evidence the `Failed` rule reached the
  database.

- **No frontend or user-docs changes.** Nothing in `packages/frontend/src` calls
  this endpoint.
- Run `npx tsx scripts/lint-docs.ts` after touching `docs/`.

## Revision log

- **2026-09-30 (a) — two-status rule.** Revised after the review of PR #1382.
  `Failed` joins `Passed` in closing the settlement address. Also: the spec has
  merged to `main`, so every instruction to read it from
  `origin/docs/kyb-review-lifecycle` (a now-deleted branch) is replaced by a
  working-tree read; the migration stamp `20260929000003` was re-verified free on
  `main`, `feat/1274-kyb-state-machine` and `feat/1377-notify-on-review`; all
  enumerated comment line numbers were re-verified; `LpResponse::stellar_address`
  (`packages/api/src/routes/lps.rs:82`) was added to the comment cleanup, having
  been missed; Open Question 1 (merge order) was answered and closed; Open
  Question 2 (`Failed` + no address) was raised, the brief and the merged spec
  having licensed opposite answers.

- **2026-09-30 (b) — Open Question 2 answered: refuse.** A `Failed` LP cannot set
  a settlement address at all, stored address or not. This is **not** the
  two-status rule of revision (a): `Failed` is closed unconditionally while
  `Passed` is closed only once an address is held, so the two terminal statuses
  behave differently and `NOT IN ('Passed', 'Failed')` is the wrong spelling.
  Consequences folded in: the predicate becomes
  `kyb_status <> 'Failed' AND (stellar_address IS NULL OR kyb_status <> 'Passed')`
  with the `Failed` conjunct **outside** the disjunction (step 3, Trap 1);
  `allows_address_write` becomes a three-arm `match`; the handler returns a
  distinct `409` for a refusal versus a fixed address; the unit test asserts all
  four terminal combinations and manual check 6b becomes the one check that must
  not be skipped; and **the merged spec is amended** (new step 9) because "may be
  set at any KYB status" is no longer true. Rationale — the asymmetry — in
  "`Passed` and `Failed` are not symmetric". **No open questions remain.**
