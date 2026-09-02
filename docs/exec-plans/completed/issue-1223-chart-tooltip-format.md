# Issue #1223: portfolio chart tooltip shows month+year on every period tab

Source: https://github.com/eq-lab/pipeline/issues/1223

## Scope

Deterministic jsdom repro against current main shows the tooltip is **already period-correct**: with a real series and a hover, `7d` renders "September 21, 14:13", `1m`/`3m` render "September 21, 2026", `1y`/`all` render "September 2026" (month by design). The per-period `FormatMode` table landed 2026-08-19/21 (#1115, #1139) — the reported all-tabs-month symptom matches any build older than that (the recurring stale-deploy pattern: #1148, #1190, #1155).

Work: pin the behavior with a permanent per-period tooltip-format regression matrix in `PortfolioPlaceholderCard.test.tsx`, attach the evidence to the issue, and have the reporter re-verify on a current build.

## Assumptions and Risks

- If the reporter still sees month-only on current main after this, the remaining axis is the served history data, not the format path — reopen with the network payload.

## Open Questions

_None_

## Implementation Steps

1. Add the five-period hover-format matrix test (real series, mocked bounding rect, pointerMove).
2. Evidence comment on #1223; PR closes it.

## Test Strategy

The regression matrix IS the deliverable; full card suite green.

## Docs to Update

None — behavior already matches `usePortfolioChart.ts`'s documented modes.
