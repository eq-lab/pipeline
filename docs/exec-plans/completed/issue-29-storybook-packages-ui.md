# Issue #29: Set up Storybook in packages/ui

Source: https://github.com/eq-lab/pipeline/issues/29

## Scope

Wire Storybook into `packages/ui` so each Phase-3 component issue can ship a `.stories.tsx` alongside its component. Specifically:

- Add Storybook config under `packages/ui/.storybook/` (`main.ts`, `preview.ts`).
- Add `storybook` (dev server) and `build-storybook` (static export) scripts to `packages/ui/package.json`.
- Pin all Storybook-related dependencies to exact versions (no `^`, no `~`).
- Pick versions that clear the repo's `npmMinimalAgeGate: 14d` (today is 2026-05-12; package versions must be published on or before 2026-04-28).
- Gitignore `storybook-static/` output.
- Reference `./src/styles/theme.css` from `preview.ts` as a commented-out / guarded import (the file does not exist yet — landing it is a separate Phase-3 issue), so the wire-up is ready but the build does not crash today.

Out of scope:
- Authoring any actual stories or components (handled by per-component Phase-3 issues).
- Creating `theme.css` or any design tokens.
- Visual regression tooling (Chromatic, Loki, etc.).
- Wiring Storybook into root-level scripts or CI.

## Assumptions and Risks

- **Issue #28 is done** — `packages/ui` exists with Vite 6 + React + Tailwind v4 + TS 5.9 (verified: `packages/ui/package.json`, `vite.config.ts`, `tsconfig.json` are in place).
- **Storybook 10.x is the target.** Storybook 10 supports the Vite builder and React 18/19; 10.3.5 (published 2026-04-07) clears the 14d gate. 10.3.6 (2026-04-29) is just inside the 14d window and must be avoided unless explicitly preapproved.
- **Builder = Vite.** The package already uses Vite; using `@storybook/react-vite` keeps the toolchain consistent and reuses `vite.config.ts` (Tailwind v4 plugin, `@/` alias).
- **Tailwind v4 preview.** Tailwind v4 uses CSS-first config (`@import "tailwindcss"`) and the Vite plugin already loaded in `vite.config.ts`; preview.ts only needs to import the future `theme.css` for tokens. Until that file exists, the import line is commented with a TODO so `yarn storybook` works today.
- **Yarn 4 workspace.** Scripts must be runnable as `yarn workspace @pipeline/ui storybook` / `... build-storybook`.
- **React version.** `packages/ui` does not yet declare `react` / `react-dom` as deps (only `@vitejs/plugin-react` devDep). Storybook 10 needs a real React install. We will add `react` and `react-dom` as devDependencies pinned to a 14d-clear version (e.g. 19.1.x — confirm release date in implementation, fall back to 18.3.1 if needed). Risk: this is a new dep choice for the package; if Phase-3 component issues prefer React 18, the planner notes it as an open question.
- **Risk:** Yarn's age gate refuses fresh deps. If any transitive Storybook dep is too new, options are (a) bump the chosen Storybook patch *down* until it resolves, (b) add a narrow `npmPreapprovedPackages` entry in `.yarnrc.yml` for that single transitive package with a justification comment. Prefer (a).
- **Risk:** Storybook addons (`@storybook/addon-essentials` is gone in v10; replaced by per-feature addons like `@storybook/addon-docs`, `@storybook/addon-a11y`). Implementation must use the v10 addon names, not the v8/v9 ones.

## Open Questions

- **React version for `packages/ui`:** pin React 19.x or React 18.3.1? Phase-3 component issues are not yet written, and `packages/frontend` (not inspected here) may already pin one. The coder should align with whatever `packages/frontend/package.json` uses; if `packages/frontend` is also empty, default to React 19.1.x (matching Storybook 10's primary target) and log a tech-debt entry to revisit if Phase-3 needs change.
- **Addons baseline:** ship with only `@storybook/addon-docs` for MVP, or also include `@storybook/addon-a11y` from day one given the accessibility focus called out in `docs/FRONTEND.md`? Recommendation: ship `addon-docs` + `addon-a11y` now to avoid a churn PR later, but the manager / human can downgrade to docs-only if they want a minimal first cut.

## Implementation Steps

1. ✅ **Pick exact pinned versions** (verify each clears 14d gate at implementation time via `npm view <pkg> time --json`; today's cutoff is 2026-04-28):
   - `storybook@10.3.5`
   - `@storybook/react-vite@10.3.5`
   - `@storybook/addon-docs@10.3.5`
   - `@storybook/addon-a11y@10.3.5` (pending Open Question)
   - `react@<pinned exact>` + `react-dom@<pinned exact>` (see Open Question; expected `19.1.x`)
   - `@types/react@<exact>` + `@types/react-dom@<exact>` matching the React major
   If any package is younger than 14d at implementation time, walk the patch version *down* until it clears; document the chosen versions in the PR description.

2. ✅ **Update `packages/ui/package.json`:**
   - Add to `scripts`:
     ```json
     "storybook": "storybook dev -p 6006 --no-open",
     "build-storybook": "storybook build -o storybook-static"
     ```
   - Add the pinned Storybook + React deps under `devDependencies` (exact versions, no `^`/`~`).
   - Keep `private: true`, `type: "module"`.

3. ✅ **Create `packages/ui/.storybook/main.ts`:**
   - `framework: { name: "@storybook/react-vite", options: {} }`
   - `stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"]`
   - `addons: ["@storybook/addon-docs", "@storybook/addon-a11y"]` (drop a11y if the Open Question resolves that way)
   - `typescript: { check: false, reactDocgen: "react-docgen-typescript" }`
   - No custom `viteFinal` for now — `vite.config.ts` is auto-picked up by the Vite builder, so Tailwind v4 and the `@/` alias come for free.
   - Use `satisfies StorybookConfig` typing from `@storybook/react-vite`.

4. ✅ **Create `packages/ui/.storybook/preview.ts`:**
   - Export `parameters` with `controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } }` and `layout: "centered"`.
   - Add a TODO-commented import line for the future theme stylesheet:
     ```ts
     // TODO(#<future-theme-issue>): enable once src/styles/theme.css lands
     // import "../src/styles/theme.css";
     ```
   - Use `satisfies Preview` typing.

5. ✅ **Gitignore the build output.** Append to `/Users/dima/git/pipeline/.gitignore`:
   ```
   packages/ui/storybook-static/
   ```

6. ✅ **Install and verify.**
   - `yarn install` from repo root (must succeed without `YN0084` age-gate errors).
   - `yarn workspace @pipeline/ui storybook` — confirm dev server boots and serves the empty story index on http://localhost:6006.
   - `yarn workspace @pipeline/ui build-storybook` — confirm static build succeeds and writes `packages/ui/storybook-static/`.
   - `yarn workspace @pipeline/ui lint` still passes (eslint + prettier).
   - `yarn workspace @pipeline/ui exec tsc --noEmit` still passes (the new `.storybook/*.ts` files are typechecked).
   - `npx tsx scripts/lint-docs.ts` still passes.

7. ✅ **Figma verification.** The Issue links a Figma node (`1497-94556`). The coder should pull that frame with `mcp__plugin_figma_figma__get_screenshot` to confirm it is a component-catalog reference (not a screen we need to wire up now). Storybook setup itself is a tooling task — no Figma-driven pixel work required — but capture the screenshot in the PR description as evidence that the design context was reviewed.

## Test Strategy

This is a tooling/scaffolding issue with no runtime business logic, so testing is verification-driven rather than test-suite-driven:

- **Manual smoke tests (must all pass before PR):**
  1. `yarn install` succeeds with the 14d gate active.
  2. `yarn workspace @pipeline/ui storybook` starts the dev UI without errors. The empty "Welcome" / no-stories landing page renders. Stop with Ctrl-C.
  3. `yarn workspace @pipeline/ui build-storybook` exits 0 and creates `packages/ui/storybook-static/index.html`.
  4. `packages/ui/storybook-static/` is correctly gitignored (`git status` does not show it after the build).
- **Lint / type checks:**
  - `yarn workspace @pipeline/ui lint` — green.
  - `yarn workspace @pipeline/ui exec tsc --noEmit` — green (covers `.storybook/main.ts` and `.storybook/preview.ts`).
  - `npx tsx scripts/lint-docs.ts` — green.
- **Throwaway story sanity check (do NOT commit):** during local verification, temporarily drop a one-line `Hello.stories.tsx` under `packages/ui/src/` to confirm the glob picks it up, the dev server hot-reloads, and the static build includes it. Delete the file before committing — actual stories belong with their components in Phase-3 issues.
- **Edge cases to confirm:**
  - The commented-out `theme.css` import does not break either the dev server or the static build.
  - `npmMinimalAgeGate` is not triggered by any direct or transitive dep (CI install would catch this; verify locally first).
  - Running the scripts from the repo root via `yarn workspace @pipeline/ui ...` works identically to running them from inside `packages/ui/`.

No automated unit/integration tests are warranted for the Storybook wire-up itself.

## Docs to Update

- **`packages/ui/package.json`** — new scripts and devDependencies (the change itself).
- **`/Users/dima/git/pipeline/.gitignore`** — append `packages/ui/storybook-static/`.
- **`docs/FRONTEND.md`** — add a short "Component workshop" subsection noting that Storybook lives in `packages/ui/.storybook/` and is launched via `yarn workspace @pipeline/ui storybook`. Mention that the design-system decision (Shadcn vs. Radix) is still TBD; this issue only sets up the workshop, not the library.
- **`docs/exec-plans/tech-debt-tracker.md`** — log:
  - "Storybook preview imports `theme.css` only as a commented TODO until the theme issue lands."
  - If Open Question resolves toward "addon-docs only," log "Add `@storybook/addon-a11y` once Phase-3 a11y work begins."
- No product spec change — this is `chore`-grade frontend tooling that does not alter user- or agent-facing behavior.
