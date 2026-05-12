# Issue #38: Bootstrap TanStack Router file-based routes in frontend

Source: https://github.com/eq-lab/pipeline/issues/38

## Scope

Create the minimal TanStack Router file-based routing skeleton in `@pipeline/frontend` so:

- `@tanstack/router-plugin` (already wired in `vite.config.ts`) stops emitting the `ENOENT: no such file or directory, scandir '.../src/routes'` warning during `vite build`.
- The generated route tree (`src/routeTree.gen.ts`) is produced by the plugin.
- `src/main.tsx` mounts a real React app with a router, instead of `console.log("Hello, World!")`.
- The placeholder home route renders `Pipeline` at `/` so subsequent issues (#59 final composition, #50 theme wiring, #52–#58 components) have a real mount point.

Out of scope:

- Any visual design / component composition for the home page (that is issue #59 and the upstream component issues #51–#58).
- Theme wiring (#50), token definitions (#41), fonts/assets (#39, #40).
- Adding routes other than the placeholder home route.
- Test setup beyond what is needed for the build to succeed (`src/test-setup.ts` referenced in `vite.config.ts` is not yet present — do not introduce a test runtime in this issue; see Open Questions).

## Assumptions and Risks

Assumptions:

- TanStack Router v1.167.x (matching the installed `@tanstack/router-plugin@1.167.22`) is the correct runtime version. We will install `@tanstack/react-router@^1.167.22` to match the plugin.
- React 19 runtime is the target (matches `react`/`react-dom` 19.1.6 already used in `@pipeline/ui`'s devDependencies). The frontend currently does not declare `react`/`react-dom` at all, so they must be added as production dependencies of `@pipeline/frontend`.
- The router plugin's default route directory (`src/routes/`) and default generated tree path (`src/routeTree.gen.ts`) are acceptable — no plugin options need to be passed.
- The home page IS the unauthenticated landing surface for the LP dashboard composition (#59). Per `docs/FRONTEND.md`, route `/` = LP Dashboard. We do not need a separate landing route.

Risks:

- TanStack Router and the plugin version pinning: if minor versions drift between `@tanstack/router-plugin` (devDep) and `@tanstack/react-router` (runtime), code generation may fail. Mitigation: install matching version explicitly and run `yarn build` to verify.
- `tsconfig.json` has `"noUnusedLocals": true` and `"noUncheckedIndexedAccess": true`. The generated `routeTree.gen.ts` must type-check under these flags; if not, add a localized `// @ts-nocheck` only inside the generated file's plugin output is not allowed (generated). Fallback: scope `tsc -b` exclusion or relax options for `*.gen.ts` via an override. The plugin generally emits TS-strict-safe code; verify on first build.
- `index.html` `<title>` is "BasedAI"; not changed in this issue (cosmetic, addressed elsewhere).
- The generated `routeTree.gen.ts` should be gitignored or committed per project convention — there is currently no precedent in this repo. Decision: commit it (simpler CI, smaller blast radius). Note in Open Questions for confirmation.

## Open Questions

- Should the generated `src/routeTree.gen.ts` be committed to the repo or added to `.gitignore` and regenerated on build? (Plan currently assumes "commit it".)
- Is `@tanstack/react-router@1.167.22` (matching the plugin major.minor) the desired pin, or should we float the caret to the latest 1.x?

## Implementation Steps

1. [x] Add runtime dependencies to `packages/frontend/package.json` under `dependencies`:
   - `react`: `19.1.6`
   - `react-dom`: `19.1.6`
   - `@tanstack/react-router`: `1.168.25` (note: pinned to 1.167.22 was intended but that exact version doesn't exist on npm; 1.167.x of react-router only goes up to 1.167.5; the router-plugin@1.167.22 peer dep is optional and requests `^1.168.21`; used 1.168.25 which is the latest version satisfying the age gate)
   - Added `@types/react`: `19.2.14` and `@types/react-dom`: `19.2.3` under `devDependencies`.
   - Ran `yarn install` at the workspace root to update the lockfile.

2. [x] Create `packages/frontend/src/routes/__root.tsx`:
   - Minimal root route using `createRootRoute` from `@tanstack/react-router`, rendering `<Outlet />` and nothing else.

3. [x] Create `packages/frontend/src/routes/index.tsx`:
   - Placeholder route via `createFileRoute('/')` exporting a `Route` whose `component` returns `<main>Pipeline</main>`.

4. [x] Rewrite `packages/frontend/src/main.tsx`:
   - Import `./index.css` (preserved).
   - Import `createRouter`, `RouterProvider` from `@tanstack/react-router`.
   - Import the generated `routeTree` from `./routeTree.gen` and instantiate `const router = createRouter({ routeTree })`.
   - Augment the `Register` interface for type-safe links.
   - `createRoot(rootElement).render(<StrictMode><RouterProvider router={router} /></StrictMode>)`.

5. [x] `@tanstack/router-plugin` generated `packages/frontend/src/routeTree.gen.ts` successfully on first build. Generated file includes `// @ts-nocheck` header.

6. [x] No tsconfig override needed — the generated file has `// @ts-nocheck` header. No strict mode violations.

7. [x] Added `packages/frontend/src/routeTree.gen.ts` to `.gitignore` per manager decision (do not commit generated file).

8. [x] Ran `yarn workspace @pipeline/frontend lint` — passes.

## Test Strategy

Manual / build-time checks (no unit tests are appropriate for this skeleton issue):

1. `yarn workspace @pipeline/frontend build` — succeeds, and the previously observed `ENOENT: no such file or directory, scandir '.../src/routes'` warning no longer appears in stderr.
2. `src/routeTree.gen.ts` exists after build and imports `./routes/__root` and `./routes/index`.
3. `yarn workspace @pipeline/frontend dev` — serves the app and `GET /` renders the text `Pipeline` (the visible `<main>Pipeline</main>` content). Confirm by opening `http://localhost:5173` (or whichever port Vite picks) in a browser or via `curl -s localhost:5173 | grep root`.
4. `yarn workspace @pipeline/frontend lint` passes.
5. `npx tsx scripts/lint-docs.ts` from the repo root passes (per AGENTS.md TS rule).
6. Figma reference for the home page (`https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-94556&m=dev`) is NOT a verification target for this issue — visual fidelity is owned by the composition issue (#59) and component issues. Only the bare text `Pipeline` is rendered here. Document this explicitly in the PR description so reviewers do not run `ux-reviewer` against Figma for this PR.

## Docs to Update

- `docs/FRONTEND.md` — optional small note under "Application structure" that file-based routing is provided by TanStack Router and routes live in `packages/frontend/src/routes/`. Add only if it improves discoverability; keep brief.
- No product spec change required: this is internal scaffolding with no user- or agent-facing behavior change.
- No `docs/exec-plans/known-bugs.md` or `tech-debt-tracker.md` entries expected. If `routeTree.gen.ts` requires a tsconfig override workaround, log it in `tech-debt-tracker.md`.
