# Issue #821: Trustee: Origination details page /origination/:id — Loan Terms + Deal Details (NO collateral valuation)

Source: https://github.com/eq-lab/pipeline/issues/821

Sub-issue of epic #775. **Supersedes the closed #816** (which included a
Collateral Valuation card + `/valuations` wiring — now explicitly dropped).
Branch `feat/821-origination-details-page` is already checked out.

## Scope

Add the Trustee **Origination details / review page** at `/origination/$id`
and wire the currently-inert "Review" buttons on both list surfaces to
navigate to it.

In scope:

1. **New route** `packages/trustee/src/routes/origination.$id.tsx` (TanStack
   file-route param convention; `$id` = `SubmissionView.id`) + a colocated
   view-model hook `packages/trustee/src/routes/-origination-detail.ts`
   (mirrors the `origination.tsx` / `-useOriginationTable.ts` split per
   `docs/FRONTEND.md` rule 2).
2. **Wire the Review buttons** — currently inert `disabled` placeholders in
   BOTH `packages/trustee/src/components/NeedsAttention.tsx` (#818) and the
   `StatusCell` "in-review" case of `packages/trustee/src/routes/origination.tsx`
   (#813) — to navigate to `/origination/$id`, passing the clicked
   `SubmissionView` (its `id` + `loan_data`) via router navigation state. Keep
   keyboard-accessible.
3. **`SubmissionView.documents` port** — add the `LoanDocumentDto` type and the
   `SubmissionView.documents` field to `packages/trustee/src/api/useLoanSubmissions.ts`
   (backend already serves it, `loan_book.rs:235`). Apply **surgically** on top
   of current `main` — do NOT take the parked #816 file wholesale (see Risks).
4. **Data resolution:** render from the `SubmissionView` passed via router
   state; on direct-URL / refresh (no state) refetch from
   `GET /v1/loan-book/submissions` via `useLoanSubmissions` and match by `id`;
   graceful `not-found` state if absent; `loading` while the refetch is in
   flight.
5. **Render (Figma 4116-9292 MINUS collateral valuation):** breadcrumb,
   heading, backed-only chip(s), Loan Terms card, Deal Details card, inert
   footer action buttons.
6. Colocated tests: `-origination-detail.test.ts` (view-model) and
   `-origination-detail-page.test.tsx` (route render) + updates to the two
   list-surface tests for the new navigation behavior.

Out of scope (do NOT implement):

- The **"Collateral valuation — NSR" card** and everything under it
  (waterfall / CCR / inputs / freshness chip / the on-chain-ticks footnote).
  The Figma's valuation card is **incorrect**.
- `useCollateralValuation` hook and any call to
  `GET /v1/loan-book/{loan_id}/valuations`. Do not port the #816
  `useCollateralValuation.ts` / its test.
- The "All three mint invariants pass" and "Originator signature verified"
  green banners (no backend data source — never fabricate).
- The "NSR · Net Smelter Return" valuation-mode chip (it was
  `/valuations`-derived).
- Any real Approve / Reject / Request-changes behavior (Type-1 review/mint
  signing flow is a separate future sub-issue). Buttons render but are
  `disabled`/no-op.
- No `@pipeline/frontend` import (epic #775 keeps the two apps separate).

## Assumptions and Risks

- **The parked `feat/816-origination-details-page` branch is the primary
  reference.** Its `origination.$loanId.tsx` and `-origination-detail.ts` are
  directly reusable for everything that remains after removing the valuation
  card. Reuse the CheckIcon, DocumentIcon, StatusPill, NeutralChip, TermRow,
  LoanTermsCard, DealDetailsCard, ActionButtons subcomponents and the
  loan-terms / deal-details / heading / status-chip mapping verbatim; DROP
  `useCollateralValuation`, `ValuationDisplay`, `mapValuation`, the
  `CollateralValuationCard` / `ValuationInputsColumn` /
  `ValuationWaterfallColumn` components, and the `initial_ccr` /
  `freshnessLabel` logic.
- **RISK — do NOT copy #816's `useLoanSubmissions.ts` wholesale.** The #816
  branch predates #818: its version of that file *removes* the `status`
  filter (`SubmissionStatusFilter` / `UseLoanSubmissionsOptions` /
  `queryKey: ["loan-submissions", chainId, status ?? "all"]`) that current
  `main` relies on — `useNeedsAttention` (#818) calls
  `useLoanSubmissions({ status: "InReview" })`. Taking the #816 file verbatim
  would revert #818 and break Needs Attention. Apply ONLY the additive parts:
  the `LoanDocumentDto` interface and the `documents: LoanDocumentDto[]` field
  on `SubmissionView`. Leave the `status`-filter API intact.
- **Route param name:** the issue specifies `/origination/$id` (`id =
  SubmissionView.id`); #816 used `$loanId`. Use `$id` per the issue. TanStack's
  Vite plugin (`TanStackRouterVite`, `packages/trustee/vite.config.ts`)
  regenerates `routeTree.gen.ts` from the file name on dev/build; the coder
  should run the dev server or `vite build` once so the generated tree
  includes `/origination/$id` (and typecheck passes). Registering the route as
  a **child** of `/origination` vs a sibling depends on the existing
  `origination.tsx` being a non-layout leaf route — verify the generated tree
  resolves `/origination` (list) and `/origination/$id` (detail) as distinct
  paths; adjust file naming (`origination.index.tsx` split) only if the plugin
  forces it. #816 used a flat `origination.$loanId.tsx` alongside
  `origination.tsx` successfully, so the flat form is the expected shape.
- **`loan_data` is `serde_json::Value` on the wire** (declared
  `SubmitLoanRequest` for convenience). Every nested access must be guarded by
  the `safeString`/`safeNumber` helpers (already in `-origination-detail.ts`);
  missing fields render `—`, never throw, never fabricate.
- **Originator source:** heading / breadcrumb / Deal-Details "Originator" use
  `loan_data.originator` (the friendly name, e.g. "Auric Andes S.A.C."), NOT
  the top-level `SubmissionView.originator` (the authenticated submitter
  address the #813 table uses). This was a resolved decision on #816 — keep it.
- **Navigation state loss:** router `location.state` is dropped on a hard
  refresh / direct URL — hence the refetch-by-id fallback. `useLoanSubmissions`
  polls the public endpoint (no wallet needed), so the fallback always has a
  data source.
- Formatters (`formatFullUsd`, `formatBpsRate`, `formatMaturityDate`) and the
  corridor-arrow regex already exist and match the Figma — reuse, don't
  reimplement. `formatMaturityDate` produces the `"10 Jul 2026"` shape the
  Figma uses for both Start and Maturity dates.
- The Trustee app has no test-phase in the frontend flow (per `AGENTS.md`); the
  epic's QA pass verifies against Figma later.
- Sandbox quirk: if the workspace vitest runner breaks under the sandbox, run
  `node node_modules/.bin/vitest run` from `packages/trustee` under Node 20.

## Open Questions

- **"Your key · one click" chip.** The Figma chip row is: `Your key · one
  click` · `NSR · Net Smelter Return` · `Awaiting your review`. The issue says
  "Chips: only backed ones (e.g. the status chip); omit unbacked chips." The
  status chip is backed (`submission.status`); `NSR · Net Smelter Return` is
  dropped (it was `/valuations`-derived). `Your key · one click` has no data
  source — it is static UI copy describing the trustee signing model. Should it
  (a) stay as a static informational chip, or (b) be dropped as "unbacked"?
  Recommend **(b) drop it** to satisfy the strict "backed-only" instruction and
  the project's no-fabricated-content rule; confirm.
- Otherwise `_None_` — direct-URL refetch-by-id fallback and the inert-buttons
  / omitted-banners / omitted-valuation scope are all explicitly specified in
  the issue body.

## Implementation Steps

1. **Port `documents` onto `useLoanSubmissions.ts` (surgical).** In
   `packages/trustee/src/api/useLoanSubmissions.ts` add, without touching the
   existing `status`-filter API:
   - `export interface LoanDocumentDto { name: string; uri: string; }`
   - a `documents: LoanDocumentDto[]` field on `SubmissionView` (with the
     "empty for legacy submissions — render a graceful empty state, never
     fabricate" doc-comment, per `loan_book.rs:233-235`).
   Update `-useLoanSubmissions.test.tsx` fixtures if the `documents` field is
   required by the type (add `documents: []` where `SubmissionView` objects are
   constructed).

2. **Create the view-model hook**
   `packages/trustee/src/routes/-origination-detail.ts`. Start from the #816
   `-origination-detail.ts` and strip all valuation logic:
   - Keep: `safeString` / `safeNumber` / `formatCorridor` helpers,
     `StatusChip`, `LoanTermsDisplay`, `DocumentDisplay`, `DealDetailsDisplay`,
     `resolveStatusChip`, `mapLoanTerms`, `mapDealDetails`, `mapHeading`, and
     the submission-resolution logic (router state → refetch-by-id fallback →
     `loading` / `not-found` / `ready`).
   - Remove: `useCollateralValuation` import + call, `CollateralValuationResponse`,
     `ValuationDisplay`, `ValuationInputRow`, `WaterfallRow`, `mapValuation`,
     `modeLabel`, `usdOrDash`, `safeWireString` (unless still needed), the
     `initial_ccr` / `formatInitialCcr` logic, and `freshnessLabel`.
   - `OriginationDetailResult` = `{ state, heading, breadcrumb, statusChip,
     loanTerms, dealDetails }` (no `valuation`).
   - `useOriginationDetail(id: string, stateSubmission?: SubmissionView)` calls
     `useLoanSubmissions()` (no args — the default all-status query) and
     resolves the submission by `String(s.id) === id`.
   - Rate row keeps the `"14.0% p.a."` suffix per Figma.

3. **Create the route view**
   `packages/trustee/src/routes/origination.$id.tsx`. Start from #816's
   `origination.$loanId.tsx` and:
   - Rename the param to `$id`: `createFileRoute("/origination/$id")`, and read
     `const { id } = Route.useParams()`.
   - Keep the CheckIcon, DocumentIcon, StatusPill, NeutralChip, TermRow,
     LoanTermsCard, DealDetailsCard, ActionButtons subcomponents.
   - Drop the `GreenBanner`, `CollateralValuationCard`,
     `ValuationInputsColumn`, `ValuationWaterfallColumn` components and their
     JSX usage; drop the `showMintInvariants` / `showSignatureVerified` props
     (banners are omitted entirely, not gated).
   - Chip row: render `StatusPill` only (plus the "Your key · one click" chip
     iff the Open Question resolves to keep it). Do NOT render the
     valuation-mode chip.
   - Layout: heading `48px`/`52.8px` Besley, breadcrumb `18px`/`25.2px`, the
     two cards side-by-side in a `flex gap-[20px]` row inside the white
     surface, then `ActionButtons`. Preserve the exact tokens/colors from the
     #816 scaffold (they were verified against this same Figma node).
   - Read router state defensively:
     `(location.state as { submission?: SubmissionView } | undefined)?.submission`.
   - Keep `loading` (skeleton) and `not-found` (message + `Link` back to
     `/origination`) states.

4. **Wire the Origination-table Review button**
   (`packages/trustee/src/routes/origination.tsx`, `StatusCell` "in-review"
   case). Replace the `disabled` `<button>` with a keyboard-accessible
   navigation control to `/origination/$id`. Two acceptable shapes — pick the
   one that keeps the Figma pixel/token styling from #813 intact:
   - a TanStack `<Link to="/origination/$id" params={{ id: String(row.id) }}
     state={{ submission }}>` styled as the button, or
   - a `<button>` with `onClick` calling `useNavigate()(...)` with the same
     `params` + `state`.
   The row must carry the full `SubmissionView` so it can be passed as
   `state.submission`. This means the table's row model must expose the source
   `SubmissionView` (currently `-useOriginationTable.ts` maps to
   `OriginationTableRow` and discards it). Add the raw `submission` (or just
   `id` + the `SubmissionView`) to `OriginationTableRow` — OR thread the
   original `SubmissionView[]` through so the view can look it up by `row.id`.
   Prefer attaching `submission: SubmissionView` to the row model (smallest,
   most local change; `mapSubmissionToRow` already receives it). Remove the
   `disabled` / `opacity-60` / `cursor-not-allowed` affordances now that the
   button is live; keep `#000080`/`h-[36px]`/`text-[15px]` styling.

5. **Wire the Needs-Attention Review button**
   (`packages/trustee/src/components/NeedsAttention.tsx`). Same navigation
   pattern. The `useNeedsAttention` hook currently maps `SubmissionView` →
   display rows — thread the source `SubmissionView` onto each row (or expose
   `id` + submission) so the button can navigate with `params={{ id }}` and
   `state={{ submission }}`. Remove the `disabled`/`aria-disabled` inert
   affordance; keep the Figma button styling (`h-[40px]`, `#000080`, full
   opacity). Verify `useNeedsAttention.ts` and its test are updated for the new
   row shape.

6. **Regenerate the route tree.** Run the trustee dev server or `vite build`
   once so `TanStackRouterVite` regenerates
   `packages/trustee/src/routeTree.gen.ts` with `/origination/$id`. Confirm
   typecheck passes and `/origination` (list) still resolves independently.

7. **Lint & typecheck.** `npx tsx scripts/lint-docs.ts` for docs structure;
   run the trustee package's lint/typecheck. Fix all errors before finishing.

## Test Strategy

Colocated tests (Vitest + Testing Library), mirroring the #813/#818/#816
conventions:

1. **`packages/trustee/src/routes/-origination-detail.test.ts`** (view-model).
   Port the relevant cases from #816's test, dropping every valuation case:
   - A full `SubmissionView` maps to the expected display strings:
     facility/senior/equity/offtaker (`formatFullUsd`), rate
     (`"14.0% p.a."`), start + maturity dates (`formatMaturityDate`), corridor
     arrow (`"PE → CN"`), originator = `loan_data.originator` (friendly name,
     NOT the submitter address), commodity, governing law, documents list.
   - Missing / malformed `loan_data` fields → `—`, never throws.
   - Router state present → uses it directly (no dependence on the refetch).
   - No router state → refetch fallback selects the submission by matching
     `String(s.id) === id`; absent id → `not-found`; refetch in flight →
     `loading`.
   - Each status (`InReview` → "Awaiting your review", `Approved`, `Rejected`,
     unknown) → correct `statusChip`.
   Mock `useLoanSubmissions` (do NOT mock or import `useCollateralValuation` —
   it must not exist in this file).

2. **`packages/trustee/src/routes/-origination-detail-page.test.tsx`** (route
   render). Render the page with a `SubmissionView` supplied via router state
   (memory-history router or by mocking `useLocation`/`Route.useParams`) and
   assert: breadcrumb + heading text, the backed status chip renders, Loan
   Terms card renders its seven rows, Deal Details card renders its four rows +
   documents list, the empty-documents state renders "No documents provided.",
   the three action buttons render and are `disabled`, and — critically — NO
   collateral-valuation card / waterfall / CCR / mint-invariants /
   signature-verified banner appears (assert absence by test-id and by text).
   Also assert the `not-found` state renders the back-Link when the id matches
   nothing and no state was passed.

3. **`packages/trustee/src/routes/-origination.test.tsx`** (update): the
   in-review Review control now navigates to `/origination/$id` with the row's
   `SubmissionView` in state (assert the link `to`/`params`, or the
   `useNavigate` call args), and is keyboard-focusable / not `disabled`.

4. **`packages/trustee/src/components/-NeedsAttention.test.tsx`** and
   **`-useNeedsAttention.test.ts`** (update): the Review button navigates to
   `/origination/$id` with the correct `id` + `state.submission`, and the row
   model exposes the source submission. Button is no longer `disabled`.

5. **`-useLoanSubmissions.test.tsx`** (update): fixtures include `documents`;
   assert the field is passed through / typed. Confirm the `status`-filter
   behavior (#818) still passes unchanged.

Edge cases to cover: empty `documents` array, corridor without a hyphen,
zero-value economics (`"$0"` not `—`), unknown status string, direct-URL with
a non-existent id.

## Docs to Update

- **`docs/exec-plans/active/issue-821-trustee-origination-details-page.md`** —
  this plan (manager moves it to `completed/` at close).
- **`docs/frontend/utils.md` / `docs/frontend/hooks.md`** — no new *shared*
  util/hook is introduced (the view-model hook is component-local per rule 2,
  and the formatters already exist and are catalogued). Only touch these if a
  genuinely shared util is extracted during implementation.
- **`docs/product-specs/trustee-dashboard.md`** — add a short subsection for
  the Origination details / review page (route, what it shows, the inert
  review actions, and that collateral valuation is intentionally not shown
  here). This is user/agent-facing behavior, so the spec should reflect it.
- No `ARCHITECTURE.md` change (no new domain boundary or dependency direction).
