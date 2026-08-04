# Issue #1014: Origination & loan details: add "Protection" and "Location" rows after "Governing law"

Source: https://github.com/eq-lab/pipeline/issues/1014

## Scope

Add two display rows to the trustee app:

1. **Origination detail** (`/origination/$id`, Deal Details card): a **Protection** row
   (`loan_data.protection`, optional string, e.g. `"LC at sight"`) and a **Location** row
   (`loan_data.initial_location`, displayed `{location_type} — {location_identifier}`,
   e.g. `Warehouse — SGS bonded stockpile, Callao, Peru`), inserted directly after the
   existing **Governing law** `TermRow`.
2. **Loan detail** (`/loans/$id`): surface the same two facts from the fields the page's
   existing endpoints already serve — `protection` from the loan's `/v1/loan-book` row
   (`LoanBookEntry.protection`, currently typed but unrendered,
   `packages/trustee/src/api/useLoanBook.ts:190`) and location from
   `/financials` (`LoanFinancialsResponse.location`, the **current** location). Exact
   placement is an Open Question (see below) because this page has **no** Governing-law
   row or deal-terms card, and current location is already rendered inside the
   "Status / location" registry row.

Out of scope: new API endpoints or new fetches on the loan detail page (all needed
fields are already served); the origination *table* truncation bug (tracked separately
as #1015); any backend change.

## Assumptions and Risks

- Backend values verbatim, never fabricate: missing/empty `protection` renders `—`;
  a missing/malformed `initial_location` renders `—`. If exactly one of
  `location_type` / `location_identifier` is a non-empty string, render that part alone
  (no em-dash) rather than fabricating the other half.
- `loan_data` arrives as `serde_json::Value` — all reads go through the existing
  `safeString` guards in `-origination-detail.ts` (same defensive style as
  `mapDealDetails` today).
- The issue's `initial_location` reference is the pre-mint submission payload and maps
  cleanly onto the origination page. On the loan detail page the served location is the
  *current* location (`current_location` projection, `useLoanFinancials.ts:28`) — showing
  it under a plain "Location" label is a semantic choice (initial vs. current) noted in
  Open Questions.
- No Figma reference exists in the issue; the two new rows reuse the existing `TermRow`
  styling, so no Figma verification step is required beyond visual consistency.
- Branch `feat/1014-protection-location-fields` (PR #1016, draft) is already open from
  `origin/main`; no dependency on unmerged PRs.

## Open Questions

_None_ — resolved by the user (2026-08-04, in-session): on the **loan detail** page keep
"Status / location" exactly as it is and add **only a Protection row** (option (a));
on the **origination detail** page add both Protection and Location after Governing law
as planned.

## Implementation Steps

1. **`packages/trustee/src/routes/-origination-detail.ts`**
   - Add `protection: string` and `location: string` to `DealDetailsDisplay`.
   - Add a small `formatLocation(value: unknown): string` helper next to
     `formatCorridor`: reads `location_type` / `location_identifier` via `safeString`
     semantics, joins the non-empty parts with `" — "`, returns `"—"` when neither is
     present.
   - In `mapDealDetails`, set `protection: safeString(loanData.protection)` and
     `location: formatLocation(loanData.initial_location)`.
   - Extend the empty-state `dealDetails` object in `useOriginationDetail` (the
     `!submission` branch) with `protection: "—"`, `location: "—"`.
   - Update the file-header "Field mapping" doc comment (add the two new lines).
2. **`packages/trustee/src/routes/origination.$id.tsx`** — in `DealDetailsCard`, after
   `<TermRow label="Governing law" …/>` (line 268), add
   `<TermRow label="Protection" value={dealDetails.protection} />` and
   `<TermRow label="Location" value={dealDetails.location} />`.
3. **Loan detail (resolved: option (a) — Protection only, location untouched):**
   - `packages/trustee/src/routes/-useLoanDetail.ts`: leave the "Status / location"
     row exactly as-is. Add a `Protection` row sourced from the already-fetched
     loan-book row (`LoanBookEntry.protection`, `—` when `null`/empty).
     `buildFinancials` takes only the financials response — either extend its
     signature with the protection value or append the row where the hook composes
     the registry rows; follow the file's existing composition pattern.
   - Update the affected doc comments (the `buildFinancials` header and the
     "Data sources" file header; remove the "Not rendered on this page" note on
     `LoanBookEntry.protection` in `useLoanBook.ts`).
4. **Docs** — see "Docs to Update".
5. Run lint/build/tests (see Test Strategy) and fix anything red. Commit on the
   existing branch; PR #1016 already carries `Closes #1014`.

## Test Strategy

- `packages/trustee/src/routes/-origination-detail.test.ts`: extend the
  `mapDealDetails`-level cases — full `initial_location` → `"Warehouse — SGS bonded
  stockpile, Callao, Peru"`; missing `protection` → `"—"`; missing/malformed
  `initial_location` (absent key, non-object, empty strings) → `"—"`; only
  `location_identifier` present → identifier alone (no dash).
- `packages/trustee/src/routes/-origination-detail-page.test.tsx`: assert the Deal
  Details card renders the "Protection" and "Location" labels and their values, in
  order after "Governing law".
- Loan detail: extend the registry-rows unit tests (`-useLoanDetail`-adjacent test
  file) — Protection row present with a served value, `protection: null` → `—`;
  existing "Status / location" assertions stay untouched.
- Commands: `yarn workspace @pipeline/trustee lint`, `yarn workspace @pipeline/trustee
  test`, `yarn workspace @pipeline/trustee build`, plus `npx tsx scripts/lint-docs.ts`
  (TS changed).

## Docs to Update

- `docs/product-specs/trustee-dashboard.md`:
  - Flow 1 (Origination approval) "resolved descriptive material" list — add
    protection and initial location.
  - The #821 implementation-status paragraph (~line 88) — note Deal Details now also
    renders Protection and Location (initial location, `type — identifier` format).
  - Loan-detail/registry-state description (#852-related text, if it enumerates the
    registry rows): note the added Protection row; "Status / location" is unchanged.
- No new product spec needed; this is a field-surfacing change inside two existing
  specified pages.
