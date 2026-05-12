# Issue #39: Download Figma assets into packages/ui/src/assets/

Source: https://github.com/eq-lab/pipeline/issues/39

## Scope

Pull every image asset referenced by Figma node `1497-94556` (Disconnected dashboard) out of Figma and commit them to git under `packages/ui/src/assets/`. Replace any transient `figma.com/api/mcp/asset/...` URLs in the repo with references to the committed local files.

In scope (committed files):

- `packages/ui/src/assets/logo.svg` — "Pipeline" wordmark, top-left header (Figma node `I1497:94717;9159:21675`, ref `imgVector2`, 116x32).
- `packages/ui/src/assets/icons/nav-home.svg` — home nav icon (filled, 24px, Figma node `I1497:94719;6411:831;6301:69`, ref `imgVector3`).
- `packages/ui/src/assets/icons/nav-dollar.svg` — dollar nav icon (24px, Figma node `I1497:94720;6411:831;6858:606`, ref `imgVector4`).
- `packages/ui/src/assets/icons/nav-stats.svg` — chart/stats nav icon (24px, Figma node `I1497:94721;9284:21160;6301:73`, ref `imgVector5`).
- `packages/ui/src/assets/icons/nav-history.svg` — arrow-clock history icon (24px, Figma node `I1497:94722;9284:21160;8450:11687`, ref `imgVector6`).
- `packages/ui/src/assets/icons/arrow-up-right.svg` — drill-in arrow used in the Q&A list (24px, Figma node `I1497:94670;8902:3678;8888:5739;6524:1868`, ref `imgVector1`). Also referenced from the stats strip (`external-link`, Figma node `I1497:94564;9284:21160;6387:199`, ref `imgVector`) — the design uses the same glyph; we ship a single `arrow-up-right.svg` and reuse it for both call sites. This is a one-line decision the planner is making; flagged in Open Questions for confirmation.
- `packages/ui/src/assets/illustrations/striped-wallet.svg` — striped illustration. The Issue body says this single file is used in both the Connect Wallet promo card AND the Recent activity empty state. In Figma node `1497:94556` there are two distinct illustration nodes (`Union` at `I1497:94566;1360:49452`, ref `imgUnion`, used in the Connect Wallet card; and `IMG` at `1497:94570`, ref `imgImg`, used in the Recent activity empty state). The Issue calls for one file; the planner will follow the Issue verbatim and ship a single `striped-wallet.svg` exported from the Connect Wallet `Union` node (the larger and more recognizably "wallet" of the two). The Recent activity empty state will use the same file. Flagged in Open Questions.

Out of scope:

- Any consumption of these assets from a React component (Issue #39 is asset acquisition only — wiring into the dashboard is a separate Issue).
- Updating `packages/ui/src/index.ts` to re-export the assets (Vite already exposes `./assets/*` via the existing `exports` map in `packages/ui/package.json`).
- PLUSD token icon (`imgPlusd` / `imgFg`) — not in the Issue's file list; skip.

## Assumptions and Risks

- Assumption: blocker Issue #28 is closed (verified — state CLOSED). The `packages/ui` package exists with `exports["./assets/*"]: "./src/assets/*"` already in `packages/ui/package.json`, so no package config changes are needed.
- Assumption: assets exported from Figma will be valid, optimized SVG (not rasterized PNG inside an `<svg>` wrapper). If Figma returns PNGs for any node (e.g. the striped illustration is sometimes flattened raster art), the coder MUST capture them as SVG via the Figma MCP `get_design_context` asset URLs and verify the file is text-based SVG. If a node only exports as PNG, halt and surface this — committing a PNG would silently violate the SVG acceptance criterion.
- Risk: Figma MCP asset URLs expire after ~7 days. The coder must download and commit in a single session; do not stash URLs in the codebase.
- Risk: SVGs exported from Figma frequently include fixed `width`/`height` and a `fill` attribute that prevents CSS-driven sizing/recoloring. The coder must strip `width`/`height` from the root `<svg>` (keeping `viewBox`) so the assets scale to the sizes used in the design (logo 116x32, nav icons 24x24, arrow 24x24, illustration ~313x200 for the wallet card / 240x240 for the activity placeholder). Where the icon should adopt the parent text color, replace literal `fill="#..."` with `fill="currentColor"` on the path(s). The planner's default is: nav icons and `arrow-up-right` use `currentColor`; the logo and illustration retain their literal colors.
- Risk: SVGs may include Figma-specific cruft (`<defs>` with unused gradients, `id="..."` collisions, clipPath ids that collide across files). Run each through a minimal cleanup (manual or `svgo` if already in repo). Do not add `svgo` as a dependency for this Issue.
- Risk: the Figma "external-link" glyph (ref `imgVector`) and the Q&A "arrow-up-right" glyph (ref `imgVector1`) MAY be visually distinct on closer inspection; using a single file is a planner decision pending confirmation (see Open Questions).

## Open Questions

- Q1: The Issue lists a single `arrow-up-right.svg` but the Figma node uses two distinct asset URLs (`imgVector` for the stats-strip external-link and `imgVector1` for the Q&A drill-in). Confirm we ship one file (`arrow-up-right.svg`) and reuse it for both, OR ship a second `external-link.svg`. Planner default: one file, named `arrow-up-right.svg` per the Issue.
- Q2: The Issue lists a single `striped-wallet.svg` used in both the Connect Wallet card and the Recent activity empty state, but Figma has two distinct illustration nodes (`Union` ≈ 314x200 for Connect Wallet, `IMG` ≈ 240x240 for Recent activity). Confirm we ship one file derived from the Connect Wallet `Union` node and reuse it in the empty state (planner default), OR ship two files (`striped-wallet.svg` + e.g. `striped-circle.svg`).

## Implementation Steps

1. Create the directory layout: `packages/ui/src/assets/`, `packages/ui/src/assets/icons/`, `packages/ui/src/assets/illustrations/`.
2. Re-run `mcp__plugin_figma_figma__get_design_context` against `fileKey=A43rjYYjSwdTmiwwf5cx5n`, `nodeId=1497:94556` to refresh the asset URLs (the ones captured in this plan expire ~7 days after issue creation). Map URLs to filenames using the table in **Scope**.
3. For each asset, download the SVG bytes from the Figma MCP asset URL (`https://www.figma.com/api/mcp/asset/<uuid>`) using `curl -fsSL -o <path>` and write to the target path. If the downloaded bytes are not SVG (check the first bytes — SVG starts with `<?xml` or `<svg`), STOP and report; do not commit binary blobs under these filenames.
4. Normalize each SVG:
   - Remove fixed `width=` and `height=` on the root `<svg>`. Keep `viewBox`.
   - For `icons/nav-*.svg` and `icons/arrow-up-right.svg`: replace literal fill colors on glyph paths with `fill="currentColor"` so consumers can recolor via CSS.
   - For `logo.svg` and `illustrations/striped-wallet.svg`: leave fills as exported (brand colors).
   - Strip any `<title>`/`<desc>` Figma noise and any obvious empty `<defs>`.
   - Ensure `xmlns="http://www.w3.org/2000/svg"` is present on the root.
5. Verify filenames are kebab-case and exactly match the list in Scope.
6. Grep the entire repo for `figma.com` and any `mcp/asset/` URLs and confirm none remain in source files:
   ```
   rg -n "figma\\.com|mcp/asset/" --glob '!docs/**' --glob '!**/storybook-static/**'
   ```
   (Hits inside `docs/` for the Issue/plan are expected.)
7. Run the project lint to confirm nothing is broken: `npx tsx scripts/lint-docs.ts` from repo root, and `yarn --cwd packages/ui lint` if it does not require a long install. (No code consumers exist yet, so type-check will be unaffected.)
8. Manual visual sanity check: open each SVG in a browser or VS Code preview. Confirm:
   - `logo.svg` renders the "Pipeline" wordmark.
   - All four `nav-*.svg` render the icon shapes shown in the Figma screenshot.
   - `arrow-up-right.svg` renders an up-right arrow.
   - `illustrations/striped-wallet.svg` renders the striped wallet illustration.
9. Surface the asset list and the resolution of Open Questions (Q1, Q2) in the PR description so the reviewer can verify file-count vs. design intent.

## Test Strategy

This Issue introduces static assets only; there are no runtime branches to unit-test. The test plan is:

- **Automated**: a small assets-presence check executed during the coder's verification step. After download, the coder runs:
  ```bash
  for f in \
    packages/ui/src/assets/logo.svg \
    packages/ui/src/assets/icons/nav-home.svg \
    packages/ui/src/assets/icons/nav-dollar.svg \
    packages/ui/src/assets/icons/nav-stats.svg \
    packages/ui/src/assets/icons/nav-history.svg \
    packages/ui/src/assets/icons/arrow-up-right.svg \
    packages/ui/src/assets/illustrations/striped-wallet.svg; do
    test -s "$f" && head -c 200 "$f" | grep -qE '<\?xml|<svg' || { echo "MISSING/INVALID: $f"; exit 1; }
  done
  ```
  This guards the "exists + is SVG" acceptance criterion. Do not add a permanent test file for this — the assertion is a one-shot verification.
- **Static analysis**: `rg "figma\\.com|mcp/asset/"` over `src/`, `packages/*/src/`, and any TS/TSX/JS/CSS files must return zero hits.
- **Visual**: open each SVG locally (see Implementation Step 8). Optionally, add a single Storybook story under `packages/ui/.storybook/` that renders all seven assets in a grid for human review. Planner default: do NOT add the Storybook story in this Issue (keeps the diff minimal); revisit when assets are consumed by real components in a follow-up Issue.
- **Regression**: no existing tests should fail. Run `yarn --cwd packages/ui lint` (or repo-level lint) to confirm.

## Docs to Update

- None of `docs/product-specs/`, `docs/design-docs/`, or `ARCHITECTURE.md` requires changes — this Issue commits static assets without changing behavior, agent surface, or architectural boundaries.
- After PR merge, the manager will move `docs/exec-plans/active/issue-39-figma-assets-download.md` → `docs/exec-plans/completed/` per the standard archive flow.
- No `docs/STORIES.md` update — there is no new user-visible behavior to story.
