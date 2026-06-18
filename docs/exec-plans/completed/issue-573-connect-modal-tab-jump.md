# Issue #573: Connect Wallet modal: content jumps vertically when switching EVM/Soroban tabs

Source: https://github.com/eq-lab/pipeline/issues/573

## Scope

Frontend bug under epic #556 (Connect Wallet modal), follow-up to #563. The left pane of
`ConnectWalletModal.tsx` vertically centers its entire content column (heading + tabs + wallet
list) with `items-center justify-center`. Because the EVM tab (4 rows, no "Show More") and the
Soroban tab (5 rows + "Show More") have different total heights, the centered block re-centers on
every tab toggle, shifting the heading/tabs/list ~60px vertically (the "jump" reported on a
1728×916 viewport). The same jump occurs when expanding "Show More".

**In scope**

- Stop vertically centering the left-pane content column so the heading and tab control keep a
  constant top position regardless of active tab or "Show More" state. Only the wallet list below
  should grow/shrink; nothing above it moves.
- Keep the content visually positioned to match Figma node `2858-57637` (container top ~196px from
  the top of the 916-tall frame).
- Preserve the short-viewport scroll fallback (`overflow-y-auto`) so content stays reachable when
  the viewport is shorter than the content.

**Out of scope**

- Tab set, wallet catalogue, per-wallet connect logic, "Show More" threshold, dismissal, focus
  trap, scroll lock, right-image pane — all unchanged from #563.
- The full-viewport two-pane layout itself (#563) — unchanged; this only adjusts vertical anchoring
  of the left pane's inner column.
- Any change to mobile single-column behavior beyond the shared anchoring change.

## Assumptions and Risks

- **Single line changed.** The fix is confined to the left-pane wrapper `className` at
  `ConnectWalletModal.tsx:673` (`flex flex-1 flex-col items-center justify-center overflow-y-auto
  px-6 py-10 lg:px-8 lg:py-12`). Replacing `justify-center` with a top-anchored layout
  (`justify-start` plus a top offset) removes the jump. The inner content column at L674
  (`flex w-full max-w-[400px] flex-col gap-6`) stays as-is.
- **Top offset technique.** `justify-start` with a fixed top padding will hold the heading at a
  constant Y. A percentage/`vh`-derived top offset is fragile across viewport heights and rehydrates
  the jump risk if content overflows; prefer a fixed `pt-*` (or a top margin on the inner column)
  combined with `justify-start`, keeping `overflow-y-auto` so tall content still scrolls. The exact
  offset value to match Figma is an Open Question (see below).
- **`items-center` (horizontal) must be kept** so the `max-w-[400px]` column stays horizontally
  centered in the pane — only the *vertical* centering (`justify-center`) is the bug. Do not drop
  `items-center`.
- **Test coupling.** `ConnectWalletModal.test.tsx` (L310 "full-viewport layout" group) asserts on
  layout classes. None currently assert on `justify-center`, but a new regression test should pin
  the anchoring (see Test Strategy). `TopBar.test.tsx` does not assert left-pane layout.
- Low risk: this is a pure CSS-class layout change with no hook/connection logic touched.

## Open Questions

- **Exact top offset value.** The issue says the Figma container starts ~196px from the top of the
  916-tall frame. Should the coder match that with a fixed `pt-[196px]` (pixel-faithful but does not
  scale with viewport height), or use a smaller fixed top padding (e.g. the existing `lg:py-12`
  rhythm) that simply *stops the jump* without reproducing the exact 196px? Pixel-exact matching is
  brittle on shorter viewports. _Recommended: keep `justify-start` with the existing top padding
  (or a modest fixed `pt`), prioritizing "no jump + matches Figma closely" over an exact 196px that
  breaks on short viewports — confirm with design which they prefer._

## Implementation Steps

All changes in `packages/frontend/src/components/ConnectWalletModal.tsx`.

1. **Left-pane wrapper anchoring (L673).** Change the wrapper className from
   `flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 lg:px-8 lg:py-12`
   to a top-anchored variant: replace `justify-center` with `justify-start` and apply the top
   offset chosen per the Open Question (either retain `py-10 lg:py-12`, or set an explicit top
   padding such as `pt-[…] lg:pt-[…]` while keeping bottom padding). Keep `items-center`,
   `flex flex-1 flex-col`, `overflow-y-auto`, and the horizontal padding.
2. **Verify the inner column (L674) is unchanged** (`flex w-full max-w-[400px] flex-col gap-6`) — it
   remains horizontally centered via the pane's `items-center`.
3. Add/extend the layout regression test (see Test Strategy).
4. Run lint/format and the fast frontend suite; fix any fallout.

## Test Strategy

- Add a regression test in `packages/frontend/src/components/ConnectWalletModal.test.tsx` under the
  "full-viewport layout" describe block (around L310):
  - Assert the left-pane wrapper is top-anchored, not vertically centered — query the wrapper
    (e.g. via the heading's ancestor) and assert it has `justify-start` and does **not** have
    `justify-center`. This pins the bug fix against regression.
- Keep all existing coverage green: tab switching, EVM/Soroban wallet rows, Show More threshold and
  reset, focus trap, scroll lock, Escape/× dismissal, right-image panel.
- Run `/test-fast` (lint + unit + integration) and `npx tsx scripts/lint-docs.ts`.
- **Figma verification** (the issue references Figma node `2858-57637`): with the dev server
  running, open the Connect Wallet modal at 1728×916 and confirm the heading top stays at a
  constant Y when toggling EVM ↔ Soroban and when expanding "Show More" (no ~60px jump). Compare the
  resting position against Figma node `2858-57637`. Capture before/after screenshots for the PR.

## Docs to Update

- None required. This is a pure visual/layout `fix/` with no product- or agent-facing behavior
  change. The existing header docblock (L1–25) still accurately describes the layout.
