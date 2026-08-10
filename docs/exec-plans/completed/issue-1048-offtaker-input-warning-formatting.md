# Issue #1048: Record coupon/repayment: over-amount warning and formatted-paste support for the offtaker payment input

Source: https://github.com/eq-lab/pipeline/issues/1048

## Scope

Two changes to the "Offtaker payment received (USD, Trust account)" input:

1. **Over-amount warning (coupon page only).** When the entered amount is larger than
   what the offtaker still owes, render a non-blocking warning (message + warning icon)
   directly below the input. No Max button, no clamping, no disabled submit (user
   decision, issue comment). The repayment page needs no warning: its amount input is
   disabled and prefilled with exactly the owed figure (#884), so it can never exceed it.
2. **Comma formatting / paste support (both pages).** The input becomes `type="text"`
   (`inputMode="decimal"` stays) and accepts values formatted the way the app displays
   them — `$`, `,` thousands separators, spaces are stripped for parsing, so copying a
   displayed `1,234,567.89` and pasting it works. The entered/prefilled value renders
   with `,` grouping (timing per Open Question 2).

Comparison baseline (issue Open Question 1, resolved by research): **`offtaker_outstanding`
from `GET /v1/loan-book/{id}/financials`** (`useLoanFinancials`) — the backend-served
"what the offtaker still owes" figure already fetched on both pages, already displayed
as the coupon page's "Offtaker still owed after coupon" row and used to prefill the
repayment amount. No new endpoint or field needed; comparing user input against a served
value is validation, not a frontend-computed metric.

Out of scope: any change to the waterfall preview, `recordPaymentInput`, or submit
gating; the repayment input stays disabled/prefilled.

## Assumptions and Risks

- `usdInputToSacBaseUnits` / `parsePositiveUsdInput` (`@/utils/stellarSacUnits`) are
  consumed only by the two record hooks, so normalizing input inside the shared helpers
  (strip `$`, `,`, spaces before the existing `POSITIVE_DECIMAL_RE` gate) is safe and
  fixes both pages' parse paths with no call-site changes. Separator *placement* is not
  validated (`1,23,4` parses as `1234`) — normalization, not locale validation.
- When `offtaker_outstanding` is missing/unparseable, the warning simply never shows
  (never fabricate a baseline).
- The warning is advisory only: `aria-live="polite"` text + icon in the app's amber
  `--color-pipeline-warning` token; no existing warning-icon component exists, so a
  small inline SVG triangle (aria-hidden) is added beside the text.
- The repayment page test asserts `toHaveValue(6150000)` on the prefilled input —
  switching to a formatted text input changes that to `"6,150,000"`.
- The coupon page currently relies on `type="number"` to keep letters out; with
  `type="text"`, non-numeric garbage parses to `null` exactly like today (waterfall
  disabled, neutral state) — no new failure mode.

## Open Questions

_None_ — both resolved by the user (2026-08-10, in-session):

1. **Warning threshold (resolved):** any amount above `offtaker_outstanding`; wording
   "Entered amount is larger than the offtaker still owes ($X). Check the wire before
   recording."
2. **Comma formatting timing (resolved):** format-as-you-type.

## Implementation Steps

1. `packages/trustee/src/utils/stellarSacUnits.ts` — normalize `$`/`,`/whitespace in
   `usdInputToSacBaseUnits` before the regex gate (inherited by
   `parsePositiveUsdInput`).
2. `packages/trustee/src/utils/formatUsd.ts` (or route-local helper) — add
   `formatUsdInputValue(raw: string): string`: strips disallowed chars, groups the
   integer part with commas, preserves a decimal part; pure + exported for tests.
3. `-record-coupon.ts` — pipe `onAmountChange` through the formatter (per OQ 2);
   expose `amountWarning: string | null` (entered live USD vs
   `offtakerOutstandingUsd`, threshold per OQ 1).
4. `loans.$id_.record-coupon.tsx` — input `type="text"`; render the warning row
   (`data-testid="record-coupon-amount-warning"`, amber text + inline SVG triangle,
   `aria-live="polite"`) between the amount field and the date field.
5. `-record-repayment.ts` / `loans.$id_.record-repayment.tsx` — prefill with the
   formatted string; input `type="text"`; no warning row.
6. Tests: parse helpers accept `"1,234,567.89"` / `"$45,000"`; formatter unit cases;
   coupon page — paste a comma-formatted value → waterfall runs (submit enables),
   warning appears when over the owed figure and disappears below it; repayment page —
   prefilled value renders with commas and recording still works.
7. Full gate: prettier, lint, `tsc`, vitest, build, `npx tsx scripts/lint-docs.ts`.

## Test Strategy

Covered by step 6 across `-record-coupon.test.ts`, `-record-repayment.test.ts` (pure
helpers) and the two page test files (paste round-trip, warning visibility both sides of
the threshold, prefill formatting). Edge cases: `"$ 1,234.56"`, trailing `.`, empty →
null; `offtaker_outstanding` missing → no warning ever.

## Docs to Update

- `docs/product-specs/trustee-dashboard.md` — one sentence in the record-payment flow
  paragraph noting the input accepts display-formatted values and warns (non-blocking)
  above the served owed figure.
- This plan moves to `docs/exec-plans/completed/` when the PR merges.
