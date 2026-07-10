# Issue #843: Trustee: Loans page (Figma 4116-9989) — /v1/loan-book, frontend filtering, pre-default flag

Source: https://github.com/eq-lab/pipeline/issues/843

Sub-issue of Epic #775 (Trustee Admin Panel). Frontend flow (`frontend` label). Depends on
the `/v1/loan-book` shape shipped by #833/#834 (Trustee Loans-page portfolio metrics) — already
merged into `packages/api/src/routes/loan_book.rs` (verified below).

## Scope

Replace the `/loans` placeholder body in `packages/trustee` with the real Trustee **Loans** page
per Figma node `4116-9989`, driven by live `GET /v1/loan-book` data (Stellar-scoped `chain_id`):

- Five summary/portfolio metric cards: Deployed senior · At-risk (WL + Default) · Weighted rate ·
  Weighted tenor · Top concentration.
- A status filter tab-bar (Performing / Watchlist / Default / Closed) with per-status counts.
- The active-loan table: Originator · Commodity·spot · Senior outst. · Collateral · CCR ·
  Maturity · Stage (+ trailing chevron cell), with the CCR-band footnote.
- **Client-side only** filtering/sorting of the returned `loans[]` (no backend query params).
- **Pre-default classification**: a loan is "pre-default" when its served CCR is below a
  **120% maintenance-margin** named constant (display classification on the served `ccr_bps`
  field — like the status-colour pattern; NOT a backend at-risk flag).
- A trustee-side `useLoanBook` hook + self-contained types (hand-mirrored, not shared).
- A hand-mirrored `scaleRegistryAmount` / `formatRegistryCompactUsd` (#840 ×1000 workaround)
  applied to registry-sourced loan amounts only.

**Out of scope** (see Open Questions — need human decision before building these):

- The "Payments due — N items" banner + "Record coupon" action (no backend data source).
- A per-loan detail route behind the row chevron (`›`) — no such route exists; not in this issue.
- Any backend change to `/v1/loan-book` (frontend-only issue).

Route + nav are **already wired**: `packages/trustee/src/routes/loans.tsx` exists with
`createFileRoute("/loans")`, and `TRUSTEE_NAV_ITEMS` already carries the `/loans` item and the
sidebar `LoansIcon` (#786). No new route registration or nav wiring is required — only the page
body is replaced.

## Assumptions and Risks

### Backend shape (verified in `packages/api/src/routes/loan_book.rs`, post-#833/#834)

`LoanBookResponse = { summary: LoanBookSummary, loans: LoanBookEntry[] }`.

`summary` (Trustee-facing fields used here):
- `deployed_senior: string` — Σ **outstanding** senior, base-6 decimal string. **Registry-sourced ⇒ scale ×1000.**
- `at_risk_wl_and_default_pct: string | null` — 4-decimal fraction (e.g. `"0.0430"`). **Backend-computed ratio (see risk below).**
- `at_risk_wl_and_default_senior: string` — base-6 decimal string. **Registry-sourced ⇒ scale ×1000.**
- `weighted_rate: string | null` — decimal fraction (e.g. `"0.131000"`). Not an amount; do NOT scale.
- `weighted_tenor_days: number | null`.
- `top_concentration: { commodity: string, share: string } | null` — `share` is a 4-decimal fraction. **Ratio of two registry amounts ⇒ scale cancels ⇒ correct; do NOT scale.**
- (also present but not shown here: `total_deployed`, `total_collateral`, `senior_debt_coverage`, `avg_yield`, `avg_duration_days`.)

`loans[]` per-entry (`LoanBookEntry`), fields the Figma needs:
- `originator: string`, `commodity: string`, `status: string` (`"Performing"|"WatchList"|"Default"|…`).
- `senior_outstanding: string` — base-6 decimal string. **Registry-sourced ⇒ scale ×1000.** → "Senior outst." column (Figma renders full dollars `$1,840,000`).
- `collateral: string | null` — base-6 decimal string, **price-feed sourced (#706) ⇒ do NOT scale.** → "Collateral" column (Figma compact `$2.10M`).
- `ccr_bps: number | null` — CCR in bps (`14000` = 140%). → "CCR" column + pre-default threshold.
- `ccr_reported_at: number` — Unix seconds; `0` when never reported. → CCR staleness chip ("1h" / "26h" age).
- `spot_price: string | null`, `spot_change_7d: string | null` (7-day change fraction). → "Commodity · spot" sub-line.
- `maturity: number` — Unix seconds (rollover-aware). → "Maturity" column.
- Also `principal`, `senior_outstanding`, `ltv`, `duration_days`, `rate`, `protection`, `documents` (unused by this page except as noted).

### RISK 1 (correctness) — scale-mixed ratio fields: `ccr_bps`, `at_risk_wl_and_default_pct`

These are **backend-computed ratios that mix a registry-scaled numerator/denominator with a
price-feed (correct-scale) one**, so the ×1000 amount helper cannot repair them:
- `ccr_bps = collateral (correct) / outstanding_senior (registry, 1000× low) × 10000` → **1000× too BIG**. A true 130% CCR is served as ≈130000%.
- `at_risk_wl_and_default_pct = at_risk_senior (registry, 1000× low) / NAV-collateral (correct)` → **1000× too SMALL**.

Consequence: when collateral data is present, the CCR column, the At-risk % headline, and the
**pre-default 120% classification (decision #2) are all wrong by 1000×** — the `< 120%` test would
essentially never fire. In current dev/testnet data the collateral price feed (#706) is largely
unwired, so `collateral`/`ccr_bps` are typically `null` → cells render `—` and the classifier never
triggers (the page degrades gracefully, does not crash). But this is a latent correctness landmine
the moment collateral lands. **This is Open Question 1** — the resolved decision #2 assumed a clean
served CCR; the scale-mix means the threshold may need to operate on a frontend-corrected CCR
(collateral ÷ scaled senior) rather than the raw served `ccr_bps`, which is a design/backend
decision beyond a pure display threshold.

### RISK 2 (data availability) — Default & Closed tabs

`loans[]` contains only the **active** set (`origination_date <= now < effective_end`). A loan's
`effective_end` is capped by its earliest `LoanDefaulted`/`LoanClosed` event, so **defaulted and
closed loans are excluded from `loans[]`** — only `Performing` and `WatchList` loans are returned.
Frontend-only filtering therefore **cannot populate the Default or Closed tabs** (they would always
be empty / count 0), even though the Figma shows Default (1) and Closed (2) with rows. **Open Question 2.**

### RISK 3 — Figma elements with no `/v1/loan-book` backing

- **"Payments due — 1 item" banner + "Record coupon" button** — no coupon/payments field anywhere in the response. **Open Question 3.**
- **Stage column qualifiers** ("· Risk Council", "· feed stale") — `status` is served, but the suffix has no backend field.
- **Spot sub-line** "$4,500/t · −18% 30d" — served `spot_price` is a plain USD number (no `/t` per-tonne unit in the data) and served `spot_change_7d` is a **7-day** change, not the Figma's "30d".
- **CCR staleness label** ("feed stale") — an age ("1h"/"26h") is derivable from the served `ccr_reported_at`, but the "feed stale" cutoff is not a served value.
- **Row chevron `›`** — implies a per-loan detail route that does not exist in scope.
- **"limit 10%"** on the Top-concentration card — a frontend-owned policy limit (backend doc confirms "the policy limit is frontend-owned"); a named constant, value to confirm.

Per the project rules **[no frontend-computed metrics]** and **never fabricate**, the plan's default
for the no-backing items is to render only what is served (omit the fabricated suffixes/units, keep
the real 7-day basis, render `—` for nulls). The items that visibly drop prominent Figma content
(payments banner, Default/Closed tabs) are surfaced as Open Questions rather than silently dropped.

### Other assumptions

- The trustee app must NOT import `@pipeline/frontend` (epic #775 keeps the apps separate) — the hook, types, and the #840 helper are **hand-mirrored** (TD-42 precedent). Log the new duplication under TD-42.
- Stellar-scoped `chain_id` = `ENV.STELLAR_CHAIN_ID`, 30 s poll — same convention as `useLoanSubmissions`/`useLoanBook`.
- Figma has no bound design variables (`get_variable_defs` returned `{}`); map raw Figma literals to the trustee `--color-pipeline-*` tokens (table below), matching the Origination-page precedent.

## Open Questions

1. **CCR / At-risk% scale-mix vs. the 120% pre-default threshold.** The served `ccr_bps` and `at_risk_wl_and_default_pct` are backend ratios mixing registry-scaled senior (1000× low) with correct-scale collateral, so `ccr_bps` is ~1000× too big and `at_risk_pct` ~1000× too small (RISK 1). The `#840` amount helper cannot fix a pre-computed ratio. Should the pre-default `<120%` classification and the CCR column instead be computed frontend-side from `collateral ÷ (scaledSenior)`, should we display the raw served `ccr_bps` as-is (accepting it is wrong once collateral lands), or is a backend fix expected first? (Decision #2 assumed a clean served CCR.)
2. **Default & Closed tabs have no data.** `/v1/loan-book` returns only active (Performing + WatchList) loans; defaulted/closed loans are excluded (RISK 2). With frontend-only filtering, should the Default and Closed tabs render but stay empty (count 0), be hidden until a backend source exists, or is a backend change expected to include them?
3. **"Payments due" banner + "Record coupon" action.** No coupon/payments-due data exists in `/v1/loan-book` (or a known sibling endpoint). Omit the banner+button entirely for this issue, or is there a data source / follow-up issue to wire?

(The remaining no-backing Figma details — Stage suffixes, spot `/t` + "30d" relabel, "feed stale"
label cutoff, row-chevron detail route, "limit 10%" value — are handled by the project's
never-fabricate / no-computed-metrics rules as described under RISK 3 and the steps below; they are
not gating, but the coder should follow the stated defaults.)

## Implementation Steps

### 1. Mirror the #840 registry-scale workaround into the trustee app

In `packages/trustee/src/utils/formatUsd.ts` add `scaleRegistryAmount(base6: string|null|undefined): string|null`
and `formatRegistryCompactUsd(base6): string`, byte-mirroring
`packages/frontend/src/utils/formatCompactUsd.ts` (×1000). Copy the `⚠️ TEMPORARY WORKAROUND for
#840` doc verbatim and adapt it to the trustee context. Apply **only** to registry-economics
amounts (`deployed_senior`, `at_risk_wl_and_default_senior`, per-loan `senior_outstanding`) — NOT to
`collateral`/`total_collateral` (price feed) or to ratio fields. Also confirm/keep a full-dollar
formatter for "Senior outst." (`formatFullUsd` already exists in this file). Add a companion
`formatRegistryFullUsd` (or apply `scaleRegistryAmount` then `formatFullUsd`) for the
full-dollar-with-separators column style (`$1,840,000`). Comment each call site as a #840 workaround.

### 2. Add the trustee `useLoanBook` hook + types

New `packages/trustee/src/api/useLoanBook.ts`, mirroring `packages/trustee/src/api/useLoanSubmissions.ts`
conventions (queryKey `["loan-book", chainId]`, `apiFetch`, `refetchInterval: 30_000`,
`chain_id=ENV.STELLAR_CHAIN_ID`). Port `LoanBookSummary`, `LoanBookEntry`, `TopConcentration`,
`LoanBookResponse`, `UseLoanBookResult` as **self-contained** types matching the post-#833
backend shape in `loan_book.rs` (include all new Trustee fields: `deployed_senior`, `weighted_rate`,
`weighted_tenor_days`, `at_risk_wl_and_default_senior`, `at_risk_wl_and_default_pct`,
`top_concentration`, and per-loan `senior_outstanding`, `ccr_bps`, `ccr_reported_at`, `spot_price`,
`spot_change_7d`, `maturity`). Document base-6/scale conventions in the file header (mirror the LP
hook's data-layer note + the #840 caveat). Note the TD-42 duplication.

### 3. Presenter hook `-useLoansTable.ts` (logic, unit-testable)

New `packages/trustee/src/routes/-useLoansTable.ts` (route-private `-` prefix, mirrors
`-useOriginationTable.ts` and `docs/FRONTEND.md` structure rule 2 — `.tsx` is render-only). It:
- Calls `useLoanBook()`, exposes a `state` discriminant (`loading|error|empty|ready`).
- Defines `MAINTENANCE_MARGIN_BPS = 12000` (**120%**, named constant) and a
  `classifyCcr(ccrBps): "healthy" | "attention" | "pre-default" | null` helper implementing the
  footnote bands (≥130% healthy, 120–130% attention, <120% pre-default/watchlist) — see Open
  Question 1 for the scale caveat; wire it to whichever CCR value Q1 resolves to.
- Maps each `LoanBookEntry` → a display-ready row: originator; commodity + spot sub-line
  (`formatSpot(spot_price, spot_change_7d)` → `"$4,500 · −18% 7d"`, real 7-day basis, `—` when
  null; no fabricated `/t`); `senior_outstanding` via the #840-scaled full-dollar formatter;
  `collateral` via compact USD (unscaled); `ccr_bps` → percentage + band colour + staleness age from
  `ccr_reported_at`; `maturity` → `"1 Aug 2026"` (add a `formatDate`-style helper in
  `packages/trustee/src/utils/formatDate.ts`); stage = mapped `status` label only (no suffix).
- Builds the summary-card view-model from `summary`: `deployed_senior` (#840-scaled compact),
  `at_risk_wl_and_default_pct` (→ `4.3%`) + `at_risk_wl_and_default_senior` (#840-scaled compact
  sub), `weighted_rate` (→ `13.1%`, one-decimal), `weighted_tenor_days` (→ `148d`),
  `top_concentration` (`share` → `7.2%`, unscaled; `commodity · limit N%` with `CONCENTRATION_LIMIT`
  named constant). `—` for every null.
- Computes per-status **counts** and applies the active tab's client-side status filter over
  `loans[]` (counts are a grouping of served rows, allowed — like the Origination status filter, not
  a derived metric). Handle the Default/Closed emptiness per Open Question 2.

Every field read defensively → `—`, never fabricated (mirror `safeString`/`safeNumber`).

### 4. Route body `loans.tsx` (render-only)

Rewrite `packages/trustee/src/routes/loans.tsx` to render, inside the trustee shell:
- The `Loans` heading (reuse the Origination heading style — `Besley 64px`, `rgba(56,55,53,0.3)`).
- The five summary cards (grid, per token map below).
- The status tab-bar (`Overlay+Border` pill group; active tab = white fill + ink text, inactive =
  muted; count chips), driven by local `useState` for the active status.
- The white card containing the (conditionally-omitted, per QO3) banner, the header row, the
  bordered body box with rows, and the CCR-band footnote (static text with green/yellow/red spans →
  `--color-pipeline-positive-primary` / the attention amber literal / `--color-pipeline-negative`).
- Loading (skeleton), error (alert), and empty states mirroring `origination.index.tsx`.
- Trailing chevron cell rendered as a decorative `›` glyph (no navigation — no detail route in scope).

Follow the Origination page's full-width CSS-grid table approach (`role="table"` + grid rows), not an
HTML `<table>`, for parity with the existing trustee table.

### 5. Figma → token/px mapping (document in the `loans.tsx` header comment)

| Figma literal | Trustee token / value |
|---|---|
| Page heading `Besley 64px / #382D…30%` (`rgba(56,55,53,0.3)`) | `font-display`, `text-[64px] leading-[64px]`, `text-[rgba(56,55,53,0.3)]` (same as Origination `h1`) |
| Card `bg-white`, `border rgba(56,55,53,0.18)`, `rounded-[4px]`, `px-[21px] py-[19px]` | `bg-[color:var(--color-pipeline-surface)]`, `LINE_COLOR = rgba(56,55,53,0.18)` inline border, `rounded-[4px]` |
| Card label `Inter 12.5px / rgba(56,55,53,0.6)` | `font-body text-[12.5px] leading-[17.5px] text-[color:var(--color-pipeline-ink-muted)]` |
| Card value `Besley 26px / #262524` | `font-display text-[26px] leading-[36.4px] text-[color:var(--color-pipeline-ink)]` |
| At-risk value red `#b20000` | `--color-pipeline-negative` (verify literal; if not exact, documented one-off like Origination's pills) |
| Tab-bar container `bg rgba(191,189,187,0.12)`, `border rgba(56,55,53,0.18)`, `p-[4px] gap-[2px] rounded-[4px]` | inline literals + `LINE_COLOR` (one-offs, Origination precedent) |
| Active tab `bg-white`, text `#262524`; inactive text `rgba(56,55,53,0.6)`; count `14px rgba(56,55,53,0.6)` | surface / ink / ink-muted tokens |
| White table card `bg-white pt-[36px] pb-[32px] px-[32px] rounded-[4px]` | `--color-pipeline-surface`, matching Origination card padding |
| Header cell `Inter 14px / rgba(56,55,53,0.6)`, `pb-[12px] px-[14px]` | reuse Origination `HEADER_CELL_CLASS` (ink-muted) |
| Body cell `Inter 16px / #262524`, `px-[14px]` ~80px rows; originator semibold | reuse Origination `BODY_CELL_CLASS`; originator `font-semibold text-[color:var(--color-pipeline-ink)]` |
| Table body box border `rgba(56,55,53,0.18)`, `rounded-[4px]`, row separators `border-t` | `LINE_COLOR` inline (Origination precedent) |
| CCR value `Inter Bold 16.5px`; red `#b20000` / amber `#6e6400` / green `#208000` | `--color-pipeline-negative` / attention amber one-off `#6e6400` / `--color-pipeline-positive-primary` (`#208000`) |
| Spot sub-line / staleness `12–12.5px rgba(56,55,53,0.6)`; negative change `#b20000` | ink-muted; negative → `--color-pipeline-negative` |
| Footnote `Inter 13px / rgba(56,55,53,0.6)` with coloured band spans | ink-muted + the three band colours above |

Confirm each `--color-pipeline-*` literal against `packages/trustee/src/index.css`; where no token
matches a Figma literal (amber `#6e6400`, the tab-bar alphas), use a documented inline one-off exactly
as `origination.index.tsx` / `TrusteeSidebar.tsx` do, and comment it.

### 6. Lint & tech-debt

Run `npx tsx scripts/lint-docs.ts` after any doc edit. Append a note to the existing **TD-42** entry
in `docs/exec-plans/tech-debt-tracker.md` recording the new trustee `useLoanBook`/loan-book-type +
`scaleRegistryAmount`/`formatRegistryCompactUsd` duplication (a fourth hand-mirroring), and cross-link
the #840 workaround so it is removed alongside the LP one when #840 is fixed.

## Test Strategy

Vitest unit tests (no DOM logic in the presenter), mirroring the existing trustee test suite:

- **`packages/trustee/src/utils/-formatUsd.test.ts`** (extend): `scaleRegistryAmount` (×1000, null/NaN passthrough), `formatRegistryCompactUsd`, and the registry full-dollar formatter — table-driven against the #842 cases.
- **`packages/trustee/src/routes/-useLoansTable.test.ts`** (new): `classifyCcr` band boundaries (119.99% → pre-default, 120% → attention, 129.99% → attention, 130% → healthy, `null` → null) using `MAINTENANCE_MARGIN_BPS`; row mapping (registry amounts scaled, collateral unscaled, spot sub-line real 7-day basis, `—` for every null field); summary view-model mapping (at-risk %, weighted rate/tenor, top-concentration share + limit constant); per-status counts and active-tab filtering; the Default/Closed behaviour chosen per Open Question 2; `loading|error|empty|ready` state precedence.
- **`packages/trustee/src/api/-useLoanBook.test.tsx`** (new): mirrors `-useLoanSubmissions.test.tsx` — correct URL (`/v1/loan-book?chain_id=<STELLAR_CHAIN_ID>`), queryKey, poll interval, error propagation, mocked `apiFetch`.
- **`packages/trustee/src/routes/-loans.test.tsx`** (replace the placeholder smoke test): renders with a mocked `useLoanBook` returning a representative response — asserts heading, the five cards, tab-bar + counts, table rows, pre-default red CCR styling on a `<120%` row, `—` on null cells, and the footnote. Include an empty-loans render.

Run `yarn workspace @pipeline/trustee test` (or the repo test script) — all green before handing back.

## Docs to Update

- `docs/exec-plans/tech-debt-tracker.md` — extend **TD-42** with the new trustee loan-book duplication + the #840 cross-link (Step 6).
- No product-spec change required: this is a frontend rendering of an existing endpoint. If Open Questions 2/3 resolve toward omitting Figma features, note the deviation in a comment on the issue (the manager owns that), not a spec edit.
- `packages/trustee/src/routes/loans.tsx` header comment must carry the Figma node id (`4116-9989`) + the token/px map (Step 5), matching the Origination-page documentation convention.
