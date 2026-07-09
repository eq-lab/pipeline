# Issue #818: Trustee Overview: Needs Attention block — Origination group (in-review submissions)

Source: https://github.com/eq-lab/pipeline/issues/818

Sub-issue of epic #775. Frontend flow. Figma node `4116:8928` (full Overview
frame; the "Needs Attention" section starts at node `4116:9004`, and the
Origination group is nodes `4116:9006` header + `4116:9008` row). Artifacts
already extracted to `/tmp/figma-ov-8928/` (`get_design_context.txt`,
`get_screenshot_0.png`, `get_metadata.txt`); re-extract via Figma MCP at
implementation time to confirm nothing drifted.

## Scope

**In scope (NOW — Origination group ONLY):**

- Add a "Needs Attention" section to the Trustee Overview page
  (`packages/trustee/src/routes/index.tsx`, built in #797) rendering ONLY the
  Origination group, backed by real data.
- Each `SubmissionView` with `status === "InReview"` (fetched from
  `GET /v1/loan-book/submissions?status=InReview`, Stellar-scoped
  `chain_id=99000001`) → one Origination needs-attention row.
- Extend the trustee-local `useLoanSubmissions` hook (`src/api/useLoanSubmissions.ts`,
  from #813) to accept an optional `status` filter. Add a co-located view hook
  (`useNeedsAttention.ts`) that maps in-review submissions → display-ready row
  view-models (view/logic split per FRONTEND.md rule 2).
- A new presentational component `NeedsAttention.tsx` (+ co-located
  `useNeedsAttention.ts`) rendering the section heading, the "Origination"
  group header, and one row per in-review submission, pixel/token-exact to the
  Figma Origination group.
- Empty state: no in-review submissions → render nothing (the whole
  "Needs Attention" section is omitted). Never fabricate rows.
- Colocated `-*.test.tsx` / `-*.test.ts` per project convention; update the
  existing `src/routes/-index.test.tsx` assertion that currently asserts
  "Needs Attention" is absent.

**Out of scope (deferred, do NOT build):**

- The Loans — Payments Due, Cash Management, and Risk Council groups (Figma
  nodes `4116:9018`+, `4116:9040`+, `4116:9072`+). No backend endpoints exist
  for them yet — tracked in #799. Omit entirely.
- Wiring the "Review" button to any route/action. Resolved by human (see Open
  Questions #1): the button is rendered per Figma but **inert**
  (disabled/no-op, accessible). Navigation is a separate follow-up issue — do
  NOT invent or wire a details route, and do NOT navigate to `/origination`.
- The origination details page #816 (parked on branch `feat/816`) — this issue
  must NOT depend on it.
- The Figma subtitle's unbacked parts (valuation mode, documents) — see Open
  Questions #2.

## Assumptions and Risks

- **Data source (verified in-repo).** `GET /v1/loan-book/submissions` is public
  (no auth required) and accepts a `status` query param
  (`InReview` | `Approved` | `Rejected`; omit for all) — confirmed in
  `packages/api/src/routes/loan_book.rs` (`SubmissionsQuery.status`,
  `list_submissions`; unknown values → 400). So `?status=InReview` filtering is
  a real server-side filter, not client-side.
- **Friendly name field.** The row TITLE uses `loan_data.originator` (the
  friendly name, e.g. "Open Mineral"), NOT the top-level
  `SubmissionView.originator` (the authenticated submitter address). This is
  explicit in the issue and consistent with `-useOriginationTable.ts`'s
  documented field mapping (which uses top-level `originator` for its
  Originator column but notes `loan_data.originator` is the friendly name).
  `loan_data` is `serde_json::Value` on the wire — read every nested field
  defensively and render nothing / omit the row detail rather than fabricate
  (mirror `mapSubmissionToRow`'s `safeString` guards).
- **Existing test must change.** `src/routes/-index.test.tsx` currently asserts
  `screen.queryByText("Needs Attention")` is NOT in the document (a #797
  guard). This issue makes that section appear when there are in-review
  submissions, so that specific assertion must be updated (e.g. assert absence
  only in the no-data/empty case, and presence when in-review rows exist).
- **Icon reuse.** The Figma Origination group row icon (node `4116:9010`) is a
  lightbulb glyph inside a 36px `#000080` circle — the same glyph as the
  existing `OriginationIcon` in `src/components/TrusteeNavIcons.tsx`. Reuse
  `OriginationIcon` rather than re-drawing it (confirm the path visually
  matches the Figma SVG at implementation time; if it diverges, redraw inline
  per the `LockIcon`/`CheckIcon` trustee-local precedent).
- **Token mapping (no raw hex in components — FRONTEND.md rule, theme.css).**
  - Icon-circle bg `#000080` → `--color-pipeline-brand` (exact).
  - Review button bg `#000080` → `--color-pipeline-brand`; white text;
    `rounded-[4px]`; `h-[40px]`; `px-[16px]`; `16px` Inter — matches the
    origination page's Review button shape.
  - Row title `#262524` → `--color-pipeline-ink` (exact); `16px`/`22.4px`.
  - Row subtitle + group header `rgba(56,55,53,0.6)` →
    `--color-pipeline-ink-muted` (exact); `12px`/`16.8px`.
  - Section heading "Needs Attention" `#262524` → `--color-pipeline-ink`;
    Besley display `36px`/`46px` — NOT the `--text-pipeline-title` (64px) token;
    document as a one-off arbitrary value (Figma is exact at a non-token size),
    same precedent as CapitalAllocationCard's `58px` total.
  - Group header: uppercase, `tracking-[0.96px]` — arbitrary one-off (no token).
  - Row bg `rgba(211,235,117,0.16)` and row border `rgba(56,55,53,0.18)` have
    NO matching token — scoped one-off inline values (same precedent as the
    CapitalAllocationCard provenance chips and the origination table
    `LINE_COLOR`). Document inline.
- **Poll cadence.** The extended hook keeps the 30s `refetchInterval` and the
  Stellar `chain_id` already in `useLoanSubmissions`; adding `status` to the
  query key so the filtered and unfiltered variants cache independently.
- **Risk: hook shared with #813 origination page.** `useLoanSubmissions` is
  consumed by `useOriginationTable` (which calls it with no status = all
  submissions). Extending it with an OPTIONAL `status` param must be
  backwards-compatible (default undefined = no filter, unchanged behavior) so
  #813's page and its tests keep passing. Verify `-useLoanSubmissions.test.tsx`
  and `-useOriginationTable.test.ts` still pass unchanged, and add a new test
  for the `status=InReview` request URL.
- **Risk: layout under the Overview `<main>`.** The current Overview `<main>`
  uses `flex flex-col gap-[30px]` with `max-w-[1180px]`. The Needs Attention
  section is a full-width block appended after the Capital Allocation card
  (see Open Questions #3); reuse the same `<main>` container so widths align.

## Open Questions

1. **"Review" button target — RESOLVED (human, coordinator relay 2026-07-09):**
   render the "Review" button per Figma but **inert** (disabled / no-op, still
   accessible). Do NOT wire navigation and do NOT navigate to `/origination`;
   wiring is a separate follow-up issue. (Mirrors the existing origination
   page's disabled Review button pattern.) No longer open — recorded here for
   traceability.
2. **Exact subtitle content.** The Figma subtitle is
   "NSR valuation · assay & offtake docs attached · submitted 18 Jun", but the
   valuation mode (`/valuations`, unavailable pre-mint) and documents
   (`loan_data.documents` = `[]` today) are NOT backed. Recommendation: render
   only backed fields — **`submitted <created_at>` + commodity + corridor**,
   e.g. "Copper Concentrate · PE → CN · submitted 18 Jun" (corridor rendered
   with the arrow glyph, reusing the #813 hyphen→arrow transform; commodity
   from `loan_data.commodity`; date via `formatSubmittedDate`). Confirm the
   exact fields and ordering before implementation.
3. **Placement + heading of the Needs Attention block.** Per the full frame
   `4116:8928`, "Needs Attention" (Besley 36px) sits BELOW the Capital
   Allocation card (and below the Cash-in-Transit / Active Deal cards, which
   #797 removed as out of scope). Recommendation: append the `<NeedsAttention>`
   section directly after `<CapitalAllocationCard />` inside the existing
   Overview `<main>`, with its own "Needs Attention" heading. Confirm this
   placement (and that the section should be entirely omitted — heading and
   all — when there are no in-review submissions).

## Implementation Steps

**Status: COMPLETE** (all 6 steps implemented; see PR for this issue). One
deviation from plan: the section is rendered INSIDE the same white `Card` as
the Capital Allocation content (not a bare transparent section) — corrected
per human review follow-up on this issue after visually comparing against the
Figma `4116:8928` background node, which contains both. The "Review" button
also does NOT copy the origination table's dimmed/`opacity-60` disabled
style — that is a different Figma component (`4116:9159`) from this
section's Review button (`4116:9016`), which is full-opacity per Figma; the
button stays inert via `disabled`/`aria-disabled` only, not a visual dimming.

1. **Extend the submissions hook** — `packages/trustee/src/api/useLoanSubmissions.ts`:
   - Add an optional argument, e.g. `useLoanSubmissions(options?: { status?: SubmissionStatusFilter })`
     where `SubmissionStatusFilter = "InReview" | "Approved" | "Rejected"`
     (reuse the existing `SubmissionView["status"]` literals; keep it a narrow
     union, not `string`).
   - When `status` is provided, append `&status=<status>` to the request URL
     and include it in the `queryKey` (`["loan-submissions", chainId, status ?? "all"]`).
   - Default (no argument / no status) MUST preserve today's behavior exactly
     (no `status` param, same query key semantics) so #813's `useOriginationTable`
     is unaffected.
   - Update the hook docstring to describe the new optional filter.
2. **Add the view hook** — `packages/trustee/src/components/useNeedsAttention.ts`:
   - Call `useLoanSubmissions({ status: "InReview" })`.
   - Expose a `state` discriminant (`"loading" | "error" | "empty" | "ready"`)
     mirroring `useOriginationTable`'s shape.
   - Map each in-review `SubmissionView` → a display-ready row view-model:
     - `id: number`
     - `title: string` = `` `${friendlyOriginator} — ${commodity}: new request` ``
       where `friendlyOriginator = safeString(loan_data.originator)` and
       `commodity = safeString(loan_data.commodity)`. If either is missing, use
       the `—` guard (do not fabricate); confirm desired degraded-title shape
       during review if both are missing.
     - `subtitle: string` = backed fields only (pending OQ#2 confirmation;
       recommended `` `${commodity} · ${corridor} · submitted ${formatSubmittedDate(created_at)}` ``,
       corridor via the #813 hyphen→arrow transform, omitting any `—` segments
       cleanly).
   - Reuse `safeString` + the corridor transform (extract the corridor helper
     into `utils/` and unit-test it if it is now used in two places —
     FRONTEND.md rule 3 — otherwise keep it local and note the duplication).
   - Reuse `formatSubmittedDate` from `src/utils/formatDate.ts`.
   - Filter to `status === "InReview"` defensively even though the server
     filters, and treat any missing/empty result as `"empty"`.
3. **Add the presentational component** — `packages/trustee/src/components/NeedsAttention.tsx`:
   - Renders nothing (returns `null`) when `state` is `"empty"` (and, per OQ#3
     recommendation, also renders nothing on `"loading"`/no rows — confirm
     whether a skeleton is wanted; default: no skeleton, matching a section
     that simply appears when data exists).
   - On error: render a minimal inline error consistent with the
     CapitalAllocationCard error block, OR omit — confirm during review;
     default recommendation is to omit the section on error (it is a
     supplementary block, not the page's primary content) but log via the
     standard pattern.
   - On `"ready"`: render the "Needs Attention" heading (Besley 36px, ink),
     the "Origination" uppercase group header, and the list of rows.
   - Each row: `bg` `rgba(211,235,117,0.16)`, `border` `rgba(56,55,53,0.18)`,
     `rounded-[4px]`, `min-h-[72px]`, `px-[17px] py-[15px]`, `gap-[16px]`,
     flex items-center; a 36px `--color-pipeline-brand` circle wrapping
     `OriginationIcon` (18px, white); a title+subtitle stack; a right-aligned
     (via `flex-1` spacer / `justify-between`) inert "Review" button.
   - "Review" button: `disabled`, `aria-disabled="true"`, descriptive
     `aria-label` (e.g. "Review submission (not yet available)"),
     `data-testid="needs-attention-review"`, `cursor-not-allowed`, brand bg,
     white text, `rounded-[4px]`, `h-[40px]`, `px-[16px]`, `16px` — mirror the
     origination page's disabled Review button styling (opacity for the
     disabled affordance).
   - Add `data-testid`s: `needs-attention` (section), `needs-attention-origination`
     (group), `needs-attention-row` (each row) for QA/tests.
4. **Mount on the Overview page** — `packages/trustee/src/routes/index.tsx`:
   - Import and render `<NeedsAttention />` directly after `<CapitalAllocationCard />`
     inside the existing `<main>` (per OQ#3 recommendation). Update the route
     docstring: replace the "No Needs Attention section — deferred to #799;
     renders nothing" note with the new scope (Origination group only, real
     `submissions?status=InReview` data; other groups still deferred to #799).
5. **Tests** (see Test Strategy) — add colocated tests and update the existing
   index route test.
6. **Lint** — run `npx tsx scripts/lint-docs.ts` (docs) and the frontend
   type/lint checks; ensure no raw hex is introduced except the documented
   one-off inline `style` values (row bg/border), consistent with existing
   precedent.

## Test Strategy

- **`src/api/-useLoanSubmissions.test.tsx` (extend):**
  - Add a case: `useLoanSubmissions({ status: "InReview" })` issues a request
    whose URL contains `status=InReview` AND `chain_id=99000001`.
  - Add a case: `useLoanSubmissions()` (no arg) issues a request with NO
    `status=` param (backwards-compat guard).
- **`src/components/-useNeedsAttention.test.ts` (new):** unit-test the mapping
  pure-function(s) without a DOM:
  - Title built from `loan_data.originator` + `loan_data.commodity`
    (`"Open Mineral — Copper Concentrate: new request"`).
  - Subtitle uses only backed fields (per confirmed OQ#2), corridor arrow
    transform applied, date via `formatSubmittedDate`; missing fields degrade
    to `—`/omitted segments, never fabricated.
  - `state` = `"empty"` for `[]` / undefined; `"ready"` with rows for in-review
    data; `"error"` when the hook errors; `"loading"` while loading.
  - Non-InReview submissions (if any slip through) are excluded.
  - Malformed `loan_data` (missing nested fields) does not throw.
- **`src/components/-NeedsAttention.test.tsx` (new):** render tests (mock
  `useLoanSubmissions`/`apiFetch`):
  - Renders the "Needs Attention" heading + "Origination" group header + one
    row per in-review submission with the expected title/subtitle text.
  - Renders nothing (no heading, `queryByTestId("needs-attention")` null) when
    there are no in-review submissions (empty state).
  - The "Review" button is present, `disabled`, and has the accessible label /
    `aria-disabled` (inert, not wired).
- **`src/routes/-index.test.tsx` (update):** change the current
  "does not render … Needs Attention" assertion — assert Needs Attention is
  ABSENT when the mocked submissions response is empty, and PRESENT (with a
  row) when the mock returns an in-review submission. Keep the existing
  Overview-heading and Capital-Allocation-card assertions.
- Run the trustee package test suite. Sandbox quirk (from the issue): if the
  workspace runner breaks under Node 20, run
  `node node_modules/.bin/vitest run` from `packages/trustee/`.

## Docs to Update

- **No product-spec change required.** This is a frontend rendering slice of an
  already-specified surface (the Trustee Overview / Needs Attention section);
  it introduces no new user- or agent-facing behavior beyond what the epic
  #775 spec + Figma already define. (`docs/product-specs/trustee-dashboard.md`
  already covers the Trustee sections; confirm it needs no addition during
  review — if it lacks a Needs Attention mention, add a one-line note there.)
- **`docs/frontend/hooks.md`:** `useNeedsAttention` is a component-local hook
  (FRONTEND.md rule 2) → NOT catalogued. If step 1's `status` extension makes
  `useLoanSubmissions` meaningfully more "shared," confirm its existing catalog
  entry (if any) still describes it accurately; update the one-liner if needed.
- **`docs/exec-plans/tech-debt-tracker.md`:** the trustee↔LP `useLoanSubmissions`
  duplication is already tracked (TD-42). If the corridor-arrow / subtitle
  helper is duplicated rather than extracted, add a short note; otherwise no
  new debt.
- This exec plan moves to `docs/exec-plans/completed/` when the issue closes
  (manager-owned).
