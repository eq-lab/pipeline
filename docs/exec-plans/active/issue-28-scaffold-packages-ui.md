# Issue #28: Scaffold packages/ui package (Vite + Tailwind v4 + TypeScript)

Source: https://github.com/eq-lab/pipeline/issues/28

## Scope

Create the shared design-kit workspace `@pipeline/ui` as a **source-only** workspace package (no library build, no `dist/`, no `build` script). The package will later be consumed by `packages/frontend` (issue #37) and hold shared theme/tokens, fonts, assets, and components (issues #39–#49). This issue is the scaffolding step only.

In scope:

- New directory `packages/ui/` with package skeleton.
- Register the new workspace in the root `package.json`.
- Configure tooling (TypeScript, ESLint, Prettier, Vite, Tailwind v4) so that `yarn workspace @pipeline/ui lint` passes and `yarn install --immutable` is clean.
- Pin every dep to the same versions already locked in `yarn.lock` for `packages/frontend` (no `^` ranges).
- Empty `src/index.ts` barrel.

Out of scope (handled by later issues):

- Design tokens / `theme.css` (#41).
- Self-hosted fonts (#40).
- Figma assets (#39).
- Any concrete components (#42–#49).
- Wiring the package into the frontend (#37, #50).
- Tailwind `@source` directive on the frontend side (#37, #50).
- TanStack Router or any route changes.

## Assumptions and Risks

- **Source-only consumption pattern.** The issue spec is explicit: no `build` script, no `dist/`, the `exports` map points directly at `.tsx`/`.ts` sources. Frontend (Vite + Tailwind v4) will transpile these as part of its own build via the `@source` directive in #37/#50. Risk: if a future non-Vite consumer is ever added, it will fail — acceptable today because only `packages/frontend` consumes it.
- **Vite is present even without a library build** because future devs/tests in `packages/ui` (e.g. component dev playground, vitest) may need it, and the issue acceptance lists a `vite.config.ts`. Risk: deciding the playground/dev story is deferred; here we only set up an inert config consistent with frontend so future work is unblocked.
- **Pinned versions must match the existing `yarn.lock` resolutions for the frontend workspace** to avoid Yarn pulling new minors. Confirmed pins (from current `yarn.lock` / `packages/frontend/package.json`): `vite@6.4.2`, `@vitejs/plugin-react@4.7.0`, `@tailwindcss/vite@4.2.4`, `tailwindcss@4.2.4`, `typescript@5.9.3`, `eslint@9.39.4`, `@eslint/js@9.39.4`, `typescript-eslint@8.59.0`, `eslint-plugin-react-hooks@5.2.0`, `prettier@3.8.3`, `prettier-plugin-tailwindcss@0.6.14`. `globals` is currently a transitive `14.0.0` pulled by `typescript-eslint`; the frontend `eslint.config.js` imports it without declaring it as a direct dep. We will mirror that pattern (no explicit `globals` dep) for consistency.
- **`type: module`** must be set so the ESLint flat config (`eslint.config.js`) and Vite config (`.ts` with ESM) resolve correctly. Matches frontend.
- **React is NOT yet a direct dependency of `packages/frontend`** (it shows up only transitively via `@vitejs/plugin-react`). Since this scaffolding issue does not introduce any React component code, we likewise do not add `react`/`react-dom` as direct devDeps here — leaving that to whichever later issue first authors a `.tsx` component (likely #42 Button). This keeps the change strictly to "scaffold + lint passes on an empty barrel."
- **Risk: `yarn install --immutable`** can fail if a new transitive dep is introduced that has no entry in `yarn.lock`. Since we are using only packages already resolved by the frontend workspace, this should be a no-op — but the coder must verify locally.

## Open Questions

_None_

## Implementation Steps

All paths absolute under `/Users/dima/git/pipeline/`.

1. **Create the package skeleton** under `packages/ui/`:
   - `packages/ui/package.json` with:
     ```json
     {
       "name": "@pipeline/ui",
       "version": "0.1.0",
       "private": true,
       "type": "module",
       "exports": {
         ".": "./src/index.ts",
         "./styles/*": "./src/styles/*",
         "./assets/*": "./src/assets/*"
       },
       "scripts": {
         "lint": "eslint . && prettier --check ."
       },
       "devDependencies": {
         "@eslint/js": "9.39.4",
         "@tailwindcss/vite": "4.2.4",
         "@vitejs/plugin-react": "4.7.0",
         "eslint": "9.39.4",
         "eslint-plugin-react-hooks": "5.2.0",
         "prettier": "3.8.3",
         "prettier-plugin-tailwindcss": "0.6.14",
         "tailwindcss": "4.2.4",
         "typescript": "5.9.3",
         "typescript-eslint": "8.59.0",
         "vite": "6.4.2"
       }
     }
     ```
     Notes for the coder:
     - All versions pinned (no `^`, no `~`) — verify each one is the resolution already in `/Users/dima/git/pipeline/yarn.lock`.
     - `tailwindcss` is added as an explicit dep because the future Tailwind v4 `@theme` work (#41) lives in this package; it pairs with `@tailwindcss/vite`.
     - `exports` map keeps three lanes open for the follow-up issues: components barrel (`.`), styles (`./styles/*` for #41 `theme.css`), assets (`./assets/*` for #39). Listing them now avoids edits in every follow-up. Acceptable to drop `./styles/*` and `./assets/*` if the coder prefers strict minimum — but the empty barrel `"."` is required.
     - **No `build` script.** The acceptance criterion explicitly forbids `build`.

2. **Create `packages/ui/tsconfig.json`** mirroring `packages/frontend/tsconfig.json` with minor adjustments:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "lib": ["ES2023", "DOM", "DOM.Iterable"],
       "types": ["vite/client"],
       "module": "ESNext",
       "skipLibCheck": true,
       "moduleResolution": "bundler",
       "allowImportingTsExtensions": true,
       "isolatedModules": true,
       "moduleDetection": "force",
       "noEmit": true,
       "jsx": "react-jsx",
       "strict": true,
       "noUnusedLocals": true,
       "noUnusedParameters": true,
       "noFallthroughCasesInSwitch": true,
       "noUncheckedIndexedAccess": true,
       "baseUrl": ".",
       "paths": {
         "@/*": ["./src/*"]
       }
     },
     "include": ["src"]
   }
   ```
   `noEmit: true` keeps it consistent with the source-only model.

3. **Create `packages/ui/vite.config.ts`** with the same plugin set as frontend, minus the router and runtime-env (this package has no app entry):
   ```ts
   import { defineConfig } from "vite";
   import react from "@vitejs/plugin-react";
   import tailwindcss from "@tailwindcss/vite";
   import path from "path";

   export default defineConfig({
     plugins: [react(), tailwindcss()],
     resolve: {
       alias: {
         "@": path.resolve(__dirname, "./src"),
       },
     },
   });
   ```
   This file exists to satisfy the issue acceptance criterion and to make a future package-local dev/test harness trivial. It is not invoked by anything in this issue.

4. **Create `packages/ui/eslint.config.js`** matching the frontend pattern but without the `import.meta.env` rule (UI is library code and has no env access concept):
   ```js
   import js from "@eslint/js";
   import reactHooks from "eslint-plugin-react-hooks";
   import tseslint from "typescript-eslint";

   export default tseslint.config(
     { ignores: ["dist"] },
     {
       extends: [js.configs.recommended, ...tseslint.configs.recommended],
       files: ["**/*.{ts,tsx}"],
       languageOptions: {
         ecmaVersion: 2022,
       },
       plugins: {
         "react-hooks": reactHooks,
       },
       rules: {
         ...reactHooks.configs.recommended.rules,
       },
     },
   );
   ```
   The frontend imports `globals` to expose `globals.browser`; for the UI package we omit it because there is no application code yet and no need to declare browser globals on an empty barrel. (Re-add if a later issue needs it.)

5. **Create `packages/ui/.prettierrc`** matching frontend:
   ```json
   { "plugins": ["prettier-plugin-tailwindcss"] }
   ```
   Create `packages/ui/.prettierignore`:
   ```
   dist
   ```

6. **Create `packages/ui/src/index.ts`** — empty barrel:
   ```ts
   export {};
   ```
   Using `export {}` (rather than a truly empty file) makes the file a module and satisfies `isolatedModules` / `moduleDetection: force`.

7. **Register the workspace** in `/Users/dima/git/pipeline/package.json`:
   ```json
   "workspaces": [
     "packages/frontend",
     "packages/ui"
   ]
   ```

8. **Update `ARCHITECTURE.md`** "Repository Layout" tree to list `packages/ui/` alongside `frontend/`, `api/`, `worker/`. Add a one-paragraph "`packages/ui`" subsection under "Packages" describing it as a source-only shared design kit consumed by `packages/frontend`, with no build output. Keep it short; details live in the package itself and follow-up issues.

9. **Install & verify**:
   ```bash
   cd /Users/dima/git/pipeline
   yarn install --immutable
   yarn workspace @pipeline/ui lint
   yarn workspace @pipeline/frontend build   # regression check — must still pass
   npx tsx scripts/lint-docs.ts              # docs lint (per AGENTS.md)
   ```
   All four must succeed before the coder hands back to the manager.

## Test Strategy

This issue has no runtime behavior to test; verification is entirely through tooling and configuration sanity.

Required automated checks (the coder must run each and confirm a clean exit code):

1. `yarn install --immutable` — proves the new package + its declared deps fully resolve against the existing `yarn.lock` with no drift. If Yarn complains about lockfile changes, the cause is almost certainly a version not pinned to the existing resolution; fix the version, do not relax `--immutable`.
2. `yarn workspace @pipeline/ui lint` — runs `eslint . && prettier --check .` inside `packages/ui`. With only an empty `src/index.ts`, configs, and ignore files, both must pass clean.
3. `yarn workspace @pipeline/frontend build` — regression: scaffolding the new workspace must not break the existing frontend build. (`tsc -b && vite build`.)
4. `npx tsx scripts/lint-docs.ts` — per `AGENTS.md`, required after any TypeScript / docs change. Catches issues in the `ARCHITECTURE.md` update.

Manual / structural checks:

- Confirm there is **no `build` script** in `packages/ui/package.json`.
- Confirm there is **no `dist/`** directory created anywhere by the install or lint runs.
- Confirm every `devDependencies` version is an exact pin (no leading `^` or `~`) and matches the resolution already present in `yarn.lock` for the frontend workspace.
- Confirm `packages/ui` is listed in the root `package.json` `workspaces` array.

Edge cases worth flagging if encountered:

- If `yarn install --immutable` mutates `yarn.lock` because of a transitive shift, the coder should pin / down-resolve until immutability holds. Do not bypass with `--mode=update-lockfile`.
- If a Prettier or ESLint plugin emits an error on a fresh, near-empty directory (e.g. complaining about no matching files), tweak the ignore list rather than disabling the rule.

No Figma verification is needed at this scaffolding stage — the Figma link in the Issue body applies to follow-up component/theme issues (#39–#49) that will consume this package. `ux-tester` is not required for issue #28 because there is no rendered UI.

## Docs to Update

- `/Users/dima/git/pipeline/ARCHITECTURE.md` — add `packages/ui/` to the repository layout tree and a short "`packages/ui`" subsection under "Packages". One paragraph; no spec-level detail. (Step 8 above.)
- No `docs/product-specs/` changes — this is a chore/infra change with no user-facing or agent-facing behavior. `docs/FRONTEND.md` already flags "Component library / design system — TBD"; updating that wording is premature until the tokens / first components land (#41, #42). Leave it for the issue that ships the first real component.
- No `docs/design-docs/` changes.
- Once this issue closes and PR merges, the exec plan moves from `docs/exec-plans/active/` to `docs/exec-plans/completed/` (manager handles).
