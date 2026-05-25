# Issue #378: /deposit USDC input container — switch white card surface to gray inline panel (no border, 8px radius, 8px padding)

Source: https://github.com/eq-lab/pipeline/issues/378

## Scope

Restyle the outer `cardClasses` of `TokenInput` so the USDC input container reads as a recessed inline panel inside the conversion card (matching Figma node `1498:99881`) instead of the current standalone white card. Specifically:

- Background: subtle gray fill — reuse the existing `--color-pipeline-fill-muted` token (`rgb(191 189 187 / 0.12)`). This is semantically the same Figma token (`fill-test/primary` ≈ `rgba(184,191,190,0.12)`); the RGB delta at 12% opacity is imperceptible and avoids token sprawl.
- Border: removed.
- Radius: 8px (Tailwind `rounded-lg`). No matching `--radius-pipeline-*` token exists at 8px — use the literal `rounded-lg` utility rather than abusing `--radius-pipeline-card` (4px) or `--radius-pipeline-button` (4px).
- Padding: uniform `p-2` (8px) replacing the current asymmetric `pt-4 px-2 pb-6`.
- Internal gap: keep `gap-8` (32px) — already correct.

Scope is **the `TokenInput` component only**. This is the single source of styling for both the /deposit and /withdraw flows (driven by `?direction=deposit|withdraw` on the same route — see `packages/frontend/src/routes/deposit.tsx:26`), so updating `cardClasses` covers both screens at once.

**Out of scope:**
- The bottom-output card (`TokenAmountDisplay`) keeps its current chrome — the conversion card stays a white container around the gray input panel.
- `ConversionCard` swap-button gradient (between the two cards) is unchanged.
- The chip restyling (gray panel → white pills) is **companion** issue #379 and will land separately. Without #379, the existing chips already render `bg-[var(--color-pipeline-surface)]` (white) so contrast will be acceptable once the surface behind them turns gray, but the border on selected/unselected chips remains as-is per #379.
- No product-spec change. This is a visual fidelity fix; behavior is unaffected.

## Assumptions and Risks

- **`TokenInput` is also rendered on /stake** (`packages/frontend/src/routes/stake.tsx:290`), wrapped inside its own white `Card`. The styling change will produce a gray panel nested inside a white card on the stake page. Visually that is a sensible recessed-panel look, but it is an unspecified side-effect of changing the shared component. If the team wants /stake to keep the previous flush look, the gray-panel styling must instead live on the consumer (deposit's `ConversionCard`) rather than on `TokenInput`. See Open Questions.
- The chosen background token (`--color-pipeline-fill-muted`) is used elsewhere (icon backgrounds, segmented-tab container) — repurposing it for the input panel is reasonable since both are "fill/primary-muted" in Figma, but it does increase its blast radius if anyone retones that token later.
- Selecting `rounded-lg` (Tailwind's literal 8px) over a token is a small inconsistency. We could optionally add `--radius-pipeline-panel: 8px` to keep all radii token-driven; planner recommends the literal until a second 8px surface justifies a token (YAGNI).
- The Figma RGB (`184,191,190`) differs from `--color-pipeline-fill-muted` (`191,189,187`) by a few units per channel. At 0.12 alpha on a paper background this delta is sub-perceptible. Documented above; flag to ux-tester so the diff is consciously accepted.
- The default `className` override path (`composed = [cardClasses, className]…`) lets callers add classes but cannot strip `cardClasses` tokens. Confirm no current caller passes a conflicting `bg-*`, `border-*`, `rounded-*`, or padding utility (a quick grep against `<TokenInput` should suffice during implementation).
- This Issue is independent of any other open work — no blocking dependencies. The Issue is in `planning`; the manager-owned label transitions are out of planner's scope.

## Open Questions

- Should /stake's `TokenInput` (currently wrapped in a white `Card`) inherit the gray-panel restyle as a free win, or should it visually remain on the white card? Resolving as "yes, /stake inherits the gray panel" keeps the styling on `TokenInput` itself (simplest); resolving as "no, /stake unchanged" forces the gray-panel styling to move up to a wrapper on the deposit-conversion side (extra plumbing, but isolates the visual change to /deposit and /withdraw).

## Implementation Steps

1. Edit `packages/ui/src/components/TokenInput/TokenInput.tsx`:
   - Replace the `cardClasses` array (currently lines 88–97) with the panel styling:
     - Swap `bg-[var(--color-pipeline-surface)]` → `bg-[var(--color-pipeline-fill-muted)]`.
     - Remove `border border-[var(--color-pipeline-line)]`.
     - Replace `rounded-[var(--radius-pipeline-card)]` → `rounded-lg` (8px).
     - Replace `pt-4 px-2 pb-6` → `p-2` (8px uniform).
     - Keep `flex flex-col`, `w-full`, `gap-8`.
   - Update the JSDoc header (lines 16–29):
     - Drop the `--color-pipeline-surface`, `--color-pipeline-line`, `--radius-pipeline-card` lines from the "Design tokens used" list.
     - Add `--color-pipeline-fill-muted` — panel background.
     - Update the leading comment on `cardClasses` (`// Outer card — white fill, subtle border, card radius.`) to describe the new gray-panel chrome (no border, 8px radius, 8px uniform padding).
2. Verify no consumer overrides break:
   - `rg "<TokenInput\b" packages/` — confirm no caller passes a `bg-*`, `border-*`, `rounded-*`, or padding-utility `className` that would collide. (`deposit.tsx`, `stake.tsx`, and the stories file are the only call sites; quick visual inspection of each is sufficient.)
3. Run `yarn workspace @pipeline/ui build` (or equivalent ts-check) to confirm the file still type-checks. No prop or API changes — purely class-string tweaks.
4. Run `npx tsx scripts/lint-docs.ts` per AGENTS.md after touching TypeScript.
5. Visually check the four stories already defined in `packages/ui/src/components/TokenInput/TokenInput.stories.tsx` (`USDC`, `PLUSD`, `NoneSelected`, `MaxSelected`, `SPLUSD`, `Controlled`) render with the new gray panel. No new stories needed — the existing set already covers selected/unselected/controlled/disabled-token variants.
6. Hand off to ux-tester for the Figma-driven verification (see Test Strategy).

## Test Strategy

- **Type/lint:** `yarn workspace @pipeline/ui build` and `npx tsx scripts/lint-docs.ts` must pass.
- **Existing unit tests:** none reference `TokenInput` class strings; nothing to update. The `/deposit` route test (`packages/frontend/src/routes/-deposit.test.tsx`) and the `/stake` route test exercise behavior (input values, chip clicks, disabled states) — they should remain green without modification.
- **Component stories:** existing Storybook variants for `TokenInput` should be re-shot to confirm the gray panel renders correctly across USDC, PLUSD, sPLUSD, NoneSelected, MaxSelected, and Controlled.
- **Figma-driven manual verification (ux-tester):**
  - Compare `http://localhost:5173/deposit` against Figma node `1498:99881` (file `A43rjYYjSwdTmiwwf5cx5n`). Expect: gray inline panel, no border, 8px radius, 8px uniform padding, 32px gap between input row and chip row.
  - Compare `http://localhost:5173/deposit?direction=withdraw` against the matching Figma withdraw conversion node — verify the same panel chrome appears (since both directions share `TokenInput`).
  - On `http://localhost:5173/stake`, confirm the now-gray TokenInput nested inside the white card renders cleanly (no double-border, no clipped corners). This is the side-effect noted in Assumptions; surface a Figma-vs-app diff for /stake if one exists.
  - Confirm the chips remain visible against the new gray background — they currently render white with a hairline border, which is acceptable until companion issue #379 lands; once #379 ships the chips become borderless and #378's gray panel is what makes them legible.
  - Smoke-check focus ring, hover state on chips, and tab order (no structural HTML changes, so behavior should be unaffected).

## Docs to Update

- No product-spec or design-doc updates required (pure visual fidelity bug, no behavior change).
- No `docs/FRONTEND.md` update needed (token usage already documented; the swap of one token for another within a single component is not a structural shift).
- The JSDoc block at the top of `TokenInput.tsx` is updated inline as part of Implementation Step 1 — that is the only doc surface touched.
- The execution plan itself (this file) will be archived to `docs/exec-plans/completed/` by the manager once the Issue is closed.
