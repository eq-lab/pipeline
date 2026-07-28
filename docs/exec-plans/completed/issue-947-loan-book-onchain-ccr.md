# Issue #947: Expose on-chain reported ccr_bps in GET /v1/loan-book

Source: https://github.com/eq-lab/pipeline/issues/947

## Scope

Add the on-chain reported CCR value to each `GET /v1/loan-book` entry, alongside the existing off-chain computed `ccr_bps`.

`LoanSnapshot.ccr_bps` (`packages/shared/src/loan_snapshot.rs:53`) already carries this — it's the value written by `LoanEventMapper` from a block-pinned contract read (`packages/worker/src/indexer/loan_mapper.rs:124,218`) whenever a `LoanDrawn` or CCR-relevant lifecycle event (including `LoanCCRUpdated`) is indexed. It is loaded into `compute_loan_book`'s per-loan `s: &LoanSnapshot` today but never copied into `LoanBookEntry` — only its timestamp (`s.last_reported_ccr_timestamp`) is, as `ccr_reported_at`.

Out of scope: changing how the off-chain `ccr_bps` is computed, changing `ccr_reported_at`, the `/loan-book/{loan_id}/valuations` or `/loan-book/{loan_id}/ccr-history` endpoints (they don't currently surface the on-chain value either, but the Issue only asks about the loan-book list), and any frontend consumption of the new field (no frontend Issue/PR is in scope here).

## Assumptions and Risks

- **Naming.** Resolved as `reported_ccr_bps`, to pair naturally with the existing `ccr_reported_at` field (both describe the on-chain-reported side; `ccr_bps` alone stays the off-chain computed value, unchanged for backward compatibility). Rejected `onchain_ccr_bps` as a less consistent pairing with the existing sibling field's name.
- **Nullability.** `LoanSnapshot.ccr_bps` is a plain `u32` (not `Option`), same shape as `last_reported_ccr_timestamp: i64` which is already exposed as a raw `i64` with the documented sentinel "`0` when never reported" (`loan_book.rs:199-201`). For consistency with that existing convention on the sibling field, `reported_ccr_bps` will also be exposed as a raw `u32` (not `Option<u32>`), with the same "`0` when never reported" caveat noted in its doc comment — rather than introducing a different nullability rule for what is otherwise the same kind of field. This keeps the change to a single-field copy with no new branching logic in the entry-building loop.
- Risk: frontend consumers unfamiliar with the distinction could mistakenly treat `reported_ccr_bps` as more "official" than the computed `ccr_bps` and use it in place of the LTV/coverage math it isn't meant for. Mitigated by explicit doc comments on both fields cross-referencing each other, and by the product-spec update below.
- No DB schema change, no new query — `s.ccr_bps` is already in memory via the existing `LoanSnapshotRow` fetch that populates `active`/`s` in `compute_loan_book`.

## Open Questions

_None._ The Issue's only open question (field naming) is resolved above with a documented rationale; nullability is a small, low-risk follow-on decision made by precedent from the sibling `ccr_reported_at` field.

## Implementation Steps

1. **`packages/api/src/routes/loan_book.rs` — `LoanBookEntry` struct** (near the existing `ccr_bps` / `ccr_reported_at` fields, ~line 199-223): add a new field
   ```rust
   /// Collateral Coverage Ratio in basis points as last reported on-chain
   /// (`LoanSnapshot.ccr_bps`, written from a block-pinned contract read whenever a
   /// `LoanCCRUpdated`-family event is indexed — see `LoanEventMapper` in
   /// `packages/worker/src/indexer/loan_mapper.rs`). Distinct from `ccr_bps` above,
   /// which is computed off-chain from the latest collateral valuation and price feed
   /// and can be fresher. `0` when never reported (see `ccr_reported_at`).
   pub reported_ccr_bps: u32,
   ```
   Place it directly after `ccr_reported_at` so the two on-chain-reported fields (value + its timestamp) sit together, ahead of the off-chain `collateral`/`ltv`/`ccr_bps` block — or immediately after the existing `ccr_bps` field with a doc comment cross-reference; either ordering is fine as long as the doc comments on both fields cross-reference each other. Prefer placing it next to `ccr_reported_at` since they are sourced from the same on-chain report.

2. **`packages/api/src/routes/loan_book.rs` — entry-building loop** (~line 1289-1310, the `entries.push(LoanBookEntry { ... })` block): add
   ```rust
   reported_ccr_bps: s.ccr_bps,
   ```
   No new computation needed — `s` is already `&loan.snapshot` in scope at that point.

3. **`packages/api/src/routes/loan_book.rs` — doc comment on the existing `ccr_bps` field** (~line 220-223): extend the existing doc comment with one clause noting the distinction from `reported_ccr_bps`, e.g. append: "Off-chain computed — see `reported_ccr_bps` for the value the contract itself last reported."

4. **`docs/product-specs/trustee-dashboard.md:172`** — update the Loans page row description. Current text:
   > `...collateral, **CCR** (`ccr_bps`) + **report time** (`ccr_reported_at`), **maturity**...`

   New text should read something like:
   > `...collateral, **CCR** (`ccr_bps`, off-chain computed) + on-chain **reported CCR** (`reported_ccr_bps`) + **report time** (`ccr_reported_at`), **maturity**...`

## Test Strategy

All existing loan-book tests live in `packages/api/tests/loan_book.rs` (compute-layer tests against `compute_loan_book` directly, fixture-driven, no DB/HTTP). Add:

1. A new test (near `entry_exposes_rollover_maturity_and_ccr_report_timestamp`, ~line 558) asserting `reported_ccr_bps` mirrors `LoanSnapshot.ccr_bps` from the fixture, independent of the computed `ccr_bps` value:
   ```rust
   #[test]
   fn entry_exposes_reported_ccr_bps_from_snapshot() {
       let mut loans = fixture_loans();
       loans[0].snapshot.ccr_bps = 13_200;
       let r = at(0, &loans, &[]); // no collateral map → computed ccr_bps is None
       assert_eq!(r.loans[0].reported_ccr_bps, 13_200);
       assert_eq!(r.loans[0].ccr_bps, None); // confirms the two fields are independent
   }
   ```
2. Extend `ccr_bps_is_collateral_over_outstanding_senior` (line 371) or add an adjacent assertion confirming that when both are present, `reported_ccr_bps` and the computed `ccr_bps` can legitimately differ (fixture default `ccr_bps: 11_750` on the snapshot vs. the collateral-derived `15_625` computed in that test) — this is the core behavior the Issue is asking for, so it's worth a direct assertion rather than relying on the new test alone.
3. No new fixture helper needed — `make_loan` already takes/sets `ccr_bps` internally (fixture default `11_750`); tests override `loans[0].snapshot.ccr_bps` directly as line 561-562 already does for other snapshot fields.

Run `cargo test -p pipeline-api --test loan_book` to verify, then `cargo clippy --all -- -D warnings` per `AGENTS.md`.

## Docs to Update

- `docs/product-specs/trustee-dashboard.md:172` — Loans page row description (see Implementation Step 4).
- No OpenAPI doc file to hand-edit — `LoanBookEntry` derives `ToSchema` (`utoipa`), so the new field's doc comment automatically flows into the generated schema at build time.
