# #534 — sPLUSD icon: correct Figma glyph on /stake page

Epic: [#531 Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#534 Stake/unstake page: wrong sPLUSD icon — use the one from Figma](https://github.com/eq-lab/pipeline/issues/534)
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-101158&m=dev

## Background

The `CoinIcon` component used the PLUSD base64 PNG as a placeholder for sPLUSD
(both icons were identical dark-navy circles). The correct sPLUSD icon is a
light-gray circle with a navy pixel-art dollar glyph — visually distinct from
PLUSD's dark-navy circle with a white glyph.

## Visual regression story

1. Navigate to `/stake`.
2. Observe the input card (Stake tab active):
   - The top row shows the **PLUSD** coin icon — a dark navy circle with a
     white dollar-sign glyph.
   - The output row below shows the **sPLUSD** coin icon — a light gray circle
     with a navy dollar-sign glyph (pixel-art border style).
3. The two icons must be visually distinct: PLUSD is dark/filled, sPLUSD is
   light/outlined.
4. Switch to the **Unstake** tab:
   - The input row now shows the sPLUSD icon (light gray circle).
   - The output row shows the PLUSD icon (dark navy circle).
5. At no breakpoint should both rows show the same icon.

## Acceptance criteria

- The sPLUSD `CoinIcon` renders the gray-circle + navy-glyph asset from
  Figma node 910:10323.
- The PLUSD `CoinIcon` is unchanged (dark-navy circle + white glyph).
- Both sizes used on `/stake` (24 px token input, 40 px token display) render
  correctly.
