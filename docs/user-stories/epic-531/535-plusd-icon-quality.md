# #535 — PLUSD icon: crisp vector glyph on /stake page

Epic: [#531 Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#535 Stake/unstake page: PLUSD icon is blurry — replace base64 PNG with SVG](https://github.com/eq-lab/pipeline/issues/535)
Figma: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95311&m=dev

## Background

The `CoinIcon` component shipped a base64-encoded PNG for the PLUSD token. Raster
PNGs scale poorly at non-native resolutions (HiDPI displays, zoomed viewports) and
produce a blurry icon. The fix replaces `coin-plusd.svg` in `packages/ui` with a
proper vector asset and updates `CoinIcon.tsx` to import it via `?url`.

## Visual regression story

1. Navigate to `/stake`.
2. Observe the **Stake** tab (default):
   - The input card top row shows the **PLUSD** coin icon — a dark navy circle
     with a white dollar-sign glyph.
   - The icon must appear sharp and fully crisp at the default viewport size,
     matching Figma node 1497-95311.
3. Zoom the browser to 150 % and 200 %; the PLUSD icon must remain crisp (no
   pixel blur or aliasing artifacts).
4. Switch to the **Unstake** tab:
   - The output row shows the **PLUSD** coin icon; it must be equally crisp.
5. Confirm the PLUSD icon is visually consistent with the **USDC** and **sPLUSD**
   vector icons present on the same page (all three must appear equally sharp).

## Acceptance criteria

- The PLUSD `CoinIcon` renders the SVG vector asset from Figma nodes 1497-95311
  and 1498-101158 — no raster blur at any viewport scale.
- The icon appearance (dark-navy circle + white glyph) is unchanged from the
  previous design; only rendering quality improves.
- Both sizes used on `/stake` (24 px token input, 40 px token display) render
  correctly.
- The PLUSD icon is visually consistent with the USDC and sPLUSD coin icons (all
  three are vector; none appear blurry).
