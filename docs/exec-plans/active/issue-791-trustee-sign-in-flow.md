# Issue #791: Trustee: sign-in flow — wallet-connect wiring + session + route gating

Source: https://github.com/eq-lab/pipeline/issues/791

> **Revised 2026-07-08.** The prior plan assumed client-side auth with no backend
> token and left five Open Questions. Those are now resolved by the **backend auth
> contract** (`packages/api/src/routes/auth.rs`, spec `docs/product-specs/api-authorization.md`).
> Auth is a **server-side signature-challenge (SIWE-style) flow that issues a JWT**.
> The plan is rewritten around it. See the Decision Log for the resolved answers.

## Scope

Turn the UI-only Trustee sign-in (shipped by #787) into a working, backend-authenticated
sign-in flow:

- Wire the `SignInCard` "Connect Wallet" button (currently a `TODO(#778)` no-op, tech-debt
  **TD-34**) to the full flow: **connect wallet → `GET /v1/auth/challenge` → sign the returned
  message → `POST /v1/auth/verify` → store the returned JWT → redirect to the dashboard**.
- Establish an authenticated **session** for the trustee app, backed by the backend-issued
  **JWT bearer token**, exposed via a React context/provider and readable outside React (for
  router gating).
- Add a trustee **`apiFetch`** that attaches `Authorization: Bearer <token>` and centralises
  the API base URL (the trustee has no API client today).
- Extract a **minimal shared wallet-connect slice** (approach (a)): connect/disconnect +
  connected address/chain + a picker modal + provider mounting, **plus a net-new
  `signMessage` capability** for both EVM and Stellar (neither exists in the LP layer today).
- Add **route gating**: unauthenticated → `/sign-in`; authenticated → dashboard; a
  **sign-out** control clears the session and returns to `/sign-in`.
- Handle the backend **401 "address is not authorized"** as an explicit error state on the
  sign-in card (server owns the authorization list; there is **no** client-side on-chain
  `TRUSTEE`-role read).
- Remove the TD-34 deferral once wired; reinstate the TD-33 eslint boundary.

**Out of scope** (unchanged from #791 / #453): per-flow business logic (Types 1–4: #779–#782),
the dashboard shell content (#786), 2FA, operator onboarding, and the LP first-connection
**terms gate** (explicitly omitted — see Decision Log).

## Authoritative auth model (resolved)

From `packages/api/src/routes/auth.rs` + `docs/product-specs/api-authorization.md`:

1. **Challenge.** `GET /v1/auth/challenge?address=<0x… | G…>&chain_id=<optional>` →
   `200 { message: string, nonce: string }`. `chain_id` defaults to the server's
   `DEFAULT_CHAIN_ID` when omitted; we send it explicitly (the connected wallet's chain).
   The address must be on the server allow-list (`auth_users`) — an unknown address returns
   **`401` "address is not authorized"**. The nonce is single-use, persisted server-side, and
   embedded in `message`.
2. **Sign.** The wallet signs `message`'s raw UTF-8 bytes:
   - EVM → EIP-191 `personal_sign`; signature sent as **hex** (optional `0x`).
   - Stellar → SEP-0053 `signMessage` (e.g. Freighter); signature sent as **base64**
     (Stellar-native) or hex.
   The `message` is a deliberately **single-line** string (no newlines) — sign the decoded
   value, not any JSON-escaped form.
3. **Verify.** `POST /v1/auth/verify` with body `{ chain_id?: number, address: string,
   signature: string }` → `200 { token: string, expires_in: number }`. On success the
   server clears the nonce (single-use, no replay) and returns an **ES256 JWT** carrying
   `sub` (address), `chain_id`, `roles`, `iat`, `exp`. `expires_in = 86400` (24h).
   `401` for unknown address, no outstanding challenge, or bad signature.
4. **Authorize.** Send the token as **`Authorization: Bearer <jwt>`** on protected endpoints
   (e.g. `GET /v1/loan-book/submissions` requires the `trustee` role → `403` if the token
   lacks it). #791 only needs to obtain and store the token + gate routes; wiring protected
   trustee data calls is later flow work (#779–#782).

**Session transport (from the code): bearer token, client-held.** The backend issues a JWT
string and expects it back in the `Authorization` header — there is **no** `Set-Cookie`, no
cookie/session middleware, and no `me`/`refresh`/`logout` endpoint in `auth.rs` (the only
routes are `GET /auth/challenge` and `POST /auth/verify`). Therefore:

- The client stores the token itself and attaches it as a bearer header. Sign-out is purely
  client-side (drop the stored token + disconnect the wallet); there is no server logout to call.
- "Session validity" is derived from token presence + `exp` (decode the JWT `exp`, or track
  `issued_at + expires_in`); an expired token → treat as unauthenticated. A `401` from any
  protected call also drops the session back to unauthenticated.
- **Storage choice:** persist in `sessionStorage` under a single key (e.g.
  `pipeline.trustee.session` → `{ token, address, chainId, expiresAt }`). `sessionStorage`
  (not `localStorage`) so the JWT does not outlive the browser tab — a reasonable default for
  an internal-operator bearer token, and it still survives in-tab reloads so route gating works
  across refreshes. (This is the one place the code left a genuine choice; see Open Questions —
  it is resolved to `sessionStorage`, not left open, because the backend dictates client-held
  bearer and nothing else constrains it.)

## Assumptions and Risks

- **`signMessage` is net-new on both chains.** The LP wallet layer exposes connect/disconnect/
  address and (Stellar-only) `signTransaction`, but **no message signing**. EVM has zero
  `personal_sign`/`useSignMessage` usage; Stellar's `useStellarWallet` wraps `signTransaction`
  only (the kit's `StellarWalletsKit.signMessage` SEP-0053 method exists but is unused). This
  plan adds thin `signMessage` wrappers in the extracted slice for both stacks. This is the
  single biggest driver of effort now (was previously the `hasRole` read, which is **dropped** —
  authorization is server-side).
- **No `apiFetch` / token plumbing anywhere.** The LP `apiFetch`
  (`packages/frontend/src/api/client.ts`) does **not** attach an `Authorization` header, and the
  trustee has no API client at all. The trustee needs a net-new `apiFetch` that reads the base
  URL from `@/lib/env` and injects the bearer token from the session.
- **Provider tree.** Trustee `main.tsx` currently mounts **no** providers. Adding the wallet
  provider(s) (EVM: `WagmiProvider` + `QueryClientProvider`; Stellar: provider + connection
  store) + the connect-modal provider + the session provider changes bootstrap. Preserve
  `StrictMode`. **Omit** `WalletGateProvider` (the LP terms gate) — see Decision Log; this means
  the connect hooks' terms-gate branch is not reachable in the extracted slice, so the slice must
  either not depend on `WalletGateProvider` or provide a no-op gate.
- **Terms-gate coupling in the LP connect hooks.** `useEvmWallet.connect()` and
  `useStellarWallet.connect()` call `readTermsAcknowledged()` / `useWalletGate().openGate(...)`.
  If we **move** these files into the shared package, that coupling comes along. The extracted
  slice must decouple the gate (make it injectable/optional) so the trustee can connect directly
  without a terms gate and without regressing the LP behaviour. Prefer the per-wallet connector
  hooks (`useEvmConnectors` / `useStellarConnectors`), whose connect paths do **not** trigger the
  gate (the gate is interposed by `ConnectModalProvider.open()` per #639) — the trustee mounts
  the connect modal but skips the gate wrapper.
- **eslint boundary (TD-33).** The trustee eslint config dropped the `no-restricted-imports`
  guards that fence off wagmi/viem/AppKit/react-query/stellar-sdk and the bare-`fetch` guard.
  When wallet + api code lands, reinstate equivalent guards scoped to the new locations.
- **Chain/network config.** LP EVM targets Hoodi (chainId **560048**, `VITE_EVM_CHAIN_ID`);
  LP Stellar uses chain **99000001** (`VITE_STELLAR_CHAIN_ID`) + `VITE_STELLAR_NETWORK_PASSPHRASE`.
  The trustee env has only `API_BASE_URL`; it must gain the chain-id + RPC/network + WalletConnect
  project-id vars the wallet slice needs. The `chain_id` sent to `/v1/auth/challenge` is the
  **connected wallet's** chain (EVM numeric id, or Stellar `99000001`).
- **Dependency reality.** #778 (shared wallet/api extraction) is **open/`backlog`** and depends
  on #777. #787 (UI) is merged. This plan proceeds via the scoped-slice approach (a) so #791 is
  **not** hard-blocked on #778 — the chosen package boundary should be reconciled with #778
  (tech-debt note).
- **Package-boundary precedent.** The scoped slice becomes a **new shared workspace package**
  (preferred, so #778 is "move the rest," not "undo a duplication"); confirm the boundary with
  the reviewer before writing, since it sets #778's precedent. Fallback: land the slice inside
  `packages/trustee/src/{wallet,api,auth}` and log the duplication as tech-debt for #778.
- **No Figma verification needed for behaviour.** #787 already matched the sign-in card to Figma
  node `4174-31660`. #791 is flow/behaviour; the only visual additions are the connect modal
  (reuse the LP `ConnectWalletModal` verbatim), the sign-out affordance, and the 401/error text on
  the card. If a dedicated trustee Figma frame exists for those, verify against it; otherwise
  reuse the LP modal as-is and keep the error text minimal/token-consistent.

## Open Questions

_None._ The backend code resolves the auth model (challenge → sign → verify → JWT bearer),
the authorization model (server-side allow-list, `401` = not authorized, no client role read),
and the transport (client-held bearer token, no cookie/`me`/logout endpoint). Chains (EVM +
Stellar 99000001), the omitted terms gate, the minimal-slice extraction, and the
`sessionStorage` token store are all decided in the Decision Log. The package-boundary choice
(new shared package vs. trustee-local) is a build-time detail for the coder to confirm with the
reviewer — it does not change behaviour and is not a blocking product question.

## Implementation Steps

1. **Create the shared wallet-connect slice** (approach (a)). Preferred: a new workspace package
   (e.g. `packages/wallet-connect`, `name: @pipeline/wallet-connect`, `private: true`) added to
   root `workspaces`, exporting only what sign-in needs:
   - Providers: EVM (`EvmWalletProvider` = `WagmiProvider` + `QueryClientProvider`, from
     `wallet/evm/EvmWalletProvider.tsx` + `evm/config.ts` + `evm/chain.ts`) and Stellar
     (`StellarWalletProvider` + `stellar/config.ts` + `stellar/chain.ts` + `connectionStore.ts`).
   - Hooks: `useEvmWallet` / `useStellarWallet` (address + `isConnected` + `connect`/`disconnect`),
     `useEvmConnectors` / `useStellarConnectors`, and the `ConnectModalProvider` +
     `useConnectModal` opener. Reuse the LP `ConnectWalletModal` (`components/ConnectWalletModal.tsx`,
     props `{ open, onDismiss }`) as the picker.
   - **Net-new `signMessage`:** add `signMessage(message: string): Promise<{ signature: string }>`
     to the EVM hook (wagmi `useSignMessage` / viem `personal_sign`; return hex) and to the
     Stellar hook (`StellarWalletsKit.signMessage(message, { networkPassphrase, address })`;
     return the base64 `signedMessage`). Export both through the barrel.
   - **Decouple the terms gate:** make the gate injectable/optional so the slice does not force
     `WalletGateProvider`. The trustee will not mount the gate.
   - **Move (not copy)** the minimal files from `packages/frontend/src/wallet` where clean, and
     re-point the LP app's imports to the new package **with zero LP behaviour change** (mirrors
     #778's constraint). If moving risks LP regressions within this issue's blast radius, **copy**
     the minimal slice and log the duplication as tech-debt for #778.
   - Config: chain-id + RPC/network + WalletConnect project-id read from env (see step 3).
   - **Fallback (if a new package is rejected):** land the slice under `packages/trustee/src/wallet/`
     and add a tech-debt entry to fold it into #778.

2. **Add the trustee API client with bearer injection.** New `packages/trustee/src/api/client.ts`
   exporting `apiFetch<T>(path, init?)` modeled on the LP client (`ENV.API_BASE_URL` base,
   non-2xx → throw with the JSON `error` field), **plus**:
   - Inject `Authorization: Bearer <token>` from the current session when a token is present
     (read via a non-hook getter from the session store — see step 4).
   - Surface `401` distinctly so callers/session can react (e.g. throw a typed
     `ApiUnauthorizedError` or expose the status) — the sign-in flow needs to tell "address not
     authorized" apart from other failures, and a `401` on a later protected call should drop the
     session.
   - Add `getAuthChallenge(address, chainId)` and `postAuthVerify({ chainId, address, signature })`
     typed wrappers around `/v1/auth/challenge` and `/v1/auth/verify`.

3. **Add trustee dependencies + env.** Update `packages/trustee/package.json` to depend on the new
   package (and transitively the wallet SDKs it needs: wagmi/viem/@reown/appkit/react-query,
   @creit.tech/stellar-wallets-kit/@stellar/stellar-sdk). Extend `packages/trustee/src/lib/env.ts`
   with the vars the wallet slice + auth flow need, mirroring the LP env names:
   `VITE_EVM_CHAIN_ID` (default 560048), `VITE_EVM_RPC_URL`, `VITE_STELLAR_CHAIN_ID`
   (default 99000001), `VITE_STELLAR_NETWORK_PASSPHRASE`, `VITE_STELLAR_RPC_URL` /
   `VITE_STELLAR_HORIZON_URL` (as the kit requires), and `VITE_WALLETCONNECT_PROJECT_ID`.
   Update `packages/trustee/public/__env.js`, the root `.env`/example, and the
   `docker/trustee` runtime-env template accordingly.

4. **Add the trustee session store + provider.** New
   `packages/trustee/src/auth/TrusteeSessionProvider.tsx` + `useTrusteeSession()` context, plus a
   **non-hook module-level accessor** (`getSessionToken()`) so `apiFetch` and the router guard can
   read the token outside React. The store:
   - Persists `{ token, address, chainId, expiresAt }` in `sessionStorage`
     (`pipeline.trustee.session`); hydrates on load; treats an expired/absent token as
     unauthenticated.
   - Exposes `status: "unauthenticated" | "connecting" | "authenticated" | "unauthorized"`
     (`unauthorized` = the backend returned `401` "address is not authorized" during sign-in),
     plus `address`, `error?`, `signIn()`, and `signOut()`.
   - `signIn()` orchestrates the flow (step 6). `signOut()` clears the stored token, disconnects
     the wallet, and returns to `unauthenticated`. **No** on-chain role read anywhere.

5. **Reinstate the eslint boundary (TD-33).** Add the `no-restricted-imports`
   (wagmi/viem/@reown/*/react-query + @creit.tech/*/@stellar/*) and `no-restricted-globals`
   (bare `fetch`) blocks to the new package's eslint config and/or
   `packages/trustee/eslint.config.js`, scoped so the wallet SDKs are only importable inside the
   wallet module and `fetch` only inside the api module. Update the TD-33 tech-debt entry.

6. **Implement the sign-in orchestration.** In `TrusteeSessionProvider` (or a `useSignIn` hook it
   uses), `signIn()`:
   1. Set `status = "connecting"`; open the connect modal (`useConnectModal().open()`); wait for a
      connected address (EVM or Stellar) — the connected wallet determines `{ address, chainId }`
      (EVM numeric id / Stellar `99000001`).
   2. `GET /v1/auth/challenge?address=<addr>&chain_id=<chainId>`. On `401` → set
      `status = "unauthorized"` + `error = "This wallet is not authorized to sign in"`; **stop**.
   3. `signMessage(message)` on the connected chain (EVM hex / Stellar base64). If the user rejects
      the signature → back to `unauthenticated` (no error banner; user-cancelled).
   4. `POST /v1/auth/verify { chain_id, address, signature }`. On `200` → store
      `{ token, address, chainId, expiresAt: now + expires_in }`, set `status = "authenticated"`,
      and redirect to `/`. On `401` → surface a verification-failed error (rare: nonce expired /
      signature mismatch) and return to `unauthenticated`.

7. **Wire providers in `main.tsx`.** Mount, around `<RouterProvider>` in
   `packages/trustee/src/main.tsx` (following the LP ordering, **minus** `WalletGateProvider`):
   `EvmWalletProvider → StellarWalletProvider → ConnectModalProvider → TrusteeSessionProvider`.
   Preserve `StrictMode`. Pass the router a `context` carrying a session accessor (or rely on the
   module-level `getSessionToken()`/status getter) so the guard in step 9 can read auth state.

8. **Wire the "Connect Wallet" button.** In `packages/trustee/src/components/SignInCard.tsx`,
   replace the `TODO(#778)` no-op `onClick` with `useTrusteeSession().signIn()`. Update the doc
   comment (remove the "documented no-op" language). Render the `unauthorized`/error state inline
   on the card — a short "This wallet is not authorized to sign in. Contact your administrator."
   message with a disconnect/retry action; show a busy state while `status === "connecting"`.

9. **Add route gating.** In `packages/trustee/src/routes/__root.tsx` (or a `beforeLoad` on the
   protected routes / a `TrusteeShell`-level guard):
   - Unauthenticated (no valid token) → redirect to `/sign-in`.
   - Authenticated on `/sign-in` → redirect to `/`.
   - Use a TanStack Router `beforeLoad` reading the non-hook session getter (step 4), **or** a
     guard component that renders `<Outlet/>` only when authenticated. Ensure `/sign-in` renders
     **standalone** — hide the `TrusteeShell` topbar nav when unauthenticated (resolves the note
     left in `sign-in.tsx` / `TrusteeShell.tsx` about the topbar wrapping the gate).

10. **Add a sign-out affordance.** In `TrusteeShell.tsx` (authenticated view), add an
    account/sign-out control (truncated `address` + "Sign out" → `signOut()`). Minimal styling;
    match a Figma frame if one exists.

11. **Update the sign-in route + doc comments.** `packages/trustee/src/routes/sign-in.tsx` doc
    comment updated for the wired behaviour; resolve the topbar-hiding note.

12. **Clear TD-34 / update TD-33.** Close **TD-34** (no-op now wired) in
    `docs/exec-plans/tech-debt-tracker.md`; update **TD-33** (eslint boundary reinstated). Add any
    new tech-debt (wallet-slice duplication to reconcile with #778 if the fallback path was taken).

13. **Lint + typecheck + build.** Run `yarn workspace @pipeline/trustee lint` and `build`
    (`tsc -b && vite build`), `npx tsx scripts/lint-docs.ts`, and — if LP wallet files moved — the
    LP frontend's tests/build to confirm zero regression.

## Test Strategy

Vitest + Testing Library in `packages/trustee` (mirrors existing `-*.test.tsx` route tests; trustee
tests use the `-` filename prefix so the router plugin ignores them). Mock the network via the
`apiFetch`/challenge-verify wrappers and mock the wallet hooks.

- **Rewrite `packages/trustee/src/routes/-sign-in.test.tsx`.** The current test asserts the
  **no-op contract** (clicking "Connect Wallet" causes no navigation/side-effect) — that contract
  is now **inverted**. Replace the no-op assertion with: clicking "Connect Wallet" invokes the
  session `signIn()` (mock `useTrusteeSession`) and, on the unauthorized path, renders the
  "not authorized" error. Keep the render/copy/testid assertions.
- **Session provider unit tests** (`packages/trustee/src/auth/-TrusteeSessionProvider.test.tsx`):
  `unauthenticated` initial state; `signIn()` happy path → challenge → sign → verify →
  `authenticated` with a stored token (assert `sessionStorage` write + bearer available to
  `apiFetch`); `401` on challenge → `unauthorized` error state; user rejects signature →
  `unauthenticated`, no error; `signOut()` clears the token + returns to `unauthenticated`;
  hydration from an existing valid token → `authenticated`; expired stored token →
  `unauthenticated`. Mock the wallet hooks and the challenge/verify wrappers.
- **`apiFetch` tests** (`packages/trustee/src/api/-client.test.ts`): attaches
  `Authorization: Bearer <token>` when a session token is present, omits it when absent; maps a
  `401` to the typed unauthorized error; forwards the base URL from `ENV`.
- **Route-gating tests:** unauthenticated navigation to a protected route (e.g.
  `/type4-monitoring`) redirects to `/sign-in`; authenticated access reaches the route;
  authenticated user hitting `/sign-in` is redirected to `/`. Use a memory router / route-tree
  render with a mocked session.
- **Edge cases:** wallet disconnects mid-session (gating re-triggers → back to `/sign-in`);
  connect-modal dismissed without connecting (stays `unauthenticated`, no error); `signMessage`
  rejected by the wallet (stays `unauthenticated`, no error); a `401` from a later protected call
  drops the session to `unauthenticated`.
- **No E2E/QA phase** (frontend flow per AGENTS.md); the epic-level QA (#775 `qa` sub-issue) covers
  the rendered flow later.

## Docs to Update

- `docs/exec-plans/tech-debt-tracker.md` — close **TD-34** (Connect Wallet no-op now wired);
  update **TD-33** (eslint boundary reinstated for the wallet/api slice); add any new debt
  (wallet-slice / #778 reconciliation).
- `docs/product-specs/trustee-dashboard.md` — the spec currently lists Authentication as
  **out of scope** (line 15). Add a short "Sign-in & session" subsection describing the resolved
  auth model: wallet connect → backend signature challenge (`/v1/auth/challenge`) → sign
  (EVM personal_sign / Stellar SEP-0053) → `/v1/auth/verify` → JWT bearer session; server-side
  allow-list authorization (`401` = not authorized, no client role read); client-held bearer token,
  client-side sign-out. Cross-reference `docs/product-specs/api-authorization.md`.
- `docs/FRONTEND.md` / `docs/frontend/index.md` — note the trustee app now has a wallet-connect +
  api + session layer and the shared wallet-connect package (if created), so #778 knows the current
  boundary.
- Root `.env`/example + `docker/trustee` runtime-env template + `packages/trustee/public/__env.js`
  — new chain / RPC / network / WalletConnect env vars.

## Decision Log

Resolved before implementation (from the revision brief + backend code):

- **Auth model** = backend challenge → sign → verify → JWT. `GET /v1/auth/challenge` +
  `POST /v1/auth/verify` only (verified against `packages/api/src/routes/auth.rs`).
- **Authorization** = server-side allow-list (`auth_users`). `401` "address is not authorized" is
  rendered as an error state on the sign-in card. **No** client-side on-chain `TRUSTEE`-role read
  (the prior plan's `useHasTrusteeRole` is **dropped**).
- **Chains** = both **EVM** (Hoodi, 560048) and **Stellar** (99000001). The connected wallet
  determines the `address`/`chain_id` sent to the challenge/verify endpoints.
- **Session transport** = client-held **JWT bearer token** (`Authorization: Bearer <jwt>`,
  ES256, `expires_in = 86400`). Confirmed from the code: no `Set-Cookie`, no cookie middleware,
  no `me`/`refresh`/`logout` endpoint — sign-out is client-side. Token stored in
  `sessionStorage` (`pipeline.trustee.session`).
- **Wallet-connect** = minimal shared slice (approach (a)): connect/disconnect + address + picker
  modal + provider mounting **+ net-new `signMessage`** (EVM + Stellar). Reuse the LP
  `ConnectWalletModal` UX.
- **Terms gate** = **omitted** (LP-only; trustee operators are internal). The extracted slice must
  decouple the gate so the LP keeps it and the trustee connects directly.
- **Package boundary** = new shared package preferred; coder confirms with the reviewer before
  writing (build-time detail, not a product question).
