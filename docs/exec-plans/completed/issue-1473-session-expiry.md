# Issue #1473: Session expiry: sign the LP out when the token lapses — timer at expiresAt plus a 401 on an authenticated request

Source: https://github.com/eq-lab/pipeline/issues/1473

Parent epic: #1247 (KYB login flow). Narrowed out of #1445 (closed 2026-10-13); the token-expiry
half of #1364. Worktree: `/Users/luiza/Projects/pipeline-feat-session-expiry`, branch
`feat/session-expiry`, cut from `main` after #1469 (/#1465) merged.

No Figma frame exists. The only new visual is a toast, and `Toast` is a shipped, Figma-verified
component (`docs/frontend/ui-components.md#toast`), so there is no new pixel-verification step. All
behaviour comes from the Issue body and the docs.

## Scope

### In scope

Three ways a session can end mid-use, all handled by one root-mounted hook:

| Reason         | Source                                                           | Guard                        | Toast |
| -------------- | ---------------------------------------------------------------- | ---------------------------- | ----- |
| `expired`      | timer at `useAuthSession().expiresAt` (React effect)             | none (see A2)                | yes   |
| `unauthorized` | `apiFetch`: `401` on an authenticated request                    | `if (!readSession()) return` | yes   |
| `suspended`    | `apiFetch`: authenticated `403 account_suspended` (#1465, as-is) | `if (!readSession()) return` | no    |

Every reason does the same thing: `clearSession()`, then `navigate({ to: "/", replace: true })`.
**Wallets are not disconnected.** The connected wallet is display-only, and "wallet connected, no
session" is a designed state (#1460), so after expiry the visitor lands in home state 7 or the
wallet-only Account variant. For `expired` and `unauthorized` only, the hook also shows the toast:
`id: "session-expired"`, `tone: "neutral"`, title `"Your session expired. Sign in again to
continue."`, action `{ label: "Sign in", onClick: () => openAuthFlow("sign-in") }`, `durationMs:
10000`.

Files:

- `packages/frontend/src/api/client.ts`: generalise the #1465 seam into
  `subscribeSessionEnded(listener: (reason: SessionEndReason) => void)`, with
  `SessionEndReason = "expired" | "unauthorized" | "suspended"`, and add the 401 trigger. No alias
  for `subscribeAccountSuspended`.
- `packages/frontend/src/api/index.ts`: swap the export and add the type export.
- `packages/frontend/src/auth/useSessionEndSignOut.ts` (new): replaces `useSuspensionSignOut.ts`
  and owns the subscription, the expiry timer and the toast.
- `packages/frontend/src/auth/index.ts`: change the barrel export.
- `packages/frontend/src/routes/__root.tsx`: call the new hook.
- Delete `auth/useSuspensionSignOut.ts` and `auth/useSuspensionSignOut.test.tsx`. Their cases move
  to the new test file.
- Tests and docs, listed below.

### Out of scope

- Disconnecting wallets on any session end. `useWalletPresence` and `disconnectAll` are not touched.
- `/account`'s explicit `Log Out` (`routes/account.tsx`). It keeps its current behaviour, and the
  file does not change.
- `AuthFlowProvider.tsx`: no code change. Its `token` effect already resets setup and review state.
  This Issue only adds a regression test for that.
- `session.ts`: read-only. In particular, `readSession()` must never call `notify()`, because it runs
  inside `getSnapshot` during render.
- Cross-tab propagation (`storage` events), refresh tokens and silent renewal (no such endpoint
  exists), and `/test?tab=auth`'s own `Sign out`.
- Any suspension notice. Per the 2026-10-12 decision, suspension stays silent.
- The trustee app. `packages/trustee/src/api/client.ts` is a separate `apiFetch`.

## Assumptions and Risks

- **A1: the timer is a React effect, not a module timer.** A module-level `setTimeout` in
  `session.ts` would be armed by every test that calls `saveSession`, and it would survive
  `localStorage.clear()`. An effect is scoped to the one mounted `RootLayout`.
- **A2: the `expired` path must not use the `readSession()` guard.** When the timer fires,
  `Date.now() >= expiresAt`, so `readSession()` already returns `null`, and it also removes the key
  without notifying. The #1465 guard would therefore make the timer a no-op. The timer callback
  calls the end-session routine unconditionally. `clearSession()` is idempotent, and it is what
  calls `notify()` so every `useAuthSession` consumer (header, `/account`) re-renders. The timer
  arms once per `expiresAt`, so it cannot double-fire. A 401 or 403 landing just after it hits the
  guard and does nothing.
- **A3: re-arm on a new sign-in.** `saveSession` calls `notify()`, the token snapshot changes, the
  hook re-renders with a new `expiresAt`, and the effect cleanup clears the old timer and arms a
  new one. Known caveat (from #1445 research): `useSyncExternalStore` bails out on an identical
  snapshot, so re-saving the _same_ token with a longer expiry would not re-arm. That case cannot
  happen today, because both `saveSession` call sites in `useEmailAuthFlow.ts` follow a
  `login`/`verify-otp` round-trip that mints a fresh token. Noted here, not worked around.
- **A4: `setTimeout` cap.** If the delay is greater than `2 ** 31 - 1` ms (about 24.8 days), the
  timer is not armed, because such a delay would fire immediately. Backend tokens last 24 h, so in
  practice the cap is never reached. Late firing (backgrounded tab, laptop sleep) is acceptable:
  `useAuthSession` already reports signed-out on the next render, and the timer still fires on wake.
- **A5: a login or verify-otp 401 can never publish `unauthorized`.** `authHeaders()` returns `{}`
  when there is no live session, and the auth wrappers in `api/auth.ts` send no `Authorization`
  header, so `requestIsAuthenticated(init)` is false. After the token lapses, `authHeaders()` is also
  empty, so a lapsed token never produces a 401 that reaches the seam. The 401 path only covers a
  token that was revoked or lapsed server-side before the client timer fired.
- **A6: `AuthFlowProvider` needs no change.** Its `useEffect` on `token` calls `setSetup(null)` once
  the token is gone. That unmounts the token-keyed `CompanyDocsModal` and `AccountInReviewModal`
  and resets `lpRead` to `"unknown"`. `EmailAuthFlow` cannot be open while a session is live: a
  signed-in LP has no header entry to it, and its own requests are unauthenticated.
- **R1: `useToast()` throws outside `<ToastProvider>`.** In production, `main.tsx` nests
  `AuthFlowProvider > WalletViewProvider > ToastProvider > RouterProvider`, so `RootLayout` is
  inside both providers. **`routes/-root.test.tsx` renders inside `AuthFlowProvider` only**, so it
  must add `<ToastProvider>` inside `AuthFlowProvider`, mirroring `main.tsx`. `TopBar.test.tsx` and
  `AccountDropdown.test.tsx` build their own `createRootRoute` and do not render `RootLayout`, so
  they are unaffected. Run the suite to confirm.
- **R2: React Query retries repeat a 401.** Every retry's 401 re-fires the seam. The `readSession()`
  guard makes the sign-out run once, and the fixed toast `id` makes the toast upsert instead of
  stacking. Both are needed.
- **R3: narrow race: timer cancelled by a re-render after the token lapsed.** If the hook re-renders
  between `expiresAt` and the timer callback (for example, a session write elsewhere or a root
  re-render in that window), `getSnapshot` returns `null`, `expiresAt` becomes `undefined`, and the
  cleanup cancels the pending timer. In that case there is no toast and no navigation, but the header
  still flips on that same render. Accepted: the window is the timer's own scheduling latency, the
  toast context value is memoised (toasts do not re-render `RootLayout`), and `navigate` and
  `useAuthFlow().open` are stable. Do not work around it with a `notify()` inside `readSession()`.
- **R4: a stale-token 401 racing a fresh sign-in** could end the new session, because it passes the
  guard. This needs a sign-out and sign-in inside one in-flight request. Accepted, the same as in
  #1445's analysis.
- **Dependency:** none open. #1465 / PR #1469 is merged into this branch's base.

## Open Questions

_None_. The Issue body settles disconnect behaviour, toast copy, tone, action, id and duration,
silent suspension, the seam shape, the timer placement and the cap.

## Implementation Steps

Code is comment-minimal: at most one `// spec:` header line per new file and no other comments
(no JSDoc, no inline comments). Leave `client.ts`'s existing module header as it is, and add no new
comments there.

1. **`packages/frontend/src/api/client.ts`**
   - Keep `ACCOUNT_SUSPENDED`. Add
     `export type SessionEndReason = "expired" | "unauthorized" | "suspended";`.
   - Replace `accountSuspendedListeners` / `subscribeAccountSuspended` with
     `const sessionEndedListeners = new Set<(reason: SessionEndReason) => void>()` and
     `export function subscribeSessionEnded(listener: (reason: SessionEndReason) => void): () => void`,
     with the same add/delete shape.
   - Add a local `publishSessionEnded(reason)` that iterates `[...sessionEndedListeners]`.
   - In the `!response.ok` branch, before `throw new ApiError(...)`:
     - keep the existing predicate (`403 && message === ACCOUNT_SUSPENDED &&
requestIsAuthenticated(init)`) and publish `"suspended"`;
     - add `else if (response.status === 401 && requestIsAuthenticated(init))` and publish
       `"unauthorized"`.
       Both publish synchronously, before the throw. The thrown `ApiError` stays byte-identical.
       `requestIsAuthenticated` is unchanged. `apiFetch` never emits `"expired"`. That reason belongs
       to the timer, and it is in the union so subscribers have one reason vocabulary.
2. **`packages/frontend/src/api/index.ts`**: export `subscribeSessionEnded` instead of
   `subscribeAccountSuspended`, add `type SessionEndReason` to the type exports, and keep
   `ACCOUNT_SUSPENDED`.
3. **`packages/frontend/src/auth/useSessionEndSignOut.ts` (new)**, with header
   `// spec: docs/frontend/auth-components.md#session-module`. To avoid a barrel cycle, import
   `useAuthSession` from `./useAuthSession`, `useAuthFlow` from `./AuthFlowContext`,
   `clearSession` and `readSession` from `./session`, `subscribeSessionEnded` and
   `type SessionEndReason` from `@/api`, `useToast` from `@/lib/toast`, and `useNavigate` from
   `@tanstack/react-router`.
   ```ts
   export function useSessionEndSignOut(): void;
   ```

   - `const navigate = useNavigate(); const toast = useToast(); const { open: openAuthFlow } =
useAuthFlow(); const { expiresAt } = useAuthSession();`
   - `const endSession = useCallback((reason: SessionEndReason) => { clearSession(); void
navigate({ to: "/", replace: true }); if (reason !== "suspended") toast.show({ id:
"session-expired", tone: "neutral", title: "Your session expired. Sign in again to
continue.", action: { label: "Sign in", onClick: () => openAuthFlow("sign-in") }, durationMs:
10_000 }); }, [navigate, toast, openAuthFlow]);`. All three dependencies are stable
     (`ToastProvider` memoises its API; `AuthFlowProvider.open` is a `useCallback` with `[]`).
     Even if one were not stable, re-arming would recompute the delay from the absolute
     `expiresAt`, so the timer cannot drift. The action follows the app's existing toast actions
     (`deposit.tsx`, `stake.tsx`): it only opens the sign-in screen. It does not dismiss the toast,
     which still auto-dismisses at 10 s and has its own dismiss button.
   - Subscription effect, deps `[endSession]`: `return subscribeSessionEnded((reason) => { if
(!readSession()) return; endSession(reason); });`. This is the #1465 once-guard.
   - Expiry effect, deps `[expiresAt, endSession]`:
     ```ts
     if (expiresAt === undefined) return;
     const delay = expiresAt - Date.now();
     if (delay > 2 ** 31 - 1) return;
     const id = setTimeout(() => endSession("expired"), Math.max(0, delay));
     return () => clearTimeout(id);
     ```
     There is no `readSession()` guard in the callback (A2). Name the cap as a module constant
     (`MAX_TIMEOUT_MS = 2 ** 31 - 1`) with no comment.
4. **`packages/frontend/src/auth/index.ts`**: replace
   `export { useSuspensionSignOut } from "./useSuspensionSignOut";` with
   `export { useSessionEndSignOut } from "./useSessionEndSignOut";`.
5. **`packages/frontend/src/routes/__root.tsx`**: import and call `useSessionEndSignOut()` in place
   of `useSuspensionSignOut()`. The JSX and the `// spec:` header stay as they are.
6. **Delete** `packages/frontend/src/auth/useSuspensionSignOut.ts` and
   `packages/frontend/src/auth/useSuspensionSignOut.test.tsx` (their cases are ported in Test
   Strategy 2).
7. Grep for leftovers: `rg "subscribeAccountSuspended|useSuspensionSignOut|accountSuspendedListeners"
--glob '!docs/exec-plans/completed/**'` must return nothing outside this plan.
8. Make the doc edits listed in Docs to Update.
9. Run the gates:
   - `yarn --cwd packages/frontend lint`
   - `yarn --cwd packages/frontend test`
   - `yarn --cwd packages/frontend build`
   - `npx tsx scripts/lint-docs.ts` from the repo root. The spec-size check counts
     `split("\n").length`, so `api-authorization-email.md` must stay at `wc -l` ≤ 199.

## Test Strategy

All tests are Vitest in `packages/frontend` (`TZ=UTC vitest run`). No new test infrastructure.

1. **`src/api/client.test.ts`**: rename the `subscribeAccountSuspended` describe block to
   `subscribeSessionEnded`. Keep every existing case, now asserting the listener receives
   `"suspended"`. Add:
   - an authenticated `401` (record headers) calls the listener once with `"unauthorized"`, and
     the rejection is still `ApiError` with `status === 401` and an unchanged message;
   - an authenticated `401` with `Headers` and with a tuple-array (`[["Authorization", "Bearer
t"]]`) header calls the listener, with case-insensitive key coverage as in the suspension
     cases;
   - a `401` with no `Authorization` (the `login` / `verify-otp` shape: `{ "Content-Type":
"application/json" }` or no `init`) does **not** call it;
   - a `401` through the real `login()` wrapper from `./auth` does **not** call it;
   - an authenticated `404` / `500` does not call it, and an authenticated `403` with another
     error body does not call it (existing case, kept);
   - an authenticated `403 account_suspended` publishes `"suspended"` only, never
     `"unauthorized"`;
   - after unsubscribe, the listener is not called.
2. **`src/auth/useSessionEndSignOut.test.tsx` (new)**. Mock `@tanstack/react-router`
   (`useNavigate` → spy), `@/api` (`subscribeSessionEnded` backed by a hoisted listener `Set`,
   with a `publish(reason)` helper), `@/lib/toast` (`useToast` → `{ show: spy, update, dismiss }`)
   and `./AuthFlowContext` (`useAuthFlow` → `{ open: spy, … }`). Use the real `session.ts` and
   `useAuthSession`.
   - Ported from `useSuspensionSignOut.test.tsx`:
     - `"suspended"` clears the session and navigates `{ to: "/", replace: true }` once;
     - two back-to-back publishes sign out once;
     - no stored session means a no-op;
     - unmount releases the subscription.
   - `"suspended"` shows **no** toast.
   - `"unauthorized"` clears, navigates once, and calls `show` once with `id: "session-expired"`,
     `tone: "neutral"`, the exact title, `action.label === "Sign in"` and `durationMs: 10000`.
     Calling `action.onClick()` calls `open("sign-in")`. A second publish does not call `show`
     again (the guard).
   - Timer, with `vi.useFakeTimers()` (Date included):
     - fires at `expiresAt`: `saveSession({ token, expires_in: 60 })`, render, advance 59 999 ms,
       nothing happens; advance 1 ms more, the session is cleared, navigation runs once, and
       `show` is called once with the toast payload;
     - re-arms on a new sign-in: render with session A (`expires_in: 60`), then
       `act(() => saveSession({ token: "jwt2", expires_in: 120 }))`, advance past 60 s, nothing
       happens; advance to 120 s, it fires once;
     - no session: render with nothing stored, advance 25 h, no navigation and no `show`;
     - clears on unmount: unmount before `expiresAt`, advance past it, no navigation;
     - respects the cap: `saveSession({ token, expires_in: 2 ** 31 / 1000 + 60 })`, advance 1 ms
       and then 1 s, no navigation and the session is still present;
     - a session already cleared by a 401 cancels the pending timer: publish `"unauthorized"`,
       advance past the old `expiresAt`, navigation still happened only once.
3. **`src/routes/-root.test.tsx`**, the end-to-end test through the real `RootLayout`. Wrap the tree
   as `<AuthFlowProvider><ToastProvider><RouterProvider/></ToastProvider></AuthFlowProvider>` (R1)
   in both existing cases, and keep their assertions. The #1465 case also asserts that no "Your
   session expired" text is rendered (suspension is silent). To make the Sign in assertion
   deterministic, stub `@/components/EmailAuthFlow` as `AuthFlowProvider.test.tsx` does, with a
   stub that renders `data-testid="email-auth-flow"` and `initialScreen` when `open`. Add:
   - **Token lapses**: `vi.useFakeTimers({ shouldAdvanceTime: true })`, `saveSession({ token,
expires_in: 60 })`, and `fetchMock` answers `getMyLp` with `404`. Render, and assert the
     header shows the account icon (no `topbar-sign-in-button`). Then
     `act(() => vi.advanceTimersByTime(60_000))`. Expect `readSession()` to be `null`,
     `topbar-sign-in-button` and `topbar-sign-up-button` to be present, the path to be `/`, and
     the text "Your session expired. Sign in again to continue." to be visible. Clicking the toast's
     `Sign in` button renders the auth-flow stub on the `sign-in` screen. Restore real timers in
     `afterEach`.
   - **Authenticated 401**: `fetchMock` answers `getMyLp` with `401`. Expect the session cleared,
     the header back on Sign In / Sign Up, and the same toast rendered once.
   - **Login 401 never fires**: no session, `fetchMock` answers `401`, call `login({ email,
password })` from `@/api` inside the rendered tree (or render and trigger nothing
     authenticated). Expect no toast and no navigation. Optional if Test Strategy 1 already covers
     the `login()` wrapper, so keep it only if cheap.
4. **`src/auth/AuthFlowProvider.setup.test.tsx`**: add a regression for A6 next to the existing
   #1465 case at line ~255. With an open `CompanyDocsModal` (LP with no documents), calling
   `act(() => clearSession())` unmounts the modal and `lpRead` returns to `"unknown"`, with no
   change to `AuthFlowProvider.tsx`.
5. **Suspension path unchanged**: covered by 1 (predicate and `"suspended"` reason), 2 (silent
   sign-out) and 3 (the existing #1465 root case, still passing).
6. **Not unit-tested**: real backend expiry and revocation. Both are covered by the user-stories doc
   for the QA pass.

## Docs to Update

1. **`docs/frontend/auth-components.md` § Session module**: rewrite the
   "**In-session forced sign-out (#1465)**" paragraph in place as "**Session end (#1465, #1473)**".
   It should cover:
   - `SessionEndReason` (`expired` | `unauthorized` | `suspended`) and
     `subscribeSessionEnded(listener)` replacing `subscribeAccountSuspended`;
   - `apiFetch` publishing `suspended` on the existing authenticated-403 predicate and
     `unauthorized` on an authenticated `401`, synchronously before the throw, across the three
     header shapes, and why a login or verify-otp 401 never matches (`authHeaders()` is empty
     without a session);
   - `useSessionEndSignOut()` mounted once by `RootLayout`. It owns the subscription (with the
     `readSession()` once-guard), the expiry timer (an effect keyed on
     `useAuthSession().expiresAt`, re-armed by each `saveSession`, skipped above `2 ** 31 - 1` ms,
     unguarded because `readSession()` is already `null` at that moment), and the one action set
     (`clearSession()` then navigate `/` with `replace`; wallets stay connected, so the visitor
     lands in home state 7 or the wallet-only Account variant);
   - the toast spec (id, tone, copy, action, 10 s), shown for `expired` and `unauthorized` only,
     with suspension still silent;
   - the A3 same-snapshot caveat and the R3 race, one sentence each.
     Also update the module's first paragraph: the sentence "`readSession()` returns `null` (clearing
     the key) once `expiresAt` has passed" should note that it does so without notifying, and that
     reactivity at `expiresAt` comes from the timer. In § AuthFlowProvider, add one sentence: its
     `token` effect is what resets setup and review state on any session end (#1473 regression
     test), and no separate reset call exists.
2. **`docs/product-specs/api-authorization-email.md` § Frontend**: the file is at 199 lines and lint
   errors above 200, so **fold the change into existing paragraphs, add no new section, and keep the
   net line count at or below zero.**
   - In "**Session storage.**", rewrap and replace "`readSession()` clears expired sessions; there
     is no refresh endpoint" with wording along these lines: "a timer at `expiresAt`, or an
     authenticated `401`, ends the session: clear the token, return to `/`, and show a neutral
     'Your session expired. Sign in again to continue.' toast with a Sign in action. Wallets stay
     connected. There is no refresh endpoint." Also update the exposed fields to
     `{ token, email, expiresAt, isAuthenticated, signOut }`.
   - In the "**Error copy**" line, keep the in-session 403 sentence (silent, no message) and
     re-point it at the shared session-end seam.
     Check with `wc -l` that the file is still ≤ 199.
3. **`docs/frontend/hooks.md`**: add a `useAuthSession` row (`@/auth`, alphabetically after
   `useApproval`). It has more than two consumers (`TopBar`, `AccountPage`, `useAccountPage`,
   `routes/index.tsx`, `routes/account.tsx`, `AuthFlowProvider`) and meets the inclusion criteria.
   The row describes the `{ token, email, expiresAt, isAuthenticated, signOut }` shape, same-tab
   `useSyncExternalStore` reactivity, and that expiry at `expiresAt` is made reactive by the
   root-only `useSessionEndSignOut` (link to `auth-components.md#session-module`). Do not add a row
   for `useSessionEndSignOut`: it has one call site, so the doc's criteria exclude it.
4. **`packages/frontend/src/api/README.md`**: retitle the section to
   "`ACCOUNT_SUSPENDED` / `subscribeSessionEnded(listener)`". It covers:
   - the reason union, including that `apiFetch` emits `suspended` and `unauthorized` but never
     `expired`;
   - the unchanged authenticated-request predicate;
   - the unchanged rejection;
   - the single subscriber, `auth/useSessionEndSignOut.ts`;
   - an updated code sample (`subscribeSessionEnded((reason) => …)`).
5. **`docs/frontend/account-page.md`** line ~329: rename `subscribeAccountSuspended` to
   `subscribeSessionEnded`. The wording stays the same otherwise; `/account` behaviour is unchanged.
6. **`docs/exec-plans/tech-debt-tracker.md` TD-135**: in the Gap paragraph, re-point
   "the global `subscribeAccountSuspended` seam" to `subscribeSessionEnded` (the `suspended` reason)
   and update the hook name if it is mentioned. Name references only: no status change and no new
   TD entry.
7. **`docs/user-stories/epic-1247/1473-session-expiry.md` (new)**, in the shape of
   `1362-header-auth-entry.md`, with Epic, Issue and Spec links and a scope note: no Figma frame;
   the toast is the shipped component (Figma `1497:95175` / `1497:95270` for the component itself);
   wallets stay connected by design (#1460). Each story has persona, pre-conditions, steps and
   expected outcomes:
   1. **Token lapses while on `/`.** Seed: sign in, then in DevTools set `pipeline.auth.session`'s
      `expiresAt` to `Date.now() + 60_000` and reload, because a direct `localStorage` edit does
      not notify. At about 60 s, with no reload, the header flips to Sign In / Sign Up and the
      neutral toast "Your session expired. Sign in again to continue." appears with a `Sign in`
      button. It auto-dismisses after about 10 s.
   2. **Lapse while on `/account`.** The visitor lands on `/` (`replace`, so Back does not return
      to the signed-in `/account`). With a wallet connected, home state 7 renders and the header
      keeps the account icon (wallet-only variant).
   3. **The toast's `Sign in` opens the sign-in screen.** Signing in again re-arms the timer (seed
      the expiry again and confirm a second toast).
   4. **Revoked or tampered token: an authenticated `401`.** Edit the stored `token` (append `x`)
      and reload. `GET /v1/lps/me` answers 401, and the result is one sign-out and one toast even
      with several requests in flight and retries (check the Network tab).
   5. **Wrong password on Sign In (`401` on `login`).** Only the form's "Incorrect email or
      password" appears: no toast and no navigation.
   6. **Mid-session suspension (`403 account_suspended`) is unchanged.** It stays silent: no toast,
      no modal. Cross-link `epic-1419/1465-suspended-account-signout.md` Story 2 rather than
      duplicating it.
   7. **The wallet stays connected after expiry.** After Story 1 with a wallet connected, `/account`
      shows the wallet-only variant, and a reload keeps the wallet connected.
8. **`docs/user-stories/index.md`**: add an Epic #1247 row after the `#1442` row:
   `| [#1473 Session expiry: sign the LP out when the token lapses](https://github.com/eq-lab/pipeline/issues/1473) | [1473-session-expiry.md](./epic-1247/1473-session-expiry.md) | Initial |`.
   On the `#1465` row (Epic #1419 table), change the status from `Initial` to `Amended by #1473`.
9. **`docs/user-stories/epic-1419/1465-suspended-account-signout.md`**: add a short
   "**Amended by #1473 (2026-10-13):**" note under the Spec links. The seam is now
   `subscribeSessionEnded` (reason `suspended`), and the subscriber is `useSessionEndSignOut`. The
   behaviour is unchanged: still silent, no toast, wallets not touched. Re-point the two in-body
   name references (Story 2 step 1, Story 4 step 1).
