# Issue #967: On-chain interest accrual has no maturity cap — contract disagrees with the API and both specs

Source: https://github.com/eq-lab/pipeline/issues/967

> **Cross-repo note.** The issue is tracked in `eq-lab/pipeline`, but the buggy code lives in a
> **separate repo**, `eq-lab/pipeline-stellar-contracts` (checked out locally at
> `../pipeline-stellar-contracts`). All file paths below are relative to that repo unless prefixed
> `pipeline:`. Work happens on branch `fix/967-interest-maturity-cap`, draft PR
> `eq-lab/pipeline-stellar-contracts#28`. GitHub keywords do not auto-close across repos, so #967
> must be closed manually when the PR merges.

## Scope

**In scope (core security fix):**

- Cap the open epoch's accrual at its own `maturity_date` in
  `contracts/loan-registry/src/storage.rs::last_epoch_interest_factor`, using **saturating**
  subtraction so a post-maturity epoch contributes zero instead of underflowing. This freezes
  `calculate_max_interest` (and therefore the `validate_repayment` gate on `record_payment`) once a
  loan passes maturity without a rollover — the stated security property
  (`pipeline:docs/product-specs/yield.md`, `pipeline:docs/product-specs/loans-data.md`).
- Tests proving `max_interest` stops growing past maturity, and behaves correctly across a
  subsequent rollover and across a post-maturity `record_payment`.

**Conditionally in scope — pending the Open Question on rollover semantics:** aligning `rollover`
so the reopened epoch starts at the *prior maturity* (matching the off-chain reference
`pipeline:packages/shared/src/loan_economics.rs::build_epochs`) rather than at the rollover
timestamp. The issue's own second acceptance test ("roll over and assert it resumes from the prior
maturity") only passes as literally written if this change is made. See Open Questions.

**Explicitly out of scope** (real divergences surfaced during investigation, but independent of the
maturity cap — do not fix here; file/track separately, per AGENTS.md bug-tracking):

1. **Epoch-per-payment.** `record_payment` calls `append_economics_epoch` on every payment, so an
   N-repayment loan carries N+1 epochs. Both the specs and the off-chain reference create epochs
   only on rollover/amend. Investigation (below) shows this does **not** corrupt the cap fix.
2. **Accrual base.** The contract accrues on the *declining* outstanding principal
   (`original_senior_tranche − cumulative.senior_principal_repaid`); the reference and spec accrue
   on the *flat* `originalSeniorTranche`. Independent economic divergence.
3. **`amend_economics`** appends a new epoch on-chain; the reference overwrites the current epoch
   in place. Independent divergence.
4. Simple (contract) vs compound (reference) interest — the reference module documents this as a
   deliberate divergence "by construction," so it is **not** a bug.

## Investigation findings (the epoch-per-payment interaction the issue flagged)

The issue asked to confirm the per-payment-epoch behaviour is understood before touching the cap,
"since the two interact." They do, and here is exactly how:

- `append_economics_epoch` (called by `record_payment`, `rollover`, `amend_economics`) closes the
  open epoch — capitalizing `factor × outstanding / ONE` onto a running `accrued_interest` — and
  opens a fresh epoch with `effective_from = now`. `record_payment` carries the **same** maturity
  and rate forward.
- **Splitting one epoch into two at `now` telescopes to the same total** for equal rate/maturity,
  *as long as `now ≤ maturity`*: `[min(now,mat) − eff_old] + [min(next,mat) − now] = min(next,mat) − eff_old`.
  So the extra epochs from payments do not, by themselves, change the accrued figure.
- **The interaction that matters:** if a payment is recorded *after* maturity, the new epoch has
  `effective_from = now > maturity` while carrying the old `maturity_date`. The next call to
  `last_epoch_interest_factor` then computes `end = now'.min(maturity) = maturity`, and
  `maturity − effective_from` is **negative**. With plain subtraction (as the issue's first draft
  `end - effective_from` shows) this **underflows `u64` and panics**. The `saturating_sub` in the
  issue's expected snippet is therefore **load-bearing, not cosmetic** — it is required precisely
  *because* `record_payment` can open a post-maturity epoch. This is the concrete
  cap × epoch-per-payment interaction.
- Net: with `saturating_sub`, the cap fix is correct and safe to ship on its own; the
  epoch-per-payment behaviour degrades to zero-contribution post-maturity epochs. Recommend fixing
  the cap now and tracking the epoch-count/accrual-base/amend divergences separately.

## Assumptions and Risks

- **Assumption:** the specs (which already describe the maturity cap) are authoritative and the
  contract is what is wrong; therefore this is a pure `fix/` with **no spec change** required.
- **Risk (economic behaviour change):** the fix lowers `max_interest` for any already-overdue loan.
  This is the intended correction (it tightens the security gate) but is a live-behaviour change —
  flag for reviewer awareness. No migration needed (values are computed, not stored, except the
  capitalized `accrued_interest`, which only ever *stops* growing — it is never rewritten downward).
- **Risk (rollover semantics):** see Open Questions — the second acceptance test depends on a
  decision that changes economic behaviour beyond the one-line cap.
- **Test-convention note:** the user's general rule is Rust tests in external `tests/` files, but
  that rule is for the **pipeline** repo. `pipeline-stellar-contracts` uses inline
  `#![cfg(test)]` `src/test.rs` (Soroban standard). This plan follows the contracts repo's existing
  convention (add tests to `contracts/loan-registry/src/test.rs`) — matching surrounding code.

## Open Questions

_None — resolved._

1. **[RESOLVED 2026-07-29 — Yes, start at prior maturity]** Rollover start semantics. The reopened
   epoch starts at the prior maturity, matching the off-chain reference (`build_epochs`,
   `LoanRolledOver`) and the issue's literal second test: the overdue gap
   `[old_maturity, rollover_time]` is charged at the new rate, so on-chain and API figures reconcile.
   **Step 2 is therefore in scope.**

## Implementation Steps

1. **Cap the accrual factor** — `contracts/loan-registry/src/storage.rs`, `last_epoch_interest_factor`
   (currently lines 160–165). Replace:
   ```rust
   let elapsed = u128::from(e.ledger().timestamp() - epoch.effective_from);
   ```
   with a maturity-capped, underflow-safe span:
   ```rust
   let end = e.ledger().timestamp().min(epoch.maturity_date);
   let elapsed = u128::from(end.saturating_sub(epoch.effective_from));
   ```
   Update the doc comment on the function to state the cap ("…since it took effect, capped at the
   epoch's own maturity"). No change needed in `calculate_max_interest` or `append_economics_epoch` —
   both consume this factor and inherit the cap automatically.

2. **(Conditional on Open Question #1) Reopen rollover at prior maturity** —
   `contracts/loan-registry/src/lib.rs::rollover` (lines 217–241) +
   `storage.rs::append_economics_epoch`. Add an `effective_from: u64` parameter to
   `append_economics_epoch` (replacing the internal `e.ledger().timestamp()` for the new epoch's
   `effective_from`). Callers: `record_payment` and `amend_economics` pass
   `e.ledger().timestamp()` (unchanged behaviour); `rollover` passes the prior epoch's
   `maturity_date` (i.e. `last_epoch.maturity_date` / `current_maturity_timestamp` before it is
   overwritten). Confirm no underflow: `rollover` requires `current_maturity_timestamp <= now`, so
   `effective_from = prior_maturity <= now`. **Skip this step entirely if the Open Question is
   resolved against changing rollover semantics.**

3. **Run lint** — from the contracts repo: `cargo clippy --all -- -D warnings` (per pipeline
   AGENTS.md Rust rule; the contracts repo follows the same lint bar). Fix any warnings.

4. **Build** — `cargo build --all` (and, if the repo builds wasm in CI, `cargo build --release
   --target wasm32-unknown-unknown -p loan-registry` or the repo's `make`/`just` target — check the
   contracts repo's CI config and match it).

## Test Strategy

Add to `contracts/loan-registry/src/test.rs` (inline, matching the file's existing style; reuse
`setup`, `draw_default_loan`, `exec_via_access_manager`, and `s.env.ledger().set_timestamp(...)`;
the default loan matures at `YEAR`, rate 10%, senior tranche 1e9, so full-year interest = 100_000_000
as the existing `interest_accrues_and_payment_is_recorded` test asserts):

1. **`max_interest_is_capped_at_maturity`** — draw default loan; `set_timestamp(YEAR)` →
   `max_interest == 100_000_000`; `set_timestamp(2 * YEAR)` → still `== 100_000_000` (regression
   test for the bug: pre-fix this would be ~200_000_000).
2. **`post_maturity_payment_does_not_underflow_or_uncap`** — draw; `set_timestamp(2 * YEAR)`; record
   a payment (e.g. small `senior_interest` within the 100_000_000 cap). Assert the call succeeds (no
   underflow panic — this is the epoch-per-payment × cap interaction), that a further
   `set_timestamp(3 * YEAR)` leaves `max_interest` unchanged (open epoch, now post-maturity,
   contributes zero), and `next_economics_epochs_id` incremented as expected.
3. **`rollover_after_maturity_resumes_accrual`** — draw; `set_timestamp(YEAR + X)`; assert
   `max_interest` frozen at the maturity cap; `rollover(new_rate, new_maturity = 2*YEAR)`; advance
   time and assert `max_interest` grows again under the new epoch. **The exact expected value depends
   on Open Question #1:** if rollover starts at prior maturity, the gap `[YEAR, rollover_time]` is
   charged at the new rate (assert accordingly); if not, accrual counts only from the rollover
   timestamp. Encode whichever the resolved decision dictates.
4. Confirm the existing suite still passes: `cargo test -p loan-registry` (or the repo's test target),
   especially `interest_accrues_and_payment_is_recorded`, `rollover_after_maturity_reopens_loan`, and
   the `record_payment_*` ceiling tests, which exercise `calculate_max_interest`.

## Docs to Update

None. The maturity cap is already the documented behaviour in
`pipeline:docs/product-specs/loans-data.md` (`ceiling` uses `min(block.timestamp, maturityDate)`),
`pipeline:docs/product-specs/yield.md` ("accrual stops at each epoch's own maturity"), and
`pipeline:packages/shared/src/loan_economics.rs` — this change brings the contract into line with
them. If the out-of-scope divergences (epoch-per-payment, accrual base, `amend_economics`) are later
picked up, file them as separate issues and reconcile the relevant spec sections then.
