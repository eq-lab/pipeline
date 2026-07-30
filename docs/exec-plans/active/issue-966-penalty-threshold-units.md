# Issue #966: Penalty threshold/step units: ppm-scheduled elements silently score zero

Source: https://github.com/eq-lab/pipeline/issues/966

## Scope

Fix the unit mismatch in the concentrate penalty waterfall. Today
`assemble_penalties` (`packages/shared/src/collateral_valuation/mod.rs`) normalises the
**assayed level** from ppm→percent (`level / 10_000`) but consumes the offtake tier's
`threshold` and `step` **verbatim**. The three quantities in the excess computation
`(level_pct − threshold_pct) / step_pct` are therefore only consistent if the offtake
author happened to write ppm thresholds already expressed in percent. Authoring them in
the natural ppm reading makes `excess` negative, clamps `steps` to zero, and silently
drops the penalty — inflating collateral value and CCR.

Chosen approach: **Option 1 from the issue (preferred)** — carry an explicit `unit`
(`Pct` | `Ppm`) on each penalty tier and normalise **both sides** to percent at assembly
time, mirroring how `DeleteriousJson.unit` already works on the assay side. The pure
valuation math (`ConcentrateInputs::valuate`) stays unit-agnostic — everything reaches it
already in percent — so the fix lives entirely in the storage shape, the API DTO, the
assembly join, and validation.

In scope:
- `unit` field on the penalty tier (storage JSON + API request DTO), defaulting to `Pct`
  for backward compatibility with already-stored rows and existing clients.
- Normalise `threshold`/`step` by the tier's `unit` in `assemble_penalties`.
- Normalise the echoed penalty inputs in the read endpoint so the displayed
  `*_pct` fields are internally consistent (all in percent) — see Open Questions.
- Validation in `validate_offtake`: accept/validate `unit`, and reject an order-of-magnitude
  wrong percent threshold/step.
- Unit tests (shared math + API validator) proving the round-trip.
- Product-spec note on the penalty `unit`.

Out of scope:
- The unused `escalating` flag on `PenaltyTierJson` (stored but never read by the math).
  Log as tech-debt if not already tracked; do not implement escalating penalties here.
- Any migration of existing stored offtake rows (see Assumptions).
- Frontend Operations Console form changes (a separate frontend issue if the console
  needs a unit selector; the API stays backward-compatible so nothing breaks meanwhile).

## Assumptions and Risks

- **Existing stored data is in percent.** Per the issue, the canonical fixtures store
  thresholds/steps already in percent (e.g. `0.0010`/`0.0005`), matching the spec's
  worked example (arsenic `0.2`/`0.1` percent). Defaulting a missing `unit` to `Pct`
  therefore preserves current-correct behaviour for every existing row and needs no data
  backfill. **Risk:** if any real offtake row was authored with a natural ppm number
  (e.g. threshold `10`) and no `unit`, defaulting to `Pct` would read it as `10%` — a
  different wrong answer, not a silent zero. Mitigation: the new `≤ 100` percent-bound
  validation only guards new writes, not existing rows; before merge, confirm with the
  team that no live offtake row was authored ppm-natural. If one exists it must be
  re-submitted (append-only) with the correct `unit`.
- `PenaltyTierJson` is a JSONB array element, so adding a field needs **no schema
  migration** — only a `#[serde(default = …)]` so old rows without `unit` still
  deserialize. Do **not** edit the already-applied `20260708000004_loan_offtake_terms.sql`
  (forward-only); its inline comment is illustrative only.
- The read endpoint's `PenaltyInput` DTO fields are named `level_pct`/`threshold_pct`/
  `step_pct` but currently echo **raw** stored values (possibly ppm). Normalising them to
  percent is a small response-shape behaviour change; low risk because the field names
  already claim percent and no consumer is known to depend on the raw ppm echo.
- utoipa generates the OpenAPI schema from the DTOs at runtime; there is no checked-in
  OpenAPI dump under `docs/generated/` to regenerate.

## Open Questions

- **Strength of the order-of-magnitude validation.** Recommended default: reject only a
  definitionally-impossible `Pct` threshold/step `> 100` (a deleterious mass fraction
  cannot exceed 100%), plus the hard `unit ∈ {Pct, Ppm}` check. A more aggressive
  heuristic (e.g. warn/reject a `Ppm` value `< 1`, or a `Pct` value that "looks like ppm")
  risks false positives on legitimate authoring. Proceed with the conservative rule unless
  the team wants the stricter heuristic.
- **Display normalisation of `PenaltyInput`.** Recommended default: normalise the echoed
  `level_pct`/`threshold_pct`/`step_pct` to percent so the trustee sees apples-to-apples
  values matching the math. Confirm no Operations Console view depends on the raw ppm echo
  (none found in this repo). If preferred, we can instead echo raw values plus a `unit`
  field — say which.

## Implementation Steps

**Status: all steps implemented (2026-07-30).** `unit` added to `PenaltyTierJson` and
`PenaltyTierInput` (serde-default `Pct`); `assemble_penalties` normalises both sides via a
new shared `to_pct` helper; the read endpoint echoes percent-normalised penalty inputs;
`validate_offtake` enforces `unit ∈ {Pct, Ppm}` and rejects a `Pct` threshold/step `> 100`.
Tests added in both `tests/` files; spec updated; `escalating` gap logged as TD-48.

1. **Storage shape — `packages/shared/src/collateral_valuation_repo.rs`.**
   - Add `pub unit: String` to `PenaltyTierJson` with a serde default:
     ```rust
     #[serde(default = "default_penalty_unit")]
     pub unit: String,
     ```
     and a module-level `fn default_penalty_unit() -> String { "Pct".to_owned() }`.
     Doc-comment: `Pct` or `Ppm`; defaults to `Pct` for rows authored before the unit was
     tracked (all historically stored in percent).
   - Leave `insert_offtake` untouched (it binds the whole `Json(penalty_schedule)` blob).

2. **Assembly — `packages/shared/src/collateral_valuation/mod.rs`.**
   - Add a small helper mirroring the existing ppm branch, e.g.
     `fn level_in_pct(value: BigDecimal, unit: &str) -> BigDecimal` returning
     `value / 10_000` for `"Ppm"`, else `value`.
   - In `assemble_penalties`, use it for the assay level (replacing the inline `if d.unit
     == "Ppm"`) **and** for the tier's `threshold`/`step`, keyed off `tier.unit`:
     ```rust
     threshold_pct: level_in_pct(dec("penalty.threshold", &tier.threshold)?, &tier.unit),
     step_pct:      level_in_pct(dec("penalty.step", &tier.step)?, &tier.unit),
     ```
   - Update the `PenaltyTier` doc comment: it already documents percent fields; add a line
     noting the offtake `unit` is normalised to percent here, same as the assay level.
   - `ConcentrateInputs::valuate` and the `PenaltyTier` struct are unchanged — the math
     stays entirely in percent.

3. **API request DTO — `packages/api/src/routes/collateral_valuation.rs`.**
   - Add `unit` to `PenaltyTierInput`:
     ```rust
     #[serde(default = "default_penalty_unit")]
     pub unit: String,
     ```
     with a local `fn default_penalty_unit() -> String { "Pct".to_owned() }` (or reuse the
     shared one via re-export — prefer a local to keep the route self-contained). Doc it as
     `Pct` or `Ppm`, default `Pct`.
   - Thread it into the `PenaltyTierJson` construction in `submit_offtake` (the `.map`
     building `penalty_schedule`): `unit: p.unit.clone()`.
   - **Read endpoint display** (`build_penalties`): normalise `level_pct`, `threshold_pct`,
     `step_pct` to percent for the echo (per Open Questions default). Reuse the same
     ppm→pct conversion; the assayed level uses the assay row's `d.unit`, the threshold/step
     use the tier's `unit`. Keep formatting via `to_plain_string()`.

4. **Validation — `validate_offtake` in the same route file.**
   - In the `for p in &req.penalty_schedule` loop, after the existing threshold/step/rate
     checks, validate the unit and the order-of-magnitude bound:
     ```rust
     match p.unit.as_str() {
         "Pct" | "Ppm" => {}
         other => return Err(format!(
             "unknown unit `{other}` for element `{}` (expected Pct or Ppm)", p.element)),
     }
     if p.unit == "Pct" {
         // A deleterious mass-fraction threshold/step cannot exceed 100% — a value
         // above 100 is almost certainly a ppm figure authored under the wrong unit.
         if threshold > BigDecimal::from(100) || step > BigDecimal::from(100) {
             return Err(format!(
                 "penalty threshold/step for `{}` look like ppm authored as Pct (> 100)", p.element));
         }
     }
     ```
     (Uses the already-parsed `threshold`/`step` locals.)

5. **Migration comment (optional, non-blocking).** Do not edit the applied migration. If a
   fresh reference is wanted, note the new JSON shape only in the repo struct doc-comment,
   which is the source of truth.

## Test Strategy

All tests in external `tests/` files, pure (no DB), per project convention.

- **`packages/shared/tests/collateral_valuation.rs` (math round-trip — the issue's
  acceptance test):**
  - New test `ppm_penalty_threshold_scores_nonzero`: build an `OfftakeTermsRow` +
    `AssayRow` for the issue's mercury case — assay `level: "22", unit: "Ppm"`, tier
    `threshold: "10", step: "5", unit: "Ppm", rate_per_dmt: "1"`, quantity 5200 dmt — run
    `compute_collateral` and assert `waterfall.penalties` ≈ `2.40 * 5200 = 12_480`
    (non-zero), proving the natural ppm authoring is no longer silently dropped.
    ((0.0022 − 0.0010) / 0.0005 = 2.4 steps × $1 × 5200 dmt.)
  - New test `pct_and_ppm_tiers_agree`: two tiers describing the same threshold, one in
    `Pct` (`0.0010`/`0.0005`) and one in `Ppm` (`10`/`5`), yield identical penalty
    contributions — proves both sides normalise consistently.
  - Existing `concentrate_matches_spec_worked_example` still passes (arsenic tier is
    percent; `PenaltyTier` construction is unchanged since it takes `*_pct` directly).
  - Note: `assemble_penalties`/`PenaltyTierJson` need a `unit` in these fixtures; default
    covers omission but tests set it explicitly to exercise both branches.

- **`packages/api/tests/collateral_valuation.rs` (validator):**
  - Extend `valid_offtake()`'s `PenaltyTierInput` with `unit: "Pct".to_owned()`.
  - `penalty_unit_ppm_is_allowed`: `unit = "Ppm"`, threshold `10`, step `5` ⇒ `Ok`.
  - `unknown_penalty_unit_is_rejected`: `unit = "mg/kg"` ⇒ error containing `unit`
    (mirrors `unknown_deleterious_unit_is_rejected`).
  - `pct_penalty_threshold_over_100_is_rejected`: `unit = "Pct"`, threshold `500` ⇒ error.
  - `penalty_unit_defaults_to_pct_when_omitted` (serde): deserialize a JSON offtake body
    without `unit` and assert the field is `"Pct"` — guards the backward-compat default.

- Run `cargo clippy --all -- -D warnings` and the shared + api test suites
  (`/test-fast`). Confirm the two existing green tests above still pass.

## Docs to Update

- `docs/product-specs/collateral-valuation.md`:
  - `penalty_schedule` row (line ~97): note thresholds/steps carry a `unit` (`Pct` | `Ppm`,
    default `Pct`) normalised to percent for the waterfall, same as the assay `deleterious`
    `unit`.
  - Optionally one sentence in the *Metal concentrate* section clarifying that penalty
    thresholds and the assayed level are compared in a common unit (percent).
- No `docs/generated/` regeneration (no checked-in OpenAPI dump); utoipa reflects the new
  DTO field automatically at runtime.
- If `escalating`'s unused state isn't already recorded, add a one-line note to
  `docs/exec-plans/tech-debt-tracker.md` (out-of-scope discovery, do not fix here).
