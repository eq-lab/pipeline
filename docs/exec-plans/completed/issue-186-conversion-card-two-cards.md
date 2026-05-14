# Issue #186: Deposit: USDC + PLUSD inputs render as one outer card; Figma has two separate cards with 2px gap and details inside the second card

Source: https://github.com/eq-lab/pipeline/issues/186

## Scope

Restructure `ConversionCard` so its visual layout matches the Figma reference (node `1498:100130`):

- Render **two distinct white surface cards** stacked vertically with a 2px gap, instead of a single outer `Card` containing an internal horizontal divider.
  - Card A (top) — `TokenInput` (USDC token row + quick-amount chips).
  - Card B (bottom) — `TokenAmountDisplay` (PLUSD token row) **plus** the nested `Exchange rate` / `Network fee` details block.
- Position the swap-vertical icon button **absolutely** over the 2px seam between the two cards (vertically centered on the gap), instead of as a divider line spanning the outer card.
- Apply Figma styling to the swap button: `rounded-[4px]` (square-ish corners, not a full pill), white-on-gray gradient fill from Figma node `1498:100157`.
- Remove the single outer bordered card wrapper.

Out of scope:

- Functional changes to `TokenInput`, `TokenAmountDisplay`, `InfoRow`, or `Card` primitives.
- Token rename / API changes to `ConversionCardProps` (signature stays stable so `deposit.tsx` and `withdraw.tsx` are untouched).
- Withdraw page styling differences beyond what naturally follows from the shared `ConversionCard` change.
- Any change to `StepsCard` or `DepositHeader`.

## Assumptions and Risks

- The two-card visual structure is described in the issue body with concrete Figma node references (`1498:100135`, `1498:100157`, `1498:100130`); no Figma re-fetch is required to plan, but the coder should pull `get_design_context` for nodes `1498:100135` and `1498:100157` to grab exact gradient stops and the icon button dimensions.
- The shared `Card` primitive currently only exposes a `white` variant with a 24px (`p-6`) inner padding and a hairline border. The Figma "input-sum-inline" cards likely use the same surface tokens (`--color-pipeline-surface`, `--color-pipeline-line`, `--radius-pipeline-card`) — confirm padding via Figma. If the inner padding differs from 24px, we override locally in `ConversionCard` rather than mutate `Card`.
- The `ConversionCardProps` API (input, output, exchangeRate, networkFee) is preserved. Consumers `deposit.tsx` (line 45) and `withdraw.tsx` (line 48) require no changes.
- Absolute positioning of the swap button requires the outer `ConversionCard` wrapper to be `relative`. The button must remain accessible (keyboard focusable if interactive) and aria-hidden if purely decorative — current implementation is decorative; keep it decorative unless Figma annotations say otherwise.
- Risk: changing the wrapper from a single `Card` to a `div` with two child cards may break any external CSS / data attribute consumers that target the outer card. A grep shows no such usage outside the component itself.
- Risk: the `2px` gap token. Figma references `var(--size-2,2px)`. If `--size-2` is not yet declared in `theme.css`, the coder should add it (or use a Tailwind arbitrary `gap-[2px]`). Confirm token availability before adding.

## Open Questions

_None_

## Implementation Steps

1. **Pull the exact Figma reference** with `get_design_context` for the coder's information:
   - `fileKey=A43rjYYjSwdTmiwwf5cx5n`, `nodeId=1498:100135` (the input section parent — to verify the 2px gap and per-card padding).
   - `nodeId=1498:100157` (swap button — to grab the white-on-gray gradient, exact size, and 4px radius).
2. **Refactor `packages/ui/src/components/ConversionCard/ConversionCard.tsx`**:
   - Remove the outer `Card` wrapper. Replace with a `<div ref={ref} className="relative flex flex-col gap-[2px] ..." {...rest}>`.
   - Card A child: a `Card variant="white"` containing `<TokenInput {...input} />`. Drop the old `flex flex-col gap-4` wrapping inside since each card now hosts a single token row.
   - Card B child: a `Card variant="white"` containing both `<TokenAmountDisplay {...output} />` and the `Exchange rate` / `Network fee` `InfoRow` group (the existing `<div className="flex flex-col gap-2 pt-2">` block).
   - Delete the existing divider row (`dividerRowClasses`, `dividerLineClasses`) entirely.
   - Update the swap-icon block:
     - Rename `swapIconWrapperClasses` to something like `swapButtonClasses`.
     - Change positioning to `absolute left-1/2 -translate-x-1/2` with a `top-[…]` value computed to sit centered on the 2px seam. Two acceptable approaches — pick whichever validates better against Figma:
       - **(a) Pixel match**: `top-[145px]` per the Figma absolute position note. Document the constant with a comment referencing the Figma node and note it assumes a fixed top-card height.
       - **(b) Computed center**: place the button on the seam by anchoring it to the bottom edge of Card A using a wrapper `<div className="relative">` around Card A with the button as a sibling positioned `top-full -translate-y-1/2`. Preferred — keeps the layout resilient if the top card's height changes (e.g. when chip row wraps).
     - Change `rounded-full` → `rounded-[4px]`.
     - Replace solid `bg-[var(--color-pipeline-surface)]` with the Figma gradient (white-on-gray). Implement either via `bg-gradient-to-b from-[var(--color-pipeline-surface)] to-[var(--color-pipeline-paper)]` or via an inline `style={{background: "linear-gradient(...)"}}` if exact stops require it — pull stops from `get_design_context`.
     - Keep the existing `border border-[var(--color-pipeline-line)]` and the `<img>` icon child.
3. **Update the component JSDoc** (lines 11-34) to reflect the new structure: "Composes two white `Card`s stacked with a 2px gap; swap button overlays the seam; details (`Exchange rate`, `Network fee`) live inside the second card."
4. **Update Storybook stories** (`ConversionCard.stories.tsx`): adjust the docs description string in `meta.parameters.docs.description.component` to describe the new two-card layout. Story args stay the same.
5. **Run lint and tests**:
   - `pnpm --filter @pipeline/ui lint` (or workspace equivalent).
   - `pnpm --filter @pipeline/ui build` (if the package has a build step).
   - `npx tsx scripts/lint-docs.ts` from repo root (per AGENTS.md).
6. **Manual visual check** in Storybook for the three stories (`Default`, `WithSelectedAmount`, `MaxSelected`) — confirm two distinct cards, 2px gap visible, swap button straddles the seam, details nested in the bottom card.

## Test Strategy

- Storybook visual smoke: open `Components/ConversionCard` and verify all three stories render two visually separate cards with a 2px gap, swap button on the seam, and details inside the bottom card.
- The follow-up `ux-tester` pass (auto-triggered by `manager` since the issue carries a Figma link) is the authoritative verification step. It will:
  - Navigate to `http://localhost:5173/deposit` and `/withdraw`.
  - Compare against Figma node `1498-100130` (file `A43rjYYjSwdTmiwwf5cx5n`).
  - Confirm:
    - Two separate rounded cards with their own white backgrounds and borders.
    - 2px vertical gap.
    - Swap button: `rounded-[4px]`, centered on the seam, white-on-gray gradient, hairline border.
    - `Exchange rate` and `Network fee` rows are visually contained within the second (PLUSD) card.
- No new unit tests required; `ConversionCard` is a pure presentational composition. Existing Storybook coverage is the regression net.
- Edge: verify deposit and withdraw pages both render correctly since they share `ConversionCard`.

## Docs to Update

- `packages/ui/src/components/ConversionCard/ConversionCard.tsx` JSDoc block (in-file).
- `packages/ui/src/components/ConversionCard/ConversionCard.stories.tsx` docs description string.
- No product-spec, design-doc, or `docs/FRONTEND.md` changes required — this is a visual bug fix that aligns implementation with the existing Figma source of truth, not a behavior change.
- No entry in `docs/exec-plans/known-bugs.md` (this plan supersedes the bug entry by fixing it).
