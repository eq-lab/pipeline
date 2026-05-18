# Issue #238: ActivityHeader hero icon renders as a black square on /transactions

Source: https://github.com/eq-lab/pipeline/issues/238

## Scope

Fix the `HeroIcon` glyph so it renders as the masked `arrow-clock` (and `chart`)
icon instead of a solid black 36×36 square. Root cause is the SVG `import`
returning a value that does not work as a CSS `mask` URL when consumed through
the workspace `@pipeline/ui` source export and resolved by the frontend's Vite.

In scope:

- `packages/ui/src/components/HeroIcon/HeroIcon.tsx` — force Vite URL-string
  resolution for the two SVGs it imports.
- A regression test asserting the rendered `HeroIcon` `<span>` carries a
  non-empty `mask-image` (`url(...)`) value.
- Audit of every other place in `packages/ui/src` that consumes an SVG via
  CSS `mask` / `WebkitMask` and apply the same `?url` suffix so we do not ship
  the same latent bug elsewhere. (`<img src={...}>` consumers like
  `ActivityIcon` are not affected — Vite returns the URL by default and `<img>`
  has no issue rendering it.)

Out of scope:

- Fix B from the Issue (refactor to inline SVG React components).
- Replacing the masked-icon pattern globally.
- Any visual / design change.

## Assumptions and Risks

- Assumption: the frontend's Vite (`packages/frontend/vite.config.ts`) has no
  explicit SVG plugin, so the default Vite asset pipeline is what resolves
  the `*.svg` import in the UI package. The `?url` query is the canonical
  Vite incantation for "give me the public URL string for this asset" and is
  stable across dev and build.
- Risk: the issue body asserts Fix A as the canonical fix, but we have not
  yet observed the exact computed `mask-image` value in DevTools. If `?url`
  does not change the resolved value (i.e. the default already returns a URL
  and the bug is elsewhere — wrong path, MIME, dev-server caching), we will
  fall back to inline SVG rendering (Fix B) for the two glyphs. The plan's
  Diagnostic Step gates the actual fix on a confirmed root cause.
- Risk: applying `?url` to every masked-icon consumer in `packages/ui` is
  cheap but expands the diff. We accept that to prevent shipping the same
  bug under a different component name.
- Dependency: none. Branch `background` is clean; no unmerged blockers.

## Open Questions

_None_

## Implementation Steps

1. **Reproduce + confirm root cause** (no code change).
   - Start `yarn front:dev`, open `/transactions` in a real browser.
   - Inspect the 36×36 `<span>` inside `HeroIcon` and capture its computed
     `mask-image`. Check the Network tab for the `arrow-clock.svg` request and
     its response (status + `Content-Type`).
   - Record the finding in the PR description. If the URL is wrong / 404,
     proceed with Fix A as planned. If the URL loads fine and the mask is
     still broken (unlikely given the symptom), switch to Fix B before
     continuing — note the decision in the plan's progress log.

2. **Apply `?url` to mask-driven SVG imports in `packages/ui`.**
   - `packages/ui/src/components/HeroIcon/HeroIcon.tsx`:
     ```ts
     import arrowClockSrc from "../../assets/icons/arrow-clock.svg?url";
     import navStatsSrc   from "../../assets/icons/nav-stats.svg?url";
     ```
   - `packages/ui/src/components/ConversionCard/ConversionCard.tsx` — same
     treatment for `swap-vertical.svg` (also consumed via CSS mask; see
     L9). Confirm by reading the file before editing.
   - Run `rg -n "WebkitMask|mask: ?\`url\(\\\$" packages/ui/src` to ensure no
     additional masked-icon consumer is missed. For each hit, apply `?url`
     to the imported SVG.
   - Leave `<img src={...}>` consumers (`ActivityIcon`, `Stat.stories`,
     illustrations) untouched — they already work with the default import
     and do not exercise the mask path.

3. **Smoke / regression test.**
   - Add `packages/ui/src/components/HeroIcon/HeroIcon.test.tsx` using
     `@testing-library/react` + `vitest` (matching the existing UI test
     setup; verify by inspecting the package's dev deps and adding the
     deps in the same step if not yet present — keep additions minimal).
   - Render `<HeroIcon icon="arrow-clock" />`, query the inner `<span>`,
     and assert:
     - `getComputedStyle(span).maskImage` (or the inline `style.mask` /
       `style.WebkitMask`) starts with `url(` and is not `url("")` or
       `url(undefined)`.
     - Repeat for `icon="chart"`.
   - If `packages/ui` does not yet have a vitest config, host the test in
     `packages/frontend` instead (frontend already configures jsdom +
     vitest globals — see `packages/frontend/vite.config.ts`) and import
     `HeroIcon` from `@pipeline/ui`. This keeps the regression coverage
     even if `packages/ui` does not own a test runner yet.

4. **Manual verification on `/transactions`.**
   - Restart `yarn front:dev`, hard-reload `/transactions`, and confirm
     the hero icon now renders the clock-with-arrow glyph centered in the
     muted circle (matches Figma node 1497:94914).
   - Capture an updated screenshot and replace the broken-state screenshot
     placeholder in the Issue/PR (attach to PR body).

5. **Run repo checks.**
   - `yarn lint` in `packages/ui` and `packages/frontend`.
   - `npx tsx scripts/lint-docs.ts` from the repo root (per AGENTS.md).
   - The repo's frontend test command (`/test-fast` workflow) to make sure
     nothing else breaks.

## Test Strategy

- **New regression test** (Implementation Step 3) — asserts the computed
  `mask-image` on `HeroIcon`'s inner `<span>` is a non-empty `url(...)` for
  both supported icons. This is the test the Issue explicitly asks for.
- **Existing Storybook stories** in `HeroIcon.stories.tsx` already cover
  `Default`, `WithAriaLabel`, `Chart`, and `OnPaper`. Re-run Storybook
  visually after the fix to make sure no story regresses.
- **Manual verification** on `/transactions` against the Figma reference
  (node 1497:94914).
- **Edge cases**: dev mode (`yarn front:dev`) vs. production build
  (`yarn front:build` + `yarn front:preview`) — verify both since Vite's
  asset handling differs between dev and build, and the bug only matters
  if both produce a working URL.

## Docs to Update

- No product-spec change — this is a pure rendering bug with no behavioural
  impact.
- After fix lands, archive this plan to `docs/exec-plans/completed/` (the
  manager handles archival at PR/merge time).
- No `known-bugs.md` entry needed — this Issue is the tracking record and
  will close on merge.
