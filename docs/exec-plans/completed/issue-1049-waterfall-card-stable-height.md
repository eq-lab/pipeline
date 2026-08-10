# Issue #1049: Waterfall Breakdown card blinks/resizes while the offtaker amount is being entered — keep a stable height with a loader

Source: https://github.com/eq-lab/pipeline/issues/1049

## Scope

On the record-coupon and record-repayment pages, the "Waterfall Breakdown — computed"
card collapses to the one-line empty-state message whenever the debounced waterfall
query is (re)fetching (each amount is a new query key, so `data` drops to `undefined`),
then re-expands when the response lands — a visible size "blink" per keystroke burst.

Fix: once a positive amount is entered, the card always renders the **full fixed row
set** (6 rows on coupon, 7 on repayment — labels are static), and while a recalculation
is in flight each row's **value** is replaced by an `animate-pulse` skeleton block (the
app's existing loading convention: `CapitalAllocationCard`, and these pages' own
page-level loading blocks). Labels and sub-lines keep rendering, so the card's height is
pixel-identical between "calculating" and "resolved" — no jump, and no stale dollar
figures are ever shown for an amount the user has since changed. The empty-state message
appears only when no positive amount is entered.

In scope:

- `packages/trustee/src/routes/-record-coupon.ts` / `-record-repayment.ts` — the
  `waterfall` view-model: emit placeholder rows while calculating + an `isCalculating`
  flag.
- `packages/trustee/src/routes/loans.$id_.record-coupon.tsx` /
  `loans.$id_.record-repayment.tsx` — the right card's empty/rows ternary + per-row
  value skeletons + `aria-busy`.
- Tests: `-record-coupon.test.ts`, `-record-repayment.test.ts`,
  `-record-coupon-page.test.tsx`, `-record-repayment-page.test.tsx`.

Out of scope:

- No `keepPreviousData`/`placeholderData` in `useLoanWaterfall` — deliberately NOT
  chosen: it would show the *previous amount's* dollar figures while a new amount
  computes, which invites misreading money values; and gating the transactional
  derivations (`recordPaymentInput`, `summaryText`, `isTerminal`) against placeholder
  data would add correctness risk for zero UX gain over skeletons. No API-hook changes
  at all.
- The pre-existing 400 ms debounce (and the fact that the footer confirm derives from
  the debounced amount) is unchanged.

## Assumptions and Risks

- **Static row labels.** Both pages build their waterfall rows from fixed label lists
  (`-record-coupon.ts:420-457`, `-record-repayment.ts:386-427`); only the values come
  from `waterfall.data`. The coupon "Gross interest (N / 365 days)" label depends on
  `useLoanFinancials` (independent of the waterfall query), so labels are stable while
  calculating. If the financials query is still loading, the label degrades to
  "Gross interest (— / 365 days)" — already today's behavior.
- **Calculating detection.** A recalculation is pending when a positive amount is
  entered in the **live** input AND either (a) the live input differs from the
  debounced value (the 400 ms window), or (b) the query for the debounced amount has
  neither `data` nor `error` yet. (a) matters: during the debounce window the query
  still holds the *previous* amount's data, which must be masked, not shown.
- **Error behavior unchanged in shape:** on a waterfall error (e.g. the #916 404 when
  the amount exceeds what's left), `isCalculating` is false, the rows render with "—"
  values (static, no pulse), and the existing `InlineError` block renders below — same
  placement as today.
- Both page test suites already mock `apiFetch`/hooks; adding calculating-state cases
  should not require new test infrastructure.

## Open Questions

_None_ — the issue (user-authored) specifies the behavior: constant card height with a
loader while computing. The loader style follows the app's existing `animate-pulse`
skeleton convention rather than introducing a new spinner primitive.

## Implementation Steps

1. `packages/trustee/src/routes/-record-coupon.ts`
   - Extend the `waterfall` view-model shape with `isCalculating: boolean`.
   - Derive `isCalculating` per Assumptions (live-vs-debounced mismatch OR
     no-data-no-error while a positive amount is entered).
   - Build `rows` whenever a positive amount is entered: from `waterfall.data` when
     resolved, otherwise the same 6 rows with `value: "—"` (placeholder). `rows` stays
     `[]` only when no positive amount is entered.
   - Leave `summaryText` / `recordPaymentInput` / `isTerminal` derivations untouched —
     they already require `waterfall.data != null`, so they stay null/false while
     calculating (confirm stays disabled).
   - Update the module doc comment (issue #1049 behavior).
2. Same changes in `-record-repayment.ts` (7-row list).
3. `loans.$id_.record-coupon.tsx`
   - Empty-state ternary keys on `view.waterfall.rows.length === 0` as today (now true
     only pre-entry) — message text unchanged.
   - Rows container gets `aria-busy={view.waterfall.isCalculating}` and
     `data-testid="record-coupon-waterfall-calculating"` when calculating.
   - `WaterfallRowView` gains an `isCalculating` prop: when true, render an
     `animate-pulse` block (`h-[20px] w-[72px] rounded-[4px]
     bg-[color:var(--color-pipeline-surface-muted)]`, matching the value line-height)
     in place of the value text. Labels/subs render normally.
4. Same changes in `loans.$id_.record-repayment.tsx`.
5. Tests (unit, view-model): calculating flag true during live≠debounced and during
   fetch; placeholder rows (correct count + "—" values) while calculating; rows empty
   with no amount; resolved rows unchanged; error case → `isCalculating` false.
6. Tests (page render): with a positive amount entered and the waterfall unresolved,
   the card shows the full row set with pulse placeholders (no empty-state message);
   with no amount, the empty message shows; after resolve, values render. Assert
   `aria-busy` toggling.
7. Run package lint/format, `tsc`, vitest, build; `npx tsx scripts/lint-docs.ts`.

## Test Strategy

Covered by steps 5–6: view-model derivation tests (both hooks) + page render tests
(both routes) for the three states (idle / calculating / resolved) and the error case.
Edge cases: amount typed then cleared (back to idle message); amount changed while a
fetch is in flight (stays calculating, previous values masked); financials-less label
degradation ("— / 365 days").

## Docs to Update

- Module doc comments in the four touched files (steps 1–4).
- `docs/product-specs/trustee-dashboard.md` does not describe the card's loading
  behavior at this granularity — no spec change required (pure `fix/`, no behavior
  contract change). Re-run `npx tsx scripts/lint-docs.ts` regardless.
- This plan moves to `docs/exec-plans/completed/` when the PR merges.
