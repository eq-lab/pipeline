# Issue #1745: Trustee/LP (staging): basic-auth credentials in the page URL boot the app twice

Source: https://github.com/eq-lab/pipeline/issues/1745

## Scope

Root cause is confirmed in the Issue body. When `document.URL` has userinfo (`https://user:pass@host/…`), Chrome keys the HTML entry `<script type="module">` by the credentialed URL. Lazy chunks resolve `import "./index-….js"` against the stripped URL, so the entry module is instantiated twice. That gives two React roots and two routers on one `window.history`, and they fight over `/sign-in` ↔ `/`.

In scope, for both `packages/trustee` and `packages/frontend`:

1. A blocking inline script, the first `<script>` in `<head>`, that strips userinfo from the page URL with `location.replace` before any other script loads.
2. A boot guard in `main.tsx` that refuses a second boot, logs one console diagnostic, and skips booting while the canonicalising navigation is pending.
3. Regression tests for the inline script (run against each real `index.html`) and for the boot guard.
4. Docs: trustee bootstrap spec, LP `docs/FRONTEND.md`, `known-bugs.md`, a user story and its index row.

Out of scope:

- `useAuthRedirect`, `TrusteeSessionProvider`, `AppErrorBoundary` and router logic. They are correct (#1731), so do not touch them.
- Kong / basic-auth configuration on staging.
- The LP app error boundary (TD-158 exposure) and any relative-`fetch` audit. The apps use absolute API bases.

## Assumptions and Risks

- **Cached credentials.** Chrome reuses the realm's cached basic-auth credentials on the credential-free `location.replace`, so there is no second prompt. The Issue verified this against httpbin. Other browsers may prompt once. That is acceptable and better than a double boot.
- **`document.URL` vs `location.href`.** Chrome strips userinfo from `location.href` but keeps it in `document.URL`, so the script must read `document.URL`.
- **Module script during navigation.** `location.replace` is asynchronous. The deferred module script could still evaluate on the credentialed document before the navigation commits. The inline script sets `window.__PIPELINE_URL_CANONICALISING__ = true` only after `replace` returns, and the boot guard skips booting silently when the flag is set. If `replace` throws, the flag is not set and the app boots as today (no white page).
- **Redirect loop.** `location.replace` runs only when the parsed URL has a username or password. The replaced URL has neither, so the reloaded page is a no-op and cannot loop.
- **Exotic URLs.** The whole body is wrapped in `try { … } catch (e) {}`. If `new URL` throws, `URL` is missing, or `replace` throws, it fails silently.
- **Secrets in logs.** The boot-guard diagnostic must log `window.location.href` (already stripped) and never `document.URL`, which can carry the password.
- **Duplicated helpers.** The boot guard lives in each app's `lib/` with no shared package. That matches how both `index.html` files already duplicate the theme script. It is small enough not to need a shared package.
- **Live check.** The local repro assets (auth proxy) are in the Issue's session scratchpad and may not exist later. The coder rebuilds the repro if needed (a basic-auth proxy in front of `vite preview`, as described in the Issue). Final confirmation is on staging after deploy.

## Open Questions

_None_

## Implementation Steps

1. **Inline canonicalisation script, both apps.** In `packages/trustee/index.html` and `packages/frontend/index.html`, add this byte-identical block as the **first `<script>` in `<head>`**: directly after `<title>`, before the theme script's comment and the theme script, and before `/__env.js` and the module entry. Do not add an HTML comment for it, per the comment-minimal rule.

   ```html
   <script>
     (function () {
       try {
         var u = new URL(document.URL);
         if (!u.username && !u.password) return;
         u.username = "";
         u.password = "";
         location.replace(u.href);
         window.__PIPELINE_URL_CANONICALISING__ = true;
       } catch (e) {}
     })();
   </script>
   ```

   Path, query and hash are kept because `URL.href` serialises them. Leave the existing theme script and its comment unchanged.

2. **Trustee boot guard.** Create `packages/trustee/src/lib/bootGuard.ts`:
   - Header: `// spec: docs/frontend/trustee-flows.md#app-bootstrap--providers`. No other comments.
   - `declare global { interface Window { __PIPELINE_BOOTED__?: boolean; __PIPELINE_URL_CANONICALISING__?: boolean } }`.
   - `export function claimAppBoot(root: HTMLElement): boolean` works as follows:
     - If `window.__PIPELINE_URL_CANONICALISING__`, return `false` silently.
     - If `window.__PIPELINE_BOOTED__`, or `Object.keys(root).some((k) => k.startsWith("__reactContainer$"))`, call `reportAppError("duplicate boot", undefined, undefined, { booted: Boolean(window.__PIPELINE_BOOTED__), reactContainer: <bool> })` from `./diagnostics` and return `false`. `reportAppError` logs `href: window.location.href`, which is credential-free.
     - Otherwise set `window.__PIPELINE_BOOTED__ = true` and return `true`.

   Restructure `packages/trustee/src/main.tsx`:
   - `queryClient`, `router` and the `declare module` `Register` block stay module-level, because they are needed for typing.
   - Move the `#root` lookup above the side effects.
   - Wrap `setWalletConnectConfig(...)`, `installGlobalErrorReporting(router)` and `createRoot(rootElement).render(...)` in `if (claimAppBoot(rootElement)) { … }`.
   - Drop the existing inline comments in `main.tsx` and replace them with one 2–3 line header pointing at `docs/frontend/trustee-flows.md#app-bootstrap--providers`. The rationale already lives in that spec section.

3. **LP boot guard.** Create `packages/frontend/src/lib/bootGuard.ts` with the same `declare global` and `claimAppBoot(root)` semantics.
   - The LP has no `reportAppError`, so the duplicate branch calls `console.error("[pipeline] duplicate boot", { href: window.location.href, booted, reactContainer })` once.
   - Header: `// spec: docs/FRONTEND.md#page-url-canonicalisation-and-boot-guard`.

   In `packages/frontend/src/main.tsx`, wrap `createRoot(rootElement).render(...)` in `if (claimAppBoot(rootElement)) { … }`. The `router` and `Register` block stay module-level. Add the same one-line spec header.

4. **Lint.** Run these and fix anything they report. If a touched file is listed in `scripts/lint-comments.baseline.json`, shrink the baseline.
   - `npx tsx scripts/lint-docs.ts`
   - `npx tsx scripts/lint-comments.ts`
   - `yarn lint`, `yarn test` and `yarn build` in both `packages/trustee` and `packages/frontend`

## Test Strategy

1. **Inline-script tests**: `packages/trustee/src/lib/-canonicalUrl.test.ts` and `packages/frontend/src/lib/canonicalUrl.test.ts`. They follow each package's existing naming in `src/lib`.
   - Import the real file with `import html from "../../index.html?raw"`. The `vite/client` types cover `?raw`, so no node `fs` or types are needed.
   - Extract the first inline `<script>` (no `src`) inside `<head>` with a regex. Assert it contains `document.URL`. Assert its offset is before the theme script (`pipeline-theme`), before `/__env.js` and before `type="module"`.
   - Run the script with `new Function("document", "location", "window", code)(stubDoc, stubLocation, stubWindow)`, where `stubDoc = { URL }`, `stubLocation = { replace: vi.fn() }` and `stubWindow = {}`. Cases:
     - `https://user:pass@host.example/sign-in?x=1#h`: `replace` is called once with `https://host.example/sign-in?x=1#h` and `stubWindow.__PIPELINE_URL_CANONICALISING__ === true`.
     - Username only (`https://user@host.example/`) and password only (`https://:pass@host.example/`): `replace` is called once with `https://host.example/`.
     - Plain `https://host.example/loans`: `replace` is not called and the flag stays unset.
     - `"not a url"` and `"about:blank"`: no throw, `replace` not called.
     - `replace` throws: no throw, flag unset.
   - Also assert the trustee and LP script bodies are identical (in the trustee test, also import `../../../frontend/index.html?raw`). If Vite's fs allow-list rejects the cross-package import, assert each file separately instead.
2. **Boot-guard tests**: `packages/trustee/src/lib/-bootGuard.test.ts` and `packages/frontend/src/lib/bootGuard.test.ts`. Reset both window flags in `beforeEach` and spy on `console.error`. Cases:
   - First claim returns `true` and sets `__PIPELINE_BOOTED__`.
   - Second claim returns `false` and logs exactly once with the `[trustee] duplicate boot` / `[pipeline] duplicate boot` prefix.
   - Flag clear but root has an own `__reactContainer$abc` key: returns `false` and logs.
   - Canonicalising flag set: returns `false` with no log.
   - The logged payload does not contain the string `pass`, using a jsdom URL without credentials.
3. **Manual repro (coder, before PR).**
   - Run `vite preview` of the trustee build behind a local basic-auth proxy and open `http://user:pass@localhost:<port>/` in an isolated DevTools page, not the user's browser.
   - Expect: the address bar loses the userinfo with no prompt, `performance.getEntriesByType('resource')` lists `index-….js` once, `#root` has one `__reactContainer$` key, and after sign-in the URL is `/` and tab clicks change the URL.
   - Repeat the load check for the LP build.

## Docs to Update

- `docs/frontend/trustee-flows.md`, section "App bootstrap & providers": add a paragraph **Page URL canonicalisation and boot guard (#1745)**. Cover the double-instantiation cause (credentialed `document.URL` vs the stripped chunk URL), the first-in-`<head>` inline script, the cached basic-auth reuse, the canonicalising flag, and `claimAppBoot`'s `[trustee] duplicate boot` diagnostic. In the "Two-layer gating" History paragraph, add one sentence: the staging `/sign-in` ↔ `/` fight after #1732 was the double boot (#1745), not the redirect logic.
- `docs/FRONTEND.md`: add a `### Page URL canonicalisation and boot guard` subsection under "Deployment image and runtime configuration", next to the `index.html` load-order paragraph. It states that the inline script runs before `__env.js` and the module entry, describes the `[pipeline] duplicate boot` guard, and links to the trustee section. Its anchor must match the LP `bootGuard.ts` header.
- `docs/exec-plans/known-bugs.md`: add **BUG-31** under `## Resolved`, above BUG-30.
  - Location: both `index.html`, both `main.tsx`.
  - Symptom: on staging, the URL stays on `/sign-in`, tabs fall back to Overview, and console lines appear twice.
  - Root cause: as above, plus the dormant relative-`fetch` credential error.
  - Resolved by #1745.
  - In BUG-30's Resolved line, add "Underlying staging trigger: BUG-31 (#1745)".
- `docs/user-stories/epic-1521/1745-credentialed-url-double-boot.md`: use the 1731 doc's header format (Epic #1521, Issue #1745, Spec link to `trustee-flows.md#app-bootstrap--providers`). Stories:
  1. Trustee opened via a credentialed URL: the address bar loses userinfo, there is no second prompt, and `index-*.js` loads once.
  2. Sign-in then tab clicks: the URL follows the tab, never sticks on `/sign-in`, and console lines are not duplicated.
  3. The LP app opened via a credentialed URL loads once.
  4. A plain URL has no extra navigation.
- `docs/user-stories/index.md`: add the #1745 row after #1731 in the epic-1521 table, with status `Initial`.
