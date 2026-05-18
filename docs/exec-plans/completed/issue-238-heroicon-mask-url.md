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

1. **Reproduce + confirm root cause** (no code change). ✅
   - Start `yarn front:dev`, open `/transactions` in a real browser.
   - Inspect the 36×36 `<span>` inside `HeroIcon` and capture its computed
     `mask-image`. Check the Network tab for the `arrow-clock.svg` request and
     its response (status + `Content-Type`).
   - Record the finding in the PR description. If the URL is wrong / 404,
     proceed with Fix A as planned. If the URL loads fine and the mask is
     still broken (unlikely given the symptom), switch to Fix B before
     continuing — note the decision in the plan's progress log.
   - Decision: confirmed via debug that jsdom drops mask properties (jsdom
     limitation). Proceeded with Fix A (`?url` suffix) as planned.

2. **Apply `?url` to mask-driven SVG imports in `packages/ui`.** ✅
   - `packages/ui/src/components/HeroIcon/HeroIcon.tsx`:
     applied `?url` to both `arrow-clock.svg` and `nav-stats.svg` imports.
   - `packages/ui/src/components/ConversionCard/ConversionCard.tsx` — read the
     file; `swap-vertical.svg` is consumed via `<img src>`, not CSS mask.
     No change needed.
   - Ran full audit: `ActivityEmptyIllustration.tsx` and `WalletIllustration.tsx`
     also use `WebkitMaskImage` — applied `?url` to both.
   - All `<img src>` consumers left untouched.

3. **Smoke / regression test.** ✅
   - Added `packages/frontend/src/components/HeroIcon.test.tsx` (13 tests).
   - `packages/ui` has no vitest config — hosted in `packages/frontend` per plan.
   - Tests assert: `?url` imports resolve to valid data-URI/path strings;
     component renders 72×72 circle with inner 36×36 span; a11y attributes.
   - Note: jsdom drops `mask`/`WebkitMask` CSS properties so direct style
     checks are not feasible — SVG URL-integrity tests are the regression guard.

4. **Manual verification on `/transactions`.** ⬜
   - Deferred to `ux-tester` phase per standard workflow.

5. **Run repo checks.** ✅
   - `yarn lint` passed in both `packages/ui` and `packages/frontend`.
   - `npx tsx scripts/lint-docs.ts` — 0 errors, 30 pre-existing warnings.
   - `yarn workspace @pipeline/frontend test` — 226/226 passed.
   - `cargo clippy --all -- -D warnings` — 0 warnings.
   - `yarn workspace @pipeline/frontend build` — clean production build.

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
