# Issue #1731: Trustee (staging): white screen after wallet sign-in and after logout, works after refresh — recurring (#921, #1008)

Source: https://github.com/eq-lab/pipeline/issues/1731

## Scope

Fix the white screen that appears on staging after an auth transition (sign-in completes, or the
user signs out). A refresh fixes it. The only console evidence is `Uncaught undefined`. The fix
has three parts:

1. **Exactly one navigation per auth transition.** `useAuthRedirect` becomes the only code that
   navigates on a session-status change. `signOut()` stops navigating. The hook navigates once,
   with `replace: true`, catches a rejected navigation and reports it, and does not issue a
   navigation that is already in flight. The address-bar self-heal runs only when the router is
   idle.
2. **Make a falsy throw visible.** Add an app-level React error boundary around `RouterProvider`
   that also catches a thrown `undefined`. TanStack's own boundaries ignore a falsy error (see
   Research). Set the router's `defaultErrorComponent` to the same error view, and add
   `error`/`unhandledrejection` window listeners that log the thrown value with the router state
   and `window.location`. No external telemetry.
3. **Stale chunk after a deploy.** Handle `vite:preloadError` with a guarded one-time reload.

Out of scope:

- Upgrading `@tanstack/react-router`. The upstream fix is in 1.170.x. It is logged as tech debt
  because it changes both `packages/trustee` and `packages/frontend`.
- Any change to `sessionStore`, the sign-in orchestration (challenge, sign, verify), or the root
  `beforeLoad` guard. The guard stays as it is for hard navigations.
- The LP frontend (`packages/frontend`).

### Research findings (done during planning)

**Reproduction with a production build.** The build was
`VITE_API_BASE_URL=https://api.pipeline.stage.eqlab.net npx vite build`, served statically with
`npx serve -s … -l 4174`. It was driven in a new isolated Chrome DevTools page with the CPU
throttled 6×. A session was seeded through `sessionStorage["pipeline.trustee.session"]`, which is
hydrated at module load. Sign-in cannot be completed headlessly: the verify step needs a
signature from an allow-listed wallet.

- **Logout (Account menu → Sign out), three runs on `/` and `/loans`:** no white screen.
  Afterwards the URL was `/sign-in`, `#root` had 2 children, and the overlay was rendered. No
  `error` or `unhandledrejection` events fired.
- **Forced concurrent transition:** `router.navigate({to:"/sign-in"})`, then `signOut()`, then
  `router.navigate({to:"/"})`, all without awaiting. Both navigate promises **resolved**
  (`"resolved:undefined"`, twice). The router settled `idle` on `/sign-in`, and the root match
  `__root__/` ended with `status: "success"` and `_nonReactive.loadPromise === undefined`.
- **White-screen signature reproduced:** the active root match was put back into `pending`
  (`router.updateMatch("__root__/", m => ({...m, status: "pending"}))`) while its shared
  `_nonReactive.loadPromise` was `undefined`. `#root` went to **0 children** (white page), and
  the console showed exactly:

  ```
  [error] Uncaught   (0 args)
  ```

  This is Chrome's `Uncaught undefined`, the reporter's line. A real `Error` thrown on the same
  path (status `redirected` without a redirect error) instead rendered TanStack's
  "Something went wrong!" view. **Only a falsy throw produces a white page.**

The staging trigger that leaves the rendered root match `pending`/`redirected` was not
reproduced headlessly. That needs the real wallet sign-in and disconnect timing. The reporter
must verify on staging after deploy (see Test Strategy). The fix targets every condition that
leads to the signature: overlapping navigations caused by auth transitions, and a falsy throw
that no boundary renders.

**Mechanism confirmed in code** (`@tanstack/react-router` 1.168.25 / `router-core` 1.168.15):

- **The white page with no message.** `react-router/dist/esm/CatchBoundary.js` renders the
  error component only `if (error)`. A thrown `undefined` is falsy, so every router boundary
  re-renders its children, the throw repeats, and it reaches the React root. The root unmounts
  the whole tree and reports `Uncaught undefined`. This applies to the global
  `MatchesInner` boundary (`Matches.js`) and to any route `errorComponent` or
  `defaultErrorComponent`. **A router `defaultErrorComponent` alone would NOT fix the white
  page.** The app boundary must handle falsy values.
- **The `throw undefined` site.** `react-router/dist/esm/Match.js` `MatchInner` throws
  `getMatchPromise(match, "loadPromise")` when the match is `pending` (L224) or `redirected`
  (L238). That value is `_nonReactive.loadPromise`, which `load-matches.js` sets to `void 0`
  after every load (L444-446, L490-491).
  - The root match id is constant (`__root__/`, from `route.id + interpolatedPath`,
    `router.js:874`).
  - `matchRoutesInternal` copies `existingMatch` (`router.js:889`), so the active, pending and
    cached copies of the root match **share one `_nonReactive`**.
  - `getMatch` prefers cached, then pending, then active (`router.js:666`). `updateMatch` falls
    back to the active store when the id is not pending.
  - Result: an overlapping load can write `pending`/`redirected` onto a rendered root match whose
    shared promise another load has already cleared. That is a `throw undefined` during render.
    In production the `Invariant failed` messages are stripped, and minified timing differs from
    dev, which fits "staging only".
- **The issue comment's premise needs correcting.** In this version a superseded navigation
  does not reject. `commitLocation` resolves the previous `commitLocationPromise`
  (`router.js:382-385`), and the forced repro confirmed both promises resolved. The
  `void navigate(...)` calls are therefore not the `undefined` source themselves. They matter
  because they create overlapping loads.
- **Double navigation on logout.**
  - `TrusteeSessionProvider.tsx:253` calls `void navigate({ to: "/sign-in" })` in `signOut`.
  - `setSession(undefined)` on L249 has already flipped the status, so
    `useAuthRedirect.ts:24-28` reacts with `void router.navigate({ to })` whenever its committed
    `pathname` is still the protected path.
  - `SignInCard`'s "unauthorized" button also calls `signOut()` while already on `/sign-in`. That
    is a same-URL commit, which runs `this.load()` again (`router.js:387`).
- **Sign-in.** On `/sign-in`, `useAuthRedirect` navigates to `/` after the status flip. The
  self-heal `replaceState` at 0/250/1500 ms (`useAuthRedirect.ts:40-47`) writes
  `window.history` from a closure-captured `href`, without checking whether a navigation is
  pending. The root `beforeLoad` (`routes/__root.tsx:33-35`) throws `redirect` on any load where
  status and path disagree. That includes a load started by a history pop or a wallet-modal URL
  restore. Its `catch` then fires another `navigate({...redirect, replace: true})`
  (`router.js:595-600`).
- **Upstream.** `@tanstack/react-router` 1.170.46 wraps the caught error in an array
  (`getDerivedStateFromError → { error: [error] }`), so a falsy throw renders the error
  component. Its `Match.js` no longer throws `_nonReactive` promises. Logged as tech debt.

## Assumptions and Risks

- **The staging trigger is not proven.** The signature (white page, `Uncaught undefined`) is
  reproduced and traced to one code path. The exact interleaving on staging is not. If the
  single-navigation change does not remove it, the new boundary turns the white page into an
  error view with the thrown value and router state. Combined with the listeners, the next
  report names the site. The PR must say this plainly. It must not claim the trigger is
  eliminated until the reporter confirms on staging.
- **The boundary must catch falsy throws.** Implement it as a class with
  `getDerivedStateFromError(error) { return { caught: true, error }; }` and branch on `caught`,
  never on `error`.
- **Recovery from a boundary-caught router error.** Re-rendering the same tree throws again. The
  error view's action is a full `window.location.reload()`, the same as the manual refresh that
  works today. No auto-recovery loop.
- **`replace: true` on both directions** changes logout from push to replace. Back after logout
  no longer returns to a protected URL, which the gate would bounce anyway. This is the intended
  URL-convention behaviour. Spec it.
- **Provider no longer needs router context.** Removing `useNavigate` from
  `TrusteeSessionProvider` drops its router dependency. It still mounts inside the root route; no
  structural move. Update the bootstrap section that cites `useNavigate()` as the reason.
- **`vite:preloadError` reload loop.** Guard with a `sessionStorage` timestamp
  (`pipeline.trustee.preloadReloadAt`) and reload only if there was no reload in the last 10 s.
  Otherwise log and let the boundary render.
- **Dependencies:** none. Draft PR #1732 on `fix/1731-trustee-auth-transition-white-screen`.
  Do not touch the unrelated working-tree files (`.mcp.json`, `.requirement`,
  `Cash management.md`, `trustee-new.md`).

## Open Questions

_None_

## Implementation Steps

1. **`packages/trustee/src/auth/useAuthRedirect.ts`: single owner, no duplicate, gated self-heal.**
   - Keep the reactive inputs (`status` from `useSessionState()`, `pathname` from
     `useRouterState`).
   - Compute `to = resolveAuthRedirect(status, pathname)`. If `to` is set:
     - Skip when `router.latestLocation.pathname === to`. The navigation is already committed to
       history but not yet reflected in `useRouterState`, which is the logout duplicate case.
     - Skip when a `useRef` holding the in-flight target already equals `to`.
     - Otherwise set the ref and call `router.navigate({ to, replace: true })`. Clear the ref in
       `.finally`. In `.catch`, call `reportAppError("auth-redirect", err, router)` from step 4.
       Do not swallow silently.
     - Return without running the self-heal.
   - Self-heal: `sync()` reads router state at call time, not from the closure. It returns early
     unless `router.state.status === "idle"` and `!router.state.isTransitioning`, and unless
     `router.latestLocation.pathname === router.state.resolvedLocation?.pathname`. Then, if
     `window.location.pathname !== router.state.resolvedLocation.pathname`, it calls
     `history.replaceState(window.history.state, "", router.state.resolvedLocation.href)`. Keep
     the 0/250/1500 ms re-checks and their cleanup.
   - Comments: remove the narrative block (L31-39) and the constant's JSDoc. Leave one 2-3-line
     spec-pointer header. The rationale moves to the spec (step 6).
2. **`packages/trustee/src/auth/TrusteeSessionProvider.tsx`: `signOut` stops navigating.**
   - Delete `useNavigate` (import and L84), the `navigate` call and its comment (L252-253), and
     `navigate` from the dependency list.
   - `signOut` = `setSession(undefined)` + disconnect connected wallets. The hook performs the
     single `/sign-in` navigation.
   - Update the header's "signOut" pointer if needed. No new comments.
3. **`packages/trustee/src/components/AppErrorBoundary.tsx` (new): boundary and view.**
   - `AppErrorBoundary`: class component with state `{ caught: boolean; error: unknown }`.
     - `getDerivedStateFromError(error)` returns `{ caught: true, error }`.
     - `componentDidCatch(error, info)` calls `reportAppError("render", error, router?, info.componentStack)`.
       It receives `router` as a prop.
     - Render: `caught ? <AppErrorView error={error} /> : children`.
   - `AppErrorView({ error })` (also used as the router `defaultErrorComponent`, which receives
     `{ error, reset }`):
     - Heading "Something went wrong".
     - The message: `error instanceof Error ? error.message : \`Non-error value thrown: ${String(error)}\``.
     - The stack in a `<pre>` when present.
     - The current `window.location.pathname`.
     - A "Reload" `Button` from `@pipeline/ui` that calls `window.location.reload()`.
     - Style with existing tokens (`--color-pipeline-paper`, `--color-pipeline-ink`), full
       viewport, `role="alert"`.
     - Do not depend on router context. It renders outside `RouterProvider`.
4. **`packages/trustee/src/lib/diagnostics.ts` (new): reporting and preload guard.**
   - `reportAppError(source, value, router?, extra?)` calls `console.error("[trustee] <source>",`
     with an object containing:
     - `value`, `type: typeof value`, `message`, `stack`
     - `routerPathname: router?.state.location.pathname`
     - `routerStatus: router?.state.status`
     - `pendingPathname: router?.latestLocation.pathname`
     - `href: window.location.href`
     - `extra`
   - `installGlobalErrorReporting(router)`:
     - `window.addEventListener("error", e => reportAppError("window.error", e.error ?? e.message, router))`.
     - `window.addEventListener("unhandledrejection", e => reportAppError("unhandledrejection", e.reason, router))`.
     - `window.addEventListener("vite:preloadError", e => { … })`: if
       `sessionStorage["pipeline.trustee.preloadReloadAt"]` is absent or older than 10 s, write
       `Date.now()`, call `e.preventDefault()`, and call `window.location.reload()`. Otherwise
       call `reportAppError("preloadError", e.payload, router)`. Wrap storage access in
       try/catch.
     - Return a cleanup function, for tests.
5. **`packages/trustee/src/main.tsx`: wire it up.**
   - `createRouter({ routeTree, defaultErrorComponent: AppErrorView })`.
   - Call `installGlobalErrorReporting(router)` before render.
   - Wrap `<RouterProvider router={router} />` in `<AppErrorBoundary router={router}>`, inside
     `ConnectModalProvider` so the existing provider order is unchanged.
   - Fold the new pieces into the existing spec-pointer comments. Add no new narrative comments.
6. **Spec: `docs/frontend/trustee-flows.md`.**
   - **§Two-layer gating (#1008):**
     - Layer 2 now has **one** navigation owner, `useAuthRedirect`. It navigates with
       `replace: true`, skips a target already pending (`router.latestLocation`), catches and
       reports rejections, and the self-heal runs only when the router is idle and resolved.
     - `signOut()` no longer navigates.
     - Move the self-heal rationale here from the hook's comments (wallet-modal URL restore,
       `window.location` vs router state).
     - Add #1731 to the History paragraph with the mechanism:
       - overlapping loads on the shared root `_nonReactive`
       - `throw undefined` from `MatchInner`
       - TanStack `CatchBoundary` ignores a falsy error, so the React root unmounts
     - Correct the "never wrong or blank content" sentence: blank was possible through this
       router path, and the app boundary now covers it.
     - Update the scenario table's Logout row to note `replace`.
   - **§Sign-in flow:** in the `signOut()` paragraph, replace "and navigates to `/sign-in`" with
     "the URL follows from `useAuthRedirect`".
   - **§App bootstrap & providers:**
     - Add `AppErrorBoundary`, which catches falsy throws, and why the router
       `defaultErrorComponent` alone is insufficient.
     - Add `installGlobalErrorReporting`: what it logs, and that there is no external telemetry.
     - Add the `vite:preloadError` one-time reload guard.
     - Update the sentence that says the provider mounts in the root route "because it calls
       `useNavigate()`". It mounts there for layout; it no longer needs the router.
     - Update **Sources** to include `components/AppErrorBoundary.tsx` and `lib/diagnostics.ts`.
7. **`docs/exec-plans/known-bugs.md`:** add `BUG-30` under **## Resolved**: trustee white screen
   after an auth transition. Include the date, the files, the symptom (`Uncaught undefined`, empty
   `#root`), the root cause (the three bullets in step 6), and the fix (#1731).
8. **`docs/exec-plans/tech-debt-tracker.md`:** add `TD-159`. Upgrade `@tanstack/react-router`,
   `router-core` and `router-plugin` to ≥ 1.170 in `packages/trustee` and `packages/frontend`.
   Upstream `CatchBoundary` stores `[error]`, so a falsy throw renders the error component, and
   `Match` no longer throws shared `_nonReactive` promises. The LP frontend has the same exposure
   and no app boundary.
9. **User stories:** create `docs/user-stories/epic-1521/1731-trustee-auth-transition-white-screen.md`
   in the format of `1626-trustee-display-fixes.md`. Header: Epic #1521 link, Issue #1731, Spec
   link to `trustee-flows.md#two-layer-gating-1008`. Stories:
   - (1) Sign in on staging from `/sign-in` → the dashboard renders in place at `/`, with no
     refresh.
   - (2) Sign out from `/` and from `/loans` → the overlay renders at `/sign-in`, and Back does
     not return to a protected page.
   - (3) Token expiry while idle → overlay at `/sign-in`.
   - (4) Every case: the console has no `Uncaught undefined`, and `#root` is never empty.
   - (5) If a render error occurs, an error view with the message and a Reload button shows
     instead of a white page.
10. **Lint and baseline.**
    - Run `npx tsx scripts/lint-docs.ts` and `npx tsx scripts/lint-comments.ts`.
    - Shrink `scripts/lint-comments.baseline.json` for any touched file it lists. That includes
      `auth/-TrusteeSessionProvider.test.tsx` and `auth/-useAuthRedirect.test.tsx`: drop their
      narrative test comments when editing.
    - Run `yarn workspace @pipeline/trustee build`.

## Test Strategy

Run the trustee tests with `yarn workspace @pipeline/trustee vitest run --maxWorkers=4`.

- **New `packages/trustee/src/auth/-authTransitions.test.tsx`: real router in jsdom.**
  - Route tree for the test:
    `createRootRoute({ beforeLoad: Route.options.beforeLoad, component: Route.options.component })`,
    reusing the real `routes/__root.tsx` `Route`, with stub `/` and `/sign-in` children. The stub
    `/` renders a marker and a button that calls `useTrusteeSession().signOut()`.
  - Router: `createMemoryHistory`.
  - Use the real `sessionStore` and reset it with `_resetSessionStoreForTests`. Mock
    `@pipeline/wallet-connect` and `@/api/auth` the way `-TrusteeSessionProvider.test.tsx` does.
  - `vi.spyOn(router, "navigate")`. Render inside `StrictMode`.
  - Cases:
    - (a) Signed out at `/sign-in` → `act(() => setSession(...))` → `navigate` called **exactly
      once** with `{ to: "/", replace: true }`. After `router.state.status === "idle"`: pathname
      `/`, the stub marker is visible, and `container` is non-empty.
    - (b) Authenticated at `/` → click sign-out → `navigate` called exactly once with
      `{ to: "/sign-in", replace: true }`. After idle: the overlay `data-testid="sign-in-overlay"`
      is rendered and `container` is non-empty.
    - (c) Authenticated at `/` → the token expiry timer fires (`vi.useFakeTimers`, short
      `expiresAt`) → one navigate, overlay rendered.
    - (d) Unauthorized at `/sign-in` → `signOut()` → **zero** navigates, overlay still rendered.
    - (e) While a navigation is pending, the self-heal does not call `history.replaceState`. Spy
      on it, and assert no call before `status === "idle"`.
- **Update `auth/-useAuthRedirect.test.tsx`.**
  - The mock router gains `navigate` returning a Promise, `latestLocation`, and `state`
    (`status`, `isTransitioning`, `resolvedLocation`).
  - Assert `replace: true`.
  - Assert no navigate when `latestLocation.pathname === to`.
  - Assert a rejected navigate calls `console.error` with `"[trustee] auth-redirect"`.
  - Assert the self-heal is skipped while `status: "pending"` and runs once idle. The existing
    clobber cases still pass.
- **Update `auth/-TrusteeSessionProvider.test.tsx` (L376-384):** `signOut` clears the token and
  disconnects wallets, and calls **no** navigate. Drop `useNavigate` from the router mock if it
  becomes unused.
- **New `components/-AppErrorBoundary.test.tsx`.**
  - A child that throws `undefined` renders `AppErrorView` with the text `undefined`, not an empty
    container.
  - A child that throws `new Error("boom")` shows `boom` and a stack `<pre>`.
  - `console.error` was called with `"[trustee] render"`.
  - Reload calls a stubbed `window.location.reload`.
  - `AppErrorView` used as the router `defaultErrorComponent` renders for a route whose component
    throws an Error, using a real router as in the shell test.
- **New `lib/-diagnostics.test.ts`.**
  - An `unhandledrejection` event with `reason: undefined` → `console.error` payload has
    `type: "undefined"`, `routerPathname`, and `href`. jsdom lacks `PromiseRejectionEvent`, so
    build an `Event` and assign `reason`.
  - An `error` event is logged.
  - `vite:preloadError`: reloads once; a second event within 10 s does not reload and is logged.
  - The cleanup removes the listeners.
- **Manual verification of the production build (coder).**
  - Rebuild into a scratch `outDir` against the staging API, serve with `npx serve -s`, and use a
    new isolated DevTools page at 6× CPU. Seed the session as described in Research.
  - Logout from `/` and `/loans`, ×3 each → overlay at `/sign-in`, no console errors.
  - Force the signature in the console: find the router via the React container fiber and run
    `router.updateMatch("__root__/", m => ({...m, status: "pending"}))` → **`AppErrorView`
    renders, not a white page**, and `[trustee] render … type: "undefined"` is logged.
  - Do not drive the user's own browser tabs.
- **Staging verification (reporter, after deploy):** run story docs 1-4 with a real wallet and
  DevTools open from before sign-in. Close #1731 only after sign-in and logout both render in
  place. Any recurrence must now show `AppErrorView` and a `[trustee]` console line, not a white
  page.

## Docs to Update

- `docs/frontend/trustee-flows.md`: §Two-layer gating (#1008), §Sign-in flow (signOut
  paragraph), §App bootstrap & providers (step 6).
- `docs/exec-plans/known-bugs.md`: BUG-30 (Resolved) with the root cause.
- `docs/exec-plans/tech-debt-tracker.md`: TD-159 (TanStack router upgrade ≥ 1.170, both apps).
- `docs/user-stories/epic-1521/1731-trustee-auth-transition-white-screen.md`: new.
- `scripts/lint-comments.baseline.json`: shrink the entries for touched test files.
