# Issue #1328: Normalize CollateralValuationInput.asset (trim/upper-case) at submission

Source: https://github.com/eq-lab/pipeline/issues/1328

Parent epic: #2129 (Math correctness, 2026-11-19 review). Source tech-debt entry: TD-55.
Branch `fix/1328-normalize-collateral-asset`. Backend only, no Figma reference, no visual check.

## Scope

The issue body predates current code. Verified against `origin/main` at `b75cf30b`. The
2026-11-19 review widens it from one field to every free-text name the valuation math matches on.

### Findings on `origin/main`

1. **Anchor `asset`** (`packages/api/src/routes/loan_book.rs`). `validate_submission` (around
   line 1297, not 1032) only rejects a blank `asset`. `insert_valuation_and_fee_rows` stores it
   verbatim in `loan_collateral_valuations.asset`, and `serde_json::to_value(&payload)` stores
   it verbatim in `submitted_loans.loan_data`. The worker collector polls MetalpriceAPI with
   `currencies=<asset>` and reads `rates["USD<asset>"]`. For `" XAU "` or `"xau"` that lookup
   misses, so no price row is ever written, and the StandardGoods loan stays unpriced.
2. **Anchor `price_provider`**. `is_known_provider` is an exact match, so `" metal_price"` or
   `"Metal_Price"` gets a 400 and is not silently broken. Trimming and lower-casing it is a
   leniency fix, not a correctness fix.
3. **Metal and element names in the concentrate math**
   (`packages/shared/src/collateral_valuation/mod.rs`):
   - `assemble_metals` `:347`: the grade lookup uses `m.metal == term.metal`.
   - `assemble_metals` `:353`: the refining-charge lookup uses `r.metal == term.metal`.
   - `assemble_penalties` `:396`: the deleterious lookup uses `d.element == tier.element`.
   An offtake that says `"Gold"` against an assay that says `"gold"` gets grade 0 and RC 0, so
   gross value and the refining charge drop out. An `"Arsenic"` tier against an `"arsenic"`
   assay gets a level of 0, so the penalty drops out. Price resolution is already
   case-insensitive (`asset_for_metal` lower-cases), but it does not trim, so `" gold"` leaves
   the loan unpriced. These functions also feed `nsr_per_dmt`, which means the security-mark
   suggestions (`packages/shared/src/security_marks.rs::concentrate_vpu_raw`) inherit the bug.
4. **The same three matches in the display echo**
   (`packages/api/src/routes/collateral_valuation.rs`): `build_metals` `:909` and `:922`, and
   `build_penalties` `:952`. #1786 Phase 2 deletes these functions together with
   `GET /valuations`.
5. `to_pct`'s `unit == "Ppm"` is case-sensitive, but `validate_assay` and `validate_offtake`
   accept only exact `Pct` or `Ppm`, and the serde default is `Pct`. No change needed.

### In scope

- **Anchor normalization at submission.** Trim and ASCII upper-case `collateral_valuation.asset`.
  Trim and ASCII lower-case `collateral_valuation.price_provider`. This runs in both
  `submit_loan` and `resubmit_loan`, before validation and before `loan_data` is serialized, the
  same way `normalize_data_room_id` works today.
- **Asset format validation.** After normalization the asset must match `[A-Z0-9_-]{1,16}`.
  This is the rule `SECURITY_MARK_COMMODITIES` already enforces through
  `security_marks::valid_asset`, and the plan reuses that function.
- **Case- and whitespace-insensitive name matching** in the shared valuation math, through one
  helper. This covers rows already stored in the JSONB columns (`loan_assays.assays` and
  `.deleterious`, `loan_offtake_terms.payable_terms`, `.refining_charges` and
  `.penalty_schedule`), so those tables need no data migration.
- `asset_for_metal` trims before it lower-cases.
- **Write-time hygiene on `POST /assay` and `POST /offtake`.** Store trimmed names. Reject empty
  names. Reject duplicate names after normalization in `assays`, `deleterious`, `payable_terms`
  and `refining_charges` (see Open Questions). Repeated elements in `penalty_schedule` stay
  allowed.
- **Backfill of stored anchors.** One migration normalizes `loan_collateral_valuations.asset` and
  `.price_provider` in place. The UPDATE is guarded and idempotent, and the migration adds no
  CHECK constraint.
- The display echo in `routes/collateral_valuation.rs` uses the same helper, but only if
  `build_metals` and `build_penalties` still exist on `main` when this is implemented.

### Out of scope

- Unit conversion in the StandardGoods branch (`compute_collateral`, `StandardGoodsInputs`). That
  is #2125, which is planning in parallel on `fix/2125-standard-goods-troy-oz` (draft PR #2134,
  no code yet). This plan does not touch lines `:283-297` or `StandardGoodsInputs`.
- Rewriting `submitted_loans.loan_data` JSON for past submissions. Nothing reads
  `loan_data.collateral_valuation.asset` for math, and a resubmission re-normalizes it.
- `loan_asset_prices`. A malformed symbol never produced a price row (see finding 1), so nothing
  is keyed by a bad asset.
- Rejecting payable metals outside `asset_for_metal`'s set. Such a loan reads as unpriced on
  purpose, per the spec.
- Unicode case folding. Metal and element names are ASCII English, and `eq_ignore_ascii_case`
  is enough.
- Implementing escalating penalty tiers (TD-48).

## Assumptions and Risks

- **Overlap with #1786 Phase 2.** That work is uncommitted on `chore/1786-retire-ccr-phase2` in
  the main checkout. It edits `collateral_valuation/mod.rs` (module and `collateral_value` docs
  only), `routes/collateral_valuation.rs` (it deletes `build_response`, `build_metals` and
  `build_penalties`, and keeps `validate_assay`, `validate_offtake`, `submit_assay` and
  `submit_offtake`), `routes/loan_book.rs`, `api/tests/collateral_valuation.rs`,
  `api/tests/loan_submission.rs`, `shared/tests/collateral_valuation.rs` and
  `docs/product-specs/collateral-valuation.md`. To keep conflicts small:
  - Put new shared tests in a new file.
  - Keep the edits to `build_metals` and `build_penalties` one line each, so a conflict resolves
    by taking the deletion.
  - Add new API tests at the end of the files.
  - Keep the spec edit to the record table rows.
  Whichever branch merges second rebases.
- **Overlap with #2125.** It edits the StandardGoods branch of the same `mod.rs` and may add an
  asset-to-quote-unit table near `asset_for_metal`. This plan's `mod.rs` edits stay in
  `asset_for_metal`, one new helper below it, and the three `find` closures in
  `assemble_metals` and `assemble_penalties`. If #2125 keys a table on `anchor.asset`, it can
  rely on the normalized upper-case asset this issue writes, both for new submissions and after
  the backfill. Tell #2125's coder this if it lands after #1328.
- **Stricter API contract.** `POST /v1/loan-book/loan` and `/resubmit` will return 400 for asset
  values the server used to accept, such as `XAU/USD`, `X AU` or 17+ characters. None of these
  could ever be priced. The Trustee origination form (`packages/trustee/src/routes/-origination-new.ts`)
  already trims, so it needs no change.
- **New 400s on `POST /assay` and `POST /offtake`** for empty or duplicate names. Only the
  Operations Console API calls these, and there is no Trustee UI for them.
- **Backfill.** There is no DB access from here, so the plan cannot confirm that malformed anchors
  exist in any environment. The UPDATE is a no-op when the data is clean. A row that is still
  invalid after trimming and upper-casing (for example `XAU/USD`) stays as it is and stays
  unpriced, which is the same behavior as today. That is why the migration adds no CHECK.
- **Migration version collision.** Other epic-2129 and #1786 branches may add migrations the same
  day. Pick the next free `YYYYMMDDNNNNNN` against `origin/main` at implementation time, and
  rename the file if a rebase collides.
- **Duplicates in stored JSONB.** With case-insensitive matching, a payable list that already
  holds both `gold` and `Gold` would match the same assay grade twice. Before, the second entry
  scored 0. The new duplicate validation only covers new writes. This is very unlikely for
  stored data, which was entered by hand with a single metal list, and the plan records it in
  the tech-debt resolution note.

## Open Questions

- **Asset format.** The plan uses `[A-Z0-9_-]{1,16}` after trimming and upper-casing, the same
  rule as `SECURITY_MARK_COMMODITIES`, so the anchor and the mark config agree. The issue
  suggested `[A-Z0-9]{2,6}`, which would reject the separators some feeds use. Which rule
  applies? Default if unanswered: `[A-Z0-9_-]{1,16}`.
- **Duplicate names on `POST /assay` and `/offtake`.** Should these return 400 when two entries
  in `assays`, `deleterious`, `payable_terms` or `refining_charges` differ only by case or
  surrounding whitespace? Repeated `penalty_schedule` elements would stay allowed, because a
  tiered schedule can legitimately have several tiers per element. Default: yes, reject.

## Implementation Steps

1. **Shared name helper**, in `packages/shared/src/collateral_valuation/mod.rs`. Keep this away
   from the StandardGoods branch.
   - In `asset_for_metal`, change the match key to `metal.trim().to_ascii_lowercase()`.
   - Directly below `asset_for_metal`, add
     `pub fn same_name(a: &str, b: &str) -> bool { a.trim().eq_ignore_ascii_case(b.trim()) }`.
     Give it a one-line `///` doc, following the existing doc style in this file.
   - In `assemble_metals`, change `.find(|m| m.metal == term.metal)` to
     `.find(|m| same_name(&m.metal, &term.metal))`. Do the same for the refining-charge `find`.
   - In `assemble_penalties`, change `.find(|d| d.element == tier.element)` to
     `.find(|d| same_name(&d.element, &tier.element))`.
   - Update the `assemble_metals` and `assemble_penalties` doc lines to say that names match
     case- and whitespace-insensitively.
2. **Make the asset rule reusable**, in `packages/shared/src/security_marks.rs`. Change
   `fn valid_asset` to `pub fn valid_asset`. This is the only edit to that file.
3. **Anchor normalization**, in `packages/api/src/routes/loan_book.rs`.
   - Next to `normalize_data_room_id`, add
     `pub fn normalize_collateral_valuation(cv: &mut CollateralValuationInput)`. It sets
     `cv.asset = cv.asset.trim().to_ascii_uppercase()` and
     `cv.price_provider = cv.price_provider.trim().to_ascii_lowercase()`.
   - In `submit_loan` (around `:841`) and `resubmit_loan` (around `:957`), call
     `normalize_collateral_valuation(&mut payload.collateral_valuation);` right after the
     `normalize_data_room_id` line. It must run before `validate_submission` and before
     `serde_json::to_value(&payload)`.
   - In `validate_submission`, replace the blank-asset check with
     `if !shared::security_marks::valid_asset(&req.collateral_valuation.asset)`. Return
     `` "`asset` must be 1-16 characters of A-Z, 0-9, `_` or `-` (got `{asset}`)" ``. The error
     must still contain `asset`, so the existing `empty_asset_is_rejected` test keeps passing.
   - Update the `///` doc on `CollateralValuationInput::asset` to say it is trimmed and
     upper-cased at ingest, and on `price_provider` to say it is trimmed and lower-cased.
4. **Assay and offtake write hygiene**, in `packages/api/src/routes/collateral_valuation.rs`.
   - Add a private `fn check_names<'a>(field: &str, names: impl Iterator<Item = &'a str>, unique: bool) -> Result<(), String>`.
     It returns `` "`{field}` names must not be empty" `` for a name that is empty after
     trimming. When `unique` is set, it returns `` "duplicate {field} `{name}` (names are matched case-insensitively)" ``
     for a repeat, deduplicating on `trim().to_ascii_lowercase()` through a `HashSet`.
   - `validate_assay` calls it for `assays[].metal` (unique) and `deleterious[].element`
     (unique).
   - `validate_offtake` calls it for `payable_terms[].metal` (unique),
     `refining_charges[].metal` (unique) and `penalty_schedule[].element` (not unique).
   - In `submit_assay` and `submit_offtake`, store `m.metal.trim().to_owned()` and
     `d.element.trim().to_owned()` (and the same for `t.metal`, `r.metal` and `p.element`)
     instead of `.clone()`. Do not change the case, so the display keeps the operator's spelling.
   - Only if `build_metals` and `build_penalties` still exist (that is, #1786 Phase 2 has not
     merged): replace the three `==` matches at about `:909`, `:922` and `:952` with
     `same_name(..)`, and add `same_name` to the `shared::collateral_valuation` import. If they
     are gone, skip this step.
5. **Backfill migration**, a new file
   `packages/shared/migrations/<next-free-version>_normalize_collateral_valuation_asset.sql`
   (for example `20261119000001_…`).
   - Header: a `-- spec: docs/product-specs/collateral-valuation.md#per-loan-valuation-record`
     line and a `-- Rollback:` note. The rollback is a no-op: the original spelling is not
     recoverable and is not needed. Also give the `DELETE FROM _sqlx_migrations WHERE version = …`
     line, following the house style.
   - `UPDATE loan_collateral_valuations SET asset = upper(btrim(asset)), updated_at = now() WHERE asset <> upper(btrim(asset));`
   - `UPDATE loan_collateral_valuations SET price_provider = lower(btrim(price_provider)), updated_at = now() WHERE price_provider <> lower(btrim(price_provider));`
   - No CHECK constraint, and no change to `loan_asset_prices` or `submitted_loans.loan_data`.
6. **Tech debt and docs.** See Docs to Update.
7. **Lint and build.** Run `cargo fmt --all`, `cargo clippy --all -- -D warnings` and
   `npx tsx scripts/lint-docs.ts`. Follow the comment-less code rule: no new body comments and
   no test comments.

## Test Strategy

All tests are pure. There is no DB and no env var access, per the project rules. Tests live in
`packages/<pkg>/tests/`.

- **New `packages/shared/tests/collateral_name_matching.rs`** (separate from
  `collateral_valuation.rs` to avoid #1786 and #2125 conflicts). Build local gold/silver and
  arsenic fixtures that mirror the existing ones. Tests:
  - `same_name`: `("Gold","gold")`, `(" gold ","GOLD")` and `("Arsenic","arsenic")` are true.
    `("gold","silver")` and `("gold","golden")` are false.
  - `asset_for_metal(" Gold ") == Some("XAU")`.
  - `compute_collateral` on a MetalConcentrate anchor whose offtake `payable_terms` say `"Gold"`
    and `"SILVER"`, whose `refining_charges` say `" gold "`, and whose assay says `gold` and
    `silver`. The `ConcentrateValuation` (gross value, refining charge, collateral value) must
    equal the all-lowercase baseline, and the refining charge must be non-zero.
  - A penalty tier with element `"Arsenic"` against an assay `deleterious` element `"arsenic"`
    gives the same non-zero `penalties` as the lowercase baseline.
  - `nsr_per_dmt` with mixed-case names equals the lowercase baseline. This is the security-mark
    path.
  - Regression: a metal truly absent from the assay (`"platinum"` payable, no platinum assay)
    still gets grade 0.
- **`packages/api/tests/loan_submission.rs`**. Append at the end to avoid #1786 hunks.
  - `normalize_collateral_valuation` turns `"  xau\n"` into `"XAU"` and `" Metal_Price "` into
    `"metal_price"`.
  - After normalization, `validate_submission` accepts `" xau "` and `"static"`.
  - `validate_submission` rejects `XAU/USD`, `X AU`, `xau` (not normalized) and a 17-character
    symbol, and the error names `asset`. It accepts `BRENT`, `XCU` and `LME-XCU`.
  - The existing `empty_asset_is_rejected` and `unknown_price_provider_is_rejected` still pass.
- **`packages/api/tests/collateral_valuation.rs`**. Append to the kept `validate_assay` and
  `validate_offtake` sections.
  - An empty or whitespace-only `metal` or `element` is rejected in each list.
  - `assays` with `gold` and `Gold` is rejected. So is `deleterious` with `arsenic` and
    `Arsenic `, `payable_terms` with `gold` and `GOLD`, and `refining_charges` with `gold` and
    `gold`.
  - `penalty_schedule` with two `arsenic` tiers is accepted.
  - The existing valid fixtures still pass.
- **New `packages/shared/tests/migration_normalize_collateral_valuation_asset.rs`**, following the
  `include_str!` pattern of `migration_lps_settlement_bank_account.rs`. Assert that the
  whitespace-flattened SQL contains both guarded UPDATE statements (`upper(btrim(asset))`,
  `lower(btrim(price_provider))`, and the `WHERE … <>` guards), contains no `ADD CONSTRAINT`,
  and has a header with `Rollback`.
- **Regression.** Run `cargo test -p shared` and `cargo test -p pipeline-api`. That covers the
  existing `collateral_valuation`, `security_marks`, `loan_submission` and `loan_book` suites.

## Docs to Update

- `docs/product-specs/api-authorization-loan-submission.md`, in the **Payload** paragraph: say
  that `collateral_valuation.asset` is trimmed and upper-cased at ingest and must match
  `[A-Z0-9_-]{1,16}`, and that `price_provider` is trimmed and lower-cased before the
  known-provider check. Both are stored normalized in `loan_data` and in the anchor.
- `docs/product-specs/collateral-valuation.md`, **Per-loan valuation record** table:
  - On the `assays`, `deleterious`, `payable_terms` and `refining_charges` rows, add that metal
    and element names match case- and whitespace-insensitively, are stored trimmed, and must be
    unique within the list.
  - On the `penalty_schedule` row, add that names match case-insensitively and that one element
    may have several tiers.
  - Keep the edit to these rows only, since #1786 Phase 2 rewrites other parts of this file.
- `docs/exec-plans/tech-debt-tracker.md`, TD-55: add a
  `**Resolution (2026-11-…, #1328):**` line covering the asset and provider normalization, the
  backfill, and the case-insensitive metal and element matching. Mention that a stored list
  holding names that differ only by case would now match twice.
- `docs/user-stories/epic-2129/1328-normalize-collateral-names.md` (new): API-level QA stories.
  - Submit a loan with `asset: " xau "`. The response and `GET /v1/loan-book/submissions` show
    `XAU`.
  - `asset: "XAU/USD"` returns 400.
  - `POST /offtake` with `"Gold"` against an assay `"gold"` gives a non-zero grade and refining
    charge in the waterfall and mark suggestion.
  - Duplicate metals return 400.
  Add the row to `docs/user-stories/index.md` under an `Epic #2129` section, and create the
  section if the QA issue #2130 has not.
- When finished, move this plan to `docs/exec-plans/completed/`. The manager does this at close.
