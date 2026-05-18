# Issue #246: USDC CoinIcon is a stale base64 PNG — replace with authoritative Figma asset

Source: https://github.com/eq-lab/pipeline/issues/246

## Scope

Replace the embedded base64-PNG USDC icon used by `CoinIcon` with the
authoritative SVG from the eq-lib Figma library (node `9250:12383`) so the
mark renders crisply at all three sizes (`sm` 20 px, `md` 24 px, `lg` 40 px),
matching the up-to-date design.

In scope:

1. Pull the canonical USDC mark from Figma (file `2KxIsFZuVbKwO7qhVwouoq`,
   node `9250:12383`) and overwrite
   `packages/ui/src/assets/icons/coin-usdc.svg`. The current file at that path
   is *not* a real vector — it is a `<svg>` wrapper around the same stale
   base64 PNG (`<image href="data:image/png;base64,…"/>`), so it must be
   replaced with proper vector geometry from Figma.
2. Rewrite `packages/ui/src/components/CoinIcon/CoinIcon.tsx` to render the
   USDC SVG via the Vite `?url` import pattern (matches the `#238` fix in
   `HeroIcon.tsx`):
   - Add `import usdcSrc from "../../assets/icons/coin-usdc.svg?url";`.
   - Remove the `USDC_B64` constant.
   - In the render path, when `token === "usdc"`, set `src={usdcSrc}` instead
     of `src={\`data:image/png;base64,…\`}`. All other props (`width`,
     `height`, alt/aria handling, `display: block; flex-shrink: 0`) stay the
     same. The `SIZE_MAP` and the public `CoinIconProps` API are unchanged.
3. Add a regression test in `packages/frontend/src/components/CoinIcon.test.tsx`
   that asserts: (a) the `?url` import of `coin-usdc.svg` resolves to a
   non-empty URL string that is *not* a `data:image/png;base64,…` URI; (b)
   the rendered `<img>` for `token="usdc"` carries a `src` matching that URL
   and *not* a `data:image/png;base64,…` value (regression guard against
   re-introducing the stale embed); (c) sizes `sm | md | lg` produce
   `width`/`height` of `20`/`24`/`40` respectively.

Out of scope:

- `PLUSD_B64` and the `SPLUSD_B64` placeholder. These remain stale base64
  PNGs after this change. They share the same defect but are explicitly
  carved out by the Issue ("Scope of this Issue is USDC only"). sPLUSD is
  tracked in #159; a follow-up issue for PLUSD can be filed separately if
  not already covered. Do NOT touch them here — keep the diff minimal.
- Refactoring `CoinIcon` to take a generic token prop or to switch to inline
  SVG components (`vite-plugin-svgr` / hand-rolled JSX). The Issue
  explicitly leaves the `"usdc" | "plusd" | "splusd"` union in place and
  Option A (URL import) is the chosen approach.
- Visual / design changes beyond replacing the asset with the up-to-date
  Figma version.
- Any change to `WalletPill`, `DepositHeader`, `ConversionCard`,
  `TokenInput`, or `TokenAmountDisplay` — they all consume `CoinIcon` via
  the same public API, which is unchanged.

## Assumptions and Risks

- **Assumption (key):** The eq-lib Figma node `9250:12383` exports as a real
  vector SVG (geometry, not an embedded raster). If the Figma node turns out
  to itself be a rasterised image — i.e. Figma's SVG export gives us back
  another `<image href="data:image/png;…"/>` wrapper — we will not have
  solved the bug. The first implementation step is a *verification* step
  that gates the rest of the work.
  - Mitigation: open the Figma node with `get_design_context` /
    `get_screenshot` and inspect the exported SVG source. Real vector paths
    (`<path>`, `<circle>`, `<g>` with fills) are required. If the export is
    raster-only, **stop**, comment on the Issue, and escalate — the design
    source itself needs to be fixed before code can.
- **Assumption:** Vite resolves `*.svg?url` imports identically inside
  `packages/ui` source (consumed by `packages/frontend` via the workspace's
  `"source"` export) to the way it resolved the icons in `HeroIcon`. The
  `#238` PR confirms this works in both dev and production builds.
- **Risk:** USDC at `sm` (20 px) currently looks acceptable because the
  20 px PNG is roughly 1:1 with its source resolution. The new SVG may
  render slightly differently at the smallest size; verify visually in
  Storybook (`AllSizesUSC` story) and on `/deposit` / wallet pill at
  device-pixel ratios 1×, 2×, and 3×.
- **Risk:** The Figma node references `coin-usdc.svg` — when we save the new
  SVG, the filename stays the same to avoid touching any other import. The
  existing `coin-usdc.svg` file in the repo is overwritten in place.
- **Risk:** If a future change accidentally falls back to a base64 PNG for
  USDC, the new regression test must catch it. Test (b) above asserts this
  directly.
- **Dependency:** None. `#238` (HeroIcon mask URL fix) is already merged and
  establishes the `?url` pattern this plan reuses. Branch is clean.

## Open Questions

_None_

## Implementation Steps

1. **Verify the Figma node is a real vector.**
   - Call `mcp__plugin_figma_figma__get_design_context` with `fileKey =
     2KxIsFZuVbKwO7qhVwouoq` and `nodeId = 9250:12383`. Inspect the response:
     screenshot for visual confirmation; metadata for asset type.
   - Cross-check by calling `mcp__plugin_figma_figma__get_metadata` on the
     same node and confirming the children are vector shapes (`VECTOR`,
     `ELLIPSE`, `GROUP`, etc.), not a single `RECTANGLE` or `IMAGE` fill.
   - If the export is raster-only, abort: post a comment on Issue #246
     summarising the finding, transition the Issue back to `blocked` with a
     note, and stop. Otherwise continue.

2. **Export and save the SVG.**
   - Use the Figma MCP to obtain the SVG source for node `9250:12383` (the
     download URL is in the `get_design_context` asset map). Save the file
     **verbatim** at `packages/ui/src/assets/icons/coin-usdc.svg`, replacing
     the stale `<image>`-wrapped file already there.
   - Light hygiene only (no visual edits): keep the `xmlns`, viewBox, and
     width/height as exported. Make sure the SVG has no embedded raster
     (`<image href="data:image/png…"/>`). If Figma's export embeds fonts or
     external CSS, strip those — pure shapes only.
   - Verify the file size dropped from "wraps a 6 KB base64 PNG" to a
     normal vector SVG (typically < 4 KB).

3. **Wire `CoinIcon` to use the SVG via `?url`.**
   - Edit `packages/ui/src/components/CoinIcon/CoinIcon.tsx`:
     - Add at the top: `import usdcSrc from "../../assets/icons/coin-usdc.svg?url";`
     - Remove the `USDC_B64` constant (lines 20–21).
     - Update the JSDoc comment block (lines 3–18) to note that USDC now
       renders from a vector SVG via Vite `?url` import; PLUSD/sPLUSD remain
       base64 PNG temporarily (cross-reference Issue #246 and #159).
     - In the component body, replace the unconditional
       `src={\`data:image/png;base64,${b64}\`}` with branching logic:
       ```ts
       const isUsdc = token === "usdc";
       const src = isUsdc
         ? usdcSrc
         : `data:image/png;base64,${token === "splusd" ? SPLUSD_B64 : PLUSD_B64}`;
       ```
       and drop the `b64` variable. Keep all other render attributes intact.
   - No public API changes — `CoinIconProps` and `SIZE_MAP` stay as-is.

4. **Add the regression test.**
   - Create `packages/frontend/src/components/CoinIcon.test.tsx`, mirroring
     the structure of `HeroIcon.test.tsx`:
     - Group 1 — URL integrity: import `coin-usdc.svg?url`, assert it is a
       non-empty string, not `"undefined"`, and does **not** start with
       `data:image/png;base64,`.
     - Group 2 — render check: render `<CoinIcon token="usdc" size="md" />`
       and assert the produced `<img>` has `src` equal to the imported URL
       (and explicitly NOT a `data:image/png;base64,…` value). Repeat for
       `sm`, `md`, `lg`, asserting the corresponding `width`/`height` of
       20 / 24 / 40 px.
     - Group 3 — non-regression for the other tokens: assert
       `<CoinIcon token="plusd" />` still renders an `<img>` (no assertion
       on the data-URI shape, to avoid coupling this test to the unchanged
       PNG path — but the element must exist and have valid width/height).
   - Hosted in `packages/frontend` per the precedent set by
     `HeroIcon.test.tsx` (UI package has no vitest runner).

5. **Run repo checks.**
   - `yarn workspace @pipeline/ui lint`
   - `yarn workspace @pipeline/frontend lint`
   - `yarn workspace @pipeline/frontend test`
   - `yarn workspace @pipeline/frontend build`
   - `npx tsx scripts/lint-docs.ts`
   - Fix any failures before handing back.

6. **Manual / Storybook visual verification (handover to ux-tester).**
   - Document the verification matrix in the PR description so `ux-tester`
     can pick it up:
     - Storybook stories `USDC — md (default)`, `USDC — all sizes`,
       `BothTokens`, `AllThreeTokens` render the USDC mark crisply with no
       aliasing at 40 px (`lg`).
     - On `/deposit` (running app): the `ConversionCard` input row USDC
       icon and the `DepositHeader` USDC hero icon both match the Figma
       reference visually.
     - In the header `WalletPill`: the small 20 px USDC icon is crisp on
       high-DPI displays.
     - PLUSD and sPLUSD icons are visually unchanged from `main` (no
       collateral damage from the diff).

## Test Strategy

- **New unit/regression test** — `packages/frontend/src/components/CoinIcon.test.tsx`,
  see Implementation Step 4. The two load-bearing assertions are:
  - `coin-usdc.svg?url` does not resolve to a `data:image/png;base64,…` URI.
  - The rendered `<img>` for `token="usdc"` carries that same URL as its
    `src` attribute, regardless of size.
  These directly satisfy the Issue's testing requirement ("Add a unit test
  asserting the rendered `<img>`'s `src` is a non-base64-PNG URL when
  `token="usdc"` — regression guard against re-introducing the stale
  embed").
- **Existing Storybook stories** — `CoinIcon.stories.tsx` already covers
  per-size and per-token rendering; the USDC stories serve as the visual
  acceptance bar at all three sizes.
- **Edge cases**:
  - High-DPI (2×, 3×) device pixel ratios — the whole point of switching to
    SVG is crispness at non-native sizes; visually verify at `lg` (40 px).
  - Dev (`yarn front:dev`) vs. production build (`yarn front:build` +
    preview) — Vite's `?url` handling differs between the two; both must
    produce a working URL. Covered by Step 5's build target.
  - `aria-label` path (decorative vs. meaningful) — already covered by
    existing test patterns in `HeroIcon.test.tsx`; not duplicated here
    unless useful.
- **ux-tester pass** — runs after merge per the standard frontend flow
  since the Issue references a Figma URL.

## Docs to Update

- No product-spec change — this is a pure asset refresh with no behavioural
  impact (the public `CoinIcon` API is unchanged).
- After fix lands, archive this plan to `docs/exec-plans/completed/` (the
  `manager` handles archival at PR/merge time).
- No `known-bugs.md` entry needed — Issue #246 itself is the tracking
  record and will close on PR merge.
- If the Figma export turns out to be raster (Step 1 abort path), file a
  new Issue against the eq-lib design library instead of working around it
  in code.
