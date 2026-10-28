# Issue #1749: Trustee: remove the /sign-in URL layer — the render-level overlay is the whole login/logout story

Source: https://github.com/eq-lab/pipeline/issues/1749 (`gh issue view 1749`)

## Scope

Drop layer 2 of trustee auth (URL convention) and keep layer 1 (render-level gate in `TrusteeShell`).
After this change no session status change issues a navigation; the URL stays where the user is and
the shell shows `SignInOverlay` while not authenticated.

In scope:
- Delete `routes/sign-in.tsx`, `auth/authGate.ts` + `-authGate.test.ts`, `auth/useAuthRedirect.ts` + `-useAuthRedirect.test.tsx`.
- Remove `beforeLoad` and `useAuthRedirect()` from `routes/__root.tsx`; add a root `notFoundComponent` (decision below).
- Regenerate and commit `routeTree.gen.ts`.
- Rewrite `-authTransitions.test.tsx`; drop the `/sign-in` fixture in `lib/-diagnostics.test.ts`; fix stale header comment in `components/-SignInOverlay.test.tsx`.
- Rename spec section `Two-layer gating (#1008)` and repoint every live spec-pointer header to the new anchor.
- Docs: trustee-flows, trustee-dashboard product spec, TD-158, epic-1521 #1731 user stories.

Out of scope: `TrusteeShell`/`SignInOverlay`/`SignInCard` UI (Figma `4174-31660` unchanged), `TrusteeSessionProvider`
(`signOut` already does not navigate), `AppErrorBoundary`, diagnostics module, router upgrade (TD-158), any
`index.html` canonicalisation script or boot guard (#1745 / PR #1746 closed unmerged by decision), LP frontend.
Completed exec plans under `docs/exec-plans/completed/` and `known-bugs.md` BUG-30 stay as history (unchanged).

### Decision: old `/sign-in` bookmark
Trustee has no not-found handling of its own today (no `notFoundComponent` on the root route or in `createRouter`
in `main.tsx`; only TanStack's built-in "Not Found" text inside the shell). Per the issue's allowed option, the root route
gets `notFoundComponent: () => <Navigate to="/" replace />`. Every unknown path (including a stale `/sign-in`) lands on
`/`: signed out it shows the overlay (the shell renders the overlay before the outlet, so the redirect never even mounts),
signed in it shows the dashboard. This navigation is driven by an unmatched path, never by a session status change, so the
acceptance "no navigation is issued by any session status change" holds. No code references the `/sign-in` string.

## Assumptions and Risks

- Signed-out unknown path: `TrusteeShell` returns `SignInOverlay` without rendering `<Outlet />`, so the not-found
  redirect fires only after sign-in (URL becomes `/`). Acceptable and expected; document it in the scenario table.
- Removing `beforeLoad` means route loaders (if any) run while signed out. Check `routes/*.tsx` for `loader`/`beforeLoad`
  usage that calls authenticated APIs; current routes fetch via hooks inside components (not mounted while signed out). If
  a loader is found, report it rather than re-adding a guard.
- Anchor rename breaks spec pointers; `lint:docs` / `lint:comments` must pass after repointing.
- Depends on nothing open; branch `feat/1749-remove-sign-in-url-layer` already exists.

## Open Questions

_None_

## Implementation Steps

1. Delete files in `packages/trustee/src`: `routes/sign-in.tsx`, `auth/authGate.ts`, `auth/-authGate.test.ts`,
   `auth/useAuthRedirect.ts`, `auth/-useAuthRedirect.test.tsx`.
2. `packages/trustee/src/routes/__root.tsx`: remove imports of `redirect`, `getSessionState`, `resolveAuthRedirect`,
   `useAuthRedirect`; remove the `useAuthRedirect()` call and `beforeLoad`; import `Navigate` and add
   `notFoundComponent: () => <Navigate to="/" replace />` to `createRootRoute`. Replace the JSDoc with a single 2–3 line
   spec-pointer header pointing at the new anchor (comment-minimal rule: no other comments).
3. `packages/trustee/src/components/TrusteeShell.tsx`: shrink the header to a 2–3 line spec pointer at the new anchor
   (drop narrative about URL races).
4. Regenerate `packages/trustee/src/routeTree.gen.ts`: in `packages/trustee` run `npx vite build` before `yarn build`;
   confirm `/sign-in` is gone from the gen file; commit it.
5. Rewrite `packages/trustee/src/auth/-authTransitions.test.tsx`:
   - `buildRouter`: drop `beforeLoad` and the `/sign-in` route; add a `/loans/$id` route rendering `data-testid="loan"`;
     pass `notFoundComponent: AppRoot.options.notFoundComponent`.
   - `renderApp` waits for `home`/`loan` when authenticated, else `sign-in-overlay`.
   - Tests: (a) sign in on `/` — URL stays `/`, `navigate` not called, `home` renders; (b) deep link `/loans/123` signed out
     shows overlay with URL unchanged, after `authenticate()` URL still `/loans/123`, `loan` renders, no navigate;
     (c) sign-out on `/loans/123` — URL unchanged, overlay, `loan`/`home` unmounted, no navigate; (d) token expiry — same;
     (e) unauthorized "Try a different wallet" — no navigate; (f) authenticated on unknown `/sign-in` ends at `/` with `home`;
     keep the existing pending-navigation / non-empty-container checks only if still meaningful (the history-rewrite test
     targeted the deleted self-heal; delete it).
   - Header: 2–3 line spec pointer at new anchor; no body comments.
6. `packages/trustee/src/lib/-diagnostics.test.ts`: replace `/sign-in` fixture paths with `/loans`.
7. `packages/trustee/src/components/-SignInOverlay.test.tsx` and `-TrusteeShell.test.tsx`: reduce headers to the
   spec-pointer form, removing the `/sign-in` mention. Grep `packages/` for `"/sign-in"` and `sign-in.tsx` — must be zero
   (the `sign-in-overlay`/`sign-in-card` test ids are not URLs and stay).
8. Docs (see below), then repoint `docs/user-stories/epic-1521/1731-trustee-auth-transition-white-screen.md` link.
9. Run checks (Test Strategy).

## Test Strategy

- `yarn workspace @pipeline/trustee test --maxWorkers=4` (or the package's vitest script) green, including the rewritten
  `-authTransitions.test.tsx` under `StrictMode`, `-TrusteeShell.test.tsx`, `-SignInOverlay.test.tsx`, `-diagnostics.test.ts`.
- Key assertions: across sign-in, sign-out, token expiry and unauthorized reset, `router.navigate` is never called and
  `router.state.location.pathname` is unchanged; content follows session status; container never empty.
- Unknown-path test: authenticated `/sign-in` → `/` with home.
- `yarn lint:docs` and `yarn lint:comments` 0 errors; trustee `yarn build` green (after `npx vite build`).
- `grep -rn "/sign-in" packages/` returns nothing (excluding node_modules, tsbuildinfo regenerated by the build).
- Manual (user, own dev server, no browser automation): visit `/loans` signed out → overlay at `/loans`; sign in → loans page
  same URL; Sign out → overlay, URL unchanged; open `/sign-in` signed in → `/`.

## Docs to Update

- `docs/frontend/trustee-flows.md`: rename `### Two-layer gating (#1008)` to `### Render-level auth gate (#1008, #1749)`;
  describe the single gate; replace the scenario table with the issue's "Behaviour after" table (old bookmark row: any
  unknown path, `/sign-in` included, redirects to `/` via root `notFoundComponent`; signed out the overlay shows first and
  the redirect happens after sign-in); keep the history paragraph and append that #1749 removed the URL layer; update the
  file list near line 1790 (drop `routes/sign-in.tsx`).
- Update anchor references in live code and `docs/user-stories/epic-1521/1731-trustee-auth-transition-white-screen.md`.
- `docs/user-stories/epic-1521/1731-trustee-auth-transition-white-screen.md`: rewrite `/sign-in` expectations (overlay on
  the current URL, URL unchanged across sign-in/out/expiry, no history entries added).
- `docs/product-specs/trustee-dashboard.md` line ~23: replace the redirect sentence with the render-level gate description.
- `docs/exec-plans/tech-debt-tracker.md` TD-158: note the upgrade is still worthwhile but no longer tied to auth navigation
  (the trustee no longer navigates on auth changes; #1749).
- Completed plans, TD-34 resolution text and BUG-30: left as history.
