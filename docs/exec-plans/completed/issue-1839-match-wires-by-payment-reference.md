# Issue #1839: Backend: match incoming wires to the LP by the issued payment reference (lp_requested_bank_details)

Source: https://github.com/eq-lab/pipeline/issues/1839

Part of epic #1247. Backend flow. No Figma. The issue has no comments. This completes the loop
#1815 started (issued `PL-XXXX-XXXX-XXXX` references, history in `lp_requested_bank_details`,
chain-aware since #1824). #1817 (LP funding modal) already tells the LP to quote that reference.

## Scope

### The key decision: two references, two jobs

A recorded wire carries two different strings. The plan keeps them apart, as
`docs/product-specs/deposits.md` § LP Funding Details already says ("Not the per-wire reference").

| | `payment_reference` (exists) | `payment_details` (new, optional) |
|---|---|---|
| What | The bank's own reference for this one wire (statement line, MT103 field 20, UETR) | The `PL-…` reference #1815 issued to the LP and the LP quoted in the remittance field |
| Uniqueness | Unique per deposit (`UNIQUE`) | Many wires may quote the same issued reference |
| On-chain | `ref_hash = sha256(payment_reference)`, single-use in the minter (`RefHashSeen`) | Never hashed and never on-chain |
| Job | Dedupes the wire and keys the mint | Attributes the wire to an LP (and to the chain and receiver it was issued for) |

Why: if the issued reference were the per-wire key, the LP's second wire quoting the same
reference would hit `409` in `lp_bank_deposits` and `RefHashSeen` on-chain, and the issue says
the LP may quote it again. With this split, reuse is just two deposits linked to the same
issued-reference row. `ref_hash`, the relayer matching (`WireInMatcher` Rules A and B) and the
contracts do not change.

### In scope

1. **Canonical form of an issued reference** (pure, `packages/api/src/routes/lp_bank_deposits.rs`,
   next to `payment_details_from`):
   - Trim, uppercase, remove every whitespace character and `-`.
   - Require `PL` followed by 12 symbols. In the 12-symbol part only, map the Crockford decode
     aliases `O→0` and `I`/`L→1`. Then every symbol must be in the alphabet (so `U` is refused).
   - Re-format as `PL-XXXX-XXXX-XXXX`.
   - Input longer than 140 characters (before normalisation) is malformed.
   - The spec already requires matching with `-` and whitespace removed, because banks strip
     hyphens. The canonical form lets the exact-match `UNIQUE` index on
     `lp_requested_bank_details.payment_details` answer the lookup, so no expression index is needed.
2. **Record route: `POST /v1/lps/{id}/bank-deposits`** (same method and path) gains an optional
   body field `payment_details`.
   - **Omitted or `null`:** today's behaviour. The Trustee attributes the wire by hand and the
     deposit has no matched reference.
   - **Present but malformed:** `400`.
   - **Canonicalises but was never issued:** `422`, for example "payment reference `PL-…` was never
     issued to any LP; record the wire without it to attribute it by hand, or book it to escrow".
   - **Issued to another LP:** `422`, for example "payment reference `PL-…` was issued to LP 12,
     not LP 7".
   - **Issued to this LP:** the deposit is stored linked to that issued-reference row.
   - These refusals use `422`, not `409`. The Trustee console maps every `409` on this route to
     "A deposit with this payment reference is already recorded."
     (`packages/trustee/src/routes/-useLpBankDeposits.ts:43`), and that copy would be wrong here.
   - **Guard (see Open Questions):** if `payment_reference` itself canonicalises to a reference that
     was actually issued, refuse with `422`, for example "`payment_reference` is an issued LP
     payment reference; enter the bank's own reference for this wire and pass the issued one as
     `payment_details`". This stops the reusable reference from being burnt into the single-use
     `ref_hash`. A string that only looks like the format but was never issued is accepted.
3. **Persistence**, one migration:
   - `lp_bank_deposits.requested_bank_details_id BIGINT NULL`.
   - A composite FK `(requested_bank_details_id, lp_id) → lp_requested_bank_details (id, lp_id)`,
     backed by a new `UNIQUE (id, lp_id)` on `lp_requested_bank_details`. A cross-LP link is then
     impossible at the DB level as well as in the handler (`MATCH SIMPLE`: a `NULL` link is not checked).
   - A partial index on the new column.
4. **Served match.** `BankDepositResponse` gains a nullable `matched_reference` on both
   `GET /v1/lps/{id}/bank-deposits` and the `POST` response:
   ```json
   "matched_reference": {
     "payment_details": "PL-7K3M-Q9TX-H2CD",
     "chain_id": 99000001,
     "receiver_address": "G…",
     "issued_at": "2026-11-09T10:00:00Z"
   }
   ```
   - `null` means "attributed by hand". Non-null means "matched by reference".
   - `chain_id` and `receiver_address` are nullable. Rows issued before #1824 have `chain_id NULL`,
     and both columns are nullable in the schema.
   - This gives the console the chain and receiver the LP was shown, which is the backend half of TD-164.
   - The issue's example names (`matched_lp_id`, `reference_known`) are not used.
     `matched_lp_id` always equals the deposit's `lp_id`, and `reference_known` is
     `matched_reference != null`.
5. **Lookup without picking the LP by hand.** The existing Trustee listing `GET /v1/lps` gains an
   optional `?payment_details=<ref>` filter. No new route is added.
   - The value is canonicalised; malformed is `400`.
   - The response is `{ "lps": [...] }` with the one owning LP, or `[]` when the reference was never
     issued. An unknown reference is not an error on a filter.
   - The console flow: the Trustee types or pastes the reference → `GET /v1/lps?payment_details=` →
     the record dialog opens pre-filled for that LP → `POST /v1/lps/{id}/bank-deposits` with
     `payment_details`, which the server re-validates.
   - The same lookup serves the #1763 escrow **assign** picker.
6. **Docs.** Specs (`deposits.md`), utoipa on both routes, a user-stories doc, and tech-debt notes.

### What happens in each case (spec text, step 8)

- **Known reference, this LP:** recorded and linked. The Trustee mints `Direct` to the LP's
  current settlement address as today (#1449/#1826). The mint chain can default from
  `matched_reference.chain_id` (frontend follow-up).
- **Known reference, another LP:** `422`. Nothing is written.
- **Unknown reference:** `422` on record and `[]` on lookup. The wire cannot be attributed, so it gets
  no `lp_bank_deposits` row (`lp_id` stays `NOT NULL`, TD-73). Per the user docs
  (`lenders/deposit.md`), the Cash reporter books it on-chain to escrow (`record_wire_in` with
  `receiver` = the minter). The Trustee then assigns it (`assign_wire_in`) or returns it
  (`return_wire_in`) from the #1763 Escrowed wires tab. That tab reads the cash book, so it needs no
  deposit row. `count_unmatched_wire_ins` already counts such a wire, which is the right meaning
  ("an on-chain wire with no deposit").
- **No reference quoted (or the LP quoted none):** the Trustee may still record it against an LP
  they pick, with `matched_reference: null` (see Open Questions).
- **Same issued reference on a second wire:** allowed. The second wire has its own bank
  `payment_reference` and `ref_hash`, and both deposits link to the same issued row.
- **The LP relinked its address after the reference was issued:** the match still stands.
  `receiver_address` records what was shown, and the mint still goes to the **current** address
  (rule unchanged, deposits.md § Receiver vs mint).

### Out of scope

- **Trustee console UI:** the reference lookup box, the "matched by reference" / "attributed by hand"
  chip, a default mint chain from `matched_reference.chain_id`, and the escrow-assign picker lookup.
  This needs a frontend follow-up issue. The manager proposes it; it is not filed here.
- `lp_bank_deposits.chain_id`, a terminal state, salted `ref_hash` and per-LP reference uniqueness
  (#1687, TD-114/116/117). The new column does not change any of those statements.
- Enriching the cash book's escrowed `wire_ins` with an LP hint. An escrowed wire has no deposit row
  and its `ref_hash` is over the bank reference, so there is nothing to join.
- Extracting a reference from a whole remittance line ("INV 42 PL-…"). The Trustee pastes the
  reference itself.
- EVM mint (#1501). Matching is chain-agnostic and works the same for an EVM-issued reference.

## Assumptions and Risks

- **Issued references are insert-only.** Nothing updates or deletes `lp_requested_bank_details`, so
  a lookup outside the insert transaction cannot go stale. The composite FK makes the cross-LP
  invariant hold even if that changes.
- **The format is fixed.** Every row since #1815 has the `PL-` + 12 Crockford format
  (`payment_details_from`). The canonicaliser lives in the same module as the generator; a future
  format change must update both, and a round-trip test pins them together.
- **The `UNIQUE (id, lp_id)` addition** cannot fail on existing data, because `id` is already the PK.
  The FK is added on an empty-for-this-column table, so there is no backfill.
- **Existing deposits stay `matched_reference: null`.** No backfill: their `payment_reference` is a
  bank reference, and this plan does not guess a link.
- **Migration timestamp.** The latest on `main` is `20261110000001_plusd_balance_seeds.sql`. Use
  `20261111000001_lp_bank_deposits_matched_reference.sql`, and re-check `main` right before
  committing (no open PR adds a migration today).
- **Overlap with PR #1875 (LDavti, #1763, open; do not modify):**
  - It is frontend and docs only, with no Rust or migration changes, so there is no code conflict.
  - Docs overlap 1: `docs/product-specs/deposits.md`. It adds a `## Escrowed Wires` section after
    § Stellar PLUSD Mint Leg (→ ~131 lines). This plan edits § LP Funding Details and adds a
    section. Keep the new section next to § LP Funding Details, not after Mint Leg, to avoid a
    textual conflict.
  - Docs overlap 2: `docs/exec-plans/tech-debt-tracker.md`. It consumes TD-178…TD-181 and moves
    "Next free" to TD-182. This plan adds no new TD, only update notes on TD-73 and TD-164, so
    the numbering does not clash.
  - The `lint-docs` cap is 200 lines, with a warning above 150. After both PRs `deposits.md` must
    stay ≤ 150 if possible. Trim the two replaced bullets in § LP Funding Details rather than
    append.
  - #1875's assign picker would benefit from the new `GET /v1/lps?payment_details=` filter. That
    is for the frontend follow-up, not for #1875.
- **#1687 (open, unplanned)** will relax `payment_reference` uniqueness and salt `ref_hash`. That is
  independent of this plan: the issued-reference link does not depend on `ref_hash`.
- **Hand-mirrored Trustee types** (`packages/trustee/src/api/useLpBankDeposits.ts`, TD-42). The new
  response field is additive and the new request field is optional, so the console keeps working
  unchanged.

## Open Questions

1. **Separate field.** Should the issued reference be a separate optional field
   (`payment_details`, named after the LP response and the table column) alongside the bank's
   per-wire `payment_reference`, as planned? The alternative is matching `payment_reference`
   itself, but that burns the reusable LP reference into the single-use on-chain `ref_hash`, so a
   second wire quoting it fails with `409` and `RefHashSeen`.
2. **Hand attribution.** Should recording without `payment_details` (Trustee picks the LP) stay
   allowed? Planned: yes, served as `matched_reference: null`. It covers LPs who quote nothing and
   pre-#1815 wires. The alternative forces every unreferenced wire to escrow.
3. **Guard on `payment_reference`.** Should a `payment_reference` that is itself an issued `PL-…`
   reference be refused (`422`)? Planned: yes. The cost is that a Trustee whose statement shows
   only the remittance text must find the bank's transaction id.
4. **Lookup surface.** Should "resolve without manual selection" be the `?payment_details=` filter
   on the existing `GET /v1/lps` (planned, no new route, two calls from the console)? The
   alternative is a new top-level `POST /v1/bank-deposits` that resolves the LP from the reference
   in one call.

**Resolved by the user (2026-11-10)** — all plan defaults accepted:

1. Separate optional `payment_details` field; `payment_reference` stays the bank's per-wire reference.
2. Recording without `payment_details` (hand attribution) stays allowed, served as
   `matched_reference: null`.
3. A `payment_reference` that is itself an issued `PL-…` reference is refused with `422`.
4. Lookup via the `?payment_details=` filter on the existing `GET /v1/lps`; no new route.

## Implementation Steps

1. **Migration** `packages/shared/migrations/20261111000001_lp_bank_deposits_matched_reference.sql`:
   - Header comment: purpose (#1839), spec link `docs/product-specs/deposits.md#wire-matching-by-payment-reference`,
     why a composite FK, no backfill, rollback SQL.
   - SQL:
     ```sql
     ALTER TABLE lp_requested_bank_details
         ADD CONSTRAINT lp_requested_bank_details_id_lp_id_key UNIQUE (id, lp_id);
     ALTER TABLE lp_bank_deposits
         ADD COLUMN requested_bank_details_id BIGINT,
         ADD CONSTRAINT lp_bank_deposits_requested_bank_details_fk
             FOREIGN KEY (requested_bank_details_id, lp_id)
             REFERENCES lp_requested_bank_details (id, lp_id);
     CREATE INDEX idx_lp_bank_deposits_requested_bank_details_id
         ON lp_bank_deposits (requested_bank_details_id)
         WHERE requested_bank_details_id IS NOT NULL;
     ```
2. **`packages/shared/src/lp_requested_bank_details_repo.rs`:**
   - `IssuedReferenceRow { id, lp_id, payment_details, chain_id: Option<i64>, receiver_address:
     Option<String>, created_at }` (`sqlx::FromRow`).
   - Trait `IssuedReferenceLookup: Send + Sync { async fn find_by_payment_details(&self, canonical:
     &str) -> Result<Option<IssuedReferenceRow>, sqlx::Error>; }`, implemented for
     `LpRequestedBankDetailsRepo` as an exact `WHERE payment_details = $1` (the existing `UNIQUE`
     index). Expose the SQL as a `pub const` so a test can pin its shape.
3. **`packages/shared/src/lp_bank_deposit_repo.rs`:**
   - `LpBankDepositRow` gains `requested_bank_details_id: Option<i64>` plus the four joined,
     nullable fields `matched_payment_details`, `matched_chain_id`, `matched_receiver_address`,
     `matched_issued_at`.
   - `list_for_lp` becomes `FROM lp_bank_deposits d LEFT JOIN lp_requested_bank_details r ON r.id =
     d.requested_bank_details_id`, keeping the order `d.occurred_at DESC, d.id DESC`.
   - `insert` takes `requested_bank_details_id: Option<i64>` and returns the same row shape through
     `WITH ins AS (INSERT … RETURNING *) SELECT … FROM ins LEFT JOIN lp_requested_bank_details r …`.
     It must stay on the caller's `&mut PgConnection` (the shared transaction with `LpLedgerRepo::insert_deposit`).
   - Put both statements in `pub const`s for shape tests. Update the file's spec header.
   - Leave `WireInMatcher` and the pending-deposit SQL untouched.
4. **`packages/api/src/routes/lp_bank_deposits.rs`:**
   - `pub fn canonical_payment_details(raw: &str) -> Result<String, String>` (Scope 1). Reuse
     `CROCKFORD` and `PAYMENT_DETAILS_PREFIX`.
   - `RecordBankDepositRequest.payment_details: Option<String>`, with `#[serde(default)]` and a doc
     comment. `RecordBankDepositValues.payment_details: Option<String>` (canonical).
     `validate_record_bank_deposit` canonicalises it and returns a 400 message on malformed input.
   - `pub async fn resolve_payment_details<L: IssuedReferenceLookup + ?Sized>(lookup, lp_id,
     values) -> Result<Option<IssuedReferenceRow>, ApiError>`. It does both lookups (the
     `payment_details` match and the `payment_reference` guard) with the 422 messages from
     Scope 2. The guard looks up only when `canonical_payment_details(payment_reference)` is `Ok`.
   - `record_bank_deposit` order: `require_trustee` → validate (400) → `known_lp` (404) →
     `resolve_payment_details` (422) → tx (insert with the resolved id; 409 on duplicate
     `payment_reference` unchanged) → ledger row → commit.
   - `MatchedReference` DTO (`ToSchema`) and `BankDepositResponse.matched_reference:
     Option<MatchedReference>`. `From<LpBankDepositRow>` builds it when
     `requested_bank_details_id` is `Some`, with `issued_at` via `iso_utc`.
   - utoipa: add `422` to the `POST` responses with both reasons; register `MatchedReference` in
     `LpBankDepositsDoc`; update the `payment_reference` doc comment to "the bank's per-wire
     reference, not the issued `PL-…` reference".
5. **`packages/api/src/routes/lps.rs`, `GET /v1/lps`:**
   - Add `#[derive(Deserialize, IntoParams)] pub struct LpsQuery { payment_details: Option<String> }`
     and extract it with `Query<LpsQuery>`.
   - When the filter is set, canonicalise it (400 on malformed) and call
     `state.lp_requested_bank_details_repo.find_by_payment_details`.
     - Unknown reference: `{lps: []}`.
     - Known reference: `lp_repo.find(row.lp_id)`, served as one `LpSummary`. A missing LP is `[]`,
       because the FK makes it impossible anyway.
   - Keep the branch in a small pure-over-traits helper (for example
     `lp_ids_for_payment_details(lookup, raw) -> Result<Option<i64>, ApiError>` in
     `lp_bank_deposits.rs`) so it is unit-testable; `lps.rs` is already 1688 lines.
   - utoipa: add `params(LpsQuery)` and a `400` response, and say the filter exists for wire matching.
6. **No worker or relayer change.** Confirm `packages/worker/src/relayer/wire_in_match.rs` and
   `PENDING_BANK_DEPOSITS_*` compile untouched; they only add columns to the row type, which the
   worker does not select.
7. **Lint and build:** `cargo fmt`, `cargo clippy --all -- -D warnings`, `cargo test --all`.
8. **Docs** (see Docs to Update).

## Test Strategy

Pure unit tests only, in `packages/<pkg>/tests/<topic>.rs`. No inline `#[cfg(test)]`, no
`DATABASE_URL` / `POSTGRES_URL` or any env var, and no Postgres.

- **New `packages/api/tests/lp_payment_reference_matching.rs`:**
  - **Canonicaliser accepts:** canonical in → same out; lowercase; hyphens stripped
    (`PL7K3MQ9TXH2CD`); internal and outer whitespace; mixed hyphen and space grouping; the
    aliases `O→0` and `I`/`L→1` in the symbol part (while the prefix `PL` keeps its `L`).
  - **Canonicaliser refuses:** empty; wrong prefix; 11 or 13 symbols; `U`; punctuation other than `-`;
    more than 140 characters.
  - **Round trip:** `canonical_payment_details(payment_details_from(r)) == payment_details_from(r)`
    across a spread of `r` (0, `u64::MAX`, bit patterns), which pins it to the generator.
  - **`resolve_payment_details`, against a fake `IssuedReferenceLookup` that counts calls:**
    - Omitted → `Ok(None)`, no lookup.
    - Known, same LP → the row.
    - Unknown → `ApiError::UnprocessableEntity` whose message names the reference.
    - Known, other LP → 422 naming both LP ids.
    - A legacy row with `chain_id: None` passes through.
    - A lookup error → `ApiError::Internal` (not a 4xx).
    - A non-reference `payment_reference` → no guard lookup.
    - `payment_reference` equal (after canonicalisation) to an issued reference → 422.
    - A format-shaped but unissued `payment_reference` → accepted.
  - **The `GET /v1/lps` filter helper:** malformed → `BadRequest`; unknown → `None`; known → `Some(lp_id)`.
- **`packages/api/tests/lp_bank_deposits.rs` (extend):**
  - `validate_record_bank_deposit` with `payment_details` absent, `null`, valid (canonicalised in the
    values) and malformed (400 message).
  - `BankDepositResponse` JSON: `matched_reference` is `null` for an unlinked row, and an object with
    the four keys (nullable `chain_id` and `receiver_address`) for a linked row.
  - OpenAPI:
    - `RecordBankDepositRequest.payment_details` is present and **not** in `required`.
    - `BankDepositResponse.matched_reference` is present.
    - `POST` documents `422`.
    - `GET /v1/lps` documents the `payment_details` query parameter and `400`.
  - The existing assertions (no `lp_id` in the body; `payment_reference` required) must still pass.
- **`packages/shared/tests/` (new `lp_bank_deposit_matched_reference_sql.rs`, or extend an existing
  SQL-shape test):**
  - The list and insert constants `LEFT JOIN lp_requested_bank_details` on
    `requested_bank_details_id`.
  - The list keeps `ORDER BY d.occurred_at DESC, d.id DESC`.
  - The lookup constant is an exact `payment_details = $1` (no `replace(`/`upper(` in SQL, so the
    unique index applies).
- **New `packages/shared/tests/migration_lp_bank_deposits_matched_reference.rs`** (`include_str!`,
  the same pattern as `migration_lp_payment_details_chain.rs`):
  - Nullable column; the composite FK `(requested_bank_details_id, lp_id)` referencing
    `(id, lp_id)`; the `UNIQUE (id, lp_id)`; the partial index.
  - No `UPDATE` / backfill, no `NOT NULL` on the new column.
  - A rollback block is present.
- **User stories** (manual, live API with trustee and LP tokens): see Docs to Update.

## Docs to Update

- **`docs/product-specs/deposits.md`:**
  - Replace the "Wire matching (follow-up)" bullet in § LP Funding Details with a one-line pointer.
  - Tighten "Not the per-wire reference" to point at the new section.
  - Add a `## Wire Matching by Payment Reference` section right after § LP Funding Details with:
    - the two-reference table;
    - canonicalisation;
    - the `POST` field and the 400/422 matrix;
    - the `payment_reference` guard;
    - `matched_reference`;
    - the `GET /v1/lps?payment_details=` lookup;
    - the per-case outcomes (unknown → escrow via the Cash reporter and the #1763 assign/return;
      reuse; relink);
    - what is not matched (the cash book's escrowed wires).
  - In § Stellar PLUSD Mint Leg, one clause: the mint chain may default from
    `matched_reference.chain_id`. Keep the file ≤ 150 lines with #1875 merged.
- **`docs/frontend/bank-transfers.md` ~line 385:** replace "Wire matching by issued reference is still
  a backend follow-up" with a pointer to the new deposits.md section (#1839).
- **`docs/references/backend.md` ~line 733:** one sentence noting that deposits may carry a
  matched issued reference (no relayer change).
- **`docs/exec-plans/tech-debt-tracker.md`:**
  - TD-164: add an "Update (#1839)" line. The deposit now serves `matched_reference` (`chain_id`,
    `receiver_address`); the console default is still open.
  - TD-73: add an "Update (#1839)" line. Unattributable wires go to on-chain escrow (#1763), and
    the reference lookup covers attributable ones.
  - No new TD entries. If the coder adds one, read "Next free number" on the then-current `main`
    (TD-178 today, TD-182 once #1875 merges).
- **User stories: new `docs/user-stories/epic-1247/1839-match-wires-by-payment-reference.md`**,
  linked from `docs/user-stories/index.md`:
  1. Get a reference as the LP (`GET /v1/lps/me/payment-details?chain_id=`), then
     `GET /v1/lps?payment_details=<lowercased, hyphen-stripped ref>` as a trustee returns exactly
     that LP.
  2. Record with `payment_details` → 201 and `matched_reference` carries the reference, chain and
     receiver; the same holds on the list.
  3. The same reference against another LP → 422, nothing written (list unchanged, ledger unchanged).
  4. An unissued well-formed reference → 422 on record and `[]` on lookup; a malformed one → 400 on
     both.
  5. A second wire quoting the same reference with a different bank `payment_reference` → 201;
     both deposits show the same `matched_reference`.
  6. `payment_reference` set to an issued reference → 422.
  7. Recording without `payment_details` still works, with `matched_reference: null`.
- **API docs:** utoipa on both touched routes (Steps 4–5); the OpenAPI is served from code.
- **Plan lifecycle:** the coder moves this plan to `docs/exec-plans/completed/` in the
  implementation PR, per the repo convention.
