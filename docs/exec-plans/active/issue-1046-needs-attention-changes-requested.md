# Issue #1046: Overview Needs Attention: also show ChangesRequested originations

Source: https://github.com/eq-lab/pipeline/issues/1046

## Scope

The Overview page's **Needs Attention** section (Origination group) currently lists only
`InReview` submissions. This issue adds `ChangesRequested` submissions to the same group,
reversing the deliberate exclusion documented in
`packages/trustee/src/components/useNeedsAttention.ts` (#949/#950 rationale: "originator-
actionable, not trustee-actionable"). Product intent (issue body): in-flight originations
awaiting a resubmit must not disappear from the trustee's Overview, aligning the section
with the origination table's post-#1044 in-flight view.

In scope:

- `useNeedsAttention.ts` — fetch + include `ChangesRequested` submissions in the
  Origination group rows, with status-aware row text.
- `NeedsAttention.tsx` — render the changes-requested rows (same row shell; wording/action
  per resolved Open Questions).
- Unit tests for both files; the Overview route test if its hook fixtures need a new case.
- Spec update in `docs/product-specs/trustee-dashboard.md`.

Out of scope:

- `Rejected` submissions stay **excluded** from Needs Attention. The origination table
  keeps them as a terminal decision record (#1044), but there is no action left to take,
  so they are not "needs attention". The issue title/body asks for ChangesRequested only.
- No changes to the Loans group (Watchlist/Matured, #867), Cash Management, or Risk
  Council groups.
- No backend changes — `GET /v1/loan-book/submissions` already serves `ChangesRequested`
  rows and `reason` (#949).

## Assumptions and Risks

- **Single-status server filter.** The backend `SubmissionsQuery.status` accepts one
  status per request (unknown values 400), so "InReview + ChangesRequested" cannot be one
  filtered call. Chosen approach: drop the server-side filter and call `useLoanSubmissions()`
  unfiltered, then filter client-side on `normalizeOriginationSubmissionStatus(s.status)`
  ∈ {`InReview`, `ChangesRequested`}. This is exactly the origination table's #1044
  pattern, and it *shares* the `["loan-submissions", chainId, "all"]` query cache with the
  table instead of maintaining a separate filtered cache + 30 s poll. Alternative (two
  parallel filtered queries) rejected: double polling, two request waterfalls, no cache
  sharing. The existing defensive in-hook status filter is kept (per #892's rationale).
- **`/origination/$id` for a ChangesRequested submission is banner-only** (#950): the
  detail page renders the Changes-requested banner with the reviewer `reason`, no
  approve/reject footer. A "Review" link from Needs Attention therefore lands on a
  read-only page. That is still useful (see the reason, re-check terms) but the action
  wording is Open Question 2.
- The `reason` field is present for every `ChangesRequested` row (backend requires it,
  #949) but may be long — if it goes into the row subtitle it will be `truncate`-clipped
  by the existing row styles. Not a blocker; noted for OQ 1.
- Query-key change: the Overview stops using the `["loan-submissions", chainId,
  "InReview"]` cache entry. No other consumer uses that key, so nothing else is affected.

## Open Questions

_None_ — both questions were resolved by the user (2026-08-10, in-session):

1. **Row wording (resolved):** title `` `${originator} — ${commodity}: changes requested` ``
   (reuses the origination table's "Changes requested" vocabulary), subtitle unchanged
   (`commodity · corridor · submitted <date>`); the reviewer `reason` stays on the detail
   page, not in the row (rows truncate; reason lengths are unbounded).
2. **Action button (resolved):** keep "Review" — same navigation contract as InReview
   rows (`/origination/$id`, router state carries the `SubmissionView`); the detail page
   already renders the Changes-requested banner + reason (#950). No new Figma-unbacked UI.

## Implementation Steps

1. `packages/trustee/src/components/useNeedsAttention.ts`
   - Replace `useLoanSubmissions({ status: "InReview" })` with `useLoanSubmissions()`
     (unfiltered) and import `normalizeOriginationSubmissionStatus` from
     `@/api/useLoanSubmissions`... note: it lives in `@/api/useLoanSubmissions`? — it is
     exported from `packages/trustee/src/api/useLoanSubmissions.ts`'s sibling
     `-useOriginationTable.ts`? **Verify**: `normalizeOriginationSubmissionStatus` is
     exported from `packages/trustee/src/api/useLoanSubmissions.ts` (it is defined there,
     line ~125). Import from there.
   - Change the rows derivation to keep submissions whose normalized status is
     `InReview` or `ChangesRequested`, preserving server order (newest first).
   - Extend `mapSubmissionToNeedsAttentionRow(submission)` to derive the title suffix
     from the normalized status: `"new request"` (InReview) vs `"changes requested"`
     (ChangesRequested) — final wording per OQ 1 resolution. Keep every existing
     defensive-guard behavior.
   - Rewrite the module doc header: the #949/#950 exclusion paragraph becomes the #1046
     reversal note (ChangesRequested is trustee-visible: awaiting resubmit, reason on the
     detail page); document the unfiltered-fetch decision (single-status server filter,
     shared "all" cache with `useOriginationTable`).
2. `packages/trustee/src/components/NeedsAttention.tsx`
   - Per OQ 2 resolution (recommended: no structural change), keep the row shell and the
     "Review" `Link`. Update the doc header (data source is no longer
     `?status=InReview`; scope note now includes ChangesRequested, #1046).
3. Tests — `packages/trustee/src/components/-useNeedsAttention.test.ts`
   - `mapSubmissionToNeedsAttentionRow`: title case for a `ChangesRequested` submission.
   - Hook: a mixed fixture (`InReview` + `ChangesRequested` + `Approved` + lifecycle
     status + `Rejected`) yields rows for the first two only, in served order; the
     `useLoanSubmissions` mock now expects **no** `status` option.
   - Keep/adjust the existing "excludes merged/lifecycle statuses" cases.
4. Tests — `packages/trustee/src/components/-NeedsAttention.test.tsx`
   - A `ChangesRequested` row renders with the agreed title and the agreed action
     (recommended: same "Review" link → `/origination/$id` with router state).
5. Check `packages/trustee/src/routes/-index.test.tsx` (Overview route test): update
   fixtures/mocks only if it stubs `useLoanSubmissions` with the `InReview` option shape.
6. Docs: update `docs/product-specs/trustee-dashboard.md` — in the origination
   implementation-status paragraph (the #950 sentence), note that per #1046 the Overview
   Needs Attention section lists `ChangesRequested` submissions alongside `InReview`
   (awaiting resubmit; reason on the detail page). Run `npx tsx scripts/lint-docs.ts`.
7. Verify no other consumer of `useLoanSubmissions({ status: "InReview" })` remains
   (grep); remove the now-unused `SubmissionStatusFilter` plumbing **only if** nothing
   else uses it — otherwise leave the API surface untouched.

## Test Strategy

- Unit (vitest, `packages/trustee`):
  - Mapping: ChangesRequested title wording; InReview wording unchanged; defensive
    guards still hold (missing `loan_data` fields → "—"/omitted, never throw).
  - Hook filtering: normalized-status inclusion set is exactly
    {InReview, ChangesRequested}; Approved/lifecycle/Rejected excluded; loading/error/
    empty/ready derivation unchanged; empty when only excluded statuses are served.
  - View: row count and per-status title/action rendering; section still renders nothing
    on loading/error/empty (supplementary-block contract, resolved OQ#3 of #818).
- Full gate: `yarn` workspace lint + `tsc`/build + unit tests for `packages/trustee`
  (the `test-fast` skill's scope). No E2E — no new route or endpoint.

## Docs to Update

- `docs/product-specs/trustee-dashboard.md` — Needs Attention sourcing sentence (step 6).
- Module doc headers in `useNeedsAttention.ts` / `NeedsAttention.tsx` (steps 1–2).
- This plan moves to `docs/exec-plans/completed/` when the PR merges.
