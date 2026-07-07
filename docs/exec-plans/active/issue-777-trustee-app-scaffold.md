# Issue #777: Trustee: scaffold packages/trustee Vite app (port 5174)

Source: https://github.com/eq-lab/pipeline/issues/777

Sub-issue of epic #775 (Trustee Admin Panel). Product/technical spec: #453,
persisted at `docs/product-specs/trustee-dashboard.md`.

## Scope

Scaffold the Trustee admin panel as a **new workspace package `packages/trustee`** —
a second Vite + React app that runs and deploys separately from the LP frontend
(`packages/frontend`), reusing shared code. This issue delivers the empty shell
only; no Trustee flow logic.

**In scope**

- New `packages/trustee/` Vite + React 19 app, added to the root `workspaces`
  array (currently `["packages/frontend", "packages/ui"]`).
- Dev server on **port 5174** with `strictPort: true` so it never silently
  falls through to another port and never collides with the LP app on 5173.
- Minimal app shell + TanStack Router with placeholder routes, one per Trustee
  flow **type** from `docs/product-specs/trustee-dashboard.md` (Type 1 Direct
  writes, Type 2 MPC co-sign, Type 3 RISK_COUNCIL proposals, Type 4 Monitoring),
  plus an index landing route. Each placeholder renders a heading + one-line
  description of that type; no flow logic, no data fetching, no wallet calls.
- Entrypoint distinct from the LP app: own `index.html`, own `src/main.tsx`,
  own router/route tree.
- Reuse `@pipeline/ui` (`workspace:^`) for the design system + theme tokens
  (import `@pipeline/ui/styles/theme.css`, add the `@source` directive over
  `../../ui/src`, mirroring `packages/frontend/src/index.css`).
- Runtime-env mechanism mirroring the LP app: `vite-plugin-runtime-env`
  (`window.__ENV__`, `injectHtml: false`), a `<script src="/__env.js">` tag in
  `index.html`, a typed `src/lib/env.ts` accessor, and a `public/__env.js`
  dev stub. The trustee app needs its own (smaller) env surface — see step 5.
- Docker: add a `trustee-build` + `trustee` stage to the root multi-stage
  `Dockerfile` (the repo has ONE root `Dockerfile`; `docker/frontend/` holds
  only `nginx.conf` + `entrypoint.sh`, not a Dockerfile) and a new
  `docker/trustee/` dir with `nginx.conf` + `entrypoint.sh` mirroring
  `docker/frontend/`. Add a "Build and push Trustee image" step to
  `.github/workflows/docker-build-and-push.yml`.
- Lint / build / test parity: `yarn workspace @pipeline/trustee dev|build|lint|test`
  all work, mirroring the LP scripts. Add a `lint-trustee` typecheck job to
  `.github/workflows/lint.yml` mirroring `lint-frontend`.

**Out of scope** (tracked elsewhere / later sub-issues of #775)

- Extraction of genuinely-shared frontend code (wallet/on-chain reads, API
  client, formatters) into a shared package → sub-issue #778. This issue
  imports `@pipeline/ui` **only** and does NOT depend on wallet/api plumbing.
- Any Trustee flow logic (Types 1–4 calldata build/decode, MPC assembly,
  proposal builder, monitoring surfaces) → per-flow sub-issues.
- Auth / session / 2FA / operator onboarding (explicitly out of scope in #453).
- The argocd `Application`/manifests: those live in the **separate**
  `eq-lab/argocd` repo. This issue provides the Application spec (image, port,
  runtime env passthrough) as an Issue **comment** for that repo — not
  committed here. See step 8.

## Assumptions and Risks

- **Dev port 5174 (strictPort).** Assumed per the issue/epic; LP app owns 5173.
- **Scaffold thin, reuse `@pipeline/ui` only.** Per epic #775 the wallet/api
  extraction is a distinct follow-up (#778). The trustee app intentionally
  pulls in NO wagmi/viem/AppKit/Stellar/TanStack-Query deps in this issue —
  keeping the dependency set minimal (react, react-dom, react-router,
  @pipeline/ui, vite toolchain) avoids a large lockfile churn now and avoids
  forking the wallet layer before #778 decides where it lives.
- **Router choice:** use `@tanstack/react-router` + `@tanstack/router-plugin`
  to match the LP app's conventions (file-based routes under `src/routes/`,
  generated `routeTree.gen.ts` ignored by eslint/prettier). This keeps a
  single router idiom across both apps.
- **Runtime-env surface differs from the LP app.** The LP `env.ts` exposes
  ~18 EVM/Stellar vars the trustee shell does not yet need. To avoid shipping
  dead config and a mismatched `entrypoint.sh`, the trustee `env.ts` starts
  with only `VITE_API_BASE_URL` (Relayer backend base URL) — the one input the
  spec's API contracts need — and `docker/trustee/entrypoint.sh` writes only
  that key. It grows as flow sub-issues land. This is a deliberate, documented
  divergence, not an omission.
- **Single root Dockerfile risk:** the frontend build stage in the root
  `Dockerfile` runs `yarn install --immutable`, so adding `packages/trustee`
  to workspaces changes `yarn.lock`; the coder MUST run `yarn install` and
  commit the updated lockfile, or the immutable install in CI/Docker will fail.
- **npmMinimalAgeGate: 14d** (`.yarnrc.yml`). Reuse the exact dependency
  versions already pinned in `packages/frontend/package.json` and `ui` — those
  are already installed and past the age gate, so no new too-fresh packages are
  introduced and no `npmPreapprovedPackages` allowlisting is needed.
- **tsc project-references risk:** the LP `build` is `tsc -b && vite build` but
  its `tsconfig.json` is a single flat config (no `references`, no
  `tsconfig.app/node.json`). Mirror that exact shape to keep `tsc -b` working.
- **Tailwind v4 `@source` path:** trustee lives at `packages/trustee/`, same
  depth as `packages/frontend/`, so the `@source "../../ui/src/**/..."`
  relative path is identical — verify it resolves at build.
- No dependency on unmerged work. Epic #775 is the container; #778 depends on
  THIS issue, not the reverse.

## Open Questions

- **Dev port** — assumed **5174 / strictPort** per the issue and epic. Proceed
  unless the user says otherwise.
- **Deploy hostname** — the trustee app deploys to its own hostname/port via a
  separate argocd Application in `eq-lab/argocd`. This issue does not commit
  argocd manifests; it posts the Application spec as an Issue comment for that
  repo. Confirm the target hostname (e.g. `trustee.<env>.pipeline…`) with the
  ops owner when the argocd PR is raised — not blocking for the scaffold.
- **Route shell shape** — assumed four type-grouped placeholder routes
  (`/type1-direct`, `/type2-mpc`, `/type3-council`, `/type4-monitoring`) plus
  an index, with a simple sidebar/topbar nav. If the team prefers the routes
  organised by the 17 individual flows/surfaces instead of by type, say so;
  the spec organises the dashboard "by type", so type-grouping is the default.

## Implementation Steps

1. **Root workspace wiring** (`package.json`): add `"packages/trustee"` to the
   `workspaces` array. Optionally add a convenience script
   `"trustee:dev": "yarn workspace @pipeline/trustee dev"` mirroring
   `front:dev`.

2. **Package manifest** (`packages/trustee/package.json`): name
   `@pipeline/trustee`, `private`, `type: module`, `version 0.1.0`. Scripts
   mirror the LP app exactly:
   `dev: "vite"`, `build: "tsc -b && vite build"`,
   `lint: "eslint . && prettier --check ."`, `preview: "vite preview"`,
   `test: "vitest run"`, `test:watch: "vitest"`.
   Dependencies (thin set, versions copied verbatim from
   `packages/frontend/package.json` so the age gate + lockfile stay clean):
   `@pipeline/ui: workspace:^`, `@tanstack/react-router`, `react`, `react-dom`.
   devDependencies: `@eslint/js`, `@tailwindcss/vite`,
   `@tanstack/router-plugin`, `@testing-library/*` (dom, jest-dom, react),
   `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `eslint`,
   `eslint-plugin-react-hooks`, `globals`, `jsdom`, `prettier`,
   `prettier-plugin-tailwindcss`, `typescript`, `typescript-eslint`, `vite`,
   `vite-plugin-runtime-env`, `vitest`, `@vitest/ui`. Do NOT add
   wagmi/viem/AppKit/Stellar/react-query (deferred to #778).

3. **Vite config** (`packages/trustee/vite.config.ts`): mirror the LP config —
   `envDir` at repo root (`path.resolve(__dirname, "../..")`), plugins
   `TanStackRouterVite()`, `react()`, `tailwindcss()`,
   `runtimeEnv({ variableName: "window.__ENV__", injectHtml: false })`,
   `resolve.alias` `@` → `./src`. **Add** `server: { port: 5174, strictPort: true }`.
   Add the `/api` dev proxy (target `process.env.API_PROXY_TARGET ?? "http://localhost:3000"`)
   to match the LP app. Include the `test` block (jsdom, globals, setupFiles
   `./src/test-setup.ts`); the freighter/stellar `server.deps.inline` block is
   NOT needed since no Stellar deps are imported — omit it.

4. **tsconfig** (`packages/trustee/tsconfig.json`): copy
   `packages/frontend/tsconfig.json` verbatim (same strict flags, `@/*` path,
   `types: ["vite/client"]`, `include: ["src"]`).

5. **Runtime env**:
   - `packages/trustee/src/lib/env.ts` — port the `readString`/`readNumber`
     `window.__ENV__ || import.meta.env` accessor from the LP `env.ts`, but
     expose only what the shell needs now: `API_BASE_URL`
     (`readString("VITE_API_BASE_URL", "http://localhost:8080")`). Keep the
     doc comment explaining it is the single centralized env reader.
   - `packages/trustee/public/__env.js` — dev stub:
     `window.__ENV__ = { VITE_API_BASE_URL: "" };` (mirrors
     `packages/frontend/public/__env.js`).

6. **App shell + entrypoint**:
   - `packages/trustee/index.html` — mirror the LP `index.html`:
     `<title>Pipeline Trustee</title>`, the blocking theme script (reuse the LP
     one; keep the `pipeline-theme` localStorage key so both apps share theme
     preference), `<script src="/__env.js"></script>`, `#root`, and
     `<script type="module" src="/src/main.tsx"></script>`.
   - `packages/trustee/src/index.css` — `@import "tailwindcss";`,
     `@import "@pipeline/ui/styles/theme.css";`, and
     `@source "../../ui/src/**/*.{ts,tsx}";` (identical to the LP css).
   - `packages/trustee/src/main.tsx` — create the router from the generated
     route tree and render `<RouterProvider>` inside `<StrictMode>`. Do **not**
     wrap in the LP wallet/query providers (those live in #778). Include the
     `declare module "@tanstack/react-router"` register block.
   - `packages/trustee/src/test-setup.ts` — mirror the LP setup (jest-dom
     import) so vitest DOM matchers work.

7. **Routes** (`packages/trustee/src/routes/`), file-based per TanStack:
   - `__root.tsx` — root layout: a minimal `TrusteeShell` (a topbar with the
     `@pipeline/ui` `Logo` + "Trustee Admin" label and a nav listing the four
     types) wrapping `<Outlet />`. Keep the shell component tiny and in its own
     file under `src/components/` per FRONTEND.md "one component per file".
   - `index.tsx` — landing page listing the four Trustee flow types with
     `@pipeline/ui` `Card`/`LinkCard` links to each type route.
   - `type1-direct.tsx`, `type2-mpc.tsx`, `type3-council.tsx`,
     `type4-monitoring.tsx` — each a placeholder route: a heading naming the
     type and a one-line description drawn from
     `docs/product-specs/trustee-dashboard.md` (e.g. Type 1 "Direct
     Trustee-key writes — one-click broadcast after decoded-calldata review").
     No data, no wallet, no calldata. Add a short doc comment on each pointing
     at the spec section and noting the flow sub-issue will fill it in.
   - `routeTree.gen.ts` is generated by the router plugin on first `dev`/`build`;
     add it to eslint `ignores` and `.prettierignore` (step 9).

8. **Docker**:
   - New `docker/trustee/nginx.conf` — copy `docker/frontend/nginx.conf`
     verbatim (SPA fallback + `/__env.js` no-cache + `/assets/` immutable).
   - New `docker/trustee/entrypoint.sh` — mirror `docker/frontend/entrypoint.sh`
     but emit only the trustee env surface (`VITE_API_BASE_URL`) via `jq` into
     `/usr/share/nginx/html/__env.js`. Keep `set -eu`, the tmp-file + `mv`
     atomic write.
   - Root `Dockerfile` — add two stages mirroring `frontend-build` / `frontend`:
     `trustee-build` (`FROM node:22-slim`; copy root manifests +
     `packages/frontend/package.json` is unnecessary — copy
     `packages/trustee/package.json` and `packages/ui/package.json`;
     `yarn install --immutable`; copy `packages/trustee/` + `packages/ui/`;
     `yarn workspace @pipeline/trustee build`) and `trustee`
     (`FROM nginx:1.27-alpine`; `apk add jq`; copy `docker/trustee/nginx.conf`
     → default.conf, `docker/trustee/entrypoint.sh` →
     `/docker-entrypoint.d/40-write-runtime-env.sh` + chmod, copy
     `--from=trustee-build /sln/packages/trustee/dist/`; `EXPOSE 80`).
     Note: because root workspaces now include trustee, the existing
     `frontend-build` stage's `yarn install --immutable` still succeeds only
     with the updated `yarn.lock` — regenerate it (step 11).
   - `.github/workflows/docker-build-and-push.yml` — add a `meta-trustee`
     metadata step (`images: ghcr.io/${{ github.repository }}-trustee`) and a
     "Build and push Trustee image" `docker/build-push-action` step with
     `target: trustee`, mirroring the frontend step.

9. **Lint/format config**:
   - `packages/trustee/eslint.config.js` — start from the LP eslint config but
     drop the wallet/api `no-restricted-imports` blocks (those modules do not
     exist here yet); KEEP `{ ignores: ["dist", "src/routeTree.gen.ts"] }`, the
     base js+ts recommended + react-hooks rules, and the `import.meta.env`
     `no-restricted-syntax` guard scoped to ignore `src/lib/env.ts`. When #778
     adds wallet/api, the import-restriction blocks return.
   - `packages/trustee/.prettierrc` — `{ "plugins": ["prettier-plugin-tailwindcss"] }`.
   - `packages/trustee/.prettierignore` — `dist` + `src/routeTree.gen.ts`.

10. **argocd Application spec (comment, not committed)** — draft the trustee
    `Application`/`Deployment` spec for the `eq-lab/argocd` repo: image
    `ghcr.io/eq-lab/pipeline-trustee:<tag>`, container port 80, the same
    runtime-env passthrough pattern the frontend Application uses but with only
    `VITE_API_BASE_URL` (plus whatever the LP frontend Application sets for
    ingress/host, adapted to a distinct trustee hostname). Post it as a comment
    on Issue #777 so it can be lifted into the argocd repo. Flag the hostname as
    an open question for the ops owner (see Open Questions).

11. **Install + verify locally**:
    - `yarn install` at repo root to register the workspace and update
      `yarn.lock` (commit the updated lockfile — required for the immutable
      installs in CI + Docker).
    - `yarn workspace @pipeline/trustee dev` → confirm it serves on
      **http://localhost:5174** and every placeholder route renders with UI
      tokens applied (theme.css loaded, fonts/colors correct).
    - Confirm the LP app still starts on 5173 with no port conflict.

## Test Strategy

- **Unit/route tests (vitest + Testing Library):** add
  `packages/trustee/src/routes/-index.test.tsx` and one placeholder test per
  type route (`-type1-direct.test.tsx`, etc.) that render the route component
  and assert the heading/description text and that the type-nav links exist.
  Mirror the LP `src/routes/-*.test.tsx` naming (leading `-` so the router
  plugin does not treat them as routes). Run via
  `yarn workspace @pipeline/trustee test`.
- **Build parity:** `yarn workspace @pipeline/trustee build` must succeed
  (`tsc -b && vite build`) and emit `packages/trustee/dist/index.html` +
  hashed assets.
- **Lint parity:** `yarn workspace @pipeline/trustee lint` (eslint + prettier
  check) passes; the `import.meta.env` guard is exercised by `env.ts` being the
  only exempt file.
- **Docker smoke (manual/coder judgement):** `docker build --target trustee .`
  builds; running the image serves the SPA and `entrypoint.sh` writes a valid
  `__env.js` (`window.__ENV__ = { "VITE_API_BASE_URL": "…" };`). If Docker is
  unavailable in the coder's env, note it and rely on the CI build step added
  in step 8.
- **Docs lint:** `npx tsx scripts/lint-docs.ts` passes (this plan + any doc
  additions are structurally valid).
- **Port isolation:** verified in step 11 (5174 strictPort; LP still on 5173).
- **No shared-code regression:** the LP frontend build/test/lint remain
  untouched — run `yarn workspace @pipeline/frontend build` once after the
  workspace + lockfile change to confirm no collateral breakage.

## Docs to Update

- **Product spec:** none. `docs/product-specs/trustee-dashboard.md` (spec #453)
  already exists and describes behavior; this is a structural scaffold that
  changes no product behavior, so no spec edit is required.
- **`docs/FRONTEND.md`:** add a short note that there are now two Vite apps —
  the LP `packages/frontend` (port 5173) and the Trustee `packages/trustee`
  (port 5174) — both consuming `@pipeline/ui`, with runtime env via
  `window.__ENV__`. Keep it to a couple of lines.
- **`README` / dev docs:** if a top-level or `docs/` "running the frontend"
  note names port 5173, add the trustee `5174` counterpart (grep for `5173`
  and `front:dev` and update wherever the LP dev command is documented).
- **`docs/exec-plans/tech-debt-tracker.md`:** log that (a) the trustee app
  currently duplicates env-accessor + entrypoint plumbing with the LP app,
  pending the shared-code extraction in #778, and (b) the wallet/api eslint
  import-restriction blocks are intentionally absent until #778 lands.
- Move this plan to `docs/exec-plans/completed/` when the issue closes
  (manager/coder housekeeping).
