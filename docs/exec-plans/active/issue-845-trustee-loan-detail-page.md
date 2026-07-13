# Issue #845: Trustee Loan detail page — hero + Price & collateral (Figma 4116-10549)

Source: https://github.com/eq-lab/pipeline/issues/845

Sub-issue of Epic #775 (Trustee Admin Panel). Builds on the Loans list page (#843,
branch `feat/843-trustee-loans-page`, PR #844) — this branch is stacked on it.

## Scope

Add a per-loan **detail page** in `packages/trustee`, reachable by clicking a loan row
on `/loans` (#843). Figma node `4116-10549`. Implement **only two sections**:

1. **Hero header** — `‹ Loans` back link · `originator · commodity` title · status chip ·
   meta line (`Loan #<id> · <corridor> · matures <date> · <N> days left`).
2. **"Price & collateral" card** — spot, quantity, collateral value (after haircut),
   senior outstanding, CCR.

Everything else in the Figma is **out of scope**: the Deal-journey stepper, the three
summary tiles (Facility/disbursed, Repaid to date, Interest to distribute), the
"Registry state & derived" card, the "Current stage — … in transit" card + its action,
and the "Other actions on this loan" block. Any of these added later is a separate issue.

## Resolved gating decision (human, issue #845 comment)

`GET /v1/loan-book` (`LoanBookEntry`, `loan_book.rs:140`) exposes **no loan id**, so the
frontend had nothing to route to `/loans/$id` with, nor to call the valuations endpoint.
**Decision:** add `loan_id` to the loan-book list **within #845** (small backend change),
mirrored on the trustee frontend type. #845 therefore touches **backend + frontend**
(keeps the `frontend` flow label; the backend delta is a single field).

## Data sources

- **Hero identity** — the clicked `LoanBookEntry`, passed via router navigation state from
  the `/loans` row (mirrors `/origination/$id`, #821/#823). Fields available: `originator`,
  `commodity`, `status`, `maturity`, `spot_change_7d`, and (new) `loan_id`. Direct-URL /
  refresh loses state → refetch `/v1/loan-book` and find the row by `loan_id`; render a
  not-found state if absent (mirrors `-origination-detail.ts`).
- **Price & collateral** — `GET /v1/loan-book/{loan_id}/valuations`
  (`packages/api/src/routes/collateral_valuation.rs`), Stellar-scoped
  (`chain_id = ENV.STELLAR_CHAIN_ID`), 30 s poll — same convention as `useLoanBook`.

### Price & collateral field map (Figma → `CollateralValuationResponse`)

| Figma row | Backend source | Notes |
|---|---|---|
| `Spot (off-chain API)` → `Li₂CO₃ $10,450/t · -1.2% 7d` | `inputs.reference_price_asset`, `inputs.reference_price` (+ `spot_change_7d` from the nav-state row) | no `/t` unit is served — omit it; 7-day change comes from the loan-book row, not this endpoint |
| `Quantity (trustee feed)` → `620 t` | `inputs.quantity_dmt` | `—` when null |
| `Collateral value (after 10% haircut)` → `$5,831,100` | `collateral_value`, `inputs.haircut_pct` | `—` when null (`missing_inputs`) |
| `Senior outstanding` → `$0 …` | `ccr.outstanding_senior_principal` | `—` when `ccr` null; repaid-date qualifier NOT served → omit |
| `CCR` → `n/a — price risk closed` | `ccr.ccr_pct` (or `n/a` when `ccr` null) | "price risk closed" qualifier NOT served → omit |
| card sub-header `feed 2h old · recalcs every 60 min` | — | no price timestamp served → keep only the static "recalcs every 60 min", or omit the age |
| `Last on-chain write: CCR 135% · …` | — | NOT served → omit |

## Assumptions and Risks

- **RISK — valuation amounts are plain USD, NOT registry base-6.** The valuations endpoint
  returns `collateral_value` / `ccr.*` as already-computed 2-decimal USD strings (see
  `collateral_valuation.rs::usd`). The `#840` ×1000 registry workaround does **NOT** apply
  here — do not scale these. (The list-page senior-outstanding was registry-sourced; this
  endpoint's `outstanding_senior_principal` is already divided by `USDC_SCALE`.)
- **RISK — `ccr` here is correctly scaled**, unlike the list's `ccr_bps` (#843's ÷1000
  workaround). This endpoint computes CCR from `outstanding_senior_principal` in plain USD,
  so `ccr.ccr_pct` is display-ready — no correction.
- **404 / missing inputs.** The endpoint 404s when a loan has no valuation anchor and nulls
  the computed sections when inputs are absent; the card degrades to `—`/`n/a`, never crashes.
- **`corridor` is unavailable** anywhere (neither the list row nor the valuations endpoint)
  → omit from the hero meta (never fabricate).
- Trustee app must not import `@pipeline/frontend` (epic #775) — the valuation hook + types
  are **hand-mirrored** (TD-42); log the new duplication.

## Open Questions (non-gating — never-fabricate defaults below; confirm at review)

1. **Hero meta "N days left"** — derivable from `maturity` (nav-state) vs now, like the #843
   CCR staleness age (a display transform of a served field, not a fabricated metric).
   Default: render it. Confirm.
2. **Unbacked qualifiers** — spot feed **age** ("2h old"), senior-outstanding **repaid date**
   ("principal repaid 24 Jun"), the CCR **"price risk closed"** phrase, and the
   **"Last on-chain write …"** history line have no data source. Default: omit them, keep the
   served values only. Confirm.

## Implementation Steps

### 1. Backend — expose `loan_id` on the loan-book list
`packages/api/src/routes/loan_book.rs`: add `pub loan_id: String` to `LoanBookEntry`
(doc it), and populate it in the entry builder (`~:920`) with `loan_key(&loan.loan_id)`
(the canonical normalized decimal string the valuations endpoint round-trips via
`BigDecimal::from_str`). Update `packages/api/tests/loan_book.rs` expectations. `cargo test`.

### 2. Frontend — mirror `loan_id` on the trustee type
`packages/trustee/src/api/useLoanBook.ts`: add `loan_id: string` to `LoanBookEntry` (+ header
note). Update #843 fixtures/tests that construct a `LoanBookEntry`.

### 3. Valuation hook + types
New `packages/trustee/src/api/useLoanValuation.ts`: `useLoanValuation(loanId)` →
`GET /v1/loan-book/{loanId}/valuations?chain_id=<STELLAR_CHAIN_ID>`, queryKey
`["loan-valuation", chainId, loanId]`, `refetchInterval: 30_000`. Self-contained
`CollateralValuationResponse` / `CollateralValuationInputs` / `Ccr` types (only the fields
this page reads), matching `collateral_valuation.rs`. Header: base-6/scale note (these are
plain USD, NOT registry-scaled) + TD-42 duplication.

### 4. Presenter hook `-useLoanDetail.ts`
Route-private (`-` prefix, `.tsx` render-only per FRONTEND.md rule 2). Takes `loanId` + the
nav-state `LoanBookEntry`; composes `useLoanValuation` (+ `useLoanBook` fallback for
direct-URL). Exposes a `state` discriminant (`loading | not-found | ready`), a **hero**
view-model (title, status chip kind+label, meta line with `formatMaturityDate` + days-left),
and a **priceCollateral** view-model (spot line, quantity, collateral+haircut, senior
outstanding, CCR), every field `—`/`n/a` on null. Unit-testable, no DOM.

### 5. Route page `loans.$id.tsx`
`createFileRoute("/loans/$id")`, render-only. Hero + the Price & collateral card per the
Figma token map (below). Reuse the #843/`origination.$id` status-pill + card styling.
loading / not-found states mirror `origination.$id.tsx`.

### 6. Wire row-click on `/loans`
`packages/trustee/src/routes/loans.tsx` (#843): make each row / the trailing chevron
navigate `{ to: "/loans/$id", params: { id: row.loanId }, state: { entry } }`
(row-click precedent: `origination.index.tsx` #823). The row needs the `loan_id` from step 2
threaded into its view-model (`-useLoansTable.ts`).

### 7. Figma → token map (document in the `loans.$id.tsx` header)
| Figma | Token / value |
|---|---|
| `‹ Loans` back link `Besley 18px / #262524` | `font-display text-[18px] leading-[25.2px]` ink; `Link to="/loans"` |
| Title `Besley 44px / #262524` | `font-display text-[44px] leading-[48.4px]` ink |
| Status chip (Performing) `bg rgba(32,128,0,0.08)` / border `rgba(32,128,0,0.3)` / `#208000` | reuse #843 loan-status pill tokens (positive-primary; Watchlist amber `#6e6400`; Default/red `#b20000`) |
| Meta line `Inter 14px / rgba(56,55,53,0.6)` | `font-body text-[14px]` ink-muted |
| Card `bg-white border rgba(56,55,53,0.18) rounded-[4px]` | `--color-pipeline-surface`, `LINE_COLOR` |
| Card title `Besley 28px` · sub-header `Inter 12–13px` ink-muted | `font-display text-[28px]`; ink-muted |
| Row label `Inter 15px` ink-muted · value `Inter 16px` ink; negative spot `#b20000` | reuse `origination.$id` `TermRow` shape |

### 8. Tests + docs
- `packages/api/tests/loan_book.rs` — assert `loan_id` present/correct (step 1).
- `-useLoanValuation.test.tsx` — URL/queryKey/poll/error (mirror `-useLoanBook.test.tsx`).
- `-useLoanDetail.test.ts` — hero + price-collateral mapping, `—`/`n/a` on null, days-left,
  not-found precedence.
- `loans.$id` render test — hero, card rows, loading/not-found.
- `loans.tsx` — row-click navigates with `loan_id` + entry state.
- Append the new trustee `useLoanValuation` duplication to **TD-42**; run `npx tsx scripts/lint-docs.ts`.

## Test Strategy
`yarn workspace @pipeline/trustee test` + `cargo test -p api loan_book` green before handoff;
`build` + `lint` clean.

## Docs to Update
- `docs/exec-plans/tech-debt-tracker.md` — extend TD-42 with the valuation-hook duplication.
- `loans.$id.tsx` header carries the Figma node id (`4116-10549`) + token map (step 7).
