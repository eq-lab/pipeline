# Issue #37: Add @pipeline/ui as a workspace dep of @pipeline/frontend

Source: https://github.com/eq-lab/pipeline/issues/37

## Scope

Wire the existing source-only `@pipeline/ui` workspace (scaffolded in #28, Storybook in #29) into `@pipeline/frontend` so that:

- `import { ... } from "@pipeline/ui"` resolves at type-check and bundle time from the frontend source.
- Tailwind v4 scans `packages/ui` sources for utility classnames when the frontend builds CSS, via the v4 `@source` directive.
- `yarn install --immutable` and `yarn workspace @pipeline/frontend build` both remain green.

In scope:

- `packages/frontend/package.json` — add `"@pipeline/ui": "workspace:^"` under `dependencies`.
- Tailwind v4 cross-package source scanning from frontend toward `packages/ui/src/**`.
- Minimal CSS entry plumbing needed to host the `@source` directive (frontend currently has no Tailwind CSS file — see "Assumptions and Risks").
- Regression checks: install, lint, build.

Out of scope:

- Authoring any UI in `@pipeline/ui` beyond the empty barrel that already exists (`packages/ui/src/index.ts` exports `{}`). Components arrive in #42–#49.
- Theme tokens / `theme.css` (#41), self-hosted fonts (#40), Figma assets (#39).
- Rendering anything new in the frontend app shell (#50 handles the actual integration screen).
- TanStack Router or route changes.
- Backend / API / worker.

## Assumptions and Risks

- **#28 is merged.** Confirmed: `packages/ui/` exists with `package.json` exporting `"."`, `"./styles/*"`, `"./assets/*"`, and `src/index.ts` is `export {};`. The package is already registered in root `workspaces`. No work needed there.
- **#29 (Storybook) is merged** and added React 19, Tailwind v4, etc. as devDeps of `@pipeline/ui`. Since `@pipeline/ui` exports source `.ts` directly, the consuming workspace (`frontend`) must be able to resolve `react`/`react-dom` itself; currently the frontend does not list `react`/`react-dom` as direct deps (only `@vitejs/plugin-react` transitively). This is fine for #37 because the barrel is empty and no React import path is exercised yet — but the first real component import will require frontend to declare `react`/`react-dom`. **Flagging as a follow-up risk, not a blocker for #37.** The acceptance criteria only require that `import { } from "@pipeline/ui"` resolves; an empty re-export does not actually pull React.
- **Frontend has no Tailwind v4 CSS entry today.** `packages/frontend/src/` contains only `main.tsx` (logs "Hello, World!"); there is no `index.css`, no `@import "tailwindcss"`, and `main.tsx` does not import any stylesheet. Vite's Tailwind v4 plugin is configured in `vite.config.ts` but has no `@source`-bearing CSS file to anchor scanning. The issue body says "`@source` directive **or equivalent**." Two options:
  1. Add a minimal `packages/frontend/src/index.css` that does `@import "tailwindcss";` followed by `@source "../../ui/src/**/*.{ts,tsx}";`, and import it once from `main.tsx`. This is the canonical Tailwind v4 pattern and the option this plan adopts.
  2. Use `@tailwindcss/vite` plugin options (no native API for cross-package source globs in v4 — `@source` is the documented way). Rejected.
- **`workspace:^` protocol.** Yarn 4 Berry (`packageManager: yarn@4.13.0`) supports `workspace:^`. The resolved version becomes `0.1.0` (current). Risk: if `@pipeline/ui` ever publishes to npm, `workspace:^` rewrites to `^0.1.0` on `yarn npm publish` — fine, private package today (`"private": true`).
- **`yarn install --immutable` risk.** Adding a `workspace:` dependency edits only `package.json` and `yarn.lock` link entries; no new external resolutions. Should remain immutable-clean, but the coder must verify locally.
- **Tailwind v4 `@source` relative path.** Resolved relative to the CSS file. From `packages/frontend/src/index.css`, the path to `packages/ui/src` is `../../ui/src`. Verified against current tree layout.
- **No `.tsx` content in `@pipeline/ui` yet** means the `@source` glob currently matches zero files. That's correct — it's pre-wiring. The first component issue (#42) will start producing matches.

## Open Questions

_None_

## Implementation Steps

All paths absolute under `/Users/dima/git/pipeline/`.

1. [x] **Add the dependency.** Edit `packages/frontend/package.json`:
   - Add a top-level `"dependencies"` block (currently absent) containing exactly:
     ```json
     "dependencies": {
       "@pipeline/ui": "workspace:^"
     }
     ```
   - Place it before `devDependencies` per conventional ordering. Do not move or modify any other field.

2. [x] **Create the frontend Tailwind CSS entry.** New file `packages/frontend/src/index.css`:
   ```css
   @import "tailwindcss";

   /* Pull utility class names from the shared UI workspace so Tailwind v4
      generates CSS for any classnames authored in @pipeline/ui sources. */
   @source "../../ui/src/**/*.{ts,tsx}";
   ```
   Rationale: Tailwind v4 scans the consuming package by default; the `@source` directive extends scanning into the source-only `@pipeline/ui` workspace, which is what the issue asks for. The relative path is anchored at the CSS file's location (`packages/frontend/src/index.css`).

3. [x] **Import the CSS once.** Edit `packages/frontend/src/main.tsx` to add a single import at the top:
   ```ts
   import "./index.css";
   ```
   Keep the existing `console.log("Hello, World!");` line untouched. This guarantees Vite includes the CSS (and therefore the `@source` directive) in the build graph. Without an import, the file is dead and Tailwind never sees the directive.

4. [x] **No `vite.config.ts` changes required.** The existing `tailwindcss()` Vite plugin in `packages/frontend/vite.config.ts` is sufficient — the `@source` directive lives in CSS, not in the Vite config. Leave the file alone.

5. [x] **Install & verify** from repo root `/Users/dima/git/pipeline/`:
   ```bash
   yarn install --immutable
   yarn workspace @pipeline/frontend lint
   yarn workspace @pipeline/frontend build
   yarn workspace @pipeline/ui lint
   npx tsx scripts/lint-docs.ts
   ```
   All five must exit clean. If `yarn install --immutable` mutates `yarn.lock`, investigate — do not relax to `--mode=update-lockfile` without flagging.

6. [x] **Smoke-check resolution.** Inside `packages/frontend/src/main.tsx`, temporarily add (then revert before commit):
   ```ts
   import * as ui from "@pipeline/ui";
   void ui;
   ```
   Run `yarn workspace @pipeline/frontend build`. It must build with zero TS errors, confirming the import resolves. Revert this change so the committed diff is minimal — the acceptance criterion only requires that the import **would** resolve, not that production code uses it yet. (The coder may instead choose to leave a `// @pipeline/ui resolves` comment in `main.tsx` if preferred, but no real import should ship.)

7. [x] **Docs.** Update `/Users/dima/git/pipeline/ARCHITECTURE.md` "`packages/ui`" subsection (currently lines around 41–43) to note that `@pipeline/frontend` now consumes the workspace via `workspace:^` and that Tailwind class scanning is enabled through `@source` in `packages/frontend/src/index.css`. Keep it to one or two sentences appended to the existing paragraph. No `docs/product-specs/` change — this is infra plumbing with no behavior change.

## Test Strategy

This issue has no runtime UI; verification is configuration- and tooling-driven.

Required automated checks (all must exit 0):

1. **`yarn install --immutable`** — proves `package.json` + lockfile are consistent after adding the `workspace:^` dep. Lockfile may add a link-protocol entry for `@pipeline/ui`; that is expected. If it complains about external resolution drift, something else changed — stop and diagnose.
2. **`yarn workspace @pipeline/frontend build`** — runs `tsc -b && vite build`. This validates: (a) TS resolves `@pipeline/ui` via workspace symlink and `exports."."`, (b) Vite + Tailwind v4 process `src/index.css` and parse the `@source` directive without error.
3. **`yarn workspace @pipeline/frontend lint`** — ESLint + Prettier still green; catches any stray formatting on the new CSS / TS edits.
4. **`yarn workspace @pipeline/ui lint`** — regression: changes here must not affect the UI workspace's clean lint state.
5. **`npx tsx scripts/lint-docs.ts`** — required by `AGENTS.md` after any TS / docs change; covers the `ARCHITECTURE.md` edit.

Manual / structural checks:

- Open the built bundle (`packages/frontend/dist/`) and confirm a CSS asset is emitted (Tailwind preflight, since the directive is wired). If no CSS is emitted, Tailwind did not pick up `index.css` and step 3 (the import) is wrong.
- Confirm `packages/frontend/package.json` lists `@pipeline/ui` under **`dependencies`** (not `devDependencies`). Runtime code will import from it.
- Confirm the `@source` path resolves: from `packages/frontend/src/index.css`, `../../ui/src` should equal `packages/ui/src`.
- Confirm no `react` / `react-dom` was added to `packages/frontend` — that's a separate concern for the first real component-consuming issue.

Edge cases:

- If Tailwind v4 errors with "no source files matched", that's acceptable today since `packages/ui/src/` contains only `index.ts` (`export {};`) with no classnames. Tailwind v4 warns but does not fail.
- If the build fails with `Cannot find module '@pipeline/ui'`, the most likely cause is that `yarn install` was not rerun after editing `package.json`. Re-run install.
- If TS errors mention "Type ... has no exported member", the empty barrel is fine — only fails if someone tries a named import. The plan's smoke test uses `import * as ui` to dodge that.

Figma verification: **not required for this Issue.** The Figma URL in the body (`A43rjYYjSwdTmiwwf5cx5n?node-id=1497-94556`) is the design target for components landing in #39–#50; #37 is pure dependency wiring with no rendered surface. `ux-tester` is not needed.

## Docs to Update

- `/Users/dima/git/pipeline/ARCHITECTURE.md` — extend the existing `packages/ui` subsection with a short note that `packages/frontend` consumes it via `workspace:^` and that Tailwind class scanning is anchored by `@source` in `packages/frontend/src/index.css` (step 7 above).
- No `docs/product-specs/` change — no user- or agent-facing behavior changes.
- No `docs/FRONTEND.md` change required; existing wording already anticipates the design-system wiring. Revisit when real components land.
- On close, the exec plan moves from `docs/exec-plans/active/` to `docs/exec-plans/completed/` (manager handles).
