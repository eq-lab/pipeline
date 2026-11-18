# Issue #1329: Add a Foundation/Tokens Storybook story for design-token visual review

Source: https://github.com/eq-lab/pipeline/issues/1329 (parent epic #2029 — Frontend tech debt; tracker entry TD-6)

## Scope

Add one Storybook story file, `packages/ui/src/foundation/Tokens.stories.tsx` (title `Foundation/Tokens`), that renders every design token of three families declared in `packages/ui/src/styles/theme.css`:

- `--color-pipeline-*` — swatch + token name + declared value (+ the resolved computed value when it differs, e.g. `--color-pipeline-positive-strong` which is a `var()` alias).
- `--text-pipeline-*` — type-ramp sample at the token's size/line-height + name + `size / line-height` values (the `--line-height` companions are paired with their base token, not listed separately).
- `--radius-pipeline-*` — a bordered box with the radius applied + name + value.

Token enumeration is derived from `theme.css` itself, not a hand-maintained list, so a newly added token appears automatically: import the stylesheet as a string (`import themeCss from "../styles/theme.css?raw"` — `vite/client` types are already in `packages/ui/tsconfig.json`), extract the `@theme { ... }` block, and regex out `--(color|text|radius)-pipeline-[a-z0-9-]+: <value>;` declarations (strip trailing `/* ... */` comments, join multi-line `rgb(\n ...)` values). The "expected value" column shows the declared value from `@theme`; the swatch itself is painted with `var(--token)` so it shows what the browser actually resolves (both `:root` and `@theme` declare these vars; a divergence becomes visible).

Stories: `Colors`, `TypeRamp`, `Radii` (three named exports; one per family keeps each canvas reviewable and a11y-addon scoped). Layout `padded`.

Out of scope: font-weight / tracking / font-family tokens (not named in the Issue; `Foundation/Typography` already covers families/weights), any token value changes, visual-regression tooling (Chromatic/Playwright snapshots), dark mode (no dark token set exists).

## Assumptions and Risks

- Existing `packages/ui/src/typography/Typography.stories.tsx` (`Foundation/Typography`) shows composite text styles; the new TypeRamp story is token-level and complementary, not a replacement. No change to that file.
- `?raw` import of a `.css` file under Storybook's Vite builder returns the source text and does not also inject styles; `preview.ts` already imports `theme.css` globally, so tokens resolve.
- Regex parsing is brittle to unusual formatting (multi-line `rgb(` values and `var(` aliases exist today). Mitigation: normalise whitespace inside the captured value; verify the rendered count equals `grep -c` of each family in the `@theme` block (colors 31 declarations incl. aliases, text 9 base sizes, radii 6 — coder recounts at implementation time).
- Comment policy (memory: comment-minimal code): one 2–3-line header pointing at `theme.css` / TD-6; no other comments.
- No Figma link on the Issue; verification is against `theme.css` values, not a frame. No user-facing app behavior changes, so no product spec update.

## Open Questions

_None_

## Implementation Steps

1. Create `packages/ui/src/foundation/Tokens.stories.tsx`:
   - `import themeCss from "../styles/theme.css?raw";`
   - Pure helper `parseTokens(css, family)` returning `{ name, value }[]` in declaration order from the `@theme` block; for `text`, group `--text-pipeline-X` with `--text-pipeline-X--line-height`.
   - Small presentational components (`ColorSwatch`, `TypeRampRow`, `RadiusSample`) using inline styles that reference existing tokens for chrome (`--color-pipeline-line`, `--color-pipeline-ink-muted`, `--font-body`), mirroring the Typography story's table style.
   - Token names/values rendered as monospace text so they are copy-pasteable.
   - `meta = { title: "Foundation/Tokens", parameters: { layout: "padded" } } satisfies Meta`; exports `Colors`, `TypeRamp`, `Radii`.
2. Update `docs/exec-plans/tech-debt-tracker.md` TD-6: mark resolved by #1329 per the tracker's existing resolution convention (check how other resolved entries are marked; correct the stale `Location: packages/ui/src/stories/`).
3. Optionally add one line to `docs/FRONTEND.md` Storybook section noting `Foundation/Tokens` as the token review surface.

## Test Strategy

- `yarn workspace @pipeline/ui lint` (eslint + prettier) and `npx tsc -p packages/ui --noEmit` (or `scripts/check-changes.sh`, which triggers the ui -> wallet-connect -> frontend/trustee chain).
- `yarn workspace @pipeline/ui build-storybook` succeeds.
- Manual: in Storybook (user's running instance or a fresh `storybook` dev server if none is running — do not restart the user's), confirm each story renders, per-family counts match `theme.css`, the `positive-strong` alias resolves to `#208000`, rgba tokens show translucency over a checkerboard/paper background, and the a11y addon panel reports no violations from the story chrome.
- No unit tests: the package has no test runner; the parser is exercised by the build + manual count check.

## Docs to Update

- `docs/exec-plans/tech-debt-tracker.md` (TD-6 resolved).
- `docs/FRONTEND.md` Storybook section (one line, optional).
