# Issue #330: Frontend deployment: Dockerfile + CI image for @pipeline/frontend

Source: https://github.com/eq-lab/pipeline/issues/330

## Scope

Add a production container artifact for `@pipeline/frontend` without changing app behavior. The work is limited to Docker packaging, runtime configuration injection, CI publishing, and deployment documentation.

In scope:

- Add a `frontend` target to the root `Dockerfile` that builds the Vite SPA from the Yarn 4 workspace and serves the static output from a small nginx runtime image.
- Include both `packages/frontend` and `packages/ui` in the frontend build path because `@pipeline/frontend` imports the source-only `@pipeline/ui` workspace package and Tailwind scans `packages/ui/src`.
- Serve TanStack Router SPA routes with an nginx fallback to `index.html`.
- Generate runtime frontend config from container `VITE_*` environment variables at startup so one image can be promoted across environments.
- Extend `.github/workflows/docker-build-and-push.yml` to publish `ghcr.io/eq-lab/pipeline-frontend` on the same `main` and `v*` tag events as the existing API and worker images.
- Document local image build/run usage and the runtime env contract in `docs/FRONTEND.md`.

Out of scope:

- Deployment manifests, Kubernetes, Compose, Terraform, TLS, CDN, source-map upload, or Sentry integration.
- Backend/API/worker behavior changes.
- Frontend feature or UI changes beyond the minimal runtime-env wiring needed for the image.

## Assumptions and Risks

- The root workspace uses Yarn 4 via `.yarnrc.yml` and `.yarn/releases/yarn-4.13.0.cjs`; the Docker build must copy those files plus `package.json`, `yarn.lock`, `packages/frontend/package.json`, and `packages/ui/package.json` before `yarn install --immutable` for stable dependency layers.
- `.dockerignore` currently excludes `node_modules/`, `dist/`, `.github/`, `docs/`, `.env*`, and `scripts/`, but does not exclude `.yarn/`, `packages/frontend`, or `packages/ui`, so the frontend build context can be assembled without changing ignore rules unless the implementation places new runtime helper files under an ignored path.
- `vite-plugin-runtime-env` is already installed and wired in `packages/frontend/vite.config.ts`, but the current default plugin behavior injects `window.env` into built `index.html`. `packages/frontend/src/lib/env.ts` and issue #330 expect `window.__ENV__` / `__env.js`. The implementation should align those surfaces explicitly instead of relying on the plugin default.
- Use nginx on port 80 for the runtime image. Any local verification that binds host port `8080` may conflict with the Rust API dev default; use a free host port if needed while preserving container port 80.
- The CI workflow already publishes API and worker from the same root `Dockerfile`; the frontend target must not invalidate or rename existing `api` and `worker` targets.
- Docker build verification may need network access for dependency downloads if the local Yarn cache or Docker layer cache is cold.

## Open Questions

_None_

## Implementation Steps

1. **Add frontend build and runtime targets to `Dockerfile`.** Done.
   - Keep the existing Rust `build`, `worker`, and `api` stages intact.
   - Add a `frontend-build` stage based on `node:22-slim` or the current Node LTS.
   - Set `WORKDIR /sln`.
   - Copy workspace install inputs first: `package.json`, `yarn.lock`, `.yarnrc.yml`, `.yarn/releases/yarn-4.13.0.cjs`, `packages/frontend/package.json`, and `packages/ui/package.json`.
   - Enable/use Yarn 4 from the checked-in release and run `yarn install --immutable`.
   - Copy only the source/config needed for the frontend build after dependency install: `packages/frontend/`, `packages/ui/`, and any root TypeScript/Vite config files required by the workspace if discovered during build.
   - Run `yarn workspace @pipeline/frontend build`, producing `packages/frontend/dist/`.

2. **Add nginx runtime support for the frontend target.** Done.
   - Add a final `frontend` stage based on `nginx:alpine` or similarly small static server image.
   - Copy `packages/frontend/dist/` from `frontend-build` into `/usr/share/nginx/html/`.
   - Expose port 80.
   - Add an nginx config, preferably under a non-ignored path such as `docker/frontend/nginx.conf`, with:
     - static asset serving from `/usr/share/nginx/html`;
     - `try_files $uri $uri/ /index.html;` for SPA fallback;
     - a no-cache response for `/__env.js` so runtime config changes are not cached across container restarts.
   - Do not place runtime helper files under `scripts/`, because `.dockerignore` excludes that directory from Docker build context.

3. **Align runtime env injection with the issue contract.** Done.
   - In `packages/frontend/vite.config.ts`, configure `runtimeEnv` so production bundles consistently reference `window.__ENV__` instead of the plugin default `window.env`.
   - Ensure `packages/frontend/index.html` loads `/__env.js` before the Vite module script. The script should be harmless in `vite dev` if the file is absent or should be served from `packages/frontend/public/__env.js` as an empty/default object if Vite requires it.
   - Add a runtime entrypoint file, preferably `docker/frontend/entrypoint.sh`, that writes `/usr/share/nginx/html/__env.js` at container start in the form:
     - `window.__ENV__ = { ... };`
     - Include exactly the frontend env keys currently consumed by `packages/frontend/src/lib/env.ts`: `VITE_API_BASE_URL`, `VITE_EVM_CHAIN_ID`, `VITE_EVM_RPC_URL`, `VITE_DEPOSIT_MANAGER_ADDRESS`, `VITE_WITHDRAWAL_QUEUE_ADDRESS`, `VITE_STAKED_PLUSD_ADDRESS`, and `VITE_WALLETCONNECT_PROJECT_ID`.
   - Generate valid JavaScript even when values are unset or contain quotes/backslashes. Use a robust escaping strategy in shell or a tiny Node command available in the runtime image; avoid hand-written unescaped interpolation.
   - Keep existing defaults in `packages/frontend/src/lib/env.ts`; unset runtime env vars should continue to fall back to those defaults instead of breaking the SPA.

4. **Extend `.github/workflows/docker-build-and-push.yml`.** Done.
   - Add a metadata step with `id: meta-frontend`.
   - Set `images: ghcr.io/${{ github.repository }}-frontend`, which resolves to `ghcr.io/eq-lab/pipeline-frontend`.
   - Use the same tags as API and worker:
     - `type=sha,format=short,prefix=`
     - `type=ref,event=tag`
   - Add a `Build and push Frontend image` step using `docker/build-push-action@v6` with `context: .`, `file: ./Dockerfile`, `target: frontend`, `push: true`, `tags: ${{ steps.meta-frontend.outputs.tags }}`, and matching labels.
   - Leave the API and worker metadata/build steps unchanged except for any ordering needed to keep the workflow readable.

5. **Update `docs/FRONTEND.md`.** Done.
   - Add a deployment/runtime configuration section near the existing runtime-env and app structure documentation.
   - Document that the image is built once and configured at container start through `VITE_*` variables written into `/__env.js` as `window.__ENV__`.
   - List all required/supported keys from `packages/frontend/src/lib/env.ts` and note current defaults where applicable.
   - Include local verification commands:
     - `docker build --target frontend -t pipeline-frontend .`
     - `docker run --rm -p 8080:80 -e VITE_API_BASE_URL=http://host.docker.internal:8080 ... pipeline-frontend`
   - Include a direct-route check example such as `curl -i http://localhost:8080/deposit/123` returning the SPA shell with HTTP 200.

## Test Strategy

- Run `yarn workspace @pipeline/frontend build` to verify the existing Vite/TypeScript build still succeeds after runtime-env wiring changes.
- Run `npx tsx scripts/lint-docs.ts` because this task updates documentation and the repo requires docs lint after TypeScript changes.
- Run `docker build --target frontend -t pipeline-frontend .` from the repo root.
- Run the image locally with representative env values:
  - `docker run --rm -p 8080:80 -e VITE_API_BASE_URL=http://host.docker.internal:8080 -e VITE_EVM_CHAIN_ID=560048 -e VITE_EVM_RPC_URL=https://ethereum-hoodi-rpc.publicnode.com -e VITE_DEPOSIT_MANAGER_ADDRESS=0x0000000000000000000000000000000000000000 -e VITE_WITHDRAWAL_QUEUE_ADDRESS=0x0000000000000000000000000000000000000000 -e VITE_STAKED_PLUSD_ADDRESS=0x0000000000000000000000000000000000000000 -e VITE_WALLETCONNECT_PROJECT_ID=replace-me pipeline-frontend`
- In another shell, verify:
  - `curl -i http://localhost:8080/` returns HTTP 200 and the SPA `index.html`.
  - `curl -s http://localhost:8080/__env.js` contains `window.__ENV__` and the passed `VITE_*` values.
  - `curl -i http://localhost:8080/deposit/123` returns HTTP 200 and the SPA shell rather than nginx 404.
- Optionally build existing targets to check for regressions:
  - `docker build --target api -t pipeline-api .`
  - `docker build --target worker -t pipeline-worker .`
- If local Docker is unavailable, document that limitation and rely on frontend build, docs lint, and CI workflow review; do not mark Docker acceptance complete without a real container build/run.

## Docs to Update

- `docs/FRONTEND.md` — add frontend deployment image usage, `__env.js` runtime configuration contract, supported `VITE_*` variables, and local verification commands.
