# Issue #813: Trustee: implement the Origination page (Figma 4116-9155)

Source: https://github.com/eq-lab/pipeline/issues/813

## Scope

Replace the placeholder body of `packages/trustee/src/routes/origination.tsx` (#786) with
the real Origination page per Figma node `4116:9155`: a page heading "Origination" plus a
white card containing a submissions **table** driven by live data from
`GET /v1/loan-book/submissions` (Stellar-scoped, `chain_id=99000001`), and the static
footer note. Add a trustee-local submissions hook and a `loan_data` field extractor
(mirroring the LP parsing conventions), plus a trustee-local date formatter.

In scope:
- New hook `packages/trustee/src/api/useLoanSubmissions.ts` (TanStack Query via the trustee
  `apiFetch`; bearer token injected automatically; singleton QueryClient already provided in
  `main.tsx`). Sends `chain_id=ENV.STELLAR_CHAIN_ID` and polls every 30 s, mirroring
  `useCapitalAllocation.ts`.
- Typed `loan_data` interfaces (`SubmitLoanRequest`, `EconomicsInput`, `LocationInput`,
  `SubmissionView`) mirroring `packages/frontend/src/api/useLoanSubmissions.ts`. Note the LP
  hook types `loan_data` as `SubmitLoanRequest` directly; the backend serializes it as
  `serde_json::Value` (verbatim passthrough), so the extractor must defensively handle
  missing/malformed nested fields and render `—` (never fabricate).
- A field extractor that maps each `SubmissionView` → a formatted table row (a co-located
  logic hook, per FRONTEND.md rule 2 — view is JSX only).
- New table view built per Figma with tokens (no `@pipeline/ui` table primitive exists;
  the LP built its `LoanBookTable` bespoke — same approach here). Columns:
  Originator · Commodity/valuation · Facility · Corridor · Rate · Maturity · Submitted ·
  (action/status column — see Open Questions).
- Trustee-local date formatter (added to `packages/trustee/src/utils/`; none exists today).
  Facility uses the existing `formatFullUsd` (Figma shows `$3,500,000`, fully expanded).
- Loading / error / empty states (mirror the `CapitalAllocationCard` state pattern).
- Static footer note (verbatim from Figma).
- Colocated tests: `packages/trustee/src/routes/-origination.test.tsx` (extend),
  `packages/trustee/src/api/-useLoanSubmissions.test.tsx` (new), and the extractor hook test.

Out of scope:
- Any backend change (`loan_book.rs` unchanged — the endpoint already serves everything the
  frontend consumes verbatim).
- The Protocol Dashboard In-Origination tab (#814, separate issue; this plan proposes the
  consistency approach only).
- Any Review/approve action wiring (see Open Questions — no target route exists yet).
- Trustee must **NOT** import `@pipeline/frontend` (epic #775 keeps the apps separate) — all
  shared conventions are mirrored, not imported.

## Assumptions and Risks

- **Field mapping (from `loan_data` = verbatim `SubmitLoanRequest`, confirmed in
  `packages/api/src/routes/loan_book.rs` lines 174–200 and the LP types):**
  - Originator → `SubmissionView.originator` (top-level, NOT `loan_data.originator`; both
    exist — use the top-level authenticated submitter, matching the LP `SubmissionView`).
  - Commodity → `loan_data.commodity`.
  - Facility → `loan_data.economics.original_facility_size` — base-6 decimal string already
    in human units (`"3500000.000000"` = $3,500,000). Use `formatFullUsd` (NOT `parseUnits`
    / `formatUsdc`); Figma shows the fully-expanded form.
  - Corridor → `loan_data.corridor` (e.g. `"PE → CN"`). Rendered verbatim.
  - Rate → `loan_data.economics.senior_interest_rate_bps` (integer bps) → percent
    (`1400` → `"14.0%"`). Mirror the LP `formatBpsRate` (bps / 100, one decimal).
  - Maturity → `loan_data.economics.original_maturity_date` — **Unix seconds** (`u64` in the
    backend `EconomicsInput`), format as `"15 Dec 2026"`.
  - Submitted → `SubmissionView.created_at` — **RFC 3339 string**, format as `"18 Jun"` (the
    Figma shows day+month only for Submitted, vs day+month+year for Maturity — two distinct
    date formats; confirm against Figma at build time).
  - Status → `SubmissionView.status` (`InReview` | `Approved` | `Rejected`).
- **Risk — valuation method is NOT in `loan_data`.** `SubmitLoanRequest` has no
  valuation-mode field. `ValuationMode` (`StandardGoods` | `MetalConcentrate`) lives in the
  `loan_collateral_valuations` table keyed by `(chain_id, loan_id)`; it is only exposed via
  `GET /v1/loan-book/{loan_id}/valuations`, which requires an on-chain `loan_id`. Submissions
  in origination are pre-mint (no `loan_id`). So the "NSR · Net Smelter Return" /
  "Standard · price × quantity" sub-line has no clean backend source for this surface. See
  Open Questions. Default behaviour absent a decision: render the valuation sub-line as `—`
  (never fabricate / infer from commodity string).
- **Risk — the LP `useDeploymentMonitorPanel` maps a *smaller, different* column set**
  (Borrower/Commodity, Principal, Collateral, LTV, Duration, Rate, Protection, Status) — it
  does NOT surface Corridor, a formatted Maturity date, a formatted Submitted date, or a
  valuation method. So the "mirror the LP parsing" instruction can only be honored for the
  *shared* conventions (base-6 handling, bps→percent, `loan_data` shape, `—` fallbacks), not
  as a literal 1:1 row-mapping copy. The trustee extractor is a superset. This is expected;
  #814 will need to widen the LP mapping to match — flagged for cross-issue consistency.
- **Risk — the action/status column (Figma col 8) is heterogeneous:** row 1 (InReview) shows
  a navy `#000080` "Review" button; row 2 (Approved) shows a green "Approved & minted · <date>"
  pill. No Review target route exists in the trustee app (routes today: `/`, `/origination`,
  `/loans`, `/cash-management`, `/risk-council`, `/audit-log`, `/sign-in`). See Open Questions.
- **Risk — the green pill copy is status-specific and only the Approved variant is in Figma.**
  No InReview-pill or Rejected-pill design is provided (InReview shows a button instead). The
  "& minted · <date>" suffix implies on-chain mint state that this endpoint does not report.
  See Open Questions.
- The endpoint returns all statuses newest-first (no `?status=` filter), matching the LP
  convention. Assume the same ordering; do not re-sort client-side unless Figma dictates.
- `@pipeline/ui` `Card` is available and used by the trustee (`CapitalAllocationCard`) — reuse
  `Card variant="white" padding="none"` for the outer card.

## Open Questions

- **Valuation method derivation** — the "NSR · Net Smelter Return" / "Standard · price ×
  quantity" sub-line has no field in `loan_data`/`SubmissionView`; `ValuationMode` lives in
  `loan_collateral_valuations` keyed by on-chain `loan_id`, which pre-mint submissions lack.
  How should the trustee derive it? Options: (a) render `—` until a backend field is added;
  (b) add `valuation_mode` to `SubmissionView`/`loan_data` (backend change, out of this
  issue's frontend scope); (c) map from `commodity` client-side (rejected — violates
  [no frontend-computed metrics]). Needs a product/decision call.
- **Action column (Review button)** — the Figma InReview row shows a navy "Review" button,
  but no submission-review/detail route exists in the trustee app. Is the button in scope for
  #813 (and if so, what is its target/behavior), or is it out of scope (render status only,
  or an inert/disabled button) pending a later sub-issue of epic #775?
- **Status → pill/label copy mapping** — Figma only shows the Approved pill
  ("Approved & minted · <date>"). What are the exact label + styling for InReview and
  Rejected? Does InReview render a "Review" button (no pill) as the Figma suggests, and does
  Rejected get a red pill? Is the "& minted · <date>" suffix (and its date source —
  `updated_at`?) correct given the endpoint reports no on-chain mint state?
- **Shared vs. mirrored `loan_data` extraction between #813 and #814** — proposal: keep the
  extractor **trustee-local (mirrored)** for this issue to avoid cross-app coupling (epic #775
  rule; matches the `formatUsd.ts` precedent and its TD note in
  `docs/exec-plans/tech-debt-tracker.md`), and log the eventual consolidation as tech debt.
  #814 widens the LP mapping to the same superset of columns. Confirm this is acceptable vs.
  extracting a shared package now.

## Implementation Steps

1. **Types + hook** — create `packages/trustee/src/api/useLoanSubmissions.ts`:
   - Port the typed interfaces from `packages/frontend/src/api/useLoanSubmissions.ts`
     (`EconomicsInput`, `LocationInput`, `SubmitLoanRequest`, `SubmissionView`), keeping the
     base-6 / RFC-3339 / Unix-seconds doc comments. Do NOT import from `@pipeline/frontend`.
   - Hook mirrors `useCapitalAllocation.ts`: `useQuery` with
     `queryKey: ["loan-submissions", chainId]`, `queryFn` calling
     `apiFetch<SubmissionView[]>(\`/v1/loan-book/submissions?chain_id=${chainId}\`)`,
     `refetchInterval: 30_000`, `chainId = ENV.STELLAR_CHAIN_ID`. Return
     `{ data, isLoading, error, refetch }`.

2. **Date formatter** — add `packages/trustee/src/utils/formatDate.ts` (none exists):
   - `formatMaturityDate(unixSeconds: number | null | undefined): string` → `"15 Dec 2026"`
     (`en-GB`, `day: "2-digit"|"numeric"`, `month: "short"`, `year: "numeric"`), `—` on
     missing/invalid.
   - `formatSubmittedDate(rfc3339: string | null | undefined): string` → `"18 Jun"` (day +
     short month, no year), `—` on missing/invalid.
   - Confirm the exact `en-GB` vs `en-US` day/month order against Figma at build time.

3. **Rate/percent + valuation helpers** — either extend `formatUsd.ts` or add to a small
   `packages/trustee/src/utils/format.ts`: `formatBpsRate(bps: number) → "14.0%"` (mirror the
   LP `formatBpsRate`). Valuation-method label helper returns `—` by default (see Open
   Questions); do not infer from commodity.

4. **Extractor / logic hook** — add `packages/trustee/src/routes/useOriginationTable.ts` (or
   colocated with the view): maps `SubmissionView[]` → typed row objects
   `{ originator, commodity, valuation, facility, corridor, rate, maturity, submitted, status }`,
   each field defensively read from `loan_data` (which is `serde_json::Value` on the wire) and
   `—` when missing/unparseable. Derive `state: "loading" | "error" | "empty" | "ready"` and
   `errorMessage` from the hook, mirroring `useCapitalAllocationCard.ts`.

5. **Table view + page** — rewrite `packages/trustee/src/routes/origination.tsx` body:
   - Keep the `createFileRoute("/origination")` export and the "Origination" heading (reuse
     the display-font heading token already in the placeholder).
   - Render a `Card variant="white" padding="none"` with the table. Build header row + body
     rows per Figma tokens (column widths, `pb-[12px] px-[14px]` header cells, `border-t`
     row separators, `#262524`/`rgba(56,55,53,0.6)` text colors, `16px`/`14px`/`12px` sizes,
     Inter regular/semibold, `rounded-[4px]` border container). Use CSS tokens where they
     exist (`--color-pipeline-ink`, `--color-pipeline-ink-muted`, `--radius-pipeline-card`);
     document Figma one-offs inline as `CapitalAllocationCard` does.
   - Commodity cell stacks the commodity (16px ink) over the valuation sub-line (12px muted).
   - Status/action column: render per the Open-Questions resolution (default: green
     Approved pill using `--color-pipeline-positive-primary` / `rgba(32,128,0,*)` from the
     Figma; InReview/Rejected pending decision — render a neutral status label as a safe
     placeholder if the Review-button scope is deferred).
   - Loading → skeleton rows; error → the `role="alert"` error box pattern from
     `CapitalAllocationCard`; empty → an empty caption ("No loans in origination").
   - Static footer note rendered verbatim (13px, `rgba(56,55,53,0.6)`, `pt-[18px]`).
   - Add stable `data-testid` anchors (`origination-table`, `origination-row`,
     `origination-loading|error|empty`, `origination-status-<id>`).

6. **Lint** — run `npx tsx scripts/lint-docs.ts` (docs) and the TS/ESLint checks. Ensure no
   `@pipeline/frontend` import and no direct `fetch` outside `src/api/` (ESLint
   `no-restricted-globals`, TD-33).

7. **Tech-debt note** — append the trustee/LP extractor-duplication + the deferred
   valuation-method/Review-button items to `docs/exec-plans/tech-debt-tracker.md` (do not fix
   inline), consistent with the `formatUsd.ts` TD precedent.

## Test Strategy

Colocated `-*.test.tsx` (Vitest + Testing Library), matching the trustee convention. Sandbox
fallback: `node node_modules/.bin/vitest run` under Node 20 if the workspace runner breaks.

- **`packages/trustee/src/api/-useLoanSubmissions.test.tsx`** (new, model on
  `-useCapitalAllocation.test.tsx`): mock `@/lib/env` + `@/auth/sessionStore`, stub `fetch`;
  assert (a) request URL includes `chain_id=99000001`; (b) bearer header attached;
  (c) success returns parsed `SubmissionView[]`; (d) error path populates `error`;
  (e) `refetchInterval` 30 s.
- **Extractor/logic hook test**: given a full fixture submission → correct formatted row
  (facility `$3,500,000`, rate `14.0%`, maturity `15 Dec 2026`, submitted `18 Jun`); given
  a submission with missing/malformed `loan_data.economics` → all affected fields `—` (no
  throw, no fabrication); status mapping for `InReview` / `Approved` / `Rejected`; valuation
  sub-line renders per the resolved Open Question (default `—`).
- **`-origination.test.tsx`** (extend the smoke test): still renders the "Origination"
  heading; renders table rows for a mocked `useLoanSubmissions`; renders loading / error /
  empty states; renders the static footer note; asserts `—` for a missing field.
- Edge cases: empty submissions array (empty state), non-numeric `senior_interest_rate_bps`,
  missing `economics`, unparseable dates, unknown `status` string (typed as
  `string & Record<never, never>` in the LP union — render safely).

## Docs to Update

- `docs/exec-plans/tech-debt-tracker.md` — log the trustee↔LP `loan_data` extractor
  duplication (parallel to the existing `formatUsd.ts` TD) and the deferred valuation-method
  + Review-button items.
- No product-spec change required: this is a frontend rendering of an existing endpoint and
  an existing spec surface. If the valuation-method Open Question resolves toward a new
  backend field, that is a separate backend issue with its own spec update
  (`docs/product-specs/collateral-valuation.md` / the loan-book submissions spec).
- No `docs/product-specs/trustee-dashboard.md` behavioral change beyond the route now
  rendering real data; update its Origination section only if a decision adds the Review flow.
</content>
</invoke>
