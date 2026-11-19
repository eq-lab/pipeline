# Issue #2127: Trustee loan detail: Facility / disbursed and Facility / senior tiles show the wrong second value

Source: https://github.com/eq-lab/pipeline/issues/2127

Parent epic: #2129 (Math correctness, 2026-11-19 code review). Flow: frontend (`bug`, `frontend`).

## Scope

`buildSummaryTiles` in `packages/trustee/src/routes/-useLoanDetail.ts` swaps the second value of the
facility tile between its two variants:

| Variant | Label | Today (wrong) | Fixed |
|---|---|---|---|
| performing / watchlist / disbursing | **Facility / disbursed** | `principal / original_senior_tranche` | `principal / (disbursed ? principal : 0)` |
| matured | **Facility / senior** | `principal / (disbursed ? principal : 0)` | `principal / original_senior_tranche` |

Also fix the copy typo `"drawned, not yet funded"` → `"drawn, not yet funded"`. It appears twice in
`-useLoanDetail.ts`: the facility-tile sub (not-yet-disbursed loan) and the lifecycle stepper's
`Disbursing` node sub (`buildLifecycle`). Both came from the same "minted → drawned" rename in #893
(the Figma / #848 copy was "minted, not yet funded"); fix both.

Evidence that the issue's "Expected" is the intended mapping:

- The field contracts say so: `LoanBookEntry.disbursed` "Backs the loan-detail **Facility /
  disbursed** tile; there is no partial-disbursement amount" and `original_senior_tranche` "Backs
  the loan-detail **Facility / senior** tile" (`packages/trustee/src/api/useLoanBook.ts`, and the
  backend #894 plan, `docs/exec-plans/completed/issue-894-loan-book-summary-fields.md`).
- The Figma-derived mock (#848, Figma `4116-10549` / `4116-10969`, deleted in #875) had Performing
  `Facility / disbursed` = `$4.8M / $4.8M` (fully disbursed = facility) and Matured
  `Facility / senior` = `$1,125,000 / $900,000` (80 % senior tranche).
- The swap was introduced in PR #875 commit "Fix #874: align summary tile field mapping" with no
  recorded rationale; `docs/exec-plans/completed/issue-874-loan-detail-summary-tiles.md` and
  `docs/user-stories/epic-775/874-loan-detail-summary-tiles.md` copied it.

Out of scope:

- Sub-lines, tones and the other tiles (Repaid to date, Interest to distribute, Days on watchlist,
  Rate · epochs) — unchanged. The matured tile sub stays `"—"`.
- The Risk Council escalate page's **Facility / senior deployed** row
  (`-risk-council-escalate.ts` `formatFacilityLine(principal, senior_outstanding)`) — a different
  label with "deployed" (outstanding) semantics, not part of this issue.
- Backend / API: no change; every field is already served on `GET /v1/loan-book`.
- Editing completed exec plans (`issue-874-…`) — historical record, left as is.

## Assumptions and Risks

- `disbursed` is binary (no partial-disbursement amount is served), so "disbursed" is either the
  full facility or `$0` — same rule the code already uses for `disbursedAmount`.
- `original_senior_tranche` is a USDC base-6 decimal string displayed as served (#906), formatted
  with the existing `formatCompactUsd` (which already renders `—` for a missing value).
- Existing unit tests encode the wrong mapping (fixture `principal 4800`, `original_senior_tranche
  3960`); they must be flipped, not just extended. Distinct principal / senior values in the fixture
  keep the tests able to catch a re-swap.
- `-loans.$id.test.tsx` stubs the hook result; its tile values are fixtures, not computed. Only the
  copy and the illustrative `$4.8M / $3.96M` value need refreshing for consistency.
- No dependency on other epic #2129 sub-issues; no file overlap with #2128 (LP dashboard) or the
  backend fixes.

## Open Questions

_None_

## Implementation Steps

1. `packages/trustee/src/routes/-useLoanDetail.ts`, `buildSummaryTiles`:
   - Add `const senior = formatCompactUsd(entry?.original_senior_tranche);` beside `facility`.
   - Matured branch: `value: tileValuePair(facility, senior)`.
   - Non-matured branch: `value: tileValuePair(facility, disbursedAmount)`.
   - Non-matured sub: `"drawned, not yet funded"` → `"drawn, not yet funded"`. Keep the
     `entry == null` → `"—"` sub and the `positive` / `attention` tone logic as is.
   - Do not add comments (comment-less code rule); leave the existing header/JSDoc untouched.
2. Same file, `buildLifecycle`: `Disbursing` step `sub: "drawned, not yet funded"` →
   `"drawn, not yet funded"`.
3. `packages/trustee/src/routes/-useLoanDetail.test.ts`, `describe("buildSummaryTiles")` (fixture
   `makeEntry()`: `principal "4800.000000"`, `original_senior_tranche "3960.000000"`,
   `disbursed: true`):
   - "maps performing tiles…": first tile value `"$4.8K / $3.96K"` → `"$4.8K / $4.8K"`.
   - Rename/rewrite "maps Facility / disbursed as principal / original_senior_tranche" → "maps
     Facility / disbursed as principal / principal when disbursed": expect `"$4.8K / $4.8K"`.
   - Add "maps Facility / disbursed as principal / 0 with the drawn sub when not disbursed":
     `makeEntry({ disbursed: false })`, `"performing"` → `{ label: "Facility / disbursed", value:
     "$4.8K / $0", sub: "drawn, not yet funded", subTone: "attention" }`.
   - Rewrite "maps Facility / senior as principal / 0 when disbursed is false" → "maps Facility /
     senior as principal / original_senior_tranche regardless of disbursed":
     `makeEntry({ disbursed: false })`, `"matured"` → value `"$4.8K / $3.96K"`, sub `"—"`, tone
     `"muted"`.
   - "maps matured facility/senior and epoch APY": first tile value `"$4.8K / $4.8K"` →
     `"$4.8K / $3.96K"`.
   - Add a disbursing/watchlist-variant check that the label stays "Facility / disbursed" with
     `"$4.8K / $4.8K"` (one case suffices, e.g. `"watchlist"`).
   - Keep "renders — when no backend field is available" (`"— / —"`) and add the non-matured
     counterpart: `buildSummaryTiles(undefined, undefined, "performing")[0]` →
     `{ label: "Facility / disbursed", value: "— / —", sub: "—", subTone: "attention" }`
     (current tone for `entry == null` is `attention` because `entry?.disbursed` is falsy — assert
     what the code returns; do not change it).
   - If a `buildLifecycle` test asserts the `Disbursing` sub, update it to `"drawn, not yet funded"`;
     otherwise add one assertion on the Disbursing step sub.
4. `packages/trustee/src/routes/-loans.$id.test.tsx`: in the performing `makeResult` fixture change
   the lifecycle sub `"drawned, not yet funded"` → `"drawn, not yet funded"` and the facility tile
   value `"$4.8M / $3.96M"` → `"$4.8M / $4.8M"`. No behavior change expected.
5. Docs (see Docs to Update) and the user story.
6. Run, all must pass:
   - `yarn workspace @pipeline/trustee test`
   - `yarn workspace @pipeline/trustee lint`
   - `yarn workspace @pipeline/trustee build`
   - `npx tsx scripts/lint-docs.ts`
   - `npx tsx scripts/lint-comments.ts`
   - `grep -rn "drawned" packages docs --include='*.ts' --include='*.tsx' --include='*.md'` returns
     nothing outside `docs/exec-plans/completed/`.

## Test Strategy

- Unit (Vitest, next to the hook): `packages/trustee/src/routes/-useLoanDetail.test.ts` as in step 3.
  Coverage matrix for the facility tile: {performing, watchlist, matured} × {disbursed true, false,
  entry missing}, with principal ≠ senior so a regression to the swapped mapping fails. Plus the
  stepper copy.
- Route test `-loans.$id.test.tsx`: fixture refresh only; existing "renders the three summary tiles"
  label assertions remain.
- Manual / Figma check (QA epic #2130 will run it): open `/loans/<id>` in the Trustee console
  (`yarn workspace @pipeline/trustee dev`, port 5174) for a Performing disbursed loan → tile reads
  `$<facility> / $<facility>` with sub "funded"; a Disbursing loan → `$<facility> / $0`, sub "drawn,
  not yet funded"; a Matured / Past Due loan → `$<facility> / $<senior tranche>`. Compare tile
  layout with Figma `4116-10549` (performing) and `4116-10969` (matured); values follow the doc,
  Figma is styling-only.

## Docs to Update

- `docs/frontend/trustee-flows.md` §"Summary tiles" (~line 973): replace the ambiguous "paired with
  the disbursed amount or `original_senior_tranche`" with the explicit mapping:
  **Facility / disbursed** = `principal / (disbursed ? principal : 0)`, sub "funded" or "drawn, not
  yet funded"; **Facility / senior** (matured) = `principal / original_senior_tranche`, sub "—".
- `docs/user-stories/epic-775/874-loan-detail-summary-tiles.md`: Story 1 expected outcome →
  `Facility / disbursed` as `principal / principal` (disbursed) ; Story 3 → `Facility / senior` as
  `principal / original_senior_tranche`. Add a one-line note that #2127 corrected the mapping.
- New `docs/user-stories/epic-2129/2127-trustee-facility-tiles.md` (ISSUE_PROTOCOL §6): stories for
  (1) Performing disbursed loan with facility ≠ senior tranche → `Facility / disbursed` shows
  facility / facility, sub "funded"; (2) Disbursing loan (`disbursed = false`) → facility / `$0`,
  sub "drawn, not yet funded", stepper Disbursing node sub "drawn, not yet funded"; (3) Matured loan
  → `Facility / senior` shows facility / original senior tranche.
- `docs/user-stories/index.md`: add an "Epic #2129 — Math correctness" section (if no sibling branch
  has added it by merge time; otherwise append the row) linking the new doc.
