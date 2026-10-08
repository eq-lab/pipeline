# Issue #963: Waterfall rejects a legitimate QP-repriced final settlement (HTTP 400)

Source: https://github.com/eq-lab/pipeline/issues/963

## Scope

`compute_waterfall` (`packages/api/src/routes/waterfall.rs`, stage 3) rejects any `amount`
greater than `original_offtaker_price − offtaker_received` with a hard `400`, on the premise
that "nothing legitimate can cause the offtaker to pay more than the contracted price." That
premise is false for a **metal concentrate**, which settles on a quotational-period average
(the first deal is 2 MAMA): `original_offtaker_price` is a genesis *estimate*, not a debt
ceiling. If the metal price rises over the QP the offtaker legitimately pays more, and the
**final payment of the loan cannot be recorded** (repro: fixture PIPE-GPC-001, final
settlement 1,764,807.37 vs outstanding 1,096,690.92 → 400). The Soroban contract's
`validate_repayment` imposes no such ceiling — only the API does.

**In scope**

- Make the stage-3 offtaker ceiling **conditional on the loan's pricing basis**: keep the
  hard `400` for fixed-price loans; for quotational (concentrate) loans accept the payment
  and **surface the overage** as an explicit response flag rather than rejecting.
- Derive the pricing basis from the loan's collateral-valuation anchor `valuation_mode`
  (`MetalConcentrate` ⇒ quotational; `StandardGoods` or no anchor ⇒ fixed).
- Add an `offtaker_overpaid` signal to the waterfall breakdown/response so the Operations
  Console (and the benign-close checklist) can show the QP overage explicitly instead of
  auto-greening for an unrelated reason.

**Out of scope**

- Any Soroban contract change (the contract already permits this; the ceiling is API-only).
- On-chain genesis fields / a new on-chain `pricing_basis` (no contract change).
- Building screen S15 (the close-loan checklist UI) — it does not exist in
  `packages/frontend/src` yet. This plan ships the `offtaker_overpaid` backend signal and
  updates the S15 design spec to consume it; **a follow-up issue builds S15** (see Docs /
  Open Questions #3).
- Quotational-period *price averaging* (that is #764 item 7); this issue only stops the API
  from rejecting an externally-supplied QP settlement `amount`.

## Assumptions and Risks

- **Pricing basis is derivable from `valuation_mode`.** A `MetalConcentrate` loan settles on
  an NSR/quotational basis; a `StandardGoods` loan is priced at a reference and is treated as
  fixed. This is the single always-present signal (the anchor is authored at submission). The
  offtake's `quotational_period` is a more literal marker but lives on append-only offtake
  rows the waterfall doesn't load; `valuation_mode` is simpler and sufficient. Risk: an
  unusual concentrate sold at a truly fixed price (or standard goods on a QP) would be
  mis-classified — acceptable for the current product, and the overage is surfaced (not
  silently mispaid) either way. See Open Questions.
- **Loans without a valuation anchor** (older loans, or loans predating the valuation
  system) resolve to `Fixed` and keep today's strict `400` — no behavior change for them.
- **Relaxing the ceiling removes a data-entry guard for quotational loans.** A typo'd
  over-large `amount` on a concentrate will now cascade into the equity residual instead of
  being rejected. Mitigation: the new `offtaker_overpaid` flag makes it visible for the
  Trustee to weigh before broadcasting — matching the existing philosophy of
  `offtaker_fully_received` ("surfaced for the Trustee to weigh rather than rejected"). No
  numeric tolerance cap is proposed (see Open Questions).
- **Extra DB read.** The handler gains one `get_anchor` lookup per waterfall request. Cheap,
  same `(chain_id, loan_id)` key, and tolerant of a missing anchor.
- **Signature churn.** `compute_waterfall` gains a `pricing_basis` parameter, touching ~25
  existing test call sites (all pass `PricingBasis::Fixed` to preserve current behavior).

## Open Questions

Resolved with the human before implementation:

1. **Pricing-basis source** — **derive from `valuation_mode`** (`MetalConcentrate` ⇒
   quotational; `StandardGoods` / no anchor ⇒ fixed). No new field, no migration.
2. **Quotational overage handling** — **accept with no numeric cap** and surface
   `offtaker_overpaid: true` (issue options 1 + 3). No tolerance knob.
3. **Benign-close checklist** — the checklist (item 3 "remaining offtaker balance
   acknowledged") exists only in the design assignment
   (`docs/design-docs/trustee-dashboard-v3-design-assignment.md` §3.2 / screen S15); there is
   **no close-loan checklist/modal in `packages/frontend/src` yet**. **Resolved:** ship the
   backend `offtaker_overpaid` signal (this plan) **and update the S15 design spec** so item 3
   consumes `offtaker_overpaid` rather than auto-greening on `received ≥ contracted price`.
   **Do not build screen S15 in this PR** — file a follow-up issue for the S15 close flow.
   This keeps #963 backend + docs only.

## Implementation Steps

**Status: all steps complete.** ✅ clippy (`--all --all-targets -D warnings`), ✅ doc lint
(0 errors), ✅ `cargo test --all` (57 blocks green; new: QP-accept, within-price, basis
mapping). S15 follow-up issue filed. Steps 1–6 implemented as written; `PricingBasis` lives
in `waterfall.rs`.

1. **Pricing-basis type.** Add a small enum — `PricingBasis { Fixed, Quotational }` — in
   `packages/api/src/routes/waterfall.rs` (or `shared` if cleaner), with a helper mapping a
   `ValuationMode` to it: `MetalConcentrate ⇒ Quotational`, `StandardGoods ⇒ Fixed`.

2. **Thread basis into the pure core.** Change
   `compute_waterfall(s, amount, as_of, fees, economics_events)` →
   `compute_waterfall(s, amount, as_of, fees, economics_events, pricing_basis)`.
   - Stage 3: compute `outstanding_offtaker = original_offtaker_price − offtaker_received` as
     today. If `amount > outstanding_offtaker`:
     - `PricingBasis::Fixed` → return the existing `400` (unchanged message).
     - `PricingBasis::Quotational` → do **not** reject; continue the cascade. The overage
       flows through the normal tiers (interest/OET/principal capped at their targets, then
       the residual to equity), exactly as a normal larger payment would.
   - Set a new breakdown field `offtaker_overpaid = amount > outstanding_offtaker` (true only
     when the payment exceeds the contracted price — for `Fixed` this is unreachable because
     that path already returned `Err`).
   - Update the stage-3 module doc comment to describe the conditional ceiling and why the
     concentrate/QP case is legitimate.

3. **Breakdown + response DTO.** Add `offtaker_overpaid: bool` to `WaterfallBreakdown` and
   `WaterfallResponse` (documented: "the settlement exceeds the genesis-contracted offtaker
   price — legitimate for a quotational-period concentrate deal; flagged for the Trustee").
   Map it in `build_response`.

4. **Handler wiring.** In `get_waterfall`, after loading the snapshot, look up the anchor via
   `state.collateral_valuation_repo.get_anchor(chain_id, &loan_id)`; map its `valuation_mode`
   to `PricingBasis` (default `Fixed` when the anchor is absent). Pass it into
   `compute_waterfall`. Update the `#[utoipa::path]` `400` description to note the ceiling
   applies to fixed-price loans only.

5. **Lint/build.** `cargo clippy --all --all-targets -- -D warnings`; `cargo build`.

## Test Strategy

All in `packages/api/tests/waterfall.rs` (pure, no DB — matches the file's convention):

- **Mechanical:** update every existing `compute_waterfall(...)` call to pass
  `PricingBasis::Fixed`; assert the current `amount_exceeding_outstanding_offtaker_is_rejected`
  still returns `Err` under `Fixed`.
- **New — quotational accepts the overage:** the issue's PIPE-GPC-001 numbers
  (`original_offtaker_price` 13,372,557.24 scaled to base units, `offtaker_received` = P1+P2 =
  12,275,866.32, final `amount` 1,764,807.37) under `PricingBasis::Quotational` returns `Ok`,
  cascades fully, sets `offtaker_fully_received = true` and `offtaker_overpaid = true`, and
  routes the overage into `equity_distributed` after senior principal is retired.
- **New — quotational within contract price:** `amount ≤ outstanding_offtaker` under
  `Quotational` behaves exactly as `Fixed` and leaves `offtaker_overpaid = false`.
- **New — fixed still rejects:** the same over-ceiling `amount` under `Fixed` returns `Err`
  (regression guard that the ceiling is preserved for fixed-price loans).
- **New — basis mapping:** `ValuationMode::MetalConcentrate ⇒ Quotational`,
  `StandardGoods ⇒ Fixed`.
- If the handler-level `valuation_mode → basis` mapping is extracted as a pure fn, unit-test
  it directly; the DB-touching `get_anchor` lookup stays untested here (no live Postgres).

## Docs to Update

- `docs/product-specs/loans.md` §"Genesis economics": note that for quotational-period
  (concentrate) deals `originalOfftakerPrice` is a genesis estimate, not a hard ceiling — the
  final settlement may exceed it when the metal price rises over the QP, and the waterfall
  surfaces an overage flag rather than rejecting. Keep the fixed-price ceiling statement.
- `docs/product-specs/trustee-dashboard.md` (and/or `yield.md` waterfall section): document
  the conditional stage-3 behavior and the new `offtaker_overpaid` response flag.
- `docs/design-docs/trustee-dashboard-v3-design-assignment.md` §3.2 (screen S15): amend
  benign-close checklist item 3 so it consumes the `offtaker_overpaid` signal — auto-green
  only when `offtaker_fully_received && !offtaker_overpaid`; a QP overage requires an explicit
  Trustee tick rather than auto-greening. (Spec change only; S15 UI is a follow-up.)
- Update the `waterfall.rs` module + stage-3 doc comments (covered in Step 2).
- Follow-up issue filed: **#982** — build screen S15 (close-loan checklist) consuming `offtaker_overpaid`.
