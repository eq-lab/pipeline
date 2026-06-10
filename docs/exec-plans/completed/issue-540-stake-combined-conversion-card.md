# Issue #540: Stake page: input and output/rates render as two separate cards; Figma shows one combined conversion card

Source: https://github.com/eq-lab/pipeline/issues/540

## Scope

Pure visual fix on the Stake page. Merge the two white cards that currently
make up the conversion form into a single white card, matching the Figma design
(node 1498-101158 / input section 1500-102009) and the sibling Deposit page's
one-card conversion layout.

In scope:

- `packages/frontend/src/routes/stake.tsx` — combine the two
  `<Card variant="white">` blocks (lines ~290–320 input card, ~323–336
  output/rates card) into one `<Card variant="white">` containing, top to
  bottom: `SegmentedTabs` → `TokenInput` → `TokenAmountDisplay` →
  `InfoRow "Exchange rate"` → `InfoRow "Network fee"`.
- The previously-separate StepsCard / connect-wallet banner block stays as its
  own card below the merged card, separated by the existing 24px (`gap-6`)
  `<main>` gap.

Out of scope:

- No change to staking logic, hooks, preview math, step gating, tab-switch
  reset, balance refetch, or the wallet-disconnected banner behavior.
- No adoption of the `@pipeline/ui` `ConversionCard` component (see Assumptions
  — it is purpose-built for deposit/withdraw and does not fit stake).
- No change to the Deposit/Withdraw pages.
- No product-spec change (behavior is unchanged).

## Assumptions and Risks

- **`ConversionCard` is NOT a drop-in here.** Despite the issue's wording that
  the Deposit page "keeps the whole conversion in one `ConversionCard`", the
  actual `@pipeline/ui` `ConversionCard`
  (`packages/ui/src/components/ConversionCard/ConversionCard.tsx`) renders **two**
  stacked sub-cards with a 2px seam and an absolutely-positioned swap-direction
  button, and has no slot for tabs. It models the deposit↔withdraw direction
  toggle, not the stake/unstake tab switch. Reusing it would (a) reintroduce a
  visual seam and (b) add an unwanted swap button. The correct fix is to merge
  the two cards inline in `stake.tsx`, producing a single continuous card as
  Figma shows. This is consistent with how stake.tsx already composes its form
  from primitives (`SegmentedTabs`, `TokenInput`, `TokenAmountDisplay`,
  `InfoRow`).
- **Spacing/visual fidelity.** After merging into one card the internal vertical
  rhythm comes from the card's own `flex flex-col gap-4` (and `Card` padding
  `lg` = 24px). The current two-card layout used `gap-4` inside each card plus a
  24px gap between cards. Collapsing to a single `gap-4` stack may slightly
  change vertical spacing between the input block and the output block versus
  Figma (Figma's input section is one 350px region with the output block flush
  under the input). Low risk, but the coder must visually compare against Figma
  rather than assume `gap-4` alone matches. See Open Questions.
- **Test impact is low.** `packages/frontend/src/routes/-stake.test.tsx` queries
  by role / aria-label (tabs via `role="tab"`, amounts via
  `TokenAmountDisplay` aria-labels, actions via the StepsCard buttons). It makes
  no assertions on the number of `Card` wrappers or on card boundaries, so the
  merge should not break existing tests. The coder must still run the suite.
- No blocking dependencies. Branch `fix/540-stake-combined-conversion-card`
  already exists. Epic #531; sibling stake fixes (#533, #534, #535) are merged.

## Open Questions

- Vertical spacing inside the merged card: Figma stacks the output block flush
  under the input block (the two `input-sum-inline` frames at y=0 and y=190 with
  no gap), whereas the input block and output block each have internal padding.
  Should the merged card keep a uniform `gap-4` between all rows, or should the
  coder reproduce Figma's tighter input→output spacing exactly (e.g. a smaller
  gap between the `TokenInput` chips and the `TokenAmountDisplay`)? Default
  assumption: keep `gap-4` for a clean single-card stack and verify visually
  against Figma; tighten only if the visual diff is obviously off. Flagging
  because pixel-exactness vs. the existing primitive spacing is a judgment call
  the planner cannot fully resolve without the coder rendering it.

## Implementation Steps

1. In `packages/frontend/src/routes/stake.tsx`, locate the two
   `<Card variant="white" className="flex flex-col gap-4">` blocks:
   - Input card (currently ~lines 290–320): `SegmentedTabs` + `TokenInput`.
   - Output card (currently ~lines 323–336): `TokenAmountDisplay` +
     `InfoRow "Exchange rate"` + `InfoRow "Network fee"`.
2. Merge them into a single `<Card variant="white" className="flex flex-col gap-4">`
   whose children, in order, are: `SegmentedTabs`, `TokenInput`,
   `TokenAmountDisplay`, `InfoRow "Exchange rate"`, `InfoRow "Network fee"`.
   Keep every prop on each child exactly as-is.
3. Update the two adjacent code comments ("Input card: …" / "Output card: …")
   to a single accurate comment describing the combined conversion card and
   citing the Figma node (1498-101158).
4. Leave the wallet-disconnected banner and the two `StepsCard` branches
   unchanged; they remain a separate card after the merged card, still separated
   by the `<main>` `gap-6`.
5. Update the route-level JSDoc at the top of `stake.tsx` that currently says
   "The input card and output card remain visible above the banner." to reflect
   the single combined conversion card.
6. Run `npx tsx scripts/lint-docs.ts` (per AGENTS.md TypeScript-change rule) and
   the frontend lint/typecheck.

## Test Strategy

- Run the existing frontend unit/route test suite, especially
  `packages/frontend/src/routes/-stake.test.tsx`, and confirm all pass
  unchanged (role/aria-label queries are unaffected by the card merge).
- No new behavioral tests are warranted — this is a layout-only change with no
  logic delta. Optionally add/adjust a lightweight structural assertion only if
  the team wants to lock the single-card layout, but this is not required and
  risks brittleness; prefer relying on Figma verification below.
- Figma verification (required, since the Issue references Figma): render
  `http://localhost:3000/stake` in the `/test` "Connected, ready to stake
  (approved)" scenario and visually compare against Figma node 1498-101158
  (full Approved frame) and 1500-102009 (input section). Confirm: one white
  card border around tabs + input + output + exchange rate + network fee; no
  24px gap or second border between input and output; the StepsCard remains a
  separate card below. Repeat the visual check on the Unstake tab.

## Docs to Update

- None required. This is a behavior-neutral visual fix.
  - `docs/product-specs/staking.md` documents staking product behavior (yield
    sources, two-party attestation) and does not describe the card layout, so it
    needs no change.
  - No `docs/design-docs/` entry catalogues the stake card-count layout.
  - The only doc-like update is the in-file JSDoc in `stake.tsx` (Step 5).
