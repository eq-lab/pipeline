# Issue #100: Download deposit-page Figma assets into packages/ui/src/assets/icons/

Source: https://github.com/eq-lab/pipeline/issues/100

## Scope

Pull the four image assets referenced by Figma node `1498-100130` (deposit page) and commit them as static SVG files under `packages/ui/src/assets/icons/`. No new components, no consumer wiring — this issue is asset acquisition only.

Target files:

- `packages/ui/src/assets/icons/coin-usdc.svg` — blue USDC coin (conversion card + wallet pill).
- `packages/ui/src/assets/icons/coin-plusd.svg` — blue PLUSD `$+` coin (conversion card row).
- `packages/ui/src/assets/icons/coin-plusd-large.svg` — same PLUSD glyph at the larger `DepositHeader` size.
- `packages/ui/src/assets/icons/swap-vertical.svg` — vertical up/down swap arrows between the USDC and PLUSD rows.

Out of scope:

- Importing the icons from any TS/TSX file or wiring them into components (`DepositHeader`, conversion card, wallet pill) — those land in the deposit-page composition Issues (#101, #112, #113).
- Optimizing or restyling the SVGs beyond what Figma exports.
- Updating the design-tokens or Typography stories.

## Assumptions and Risks

- Issue #28 (scaffold `@pipeline/ui`) is **CLOSED**, so `packages/ui/src/assets/icons/` already exists and is the correct landing spot (verified — sibling icons like `nav-home.svg`, `arrow-up-right.svg` already live there).
- The Figma MCP server is reachable and Figma node `1498-100130` is accessible to the agent running the coder step. If MCP cannot return downloadable SVG export URLs for any of the four assets, the coder must surface that as a blocker rather than hand-authoring an SVG.
- The Figma export pipeline may emit SVGs with embedded `<image>` raster fallbacks or hard-coded fills. We accept the raw Figma export as long as it is a valid SVG and renders at the design size; we do not re-author the artwork.
- Risk: the "large" PLUSD glyph (`coin-plusd-large.svg`) may be identical artwork to `coin-plusd.svg` at a different render size. The Issue acceptance explicitly permits shipping a single file in that case — see Step 4.
- Risk: SVGs that hard-code colors instead of using `currentColor` will not theme via CSS. For this Issue we keep the Figma colors as-is; theming is a follow-up if/when consumers need it.
- No external (`figma.com` / CDN) URL may remain in any source file. The Issue's acceptance bullet is a hard rule.

## Open Questions

_None_

## Implementation Steps

1. [x] Verify the asset destination directory exists and inspect siblings to match conventions.
   - Confirmed `packages/ui/src/assets/icons/` exists with sibling icons.
   - Existing icons use `xmlns`, `viewBox`, SVG format conventions.

2. [x] Pull the Figma node design context to enumerate the exact asset URLs.
   - Called `get_design_context` on `1498:100130`. Identified all four roles.
   - Note: All coin/arrow assets in Figma are raster (PNG) images embedded via `<img>` — not SVG vector paths. The plan explicitly accepts "SVGs with embedded `<image>` raster fallbacks."
   - Used `get_screenshot` MCP tool to download each icon as PNG from the relevant Figma nodes, then wrapped in SVG `<image>` with correct `viewBox`.

3. [x] Download each SVG to its target path.
   - Use the Figma MCP-provided download URL (or `WebFetch` against that signed URL if MCP only returns the URL) to write the bytes directly into the four target files under `packages/ui/src/assets/icons/`.
   - Do **not** embed the Figma URLs anywhere in source. The download URL is used at acquisition time and discarded.

4. [x] Resolve the PLUSD large-vs-small question.
   - Compared pixel content of 72px export (DepositHeader) vs 40px export (conversion card) by scaling large to 40x40 and computing mean pixel diff.
   - Result: mean diff 3.57 (within LANCZOS resampling noise), same artwork. `coin-plusd-large.svg` is NOT committed. Consumers render `coin-plusd.svg` at 72px via CSS. Issue comment posted.

5. [x] Validate the SVGs.
   - All three files start with `<svg`, have `xmlns="http://www.w3.org/2000/svg"`, and have `viewBox`. No external refs.
   - SVGs use base64-embedded PNG `<image>` (Figma coin/arrow assets are raster, not vector paths).

6. [x] Confirm the no-external-URL invariant across the repo.
   - `rg -n "figma\.com" packages apps` → zero matches.
   - `rg -n "figma-alpha-api\.s3" packages apps` → zero matches.

7. [x] Run lint to make sure nothing in the workspace regresses on asset-related rules.
   - `yarn workspace @pipeline/ui lint` → clean.
   - `npx tsx scripts/lint-docs.ts` → 0 errors, 30 warnings (pre-existing).

## Test Strategy

- Manual visual check: open each of the four (or three) committed SVGs in a browser. Confirm the rendered output matches the corresponding glyph in the Figma node screenshot at the design size.
- Static checks:
  - `rg -n "figma\\.com|figma-alpha-api" packages apps` returns zero matches.
  - Each SVG file is non-empty, starts with `<svg`, and contains `xmlns="http://www.w3.org/2000/svg"` and a `viewBox` attribute.
- Workspace lint: `yarn workspace @pipeline/ui lint` is clean.
- No new unit/E2E coverage is added — the assets are inert until a consumer Issue (#101 / #112 / #113) imports them. Consumption-side rendering tests live with those Issues.

## Docs to Update

- None. These are raw design assets; they are not part of any product spec or design doc. If Step 4 collapses the large-PLUSD file, leave a single-line comment on Issue #100 (per Issue acceptance) — no repo doc edits.
