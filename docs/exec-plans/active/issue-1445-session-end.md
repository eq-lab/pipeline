# Issue #1445: Session end: one path that reacts to token expiry, 401, and account suspension, and disconnects wallets

Source: https://github.com/eq-lab/pipeline/issues/1445

Parent epic: #1247 (KYB login flow). Supersedes #1364 (expiry not reactive), #1391 (mid-session
suspension), #1440 (wallet stays connected after sign-out).

Branch/worktree: `feat/session-end` at `/Users/luiza/Projects/pipeline-feat-session-end`, cut from
`main` after #1469 (/#1465) and #1466 (/#1458) merged.

No Figma frame exists for anything in this Issue. The only new visual is a toast, and `Toast` is a
shipped, Figma-verified component (`docs/frontend/ui-components.md#toast`) — there is no new
pixel-verification step, only the copy/tone decision recorded below.

## What already shipped (do not re-plan)

Verified in the worktree on 2026-10-12, per the manager's Issue comment:

- **Disconnect control on `/account`** — #1458 / PR #1466. `AccountWalletCard` renders a divider +
  `Disconnect` row in every connected state, wired to `useActiveWalletAccount().disconnect` (active
  namespace). `useWalletPresence().disconnectAll()` exists and is used by the wallet-only `Log Out`.
  TD-111 is already marked RESOLVED in the tracker. **Nothing to build; nothing to re-document.**
- **Trigger 3 (suspension)** — #1465 / PR #1469. `packages/frontend/src/api/client.ts` exports
  `ACCOUNT_SUSPENDED` + `subscribeAccountSuspended`, fired synchronously before the `ApiError` is
  thrown, only for `403` + `error === "account_suspended"` + `requestIsAuthenticated(init)` (a
  case-insensitive `Authorization` sniff across the `Headers` / record / tuple-array shapes).
  `auth/useSuspensionSignOut.ts` is the single subscriber, mounted once by `RootLayout`
  (`routes/__root.tsx`); it early-returns on `!readSession()`, then `clearSession()` + navigate `/`.
- **User decision 2026-10-12:** there is **no message and no dedicated "account closed" state**
  after a forced sign-out. The suspension copy appears only on the next sign-in attempt (already
  shipped in `useEmailAuthFlow`, "This account is suspended. Contact support."). The Issue body's
  "dedicated account closed state" paragraph is **superseded**. This Issue folds suspension into the
  shared path so it also disconnects wallets — it adds no notice.

## Scope

### In scope

One `endSession(reason)` path, four triggers routed through it, one toast.

1. **`packages/frontend/src/api/client.ts`** — generalise the #1465 seam:
   - `export type SessionEndReason = "expired" | "unauthorized" | "suspended" | "sign-out";`
   - replace `accountSuspendedListeners` / `subscribeAccountSuspended` with
     `sessionEndedListeners: Set<(reason: SessionEndReason) => void>` /
     `export function subscribeSessionEnded(listener: (reason: SessionEndReason) => void): () => void`.
   - fire `"suspended"` on the existing authenticated-403-`account_suspended` condition (unchanged
     predicate), and `"unauthorized"` on `response.status === 401 && requestIsAuthenticated(init)`.
   - keep `ACCOUNT_SUSPENDED`, keep the synchronous-before-throw ordering, keep the thrown
     `ApiError` byte-identical.
   - **Migrate** the one subscriber rather than keeping `subscribeAccountSuspended` as an alias —
     `useSuspensionSignOut` is being deleted in this Issue anyway, so an alias would ship dead.
2. **`packages/frontend/src/api/index.ts`** — swap the `subscribeAccountSuspended` export for
   `subscribeSessionEnded` and add `export type { SessionEndReason }`.
3. **`packages/frontend/src/auth/useEndSession.ts` (new)** — the shared path. Returns
   `(reason: SessionEndReason) => void`; the reason only selects the notice (handled by the caller),
   never the actions. Actions, in order: `clearSession()` → `disconnectAll()` →
   `navigate({ to: "/", replace: true })`.
4. **`packages/frontend/src/auth/useSessionEndTriggers.ts` (new, replaces
   `useSuspensionSignOut.ts`)** — mounted exactly once, by `RootLayout`. Owns:
   - the `subscribeSessionEnded` subscription, with the #1465 `if (!readSession()) return;` guard;
   - the expiry timer, a `useEffect` keyed on `useAuthSession().expiresAt`;
   - the toast, shown for `"expired"` and `"unauthorized"` only.
5. **`packages/frontend/src/auth/index.ts`** — export `useEndSession` and `useSessionEndTriggers`,
   drop `useSuspensionSignOut`.
6. **`packages/frontend/src/routes/__root.tsx`** — `useSessionEndTriggers()` in place of
   `useSuspensionSignOut()`.
7. **`packages/frontend/src/routes/account.tsx`** — `onLogOut` calls `endSession("sign-out")` for
   **both** variants, replacing the `isAuthenticated ? signOut() : disconnectAll()` branch and the
   local `navigate({ to: "/" })`.
8. **Delete** `packages/frontend/src/auth/useSuspensionSignOut.ts` and
   `auth/useSuspensionSignOut.test.tsx` (its four cases are ported, not dropped).
9. Tests and docs per the sections below, incl. the user-stories doc under
   `docs/user-stories/epic-1247/`.

### Out of scope

- Any "account closed" / suspension notice (superseded by the 2026-10-12 user decision).
- Any change to `AccountWalletCard`, `useActiveWalletAccount`, or the `Disconnect` row (#1458).
- Any change to `AuthFlowProvider.tsx`. See Assumption A3 — its existing `token` effect already
  performs the reset the Issue body asks for; this Issue adds a regression test, not code.
- Any change to `useWalletView` / `WalletViewContext`. See Assumption A4 and TD-138.
- Cross-tab session propagation (`storage` events). Still same-tab only, as documented.
- `/test?tab=auth`'s own `Sign out` button (`useAuthSession().signOut` → `clearSession`). The
  diagnostics seam is deliberately independent and must **not** disconnect wallets; leave it.
- A refresh-token / silent-renewal endpoint. There is none; expiry means sign-in again.
- TD-135 and TD-138 — reference updates only, no resolution.

## Assumptions and Risks

- **A1 — the publisher lives in `api/client.ts`, the timer does not.** The alternative (publisher in
  `auth/session.ts`, which `api/lps.ts` already deep-imports, with a module-level timer armed by
  `saveSession`) was considered and rejected: a module-level `setTimeout` would be armed by every
  one of the ~dozens of existing tests that call `saveSession(...)` and would survive
  `localStorage.clear()`, leaking across test files. A React effect is scoped to the mounted hook.
- **A2 — the timer re-arms through `useAuthSession`.** `saveSession` → `notify()` →
  `useSyncExternalStore` snapshot (the token string) changes → `useSessionEndTriggers` re-renders
  with the new `expiresAt` → the effect's cleanup clears the old timer and arms a new one. **Known
  hole:** `useSyncExternalStore` bails out when the snapshot is identical, so re-saving the *same*
  token with a *longer* expiry would not re-arm. Both `saveSession` call sites
  (`useEmailAuthFlow.ts:159` and `:242`) follow a `login`/`verify-otp` round-trip that always
  returns a fresh token, so this is unreachable today. Noted, not worked around.
- **A3 — `AuthFlowProvider` already resets itself.** Its `useEffect` on `token`
  (`AuthFlowProvider.tsx:36-68`) does `setSetup(null)` the moment the token goes away, which
  unmounts `CompanyDocsModal` and `AccountInReviewModal` (both token-keyed) and resets `lpRead` to
  `"unknown"`. The only state it does not reset is `isOpen`/`screen` for `EmailAuthFlow` — and that
  modal cannot be open when a session ends (a signed-in LP has no header entry to it, its own
  requests are unauthenticated so they never trigger 401/403, and `/test` is independent). So
  `useEndSession` deliberately does **not** take an `useAuthFlow()` dependency for `close()`; adding
  one would force every call site's test tree to mount `AuthFlowProvider` for no observable gain.
- **A4 — `useWalletView` is left alone on purpose.** After `disconnectAll()` nothing is connected in
  either namespace, so the persisted `pipeline.wallet.view.kind` changes nothing the user can see
  (home falls to the zero state, the header to Sign In / Sign Up). Resetting it would be a second
  write into exactly the surface TD-138 is about; not touching it cannot make TD-138 worse.
- **A5 — reload-does-not-reconnect comes free, and is verified, not implemented.** wagmi's
  `useDisconnect()` removes the connection from its persisted store, and
  `StellarWalletsKit.disconnect()` clears the kit's stored wallet id (plus
  `setStellarConnectionAddress(undefined)` for the in-memory store). #1440's observation 2 was about
  a path where *nothing* called disconnect. This is a user-story / manual check, not a unit test —
  jsdom cannot meaningfully assert wagmi's persistence.
- **R1 — `useToast()` throws outside `<ToastProvider>`.** `RootLayout` will now require it. In
  `main.tsx` the order is `AuthFlowProvider > WalletViewProvider > ToastProvider > RouterProvider`,
  so production is fine, but **`packages/frontend/src/routes/-root.test.tsx` renders `RootLayout`
  inside `AuthFlowProvider` only** and will start failing. That test must wrap `<ToastProvider>`.
  Check `-account.test.tsx` and `-account-route-dev-only.test.tsx` the same way — the account route
  gains `useEndSession()` (needs a router + `useWalletPresence`, both already mocked/provided there)
  but not `useToast`, so they should pass unchanged; verify, don't assume.
- **R2 — a stale-token 401 racing a fresh sign-in.** A request issued with an old token whose 401
  lands *after* a new session was saved would pass the `readSession()` guard and end the new
  session. Accepted: the window is sub-second and needs a sign-out/sign-in inside one in-flight
  request. Not worth threading the request's token through the seam.
- **R3 — `setTimeout` delays above `2 ** 31 - 1` ms (~24.8 days) fire immediately.** The effect must
  skip arming when `expiresAt - Date.now()` exceeds that, or a long-lived token would sign the LP
  out on the next render. Backgrounded tabs and laptop sleep can also fire the timer late; that is
  acceptable because `readSession()` already returns `null` past `expiresAt` and the 401 path is the
  backstop.
- **R4 — React Query retries multiply the 401.** `useRequests` and friends retry; every retry's 401
  re-fires the seam. The `readSession()` guard is what makes the sign-out happen once; the toast's
  fixed `id` makes it upsert rather than stack. Both must be in place together.
- **R5 — the trustee app is unaffected.** `packages/trustee/src/api/client.ts` is a separate
  `apiFetch`; a trustee 401 cannot reach the LP seam.

## Open Questions

- **Q1 — Does ending a session disconnect the wallet for *every* reason, or only for suspension?**
  The Issue body and #1440 say yes for all of them ("Sign-out ends the whole session"). But #1460
  shipped state 7 — connected wallet, no session — as a *designed* state with the account icon and a
  wallet-only `/account` variant, and the user has described the wallet as display-only. So a
  sign-out that keeps the wallet is now a legitimate landing state, and an expiry that silently
  disconnects a wallet is heavier than the trigger warrants. **Proposed default (what the plan is
  written to): all four reasons disconnect**, per the body — it makes both `/account` `Log Out`
  variants identical and satisfies "reload does not reconnect". **Override to consider:** only
  `"suspended"` disconnects; `"expired"` / `"unauthorized"` / `"sign-out"` clear the session and
  leave the visitor in state 7. If the human picks the override, only step 3 changes (gate
  `disconnectAll()` on the reason) plus the matching user stories.
- **Q2 — Toast copy and tone (no Figma).** **Proposed default:** `tone: "neutral"` (dark ink surface,
  check-circle icon, `role="status"`), title `"Your session expired. Sign in again to continue."`,
  action `{ label: "Sign in" }`, `durationMs: 10000`. Rationale: an expiry is not an error the LP
  caused, and `neutral` is the app's informational tone; the default 5 s is too short to reach an
  action button. **Override to consider:** `tone: "danger"` — red fill, alert icon,
  `role="alert"` + `aria-live="assertive"`, which is louder but more accessible for an interrupting
  message. Same copy either way unless the human changes it.

## Implementation Steps

1. **`packages/frontend/src/api/client.ts`.**
   - Add `export type SessionEndReason = "expired" | "unauthorized" | "suspended" | "sign-out";`
     next to `ACCOUNT_SUSPENDED`. The union is the app-wide vocabulary; `apiFetch` only ever emits
     two of its members (the other two are produced by the timer and by `/account`'s `Log Out`).
   - Replace `const accountSuspendedListeners = new Set<() => void>()` with
     `const sessionEndedListeners = new Set<(reason: SessionEndReason) => void>()`, and
     `subscribeAccountSuspended` with
     `export function subscribeSessionEnded(listener: (reason: SessionEndReason) => void): () => void`
     (same add/delete shape).
   - In the `!response.ok` branch, keep the existing suspension condition and emit `"suspended"`;
     add, as a sibling condition, `response.status === 401 && requestIsAuthenticated(init)` emitting
     `"unauthorized"`. Both notify synchronously before `throw new ApiError(...)`, both iterate a
     `[...sessionEndedListeners]` copy so a listener that unsubscribes mid-iteration is safe.
   - `requestIsAuthenticated` is unchanged. Note for the coder: `authHeaders()` returns `{}` when
     there is no session, so an unauthenticated `login`/`verify-otp` 401 can never satisfy the sniff
     — this is the structural reason a login 401 never signs anyone out.
   - Leave the file's existing module header comment as-is (it predates the comment-minimal rule and
     is the api module's documented entry point); add no new comments.
2. **`packages/frontend/src/api/index.ts`** — export `subscribeSessionEnded` from `./client` instead
   of `subscribeAccountSuspended`; add `export type { SessionEndReason } from "./client";`. Keep
   `ACCOUNT_SUSPENDED`.
3. **`packages/frontend/src/auth/useEndSession.ts` (new).** One spec-pointer header line
   (`// spec: docs/frontend/auth-components.md#session-module`), nothing else.
   ```ts
   export function useEndSession(): (reason: SessionEndReason) => void
   ```
   Body: `const navigate = useNavigate(); const { disconnectAll } = useWalletPresence();` then a
   `useCallback` that calls `clearSession()`, `disconnectAll()`, and
   `void navigate({ to: "/", replace: true })`. `clearSession()` is safe with no session (it also
   clears the account-setup dismissal flag); `disconnectAll()` is safe with nothing connected (it
   already guards per namespace). The `reason` parameter is accepted and ignored by the actions —
   it exists so call sites read correctly and so the notice decision has one place. Do **not**
   memoize on `disconnectAll` (a fresh function identity every render); use `useCallback` with
   `[navigate]` and read `disconnectAll` through a ref updated in an effect, or accept an unstable
   identity and make step 4's timer effect depend on a ref instead. Pick one and be consistent with
   step 4 — the timer must not re-arm on every render.
4. **`packages/frontend/src/auth/useSessionEndTriggers.ts` (new).** `useSessionEndTriggers(): void`,
   mounted once. Composes:
   - `const endSession = useEndSession();`, `const toast = useToast();`,
     `const { open: openAuthFlow } = useAuthFlow();`, `const { expiresAt } = useAuthSession();`
   - a local `run(reason)` that calls `endSession(reason)` and, for `"expired"` / `"unauthorized"`
     only, `toast.show({ id: "session-ended", tone: "neutral", title: "Your session expired. Sign in
     again to continue.", action: { label: "Sign in", onClick: () => openAuthFlow("sign-in") },
     durationMs: 10000 })` (see Q2). The fixed `id` upserts, so repeated triggers never stack.
   - **subscription effect:** `subscribeSessionEnded((reason) => { if (!readSession()) return;
     run(reason); })`, returned as the cleanup — the #1465 shape, with the same guard. This is the
     double-fire guard for several in-flight 401/403s.
   - **expiry effect**, deps `[expiresAt, …]`:
     ```
     if (expiresAt === undefined) return;
     const delay = expiresAt - Date.now();
     if (delay > 2_147_483_647) return;               // R3
     const id = setTimeout(() => run("expired"), Math.max(0, delay));
     return () => clearTimeout(id);
     ```
     Keep the latest `run` in a ref (updated in its own effect) so the deps stay `[expiresAt]` and
     the timer is armed once per session, not once per render. **Never call `notify()` from inside
     `readSession()`** — nothing in this step does; the notification comes from `clearSession()`
     inside `endSession`, which runs in a timer callback, not in `getSnapshot`.
   - This hook is the only owner of the expiry timer. When it fires, `clearSession()` → `notify()`
     re-renders every `useAuthSession` consumer, so the header and `/account` react at `expiresAt`
     without each needing its own timer (#1364's ask, satisfied from one place).
5. **`packages/frontend/src/auth/index.ts`** — add `useEndSession`, `useSessionEndTriggers`, and
   `export type { SessionEndReason }` re-exported from `@/api` if call sites need it; remove the
   `useSuspensionSignOut` line.
6. **`packages/frontend/src/routes/__root.tsx`** — replace the import and the call with
   `useSessionEndTriggers()`. Leave the `// spec:` header and the JSX untouched.
7. **`packages/frontend/src/routes/account.tsx`** — `const endSession = useEndSession();`; the
   `AccountPage` prop becomes `onLogOut={() => endSession("sign-out")}`. Drop the
   `isAuthenticated ? signOut() : disconnectAll()` branch, the local `navigate({ to: "/" })` for
   log-out, and the now-unused `signOut` / `disconnectAll` destructures — but **keep**
   `isAuthenticated`, `isAnyConnected` and `isSettled`, which the route gate still needs, and keep
   the gate's own `navigate` effect.
8. **Delete** `packages/frontend/src/auth/useSuspensionSignOut.ts` and
   `packages/frontend/src/auth/useSuspensionSignOut.test.tsx`.
9. **Docs** — see "Docs to Update".
10. **Lint and build.** `yarn --cwd packages/frontend lint`, `yarn --cwd packages/frontend test`,
    `yarn --cwd packages/frontend build`, and `npx tsx scripts/lint-docs.ts` from the repo root.

## Test Strategy

All Vitest, all in the frontend package (`TZ=UTC vitest run`). No new test infrastructure.

1. **`packages/frontend/src/api/client.test.ts`** — rename the `subscribeAccountSuspended` describe
   block to `subscribeSessionEnded` and keep every existing case, asserting the listener is now
   called with `"suspended"`. Add:
   - authenticated `401` (an `Authorization` header present) → listener called once with
     `"unauthorized"`; the rejection is still an `ApiError` with `status === 401` and an unchanged
     message;
   - `401` with **no** `Authorization` header (the `login` / `verify-otp` shape) → **not** called;
   - `401` across all three header shapes (`Headers`, record, tuple array) → called, mirroring the
     existing suspension coverage;
   - an authenticated `404` / `500` → not called;
   - an authenticated `403` with a different error body → still not called (existing case, retained).
2. **`packages/frontend/src/auth/useEndSession.test.tsx` (new).** `useNavigate` mocked as in
   `useSuspensionSignOut.test.tsx`; `@/wallet`'s `useWalletPresence` mocked with a spy
   `disconnectAll`. Cases: clears a saved session; calls `disconnectAll()` once; navigates
   `{ to: "/", replace: true }`; is a safe no-op shape with no session and nothing connected (no
   throw, `disconnectAll` still called once); behaves identically for all four reasons (the reason
   selects no action).
3. **`packages/frontend/src/auth/useSessionEndTriggers.test.tsx` (new).** Ports the four
   `useSuspensionSignOut` cases onto the new seam (sign-out happens once on notification; twice
   back-to-back still signs out once; no-op with no stored session; unsubscribes on unmount), plus:
   - **timer:** `vi.useFakeTimers()`, `saveSession({ token, expires_in: 60 })` before render,
     advance 59 999 ms → nothing; advance past 60 000 ms → session cleared, `disconnectAll` called,
     navigated once;
   - **re-arm:** render, `act(() => saveSession({ token: "jwt2", expires_in: 120 }))` after the
     first session, advance past the *first* expiry → nothing happens; advance to the second → fires
     once;
   - **no session → no timer:** render with nothing stored, advance a day → no navigation;
   - **unmount clears the timer:** unmount before `expiresAt`, advance past it → no navigation;
   - **R3 cap:** a session whose `expiresAt` is more than `2 ** 31 - 1` ms away does not fire on the
     next tick;
   - **toast:** shown exactly once (same `id`) for `"expired"` and for `"unauthorized"`; **not**
     shown for `"suspended"`; its action calls `useAuthFlow().open("sign-in")`. Mock `useToast` with
     a spy `show` and assert the `id`/`tone`/`title`/`action.label` payload.
4. **`packages/frontend/src/routes/-root.test.tsx`** — wrap the rendered tree in `<ToastProvider>`
   (R1). Keep the existing #1465 assertion (a `403 account_suspended` on an authenticated request
   clears the session and shows no modal/alert) and add: the same flow now also calls
   `disconnectAll()` and still renders **no toast** (query by the toast's title text and assert
   absent). Add a sibling case for an authenticated `401`: session cleared, `disconnectAll()`
   called, and the session-expired toast **is** rendered with a `Sign in` action.
5. **`packages/frontend/src/auth/AuthFlowProvider.test.tsx`** — add (or extend the #1465 case) a
   regression that proves A3: with a session and a loaded LP, clearing the session resets `lpRead`
   to `"unknown"` and unmounts the setup/review modals, with no change to `AuthFlowProvider.tsx`.
6. **`packages/frontend/src/routes/-account.test.tsx`** — add a `Log Out` case for both variants:
   signed-in → session cleared **and** `disconnectAll()` called (the behaviour change) and navigated
   to `/`; wallet-only (no session) → `disconnectAll()` called and navigated. If Q1 is answered with
   the override, invert the signed-in assertion to "`disconnectAll` not called".
7. **Not unit-tested, by design:** reload-does-not-reconnect (A5) and the real backend 401/403 —
   both covered by the user-stories doc for the QA pass.

## Docs to Update

1. **`docs/frontend/auth-components.md` § Session module** — rewrite the existing
   "**In-session forced sign-out (#1465)**" paragraph into "**Ending a session (#1445)**", in place:
   the four reasons, the one `useEndSession` path (clear session → disconnect every connected
   namespace → navigate `/` with `replace`), `subscribeSessionEnded` replacing
   `subscribeAccountSuspended` (now also firing on an authenticated 401), the expiry timer owned by
   `useSessionEndTriggers` and re-armed through `useAuthSession().expiresAt`, the `readSession()`
   double-fire guard, the toast for expiry/401 only, and the restated "no notice for suspension —
   the copy appears on the next sign-in". Keep the existing cross-reference to the login-403 path.
   Also update the § AuthFlowProvider paragraph with one sentence recording A3 (the `token` effect
   is what resets setup/review state on session end — no separate reset call).
2. **`docs/product-specs/api-authorization-email.md` § Frontend** — the file is at 199 lines; **fold
   into the existing paragraphs, add no new section.** Extend "**Session storage.**" with: a timer
   at `expiresAt` ends the session the moment the token lapses (no refresh endpoint); an
   authenticated `401` ends it once, handled in the API client, never per screen; ending a session
   clears the token, disconnects connected wallets, and returns to `/`; expiry and 401 show a
   session-expired toast with a Sign in action, suspension and explicit sign-out show nothing.
   Amend the "**Error copy**" line about the in-session 403 so it points at the shared path rather
   than the suspension-only seam.
3. **`docs/frontend/account-page.md`** — § Route gate: `onLogOut` no longer branches on
   `isAuthenticated`; both variants call `endSession("sign-out")`. § Wallet-only variant: the
   `Log Out` paragraph ("The signed-in variant's `Log Out` is unchanged … the wallet, if any, is
   left connected") is now wrong — the two variants behave identically; the `Disconnect` row remains
   the way to drop a wallet *without* ending the session. Line ~329's
   `subscribeAccountSuspended` mention → `subscribeSessionEnded`.
4. **`docs/frontend/hooks.md`** — add a `useEndSession` row (import path `@/auth`), alphabetically
   placed: the shared end-session path, its three actions, its two call sites (`RootLayout` via
   `useSessionEndTriggers`, and the `/account` route's `Log Out`), and the note that the reason
   selects the notice, not the actions. `useSessionEndTriggers` is root-only/single-call-site, so by
   the doc's own inclusion criteria it does **not** get a row — it is described in
   `auth-components.md` instead.
5. **`packages/frontend/src/api/README.md`** — replace the
   "`ACCOUNT_SUSPENDED` / `subscribeAccountSuspended(listener)`" section with
   "`ACCOUNT_SUSPENDED` / `subscribeSessionEnded(listener)`": the reason union, which two members
   `apiFetch` emits and which two it never does, the unchanged authenticated-request predicate, the
   unchanged rejection, and the new single subscriber (`auth/useSessionEndTriggers.ts`).
6. **`docs/exec-plans/tech-debt-tracker.md`** — TD-135's Gap paragraph names
   `subscribeAccountSuspended` and `useSuspensionSignOut`; re-point both to the new names and widen
   "the in-session `account_suspended` 403" to "the shared session-end path". **Do not** change
   TD-135's status — it remains a backend/product decision. TD-111 is already RESOLVED; leave it.
   TD-138 is untouched (A4). Add no new TD entries unless the coder actually takes a shortcut.
7. **`docs/user-stories/epic-1247/1445-session-end.md` (new)** — follow the shape of
   `1362-header-auth-entry.md`. Stories to cover, each with persona / pre-conditions / steps /
   expected outcomes:
   1. Token expiry while idle on `/` — at `expiresAt` the header flips to Sign In / Sign Up with no
      reload, the wallet disconnects, and the session-expired toast appears with a `Sign in` action.
   2. The toast's `Sign in` action opens the sign-in screen of the auth modal.
   3. An authenticated request answering `401` (revoked token) — one sign-out, one toast, even when
      several requests are in flight.
   4. A failed sign-in (`401` on `login`) does **not** sign anyone out and shows only the form's
      "Incorrect email or password" — the unauthenticated-request case.
   5. Mid-session suspension (`403 account_suspended`) — session cleared, wallets disconnected,
      lands on `/`, **no toast and no modal**; the suspension copy appears only on the next sign-in
      attempt. (Supersedes `epic-1419/1465-suspended-account-signout.md` stories 1–2 — cross-link
      rather than duplicate, and add an "Amended by #1445" note at the top of that doc.)
   6. An unrelated authenticated `403` does not end the session.
   7. `Log Out` on `/account` (signed in) — session cleared, wallet disconnected, header reverts,
      `/account` unreachable again. (Adjust if Q1 is overridden.)
   8. `Log Out` on the wallet-only `/account` variant — unchanged behaviour, now through the same
      path.
   9. Reload after any of the above does not reconnect the wallet (EVM via wagmi's persisted store,
      Stellar via the kit) — the A5 check.
   10. `/test?tab=auth`'s own `Sign out` still only clears the session and leaves the wallet
       connected (the seam stays independent).
   Note at the top: no Figma frame exists for any of this; the toast is the shipped `Toast`
   component, so the QA Figma comparison applies only to that component's own frames
   (`1497:95175`, `1497:95270`).
8. **`docs/user-stories/index.md`** — add the row to the Epic #1247 table (after the `#1442` row):
   `[#1445 Session end: …](…/issues/1445)` → `[1445-session-end.md](./epic-1247/1445-session-end.md)`
   → `Initial`.
9. **`docs/user-stories/epic-1419/1465-suspended-account-signout.md`** — a short "Amended by #1445
   (2026-10-12)" note at the top: the suspension trigger now runs through the shared end-session
   path and also disconnects wallets; the no-message decision is unchanged; the seam is named
   `subscribeSessionEnded`.
