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

1. Verify the asset destination directory exists and inspect siblings to match conventions.
   - Confirm `packages/ui/src/assets/icons/` exists (it does).
   - Skim `nav-home.svg` / `arrow-up-right.svg` for file-style conventions (xmlns, viewBox, no `width`/`height` lock-in if possible) to align the new exports.

2. Pull the Figma node design context to enumerate the exact asset URLs.
   - Call `mcp__plugin_figma_figma__get_design_context` with `fileKey=A43rjYYjSwdTmiwwf5cx5n`, `nodeId=1498:100130`.
   - From the returned download-URL map, identify the four target assets by matching them to the visual roles called out in the Issue body:
     - USDC coin in the conversion card / wallet pill → `coin-usdc.svg`.
     - PLUSD `$+` coin inside the conversion card → `coin-plusd.svg`.
     - PLUSD `$+` coin inside the `DepositHeader` (larger render) → `coin-plusd-large.svg`.
     - Vertical up/down arrows between conversion rows → `swap-vertical.svg`.
   - If any of the four roles cannot be unambiguously matched, drill in with `get_metadata` on `1498:100130` to locate the specific child node IDs, then call `get_design_context` on each child.

3. Download each SVG to its target path.
   - Use the Figma MCP-provided download URL (or `WebFetch` against that signed URL if MCP only returns the URL) to write the bytes directly into the four target files under `packages/ui/src/assets/icons/`.
   - Do **not** embed the Figma URLs anywhere in source. The download URL is used at acquisition time and discarded.

4. Resolve the PLUSD large-vs-small question.
   - Byte-compare the small and large PLUSD exports (`diff` the raw SVG bytes, ignoring trailing whitespace).
   - If they are identical artwork (same paths, only the wrapping `width`/`height` or `viewBox` differs), delete `coin-plusd-large.svg`, keep `coin-plusd.svg`, and add a comment on Issue #100 noting that one file is sufficient and that consumers should render `coin-plusd.svg` at the larger size via CSS.
   - If the artwork genuinely differs (different stroke weight, gradient, padding), keep both files.

5. Validate the SVGs.
   - Open each file and confirm: starts with `<svg`, includes `xmlns="http://www.w3.org/2000/svg"`, has a `viewBox`, parses (no truncated bytes), and contains no `figma.com` / external `href` references.
   - Quick render check: load each file in a browser (or `qlmanage -p` on macOS) to confirm it visually matches the Figma design at the intended size.

6. Confirm the no-external-URL invariant across the repo.
   - Run `rg -n "figma\\.com" packages apps` and confirm zero matches in source files (allowed only inside `docs/`).
   - Run `rg -n "figma-alpha-api\\.s3" packages apps` to catch signed CDN URLs that sometimes leak into SVG `xlink:href` attributes.

7. Run lint to make sure nothing in the workspace regresses on asset-related rules.
   - `yarn workspace @pipeline/ui lint`.
   - `npx tsx scripts/lint-docs.ts`.

## Test Strategy

- Manual visual check: open each of the four (or three) committed SVGs in a browser. Confirm the rendered output matches the corresponding glyph in the Figma node screenshot at the design size.
- Static checks:
  - `rg -n "figma\\.com|figma-alpha-api" packages apps` returns zero matches.
  - Each SVG file is non-empty, starts with `<svg`, and contains `xmlns="http://www.w3.org/2000/svg"` and a `viewBox` attribute.
- Workspace lint: `yarn workspace @pipeline/ui lint` is clean.
- No new unit/E2E coverage is added — the assets are inert until a consumer Issue (#101 / #112 / #113) imports them. Consumption-side rendering tests live with those Issues.

## Docs to Update

- None. These are raw design assets; they are not part of any product spec or design doc. If Step 4 collapses the large-PLUSD file, leave a single-line comment on Issue #100 (per Issue acceptance) — no repo doc edits.
