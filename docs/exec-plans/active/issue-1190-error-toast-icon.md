# Issue #1190: error toast — radius 4, meaningful copy, fitting icon

Source: https://github.com/eq-lab/pipeline/issues/1190
Figma: review annotation `3001:10464` on deposit step-flow screenshot `2999:8569` (pill-shaped dark-red toast with a check-circle icon and bare "Deposit failed").

## Scope

Of the three asks, two are already satisfied on main and the review screenshot predates them (same stale-deploy pattern as #1148):

- **Radius 4** — the Toast container has used `rounded-[var(--radius-pipeline-card)]` (4 px) since #702 (2026-06-23).
- **Meaningful copy** — #1034 routes all failure toasts through `toUserError`: specific mapped messages when recognizable, generic title plus a "Details" action into `ErrorDetailsDialog` otherwise.

The remaining defect: the **danger tone's default icon is `CheckCircleIcon`** — an error toast leads with a checkmark. Fix: a danger-specific alert icon (exclamation-in-circle, same filled-circle 16.67-viewBox family as the success/pending glyphs) as the danger default; neutral keeps the check-circle.

## Assumptions and Risks

- Verify-and-document rather than re-do the radius/copy asks; note the finding on the issue.
- Icon drawn in the established inline-SVG idiom (currentColor, evenodd cut-out) — no new asset pipeline.

## Open Questions

_None_

## Implementation Steps

1. `packages/ui/src/components/Toast/Toast.tsx`: add `AlertCircleIcon`; default-icon selection maps `danger` → alert, `pending` → clock, `success` → check, `neutral` → check-circle.
2. `packages/frontend/src/lib/toast/Toast.dom.test.tsx`: danger default icon is the alert glyph (and not the check-circle); other tones unchanged; icon override still wins.
3. Spec `docs/frontend/ui-components.md#toast`: per-tone default-icon table + the radius/copy verification note.
4. Issue comment documenting the two already-satisfied asks with commit refs.

## Test Strategy

DOM tests per step 2; manual danger toast via the /test Toasts tab.

## Docs to Update

`docs/frontend/ui-components.md` (#toast).
