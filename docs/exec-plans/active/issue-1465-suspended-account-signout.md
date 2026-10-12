# Issue #1465: Suspended (KYB-rejected) account: sign-in shows the 403 error; an already signed-in LP is signed out when the API returns 403 account_suspended

Source: https://github.com/eq-lab/pipeline/issues/1465

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419). Follow-up to
#1426 / PR #1463. The Issue body (rewritten 2026-10-12) supersedes the earlier same-day "keep
access, show contact details" note; backend issue #1464 is closed and the backend is unchanged.

## Scope

Backend behaviour is fixed and already shipped: a `Failed` KYB verdict sets
`accounts.status = 'Suspended'` (`LpRepo::decide_kyb`), and from that moment every bearer request
and both sign-in mint paths answer `403 {"error":"account_suspended"}`
(`packages/api/src/account_status.rs`, `auth.rs` — `docs/product-specs/kyb-lp-verification.md`,
`api-authorization.md`, `api-authorization-email.md`). This Issue is the frontend's reaction, in
`packages/frontend` only.

In scope:

1. **Sign-in (already shipped — keep).** `useEmailAuthFlow.handleSignInSubmit` maps a login `403`
   that is not `email_not_verified` to `formError` "This account is suspended. Contact support."
   Coverage already exists — `packages/frontend/src/components/EmailAuthFlow.test.tsx:209`
   ("403 suspended renders a form-level error, not the OTP screen", asserting the copy against an
   `ApiError(403, "account_suspended")`). No code change; the plan only re-points docs at it and
   adds the hook-level unit assertion listed under Test Strategy.
2. **In-session sign-out (new).** The first **authenticated** request that answers
   `403 account_suspended` clears the session (`clearSession()`), navigates to `/`
   (`replace: true`), and surfaces the same suspension copy. The header reverts to Sign In / Sign
   Up by itself through the shipped `useAuthSession` → `subscribeSession` reactivity (#1364) — no
   `TopBar`/`MobileNavMenu` change. One global seam in `src/api/client.ts`, one subscriber mounted
   once in `routes/__root.tsx`; no per-call-site handling.
3. **Unrelated 403s stay untouched.** A 403 whose body is not `account_suspended`, and any 403 on
   an **unauthenticated** request (login/signup/verify-otp/resend-otp carry no `Authorization`
   header), never signs anyone out.
4. **#1463's `/account` suspended stand-in — decision: KEEP as a defensive fallback.** Rule 2
   normally signs the LP out before the branch can render, so it stops being the realistic path,
   but it stays: it is shipped, tested code whose cost is one boolean plus a suppressed `Retry`,
   and it keeps `/account` correct if `useAccountPage` is ever mounted in a tree without the root
   subscriber (today: component tests) or if a future authenticated call site is added that the
   header sniff below does not recognise. `useAccountPage`'s literal `"account_suspended"` is
   re-pointed at the constant exported from `@/api` so there is one spelling. `account-page.md` and
   TD-135 are updated to say so.

Out of scope: backend; `TopBar`/`MobileNavMenu`/`AccountGlyph` (already reactive); home-state
derivation (`homeState.ts` — after a sign-out the home route renders the signed-out state, so the
`lpRead === "error"` → `"legacy"` branch is unchanged); wallet disconnection (a connected wallet is
not suspended — only the email session is cleared, and the wallet-only `/account` variant from
#1458 stays reachable); `packages/trustee` (its own `src/api/client.ts`, its own session store);
home state 6's `Failed` card, which stays unit-test-only (TD-135 remains true in substance, with
wording updated).

## Assumptions and Risks

- **`apiFetch` is the only network seam.** The ESLint `no-restricted-globals` rule forbids `fetch`
  outside `src/api/`, so a single hook in `client.ts` genuinely covers every call. Verified: the
  only authenticated calls in `packages/frontend` today are the five `lps.ts` functions, all of
  which spread `authHeaders()` into a plain-object `headers`.
- **Authenticated-request detection is a header sniff.** `requestIsAuthenticated(init)` must handle
  the three `HeadersInit` shapes (plain record, `Headers`, `[name, value][]`) case-insensitively;
  today only the record shape occurs. Risk: a future call site that attaches the bearer some other
  way (e.g. a `Request` object) would not be recognised — which is exactly why item 4 keeps the
  `/account` fallback. An alternative gate ("a session exists right now") was rejected: it would
  fire on a login 403 for a visitor who still holds a stale session.
- **Double-firing.** Several in-flight authenticated requests can 403 together (e.g.
  `AuthFlowProvider`'s `getMyLp` and `useAccountPage`'s `getMyLp` on `/account`). The subscriber
  returns early when `readSession()` is already `null`; because `clearSession()` is a synchronous
  `localStorage` removal performed by the first delivery, every later delivery no-ops. No timer, no
  "already fired" module flag that would have to be reset between tests.
- **Rejection-handler ordering.** The notification fires synchronously inside `apiFetch`'s
  `!response.ok` branch, before the `ApiError` is thrown, so each caller's own `catch` still runs
  afterwards: `AuthFlowProvider` will briefly `setSetup({ status: "error" })` and `useAccountPage`
  will set `readState: "error"` for the stale token. Both are then reset by their own
  `token`-keyed effects once the cleared session re-renders (`setSetup(null)`;
  `useAccountPage`'s reset effect). Assert the end state (`lpRead` back to `"unknown"`, no session)
  rather than the intermediate frame.
- **`AuthFlowProvider` sits above `RouterProvider`** (`main.tsx`), so it cannot call `useNavigate`.
  The subscriber therefore lives in `routes/__root.tsx`, which renders inside both the router and
  the provider. No test mounts `routes/__root.tsx` today (`TopBar.test.tsx` and
  `AccountDropdown.test.tsx` build their own `createRootRoute`), so adding a `useAuthFlow()` call
  there breaks nothing.
- **No Figma frame exists for this behaviour** (confirmed with the Issue). Copy is the shipped
  string; chrome is the shipped `SignInModal` `formError` slot. No visual verification step, and no
  `ux-tester` Figma comparison is possible or required for this Issue.

## Open Questions

1. **Where the suspension message is shown after the forced sign-out.** Proposed default: reopen
   the shipped sign-in modal on `/` with the message in `SignInModal`'s existing `formError` slot
   (a `role="alert"` paragraph, `SignInModal.tsx:100-113`) — it is the Issue's own first
   suggestion, needs no new component, and leaves the LP looking at the one surface that will
   repeat the same explanation if they try to sign in again. The alternative shipped pattern is a
   `useToast({ tone: "danger" })` entry (`role="alert"`, `aria-live="assertive"`), which is less
   intrusive but auto-dismisses after 5s (or needs `pending` + a manual dismiss action) and can be
   missed entirely. Confirm the modal, or say "toast" and step 6 swaps the surfacing call only —
   everything else in this plan is unchanged.

## Decision Log

- **2026-10-12 — Open Question 1 resolved: no message after the forced sign-out.** The user answered
  on the Issue: clear the session and return to `/` silently — no modal, no toast. The suspension
  copy ("This account is suspended. Contact support.") is shown only when the LP next tries to sign
  in, via the already-shipped login-403 path in `useEmailAuthFlow` (rule 1). Accordingly,
  `openSuspended()` (`AuthFlowContext`/`AuthFlowProvider`) and the `signInNotice` prop/effect
  (`EmailAuthFlow`/`useEmailAuthFlow`) described in steps 3, 5, 6, 7, 8 below are **not implemented**:
  `useSuspensionSignOut` only clears the session and navigates home. `SUSPENDED_ERROR_MESSAGE` is
  still exported from `useEmailAuthFlow.ts` (single source of the copy, now consumed by its own
  test file instead of the provider) and `ACCOUNT_SUSPENDED` is exported from `api/client.ts` (single
  source of the literal, consumed by `useAccountPage.ts`'s fallback). Steps 1, 2, 4, 9, 10 are
  implemented as planned; steps 3's hook body is simplified as shown below.

## Implementation Steps

Status: 1, 2, 4, 9, 10 implemented as planned; 3 implemented with the `openSuspended()` call removed
(see Decision Log); 5, 6, 7, 8 dropped (see Decision Log).

1. **[done]** **`packages/frontend/src/api/client.ts` — the one global 403 seam.**
   - Export `const ACCOUNT_SUSPENDED = "account_suspended"`.
   - Add a module-level `Set` of listeners and
     `export function subscribeAccountSuspended(listener: () => void): () => void` returning an
     unsubscribe (mirrors `auth/session.ts`'s `subscribeSession` shape).
   - Add a private `requestIsAuthenticated(init?: RequestInit): boolean` that returns `true` when
     `init.headers` carries an `authorization` key, case-insensitively, for all three `HeadersInit`
     shapes (`Headers` instance → `.has`, array → `some(([k]) => …)`, record → `Object.keys(…).some`).
   - In the existing `if (!response.ok)` branch, after the `payload`/`message` parse and **before**
     `throw new ApiError(...)`: when `response.status === 403 && message === ACCOUNT_SUSPENDED &&
     requestIsAuthenticated(init)`, notify every listener (iterate a copy of the set). The thrown
     `ApiError` is unchanged, so every existing caller keeps today's behaviour.
   - The mock layer returns before the real fetch and never produces a 403, so it is untouched.
2. **[done]** **`packages/frontend/src/api/index.ts`** — export `subscribeAccountSuspended` and
   `ACCOUNT_SUSPENDED` from the barrel.
3. **[done, simplified]** **`packages/frontend/src/auth/useSuspensionSignOut.ts` (new).** Implemented
   without `openSuspended` (dropped per the Decision Log):
   ```ts
   const navigate = useNavigate();
   useEffect(
     () =>
       subscribeAccountSuspended(() => {
         if (!readSession()) return;
         clearSession();
         void navigate({ to: "/", replace: true });
       }),
     [navigate],
   );
   ```
   Exported from `auth/index.ts`.
4. **[done]** **`packages/frontend/src/routes/__root.tsx`** — replaced the inline arrow `component`
   with a named `RootLayout()` function that calls `useSuspensionSignOut()` and returns today's
   `RiskBanner`/`TopBar`/`Outlet`/`Footer` tree unchanged. Kept the existing spec-pointer comment.
5. **[dropped — see Decision Log]** ~~`packages/frontend/src/auth/AuthFlowContext.ts`~~ — no
   `openSuspended()` seam added; `AuthFlowContextValue` is unchanged.
6. **[dropped — see Decision Log]** ~~`packages/frontend/src/auth/AuthFlowProvider.tsx`~~ — no
   `signInNotice` state, no `openSuspended` callback; `<EmailAuthFlow />` is rendered unchanged.
7. **[partially done]** **`packages/frontend/src/components/useEmailAuthFlow.ts`** — exported the
   existing `SUSPENDED_ERROR_MESSAGE` constant (single source of the copy), now consumed by this
   file's own test (rule 1 hook-level assertion) rather than by a provider. The `signInNotice` option
   and effect are dropped — see Decision Log.
8. **[dropped — see Decision Log]** ~~`packages/frontend/src/components/EmailAuthFlow.tsx`~~ — no
   `signInNotice` prop added.
9. **[done]** **`packages/frontend/src/components/account/useAccountPage.ts`** — kept the suspended
   branch; changed `isAccountSuspended` to compare against `ACCOUNT_SUSPENDED` imported from `@/api`
   instead of the inline literal. No behaviour change.
10. **[done]** **`packages/frontend/src/api/README.md`** — documented `subscribeAccountSuspended` /
    `ACCOUNT_SUSPENDED` in the module's public surface next to the existing `login` 403 note,
    including the "authenticated requests only" rule.

## Test Strategy

All under `packages/frontend` (`yarn test`, Vitest + jsdom + Testing Library).

1. **`src/api/client.test.ts`** (extend; `fetch` is already stubbed globally):
   - authenticated (`headers: { Authorization: "Bearer t" }`) 403 with body
     `{"error":"account_suspended"}` → subscriber called exactly once, **and** `apiFetch` still
     rejects with `ApiError` `status: 403`, `message: "account_suspended"`.
   - same response but **no** `Authorization` header (the login shape) → subscriber not called.
   - authenticated 403 with a different body (`{"error":"forbidden"}`) and with a non-JSON body →
     subscriber not called.
   - authenticated `401` and `500` → subscriber not called.
   - `Headers` instance and `[name, value][]` header forms, and a lowercase `authorization` key,
     are all recognised.
   - the returned unsubscribe stops further delivery; two subscribers both receive one call.
2. **`src/auth/useSuspensionSignOut.test.tsx`** (new; implemented). `useNavigate` is mocked
   (`vi.mock("@tanstack/react-router", …)`) and `@/api`'s `subscribeAccountSuspended` is replaced by a
   test-owned listener set, so notifications are triggered directly without going through a real
   fetch:
   - with a saved session, one notification → `readSession()` is `null`, `navigate` called once with
     `{ to: "/", replace: true }`.
   - **two notifications back-to-back** (the concurrent-403 case) → `navigate` called exactly once.
   - with **no** session → nothing called, no navigation.
   - unmount → the subscription is released (a later notification does nothing).
3. **[dropped — see Decision Log]** ~~`src/auth/AuthFlowProvider.test.tsx` `openSuspended` /
   `signInNotice` coverage~~ — not implemented, since `openSuspended` was never added.
4. **`src/auth/AuthFlowProvider.setup.test.tsx`** (extended, implemented): a new test in the "LP read
   state published via context" block rejects `getMyLp` with `ApiError(403, "account_suspended")`,
   waits for `lpRead === "error"`, then calls `clearSession()` directly (standing in for
   `useSuspensionSignOut`'s effect) and asserts `lpRead` resets to `"unknown"` — i.e. the provider's
   own `"error"` write for the stale token does not survive a cleared session.
5. **[dropped — see Decision Log]** ~~`src/components/EmailAuthFlow.test.tsx` `signInNotice`
   coverage~~ — not implemented. The existing `403 account_suspended` login test (line 209) stays
   untouched — that is rule 1's coverage.
6. **`src/components/useEmailAuthFlow.test.ts`** (extended, implemented; rule 1 at hook level): a
   login rejection of `ApiError(403, "account_suspended")` sets `signInFormError` to
   `SUSPENDED_ERROR_MESSAGE` and leaves `screen` on `"sign-in"`, while
   `ApiError(403, "email_not_verified")` routes to `"otp"` with no `signInFormError` — locking the
   branch that distinguishes the two 403s.
7. **`src/components/account/useAccountPage.test.tsx` / `AccountPage.test.tsx`** — unchanged; they
   keep proving the defensive fallback still renders the declined copy with `Retry` suppressed when
   the page is mounted without the root subscriber.
8. **`src/routes/-root.test.tsx`** (new; end-to-end, not in the original plan). Mounts the real
   `Route` from `routes/__root.tsx` (`RootLayout` + `TopBar`) inside a real `AuthFlowProvider`, with
   global `fetch` stubbed so `getMyLp` actually goes through `apiFetch`: a signed-in render that hits
   a `403 account_suspended` on `/v1/lps/me` ends with the session cleared, the header showing
   Sign In / Sign Up, no `dialog` role, no `alert` role, and the router still on `/`. A second case
   confirms an unrelated 403 (`{"error":"forbidden"}`) leaves the session intact.
9. **Gates:** `yarn workspace @pipeline/frontend test`, `yarn workspace @pipeline/frontend lint`,
   `yarn workspace @pipeline/frontend build`, and `npx tsx scripts/lint-docs.ts` (AGENTS.md).
   Comment-minimal code throughout: at most one 2-3-line spec-pointer header per new file, no test
   comments.

## Docs to Update

- **`docs/frontend/auth-components.md`**
  - `### Session module` — new paragraph: the `subscribeAccountSuspended` seam in `api/client.ts`
    (authenticated requests only, `account_suspended` body only), `useSuspensionSignOut` mounted
    once in `routes/__root.tsx`, the `readSession()` dedupe for concurrent 403s, `clearSession()` →
    `/` (`replace: true`) → suspension copy, and the explicit "an unrelated 403 does not sign the
    LP out" rule.
  - `### AuthFlowProvider` / `### EmailAuthFlow` — **[dropped — see Decision Log]**: no
    `openSuspended()` / `signInNotice` plumbing exists, so neither section gains new prose beyond
    the Session module paragraph above. A one-line note added to the sign-in `formError` description
    instead, pointing at the session-module paragraph for the mid-session case.
- **`docs/frontend/account-page.md`** — the two declined-stand-in passages (the paragraph ending
  "in practice unreachable while a `Failed` verdict suspends the account (tech debt)", ~line 59, and
  "The declined stand-in (#1426, also no designed frame)", ~lines 314-330): the 403 path is no
  longer "the realistic path" — #1465 signs the LP out before `/account` can render it; the branch
  is retained as a defensive fallback and its copy/`Retry` suppression are unchanged. Link to
  `auth-components.md#session-module`.
- **`docs/product-specs/api-authorization-email.md` → `## Frontend`** — new short paragraph
  "**403 `account_suspended`**": both sides of the rule (sign-in form error; in-session forced
  sign-out to `/` with the same copy, from one global seam, authenticated requests only). Keep the
  file under the 150-line warn / 200-line error budget of `scripts/lint-docs.ts` (currently 198
  lines — fold the new text into the existing **Error copy** paragraph rather than adding a block,
  and do not grow the file).
- **`docs/frontend/bank-transfers.md`** (~line 203) — the `declined` bullet's parenthetical "403 on
  every bearer request, routing the home read to `"legacy"` instead" is now wrong: the LP is signed
  out, so the home route renders the signed-out state. One-line accuracy fix.
- **`docs/user-stories/epic-1419/1465-suspended-account-signout.md`** (new, following the
  `1460-home-wallet-only-state.md` header format, with a "no Figma frame exists for this behaviour"
  scope note): Story 1 — a suspended LP signing in sees the message on the sign-in form and no
  session is created. Story 2 — a signed-in LP whose account is suspended mid-session is signed out
  on the next authenticated request: header reverts to Sign In / Sign Up, the app lands on `/`
  silently (no modal, no toast). Story 3 — the same from `/account` (the page does not linger on the declined
  stand-in). Story 4 — an unrelated 403 leaves the session intact. Story 5 — two authenticated
  requests 403ing together sign out once.
- **`docs/user-stories/index.md`** — add the #1465 row to the Epic #1419 table (status `Initial`),
  required by the linter's reachability rule.
- **`docs/exec-plans/tech-debt-tracker.md` → TD-135** — update **Gap** and **Impact**: after #1465
  no authenticated surface renders the declined copy at all (the `useAccountPage` 403 stand-in is
  demoted to a defensive fallback); a `Failed` LP is signed out and sees "This account is suspended.
  Contact support." The suggested fix (a product/backend decision about whether `Failed` should
  suspend) is unchanged.
- **`packages/frontend/src/api/README.md`** — see Implementation step 10.
