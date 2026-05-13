# Issue #116: Download transactions-page Figma assets into packages/ui/src/assets/icons/

Source: https://github.com/eq-lab/pipeline/issues/116

## Scope

Pull every new icon referenced by Figma node `1497-94912` (transactions page) and
commit them as static SVG files under `packages/ui/src/assets/icons/`. This issue
is asset acquisition only — no component, no story, no consumer wiring.

Target files (kebab-case, all under `packages/ui/src/assets/icons/`):

- `arrow-clock.svg` — clock-with-arrow glyph used inside the 72px `HeroIcon`
  badge above the "Activity" heading. Figma node ref `imgVector`, source node
  `I1497:94915;6409:668;8450:11687` (name `arrow-clock`), rendered at 36×36
  inside a 72px circle.
- `check-circle.svg` — success transaction badge inside `ActivityIcon`. Figma
  ref `imgVector1`, source node `I1505:104302;8905:4088;6409:674;8532:9443`
  (name `check-circle`), rendered at 20×20 inside a 40×40 ink tile.
- `clock-pending.svg` — pending transaction badge inside `ActivityIcon`. Figma
  ref `imgVector2`, source node `I1505:104303;8905:4086;6409:674;7154:4837`
  (Figma node name `clocks`), rendered at 20×20.
- `arrow-up-circle.svg` — unstake transaction badge. Figma ref `imgVector3`,
  source node `I1505:104304;8905:4086;6409:674;7403:1786` (name
  `arrow-up-circle`), rendered at 20×20.
- `arrow-down-circle.svg` — stake transaction badge. Figma ref `imgVector4`,
  source node `I1505:104305;8905:4086;6409:674;9194:25167` (name
  `arrow-down-circle`), rendered at 20×20.
- `exchange.svg` — convert transaction badge. Figma ref `imgVector5`, source
  node `I1505:104306;8905:4086;6409:674;6390:80` (name `exchange`), rendered at
  20×20.

Reused (NOT to be re-downloaded — already present and verified): `nav-home.svg`,
`nav-dollar.svg`, `nav-stats.svg`, `nav-history.svg`, `arrow-up-right.svg`.

Decision (recorded here, not flagged as an open question): the transactions
page also references an `arrow-clock` glyph in the top-nav `button-icon` slot
(Figma ref `imgVector10`, source node `I1497:94935;9284:21160;8450:11687`).
That is the **same** source node (`8450:11687`) as the existing
`nav-history.svg`, which already lives in `packages/ui/src/assets/icons/` and
already encodes the clock-with-arrow glyph as a vector path with
`fill="currentColor"`. Therefore we do NOT download a second history nav icon;
the existing `nav-history.svg` is reused for the nav slot, and the new
`arrow-clock.svg` (which targets the 72px Activity hero) is the only file we
ship that carries this glyph. The Issue body explicitly permits this choice
("clock-with-arrow glyph used by the 72px Activity hero (and the history nav
icon, if you find we still need it)").

Out of scope:

- Building `ActivityIcon` (#118) or `HeroIcon` (#119) — those are blocked by
  this issue and ship in their own PRs.
- Wiring the icons into the `/transactions` route (#125) or any component.
- Theming, restyling, or re-authoring the SVG artwork beyond the normalization
  required to keep parity with sibling icons (see Implementation Step 3).
- Touching any `nav-*.svg` already in `packages/ui/src/assets/icons/`.
- Adding a Storybook page that previews the new icons — Storybook coverage
  lands with the consumer components in #118/#119.

## Assumptions and Risks

- **Blocker #28 is closed.** Verified (`gh issue view 28` → CLOSED). The target
  directory `packages/ui/src/assets/icons/` exists with sibling icons
  (`nav-home.svg`, `nav-dollar.svg`, `nav-stats.svg`, `nav-history.svg`,
  `arrow-up-right.svg`, `coin-usdc.svg`, `coin-plusd.svg`, `swap-vertical.svg`).
  No package wiring changes are needed; `packages/ui/package.json` already
  exposes `./assets/*` via its `exports` map.
- **Figma MCP asset URLs expire after ~7 days.** The coder must call
  `mcp__plugin_figma_figma__get_design_context` against
  `fileKey=A43rjYYjSwdTmiwwf5cx5n`, `nodeId=1497:94912` at execution time to
  refresh the asset URLs — the ones captured in this plan **will be stale by
  the time the coder runs**. The role mapping (`imgVector` → `arrow-clock`,
  `imgVector1` → `check-circle`, etc.) is stable because it derives from the
  Figma node names (`arrow-clock`, `check-circle`, `clocks`, `arrow-up-circle`,
  `arrow-down-circle`, `exchange`), not from URL identity.
- **The exported assets may be raster (PNG) wrapped in `<svg><image>`, not
  vector paths.** Direct inspection of the transactions-page Figma node shows
  the icons rendered via `<img src={imgVectorN} />` — the same pattern that
  Issue #100 hit for `coin-usdc.svg` / `coin-plusd.svg`. The Issue #100 plan
  set the precedent: SVGs with a base64 `<image>` are acceptable as long as
  (a) the file is valid SVG (starts with `<?xml` or `<svg`, has `xmlns` and
  `viewBox`), (b) it renders at the design sizes (20px badges, 36px hero
  glyph), and (c) no external URL is left in the source file. We follow that
  precedent here. Counter-evidence: `nav-history.svg` is shipped as pure
  vector with `currentColor` paths, which means the Figma export pipeline
  *sometimes* returns vector SVG for clock-glyph nodes. The coder takes
  whichever form the MCP returns — vector preferred, base64-PNG-in-SVG
  acceptable — and does not re-author artwork.
- **`currentColor` is not guaranteed.** If the export is vector, the coder
  should replace literal fills on glyph paths with `fill="currentColor"` so
  that the consumer components (`ActivityIcon` paints white-on-ink, `HeroIcon`
  paints ink-tinted) can theme through CSS. If the export is base64 PNG, this
  is impossible — the consumer components in #118/#119 will need to handle
  that constraint there. Flag this in the PR if a base64 export ships, so the
  consumer-side work doesn't get surprised.
- **No external (`figma.com` / CDN) URL may remain in any source file.** Hard
  acceptance criterion from the Issue body. The coder must grep the repo
  (excluding `docs/`) and confirm zero hits before opening the PR.
- **Risk: the 72px Activity-hero `arrow-clock` and the existing
  `nav-history.svg` share a source node.** If pixel-diffing the two artworks
  reveals they are visually identical at the same render size, the
  Scope decision (ship a *new* `arrow-clock.svg` separate from
  `nav-history.svg`) still stands, because the Issue body lists `arrow-clock.svg`
  as a target file and the 72px hero consumer (`HeroIcon` in #119) explicitly
  expects to load `arrow-clock.svg`. We do not collapse the two files. This
  is the inverse of the Issue #100 "coin-plusd-large vs coin-plusd" collapse:
  there, the consumer hadn't been written yet; here, #119 already names
  `arrow-clock.svg` in its acceptance criteria.
- **Risk: Figma MCP returns a download URL but the bytes are not SVG.** If any
  download returns non-SVG bytes (e.g. raw PNG without an `<svg>` wrapper),
  STOP and surface — do not commit a binary blob under a `.svg` filename. The
  Issue #100 workflow re-wrapped Figma-PNG bytes inside a hand-authored
  `<svg><image href="data:image/png;base64,...">` wrapper; that is the
  fallback. The coder must not introduce a new asset format.

## Open Questions

_None_

## Implementation Steps

1. **Verify the destination directory and sibling conventions.**
   - Confirm `packages/ui/src/assets/icons/` exists.
   - Spot-check a sibling icon (`nav-history.svg` for vector format,
     `coin-plusd.svg` for the base64-PNG-in-SVG format) so the coder knows
     both shapes are acceptable.
   - Confirm `nav-history.svg`, `nav-home.svg`, `nav-dollar.svg`,
     `nav-stats.svg`, `arrow-up-right.svg` are already present (per the
     Issue's "do not re-download these" list).

2. **Pull fresh design context from Figma.**
   - Call `mcp__plugin_figma_figma__get_design_context` with
     `fileKey="A43rjYYjSwdTmiwwf5cx5n"` and `nodeId="1497:94912"`.
   - From the returned code, extract the asset URLs for each role using the
     Figma node names listed in **Scope** as the join key. The role-to-file
     mapping is:
     | Figma node name        | Source node id (suffix of `data-node-id`) | File                          |
     |------------------------|-------------------------------------------|-------------------------------|
     | `arrow-clock` (hero)   | `6409:668;8450:11687`                     | `arrow-clock.svg`             |
     | `check-circle`         | `8905:4088;6409:674;8532:9443`            | `check-circle.svg`            |
     | `clocks`               | `8905:4086;6409:674;7154:4837`            | `clock-pending.svg`           |
     | `arrow-up-circle`      | `8905:4086;6409:674;7403:1786`            | `arrow-up-circle.svg`         |
     | `arrow-down-circle`    | `8905:4086;6409:674;9194:25167`           | `arrow-down-circle.svg`       |
     | `exchange`             | `8905:4086;6409:674;6390:80`              | `exchange.svg`                |
   - The nav-slot `arrow-clock` ref (`imgVector10`, source
     `I1497:94935;9284:21160;8450:11687`) is intentionally NOT downloaded —
     `nav-history.svg` already covers it.

3. **Download each asset to its target path.**
   - For each role above, fetch the bytes from the MCP-provided download URL
     (`curl -fsSL -o <path> "<url>"` or equivalent). Write to the target
     filename under `packages/ui/src/assets/icons/`.
   - Inspect the first bytes:
     - If the response is text and starts with `<?xml` or `<svg` → keep as
       a vector SVG.
     - If the response is binary PNG (starts with `\x89PNG`) → wrap in an
       `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 N N" width="N"
       height="N"><image href="data:image/png;base64,..." x="0" y="0"
       width="N" height="N"/></svg>` skeleton, matching the existing
       `coin-plusd.svg` shape. Use `N=36` for `arrow-clock.svg`, `N=20` for
       all others (the design render sizes from the Figma node).
     - If the response is neither (e.g. HTML error page) → STOP and report
       in the PR; do not commit.
   - Do NOT embed any `figma.com` URL anywhere in the committed files. The
     download URL is consumed at acquisition time and discarded.

4. **Normalize each vector SVG (skip this step for base64-PNG exports).**
   - Strip fixed `width=`/`height=` on the root `<svg>` so the icon scales to
     consumer-supplied sizing. Keep `viewBox`.
   - Ensure `xmlns="http://www.w3.org/2000/svg"` is present on the root.
   - Replace literal `fill="#xxxxxx"` on glyph paths with `fill="currentColor"`
     so consumers can theme via CSS (white-on-ink inside `ActivityIcon`,
     ink-tinted inside `HeroIcon`). Reference: existing `nav-history.svg`
     already uses `fill="currentColor"` on both its paths.
   - Remove Figma cruft: empty `<defs>`, unused `<title>`/`<desc>`,
     collision-prone `id="..."` attributes.
   - If a glyph carries multiple paths with different non-decorative colors
     (e.g. a green check on a white circle), leave the literal colors —
     `currentColor` only makes sense for monochrome glyphs. Document the
     decision in a one-line comment near the path if the color is
     load-bearing.

5. **Confirm the no-external-URL invariant.**
   ```bash
   rg -n "figma\.com|mcp/asset/|figma-alpha-api" packages \
     --glob '!**/storybook-static/**'
   ```
   Expected output: zero matches. (Hits inside `docs/` are expected and
   excluded by the glob above.)

6. **Validate each committed file.**
   ```bash
   for f in \
     packages/ui/src/assets/icons/arrow-clock.svg \
     packages/ui/src/assets/icons/check-circle.svg \
     packages/ui/src/assets/icons/clock-pending.svg \
     packages/ui/src/assets/icons/arrow-up-circle.svg \
     packages/ui/src/assets/icons/arrow-down-circle.svg \
     packages/ui/src/assets/icons/exchange.svg; do
     test -s "$f" && head -c 200 "$f" | grep -qE '<\?xml|<svg' \
       || { echo "MISSING/INVALID: $f"; exit 1; }
     grep -q 'xmlns="http://www.w3.org/2000/svg"' "$f" \
       || { echo "MISSING xmlns: $f"; exit 1; }
     grep -q 'viewBox' "$f" \
       || { echo "MISSING viewBox: $f"; exit 1; }
   done
   ```

7. **Lint check.**
   - `yarn workspace @pipeline/ui lint` must remain clean.
   - `npx tsx scripts/lint-docs.ts` must not regress (the existing repo
     baseline is "0 errors, 30 warnings" — match or improve).

8. **Manual visual check.**
   - Open each SVG in a browser tab or VS Code preview at the design size
     (36px for `arrow-clock.svg`, 20px for the rest) and confirm the rendered
     glyph matches the corresponding Figma badge in the screenshot returned
     by `get_design_context` (or `get_screenshot` for a higher-fidelity
     comparison).

9. **PR summary note.**
   - In the PR description, list the six new files and call out whether each
     shipped as a vector SVG or as a base64-PNG-in-SVG wrapper. This lets the
     #118 / #119 consumers know up front whether `currentColor` theming is
     available on each icon — they may need a `<mask>`-based recolor for any
     icon that ships as PNG-in-SVG.

## Test Strategy

This issue commits static assets only; there are no runtime branches to
unit-test. The verification surface is:

- **Existence + format check (automated, one-shot):** the bash loop in
  Implementation Step 6. Asserts every target file exists, is non-empty, has
  a valid SVG header, and carries `xmlns` + `viewBox`. Do NOT add this as a
  permanent test file; it is a coder-side verification, identical in spirit
  to the assets check in #39 / #100.
- **External-URL check (automated, one-shot):** the `rg` invocation in
  Implementation Step 5. Asserts no `figma.com`, `mcp/asset/`, or
  `figma-alpha-api` URL leaks into `packages/`.
- **Lint regression:** `yarn workspace @pipeline/ui lint` stays green
  (no formatter complaints on the new SVG files — the project's prettier
  config does not format SVGs but does check whitespace at the file
  boundaries) and `npx tsx scripts/lint-docs.ts` does not regress.
- **Visual verification (manual):** open each SVG at its design size in a
  browser / preview pane and confirm the glyph matches the Figma source.
  Document this in the PR description with a one-line "rendered at Npx,
  matches Figma node `<name>`" note per file.
- **No new component tests, no new Storybook stories, no new E2E coverage.**
  Consumer-side rendering tests live with #118 (`ActivityIcon`), #119
  (`HeroIcon`), and #125 (`/transactions` route composition).

## Docs to Update

- None of `docs/product-specs/`, `docs/design-docs/`, `docs/FRONTEND.md`,
  `docs/STORIES.md`, or `ARCHITECTURE.md` requires changes — this issue
  commits inert design assets and does not alter behavior, agent surface,
  routing, or architectural boundaries. The downstream consumer issues
  (#118, #119, #125) are responsible for any STORIES/spec edits triggered
  by the new transactions page.
- After PR merge, the manager moves this plan from
  `docs/exec-plans/active/issue-116-transactions-figma-icons.md` to
  `docs/exec-plans/completed/` per the standard archive flow.
