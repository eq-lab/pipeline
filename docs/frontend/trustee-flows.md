# Trustee flows

Architecture and behavior specs for the Trustee admin panel in `packages/trustee/src/**` —
loan-book data, loan detail, cash movement, and lifecycle actions. This is the home for flow-shape
knowledge that previously lived as inline comments and docblocks — see
[`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

Trustee product intent lives in `docs/product-specs/` (see the Trustee panel note in
[`docs/FRONTEND.md`](../FRONTEND.md#application-structure)); this doc captures the frontend
*implementation* architecture.

> **Status:** scaffold. Sections are filled in as each module's comments are migrated under
> [issue #991](https://github.com/eq-lab/pipeline/issues/991). Do not delete a source comment until
> its content lives in a section below. The **Audit Log** section below is migrated; the rest are
> scaffolds.

## Audit Log

**Sources:** `packages/trustee/src/routes/audit-log.tsx` (view),
`packages/trustee/src/routes/-useAuditLog.ts` (presenter),
`packages/trustee/src/api/useAuditLog.ts` (data hook).
**Consumer route:** `/audit-log`. **Surface 17** of epic #775; issue #1004; Figma node
`4116:13770`.

Surface 17 is an append-only, reverse-chronological (newest-first) table — Time · Action · Loan /
scope · Reference — of on-chain Trustee actions.

### Architecture

Follows the `loans.index.tsx` design language and the view/logic split of
[`docs/FRONTEND.md` rule 2](../FRONTEND.md#code-structure-rules): the `.tsx` view is JSX-only and
reads a single presenter hook, `useAuditLogView`.

- `useAuditLog` (`api/`) — React Query hook over `GET /v1/audit-log`, Stellar-scoped `chain_id`,
  30 s poll. Its DTOs are a self-contained hand-mirror of the backend shape
  (`packages/api/src/routes/audit_log.rs`, #1000) — TD-42 convention, the trustee app does not
  depend on `@pipeline/frontend`.
- `useAuditLogView` (`routes/-useAuditLog.ts`) — presenter. The feed is the **source of truth for
  state**; the loan book (`useLoanBook`) is **enrichment only**: a loan-scoped row shows the
  friendly `"Originator — Commodity"` name, falling back to the server-supplied `scope.label`
  (`"Loan #<id>"` / `"Protocol"`) until the loan book loads or when an id isn't in it. Each item
  maps to a display row: `formatAuditTimestamp` time (UTC), resolved scope label, and a truncated
  tx-hash reference (`<first6>…<last4>`, full hash in the cell `title`).

### Scope — on-chain only (resolved with the issue author, #1004)

The endpoint serves on-chain loan-lifecycle + yield events only. **Rows are exactly what the
endpoint returns — never fabricated** ([[no-frontend-computed-metrics]]). Two consequences vs. the
Figma mock:

- The mock's off-chain rows ("Batch off-ramp co-signed", "Loan distributions wired (fiat)") and
  non-loan "Batch #B-102" scopes do **not** appear until the backend off-chain-audit follow-up
  lands (see the `audit_log.rs` header).
- The caption is adapted from the Figma copy (which promises fiat wire confirmations + MPC
  co-signatures "all land here") to describe what is actually served today — no over-claiming,
  matching the loans-page "never fabricate" precedent.

### Rendering (unpaginated feed)

`GET /v1/audit-log` returns the **full feed, not paginated**. The page bounds *rendering* — not the
payload:

- Render the newest `AUDIT_PAGE_SIZE` (50) rows; a "Show older (N more)" control reveals another
  page per click. A **visible** cap, never a silent truncation.
- The row is `memo()`-ised so the 30 s background poll does not re-render unchanged rows (TanStack
  Query structural-shares unchanged data → stable row identity).

Trimming the **payload** itself needs server-side `limit`/`cursor` pagination — backend follow-up
#1006. When it lands, "Show older" becomes a real `fetchNextPage` instead of revealing
already-downloaded rows.

### Figma → token / px mapping

Matches the `loans.index.tsx` precedent (raw Figma literals mapped to `--color-pipeline-*` tokens):

- Heading `font-display text-[64px] leading-[64px]`, `rgba(56,55,53,0.3)`.
- Card `bg-[--color-pipeline-surface] rounded-[4px] p-[32px]`.
- Header cells `14px` / ink-muted, `pb-[12px] px-[14px]`; the table draws borders **only** around
  the body box + inter-row separators (`LINE_COLOR` = `rgba(56,55,53,0.18)`, applied via inline
  `style` so it always paints regardless of Tailwind v4 utility ordering); the header row sits
  unbordered above the box.
- Body cells `16px`, `py-[20px] px-[14px]`: Time + Reference ink-muted, Action + scope `#262524`
  ink; Reference is monospace `14px`.
- Action + Loan/scope **wrap** (a deliberate deviation from the Figma's single-line `nowrap` cells):
  audit actions run long and must stay fully readable — never truncate served data.
- Caption `13px` / ink-muted, `leading-[18.2px]`, `pt-[16px]`.

## Cash Management — Withdrawal Queue

**Sources:** `packages/trustee/src/routes/cash-management.tsx` (view — the Withdrawal Queue tab +
`WithdrawalTopUpDialog`), `packages/trustee/src/routes/-cash-management-withdrawals.ts` (presenter),
`packages/trustee/src/api/useWithdrawalQueue.ts` (data hook).
**Behavior source:** the working doc `Cash management.md` §"Withdrawal queue". **Design:** Figma node
`4116-13974` (the top-up MPC dialog). On mismatch the **doc** wins; Figma is styling only.
Issue #945; the third tab of the Cash Management page (shell #943), alongside the On/Off-ramp and
T-Bills swap forms.

### Architecture

View/logic split per [`docs/FRONTEND.md` rule 2](../FRONTEND.md#code-structure-rules): the tab and
dialog are JSX-only and read `useWithdrawalQueueView`.

- `useWithdrawalQueue` (`api/`) — React Query hook over `GET /v1/withdrawal-queue`, 30 s poll. A
  self-contained hand-mirror of the backend shape (TD-42; the trustee app does not depend on
  `@pipeline/frontend`, whose `useWithdrawalQueue` reads the same endpoint). `in_queue_usd`/`amount`
  are base-6 decimal strings in human units — format with `@/utils/formatUsd`.
- `useWithdrawalQueueView` (`-cash-management-withdrawals.ts`) — presenter.

### Scope — visual-only shell (served vs. `—`)

Same "build the shell now, backend later" decision as the swap forms (#973/#983). Render **exactly
what is served**, never fabricated ([[no-frontend-computed-metrics]]):

- **Total claimable** (`in_queue_usd`, the doc's `totalClaimable`) and **request count**
  (`requests_count`) are served → shown.
- The doc also wants the **WithdrawalQueue wallet balance** (`USDC.balanceOf(WithdrawalQueueWallet)`),
  but the endpoint does not serve it → `walletBalanceDisplay = "—"`.
- **Top-up alert:** the doc shows it when `balance < totalClaimable + reserve`. Because the balance
  is unserved, that comparison can't be made — so `needsTopUp` is always `false` and the alert is
  **never fabricated** from missing data.
- The **top-up transfer** is a Capital-Wallet MPC action (3-of-5, Type 2, flow 9) with no backend
  path yet (#781) — the dialog's signature rows are static "not signed" and `Co-sign in MPC` is
  disabled. Coverage-after / oldest-pending have no served source → `—`.

Deferred backend (not blocking the UI): the WithdrawalQueue-wallet balance read + the Type-2
Capital-Wallet MPC assembly (#781).

### Figma → token / px mapping (top-up dialog, `4116-13974`)

Same design language as the sibling swap dialogs. Card `bg-white rounded-[6px] px-[30px] py-[28px]
w-[640px]`, `shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]`. Title Besley `26px/36.4px` `#262524`;
subtitle `14px` ink-muted. Summary rows `border-b LINE_COLOR pb-[13px] pt-[12px]`, label `15px`
ink-muted / value `16px` `#262524` right-aligned (Amount is a right-aligned input — the doc has the
Trustee specify it). Signature collection header `12px` uppercase `tracking-[0.96px]`; signer rows
a `9px` dot + name `15px` + optional `mandatory` chip + right-aligned "not signed" `13px`. Buttons
`h-[40px]`: Cancel white-bordered, Co-sign `BRAND` (disabled).

## Loan book & tables

_To be migrated from `packages/trustee/src/api/useLoanBook.ts`, `routes/-useLoansTable.ts`._

## Loan detail

_To be migrated from `packages/trustee/src/routes/-useLoanDetail.ts`, `routes/loans.$id.tsx`._

## Cash movement & lifecycle actions

_To be migrated from `packages/trustee/src/routes/-record-*.ts`._

## Session & auth

**Sources:** `packages/trustee/src/auth/**` (`TrusteeSessionProvider.tsx`, `sessionStore.ts`,
`authGate.ts`, `useAuthRedirect.ts`), `components/TrusteeShell.tsx`, `components/SignInOverlay.tsx`,
`components/SignInCard.tsx`, `routes/__root.tsx`, `routes/sign-in.tsx`.
Issues: #791 (flow), #793/#794/#795 (modal hardening), #921/#988/#1009 → **#1008** (gating
architecture). Backend contract: `docs/product-specs/api-authorization.md` /
`packages/api/src/routes/auth.rs`.

### Two-layer gating (#1008)

Auth is enforced in two independent layers:

1. **Correctness — render-level gate (cannot race).** `TrusteeShell` renders `SignInOverlay`
   (Figma `4174-31660`) whenever the session is not authenticated, **on any URL**, and never mounts
   protected route content (`<Outlet/>`) while signed out — so no authenticated API calls fire
   either. Whatever the address bar says, the content is always right.
2. **URL convention — redirects (not load-bearing).** `/sign-in` is the canonical logged-out URL.
   The root route's `beforeLoad` (`resolveAuthRedirect`) enforces it on hard navigations
   (unauthenticated on a protected path → `/sign-in`; authenticated on `/sign-in` → `/`), and
   `useAuthRedirect` enforces it on **mid-session** status changes (sign-in completing, sign-out,
   token expiry) that `beforeLoad` never sees. `signOut()` navigates to `/sign-in` explicitly. The
   `/sign-in` route itself renders `null` — the gate UI always comes from the shell.
   `useAuthRedirect` also **self-heals the address bar**: external history writes (observed on
   staging — e.g. the wallet modal restoring its pre-open URL on close) can overwrite
   `window.location` without the router noticing, leaving the URL on `/sign-in` while the app
   renders `/`. No router/React state reflects that divergence, so the hook compares
   `window.location.pathname` against router state on every status/path change (plus short delayed
   re-checks for late clobbers) and re-stamps the address bar via `history.replaceState` — router
   state is the source of truth.

If a redirect misfires, the failure mode is a briefly-wrong address bar — never wrong or blank
content. **History:** three URL-synchronization approaches raced in production builds and stranded
the URL on `/sign-in` — a render-phase `<Navigate>` (#921), `beforeLoad` + `router.invalidate()`
(#988, `invalidate()` does not re-run the root guard and `beforeLoad` only runs during
navigations), and a reactive navigate alone (#1009). The trigger — "status flipped while parked on
`/sign-in` with no navigation in flight" — is inherently racy to convert into a navigation, which
is why correctness no longer depends on one.

| Scenario | URL | Content |
|---|---|---|
| Visit `/` signed out | `/sign-in` | overlay |
| Deep-link `/loans` signed out | `/sign-in` | overlay |
| Sign in from `/sign-in` | `/` | dashboard |
| Logout from any page | `/sign-in` | overlay |
| Token expiry mid-session | `/sign-in` | overlay |

### Sign-in flow (#791, hardened #793/#794/#795)

`TrusteeSessionProvider` orchestrates; `SignInCard` is the UI (idle / "Connecting…" /
unauthorized-error states).

1. `signIn()` sets `status = "connecting"` and **always opens the wallet-connect modal** — sign-in
   must be driven by the user's deliberate chain pick, never ambient wallet state (#795: wagmi
   auto-reconnects a persisted EVM session on page load, which used to hijack sign-in and skip the
   modal, so Freighter/Soroban was never offered). The picked chain (`onWalletSelect`) becomes the
   sole driver: already connected → sign-in runs immediately (the kit treats same-address reconnect
   as a no-op, so a watch effect alone would miss this case, #794); not yet connected → a watch
   effect on the reactive wallet hooks runs it once that specific chain connects. A wallet on the
   *other* chain never triggers sign-in. Dismissing the modal with no pick resets to
   `unauthenticated` (#793 — no stuck "Connecting…"). An `orchestrating` ref makes the
   challenge/verify orchestration single-flight.
2. `GET /v1/auth/challenge?address=&chain_id=` — `401` = address not on the server allow-list →
   `unauthorized` + explanatory error (authorization is entirely server-side); other failures →
   "could not reach the sign-in service".
3. The wallet signs the challenge `message` (EVM `personal_sign` hex / Stellar SEP-0053 base64 via
   `@pipeline/wallet-connect`). A rejection returns to `unauthenticated` **silently** — a user
   choice, not an error.
4. `POST /v1/auth/verify` — on success the token is stored (`setSession`) and `status` flips to
   `authenticated`; **no navigation happens anywhere in the flow** (layer 1 swaps the UI, layer 2
   tidies the URL). A `401` here (nonce race / signature mismatch) surfaces as
   "verification failed".

`signOut()` clears the stored token, disconnects both wallets, and navigates to `/sign-in`. There
is no server logout endpoint (bearer-token transport, per the #791 Decision Log) — sign-out is
purely client-side.

### Session store (`sessionStore.ts`)

Module-level external store (the same pattern as `@pipeline/wallet-connect`'s Stellar
`connectionStore`), single source of truth for the backend-issued JWT:

- Persisted in **`sessionStorage`** (not `localStorage`) under `pipeline.trustee.session` — the JWT
  must not outlive the browser tab (#791 storage-choice rationale). Hydrated once at module load;
  expired stored sessions are dropped on hydrate.
- Exposes the reactive `useSessionState()` (via `useSyncExternalStore`) plus **non-hook accessors**
  (`getSessionToken()`, `getSessionState()`) for `apiFetch` and the router guard, which run outside
  React. `getSessionToken()` is deliberately pure — no writes/notifications, so a fetch reading the
  token never triggers a re-render (#795).
- **Reactive expiry:** a timer armed on every `setSession` (and at hydrate) evicts the session the
  instant its ~24 h token expires, so an idle trustee is re-gated without needing a failed API call
  (#795). Statuses: `unauthenticated | connecting | authenticated | unauthorized`.

## Loan book & tables
