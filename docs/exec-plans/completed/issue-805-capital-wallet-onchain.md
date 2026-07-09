# Issue #805: Trustee Overview — read Capital Wallet balance directly from the Stellar contract

Source: https://github.com/eq-lab/pipeline/issues/805

Sub-issue of epic #775 (Trustee Admin Panel). Follows #797 (Overview Capital
Allocation card) and #807 (drift text + provenance chips), both merged on `main`.
Branch: `feat/805-capital-wallet-onchain` (checked out).

## Scope

Narrowed per the two latest human comments on #805 (authoritative):

**In scope**

- Read the **Capital Wallet** USDC balance **directly from the Stellar
  contract** (on-chain), by calling `usdc.balance(account)` on the USDC SAC where
  `account = VITE_STELLAR_USDC_CUSTODY_ID` (the existing custody account
  `GDH66JAF…`). No new env var — reuse the custody id.
- Render that on-chain balance as the `capital_wallet` legend value on the
  existing Overview Capital Allocation card (`CapitalAllocationCard`).
- Fold the on-chain Capital-Wallet balance into the **displayed total**:
  `displayed total = backend total + on-chain Capital-Wallet balance`, as a
  deliberate interim client-side sum until the backend indexes `capital_wallet`.
  Guards (see Implementation): only add when backend `buckets.capital_wallet` is
  `null`; handle a `null` backend `total` gracefully.
- Loading / error / unset-id handling that renders `—` (never a fabricated
  value), alongside the card's existing loading and error states.

**Out of scope**

- **Trust account** (`trust_account`) — deferred (no address confirmed yet).
  The original #805 title mentions it; the narrowed scope drops it from this
  issue. Note this explicitly in the PR / issue so the title/scope match.
- The other buckets (`in_transit`, `tbills`, `deployed`) and the backend
  `total` semantics — unchanged; still sourced from `GET /v1/capital-allocation`.
- The inert allocation bar / percentages (still deferred; no client-computed
  proportions — see [no frontend-computed metrics] and TD-39).
- Any backend change to `capital_allocation.rs` — the backend still returns
  `capital_wallet: null`; that indexing work is separate.

## Assumptions and Risks

- **Read-path decision is forced by the ESLint boundary, not preference.** The
  trustee's `packages/trustee/eslint.config.js` hard-forbids importing
  `@stellar/stellar-sdk` (and the wallets-kit) **everywhere, with no carve-out**
  (TD-33, reinstated by #791): "all wallet code lives in the shared package, so
  the restriction applies everywhere in this app with no carve-out." The trustee
  also does **not** depend on `@stellar/stellar-sdk` at all — only on
  `@pipeline/wallet-connect`. Therefore a trustee-local hook that imports the SDK
  (option **a** in the brief) would violate the existing enforced architecture
  and require adding both a lint carve-out and a new direct SDK dependency. This
  plan takes option **(b): extract the SAC balance read into
  `@pipeline/wallet-connect`** as a shared Stellar read helper, which is the only
  path consistent with the boundary. The extraction is small (one class + one
  thin function; the LP's `TokenClient` is ~120 lines and self-contained).
- **`@tanstack/react-query` is forbidden outside `src/evm/**`inside`@pipeline/wallet-connect`** (its own `eslint.config.js`). So the shared helper
in `src/stellar/**` must expose a **plain async read function\*\* (not a
  `useQuery` hook). The trustee wraps it in `useQuery` on its side, where
  react-query is allowed. This mirrors how the LP frontend layers
  `useStellarUsdcCustodyBalance` (react-query) over `TokenClient` (pure SDK).
- **Custody account may be the USDC issuer → i64-max sentinel.** The LP's
  `useStellarUsdcCustodyBalance` guards against a `balance()` call on an issuer
  account returning the i64 max sentinel (~9.2e18, would render as ~$922B). The
  `.env` comment on `VITE_STELLAR_USDC_CUSTODY_ID` explicitly warns this account
  may be the issuer. The shared helper / trustee hook MUST reproduce this
  sentinel guard and render `—` on hit. Losing this guard is the highest-risk
  regression.
- **Decimals mismatch.** The on-chain `balance()` returns a raw i128 bigint at
  **7-decimal SAC scale**; the card's formatters (`formatCompactUsd` /
  `formatFullUsd`) and the backend buckets are **base-6 decimal strings in human
  units**. The trustee hook must convert 7-decimal-raw → a human-decimal string
  before formatting, and must convert to a comparable unit before summing with
  the backend `total`. Getting the scale wrong is an easy 10x/100x error.
- **Total is now a client-side sum** — an explicit, documented exception to
  [no frontend-computed metrics]. The rule forbids _deriving_ metrics the backend
  should own; here the human explicitly requested an interim sum of two
  authoritative real sources (backend total + real on-chain balance). Document
  this inline and in the tech-debt tracker so it reads as deliberate, guarded,
  and temporary — not an accidental client computation.
- **Env plumbing.** The trustee `ENV` (`packages/trustee/src/lib/env.ts`)
  currently exposes only `API_BASE_URL`, EVM vars, `WALLETCONNECT_PROJECT_ID`,
  `STELLAR_NETWORK_PASSPHRASE`, `STELLAR_CHAIN_ID`. It is missing
  `STELLAR_RPC_URL`, `STELLAR_USDC_ID`, `STELLAR_USDC_CUSTODY_ID`. These already
  exist in `.env` / `.env.example` (added for the LP #770), so no new env values
  are needed — only new accessors + passing them into the wallet-connect config.
- **wallet-connect config surface must grow.** `WalletConnectConfig`
  (`packages/wallet-connect/src/config.ts`) has no Soroban RPC URL or USDC SAC id.
  The shared read function needs the Soroban RPC URL and network passphrase; both
  the LP and trustee already inject `stellarNetworkPassphrase`. Decide whether the
  shared read function reads config via `getWalletConnectConfig()` (requires
  adding `stellarRpcUrl` to the config, and the trustee `main.tsx` passing it) or
  takes RPC/USDC ids as explicit function arguments from the caller. See Open
  Questions Q1 — the plan proposes explicit arguments to keep `WalletConnectConfig`
  lean, but flags the config-based alternative.
- **No Figma dependency for this change.** #805 references no new Figma node —
  the card layout and legend format are already implemented and verified in
  #797/#807. This change only populates one previously-`—` value and adjusts the
  total; the visual acceptance is "the Capital Wallet legend shows a real dollar
  figure and the total reflects it," verified live per FRONTEND.md.

## Open Questions — RESOLVED

Both resolved by the human/manager before implementation started (see issue #805 comments);
implemented per the resolutions below.

1. **wallet-connect config vs. explicit args for the Soroban RPC URL / USDC SAC
   id.** RESOLVED: explicit function arguments (`getSacBalance({ sorobanRpcUrl,
networkPassphrase, sacContractId, account })`) — `WalletConnectConfig` is
   unchanged; the trustee passes `ENV.STELLAR_RPC_URL` / `ENV.STELLAR_USDC_ID` /
   `ENV.STELLAR_NETWORK_PASSPHRASE` in directly.
2. **Display when the backend `total` is `null` but the on-chain Capital-Wallet
   balance is present.** RESOLVED: show the on-chain Capital-Wallet balance as
   the sole known total (real data, not fabricated); `—` only when neither
   source has anything. Implemented in `computeTotalNum` /
   `useCapitalAllocationCard.ts`.

## Scope addition mid-implementation (human, Figma node `4116:8961`)

After the read-path implementation (Steps A–D below) was complete, the human requested folding in
a further UI change to the same legend rather than opening a separate issue/PR (to avoid a merge
conflict on `CapitalAllocationCard.tsx`): each legend row also renders a percentage pill
(`[colored dot + N%]` prefixing `Label $Value`), computed as `bucket_value ÷ displayed_total`
(the SAME guarded total from Step D), rounded to the nearest whole percent, not normalized to sum
to 100. This is an **explicitly requested reversal** of TD-39's "no client-computed percentages"
deferral (documented inline in `useCapitalAllocationCard.ts` and folded into TD-41). Implemented
as:

- `AllocationLegendRow.percentDisplay: string | null` (new field) in
  `packages/trustee/src/components/useCapitalAllocationCard.ts`, computed via
  `computeTotalNum` (extracted from the total-display logic) + `computePercentDisplay`.
- `CapitalAllocationCard.tsx`: each legend row renders a pill (dot + `N%`) when
  `percentDisplay !== null`, else falls back to the pre-#805 plain dot — never a fabricated `0%`.
- Tests added in `-useCapitalAllocationCard.test.ts` (percentage computation, including the
  double-count-guard total) and `-CapitalAllocationCard.test.tsx` (pill rendering, null-bucket →
  no pill).

## Implementation Steps

**Status: all steps complete.** Minor naming deviation from this plan: the exported function is
named `getSacBalance` (not `readSacBalance`), and its params object uses `sacContractId` (not
`usdcContractId`) since it's a generic SAC reader, not USDC-specific — functionally identical to
the plan's description. Noted on the issue as a deviation per the coder skill's contract.

### A. Shared SAC balance read in `@pipeline/wallet-connect` (option b) — DONE

1. Add a Stellar SAC read module at
   `packages/wallet-connect/src/stellar/sacBalance.ts` (lives under
   `src/stellar/**`, the only place the package permits `@stellar/stellar-sdk`).
   Port the minimal read machinery from the LP's
   `packages/frontend/src/wallet/stellar/contracts/token.ts`:
   - A small `TokenClient`-style reader using
     `{ Account, Contract, TransactionBuilder, BASE_FEE, xdr, Address,
scValToNative, rpc as SorobanRpc }` from `@stellar/stellar-sdk`.
   - `balance(account)`: builds `contract.call("balance", new Address(account).toScVal())`,
     runs `server.simulateTransaction(tx)` against the Soroban RPC using the
     `READ_SIMULATION_SOURCE` null account
     (`GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF`), and returns
     `scValToNative(retval)` as a raw i128 `bigint` (7-decimal SAC scale).
   - Export a plain async function, e.g.
     `readSacBalance({ sorobanRpcUrl, networkPassphrase, usdcContractId, account })
: Promise<bigint>` (NO react-query — react-query is forbidden outside
     `src/evm/**` here). Return the raw bigint; let the caller scale/guard, OR
     apply the sentinel guard here (recommend applying the sentinel guard here so
     every consumer inherits it — see step 2).
   - Reuse the passphrase from the caller/config; do NOT read `import.meta.env`
     (this package has no env accessor by design — see `config.ts` docs).
2. Reproduce the **i64-max sentinel guard** from
   `useStellarFinancialPositionReads.ts` (`I64_MAX = 9223372036854775807n`): if
   `balance()` returns `>= I64_MAX`, throw (or return a sentinel the caller maps
   to `undefined`). Recommend throwing a typed error so the trustee's react-query
   surfaces it as an error → `—`, matching LP behavior.
3. Export the new function from the package barrel
   `packages/wallet-connect/src/index.ts` under the Stellar namespace
   (e.g. `export { readSacBalance } from "./stellar/sacBalance";` plus its param
   type). Update the barrel's boundary doc comment to mention the new read.
4. Add/extend a unit test in `packages/wallet-connect/src/stellar/` mocking
   `@stellar/stellar-sdk`'s `rpc.Server.simulateTransaction` /
   `SorobanRpc.Api.isSimulationError` to assert: a normal i128 returns the
   scaled bigint; the i64-max sentinel throws/maps to the guarded outcome; a
   simulation error propagates.

### B. Trustee env plumbing — DONE

5. In `packages/trustee/src/lib/env.ts`, add three accessors to the frozen `ENV`
   object (values already exist in `.env` / `.env.example`):
   - `STELLAR_RPC_URL: readString("VITE_STELLAR_RPC_URL", "https://soroban-testnet.stellar.org")`
   - `STELLAR_USDC_ID: readString("VITE_STELLAR_USDC_ID", "")` (empty = unconfigured → `—`)
   - `STELLAR_USDC_CUSTODY_ID: readString("VITE_STELLAR_USDC_CUSTODY_ID", "")`
     (empty = unconfigured → `—`)
     Follow the existing empty-string-means-unconfigured pattern used by the LP's
     `chain.ts` (`usdcId`/`usdcCustodyId`).
6. SKIPPED — resolved to "explicit args" (preferred); `WalletConnectConfig` and
   `main.tsx` are unchanged. The trustee hook passes the RPC url / passphrase /
   USDC id directly to `getSacBalance`.

### C. Trustee Capital-Wallet balance hook — DONE

7. Add `packages/trustee/src/api/useCapitalWalletBalance.ts` — a `useQuery` hook
   (react-query is allowed in the trustee) that:
   - Short-circuits to `{ data: undefined }` when `ENV.STELLAR_USDC_ID` or
     `ENV.STELLAR_USDC_CUSTODY_ID` is empty (unconfigured → `—`).
   - Calls `readSacBalance({ sorobanRpcUrl: ENV.STELLAR_RPC_URL,
networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
usdcContractId: ENV.STELLAR_USDC_ID,
account: ENV.STELLAR_USDC_CUSTODY_ID })` inside `queryFn`.
   - Query key includes the USDC id + custody id + RPC url (mirrors LP).
     `refetchInterval: 30_000`, `staleTime: 30_000`, `retry: false` — matching
     `useCapitalAllocation` and the LP hooks.
   - Returns the balance as a **human-decimal string** (scale the raw
     7-decimal bigint via a local `rawToDisplay(raw, 7)` port, or reuse a scaling
     helper) so it feeds the existing base-6-human-units formatters unchanged, or
     returns the raw bigint + lets the card hook scale — pick one and keep the
     unit contract documented in the hook's docblock.
   - Exposes `{ data, isLoading, error }` like `useCapitalAllocation`.
   - This is NOT a `fetch` (it goes through the SDK simulate), so it does not hit
     the `no-restricted-globals: fetch` rule; it lives under `src/api/` anyway.

### D. Wire into the card view hook — DONE (extended with the percentage-pill scope addition above)

8. In `packages/trustee/src/components/useCapitalAllocationCard.ts`:
   - Call both `useCapitalAllocation()` and the new `useCapitalWalletBalance()`.
   - **Capital Wallet legend value**: prefer the backend
     `data.buckets.capital_wallet` when non-null; otherwise use the on-chain
     balance formatted via `formatCompactUsd`. On unset id / read error / loading,
     render `—` (loading contributes to the card's overall `isLoading`; a read
     error should NOT blow up the whole card — degrade the single legend value to
     `—` while the rest of the card renders, unless the backend query itself
     errored). Decide error composition: recommend the on-chain read error only
     degrades the Capital-Wallet legend value to `—`, and only the backend query
     error drives the card-level error surface (keeps the card resilient).
   - **Total**: compute the displayed total per the guarded rule:
     - If backend `buckets.capital_wallet` is non-null → the backend already
       includes it; use `data.total` as-is (do NOT add the on-chain value —
       avoids double-count).
     - Else if backend `buckets.capital_wallet` is null AND the on-chain balance
       is available → displayed total = `backend total + on-chain balance`
       (sum in a single consistent unit; document the arithmetic).
     - Else (on-chain unavailable) → `data.total` as-is.
     - If backend `total` is null → apply Open Question Q2's resolved rule
       (proposed: show the on-chain Capital-Wallet balance as the sole known
       total; fallback `—`).
   - Keep the mapping in the hook (view stays pure per FRONTEND.md rule 2). Add a
     clear docblock explaining the guarded interim sum and citing the human
     decision + this exec plan.
9. DEVIATION: `CapitalAllocationCard.tsx` DID need a structural change after all
   — the mid-implementation scope addition (Figma `4116:8961`) added a
   percentage pill per legend row, replacing the plain dot when
   `percentDisplay !== null`. The loading/error branches are otherwise
   unchanged and still behave per the original plan (verified by tests).

### E. Docs + tech debt — DONE

10. Added tech-debt entry **TD-41** in `docs/exec-plans/tech-debt-tracker.md` —
    extended beyond the plan's original wording to also cover the
    percentage-pill scope addition (client-computed, explicitly requested,
    reversing TD-39's deferral).
11. `.env.example` — reviewed; existing comments already accurately describe
    `VITE_STELLAR_USDC_ID` / `VITE_STELLAR_USDC_CUSTODY_ID` /
    `VITE_STELLAR_RPC_URL` for the LP frontend's use, and are equally accurate
    for the trustee's new use (same values, same semantics) — no wording change
    needed.
12. Added `docs/user-stories/epic-775/805-capital-wallet-onchain.md` (ISSUE_PROTOCOL
    §6 requirement) and linked it from `docs/user-stories/index.md`.

## Test Strategy

- **wallet-connect (new)** — `packages/wallet-connect/src/stellar/sacBalance.test.ts`:
  mock `@stellar/stellar-sdk` (`rpc.Server`, `SorobanRpc.Api.isSimulationError`,
  `scValToNative`). Assert: normal balance path returns the expected raw/scaled
  value; i64-max sentinel is guarded (throws or maps to the documented outcome);
  a simulation error propagates as an `Error`. Follow the LP token-client test
  approach if one exists; otherwise mirror the mocking style used in
  `useStellarWallet.test.tsx`.
- **Trustee hook (new)** — `packages/trustee/src/api/-useCapitalWalletBalance.test.tsx`:
  mock `readSacBalance` (and `ENV` via `withEnvOverride`). Assert: unset custody
  id → `data === undefined` (no call); a successful read → the scaled
  human-string; a read error → `error` set / `data === undefined`.
- **Card view hook (extend)** — the mapping in `useCapitalAllocationCard` is the
  behavioral core. Add a hook-level test (mock both `useCapitalAllocation` and
  `useCapitalWalletBalance`) asserting:
  - on-chain balance renders as the `capital_wallet` legend value when backend
    bucket is null;
  - backend `capital_wallet` (when non-null) takes precedence over the on-chain
    read (no double source);
  - total = backend total + on-chain balance **only** when backend bucket is null
    (double-count guard);
  - total = backend total unchanged when backend bucket is non-null;
  - null backend total → Q2 resolved display;
  - unset id / read error → Capital-Wallet legend `—`, card still renders.
- **Card render (extend)** — `-CapitalAllocationCard.test.tsx` already mocks
  `useCapitalAllocationCard`; add a case where the mocked hook returns a populated
  `capital_wallet` value + a summed total, asserting the legend and total strings
  render. (This file mocks the view hook, so it exercises rendering, not the
  sum logic — the sum logic is covered by the view-hook test above.)
- **Sandbox quirk**: if the workspace runner breaks under the sandbox, run
  `node node_modules/.bin/vitest run` (Node 20) per the brief.
- **Lint**: `yarn workspace @pipeline/trustee lint` and
  `yarn workspace @pipeline/wallet-connect lint` must pass — critically confirm
  no `@stellar/stellar-sdk` import leaked into the trustee (would fail
  `no-restricted-imports`). Run `npx tsx scripts/lint-docs.ts` for docs.
- **Live verification** (FRONTEND.md; no Figma delta): start
  `yarn workspace @pipeline/trustee dev` (or the LP dev script the trustee uses),
  open the Overview page, confirm the Capital Wallet legend shows a real dollar
  figure (not `—`) with the configured custody account, and the total reflects
  the guarded sum. Verify `—` when the custody id is unset. Do not fabricate;
  check the Network / RPC call actually returns.

## Docs to Update

- `docs/exec-plans/tech-debt-tracker.md` — add **TD-41** (interim on-chain
  Capital-Wallet source + client-side total sum; remove when backend indexes
  `capital_wallet`).
- `.env.example` — comment-only clarification that the trustee app now also
  reads `VITE_STELLAR_RPC_URL` / `VITE_STELLAR_USDC_ID` /
  `VITE_STELLAR_USDC_CUSTODY_ID` (no new keys).
- No product-spec change required: this populates an already-specified card value
  from an interim real source; behavior of the card (real data, `—` on missing)
  is unchanged in intent. If a Trustee Overview spec exists under
  `docs/product-specs/`, add one line noting Capital Wallet is read on-chain as
  an interim source until the backend serves it.
- The `@pipeline/wallet-connect` barrel docblock (`src/index.ts`) — note the new
  Stellar SAC read helper in the boundary description.

## Post-archive addendum: PR #811 human review follow-up (correctness review passed, two non-blocking fixes)

Applied after this plan was archived to `completed/` (the correctness review on PR #811 passed
with no blockers; these are two additional human-requested polish fixes, folded into the same
PR rather than a new issue):

1. **Proportional allocation bar.** The bar (previously an inert, equal-width placeholder per
   #797/TD-39) now sizes each segment's width to that bucket's EXACT (unrounded) share of the
   displayed total — `AllocationLegendRow.barFraction: number | null`, computed by
   `computeBarFraction` in `useCapitalAllocationCard.ts` and rendered via inline `width` style in
   `CapitalAllocationCard.tsx`. A `null` bucket/unknown total renders no segment (filtered before
   mapping) rather than a fabricated share. Uses the raw fraction (not the rounded percent text)
   so segments sum to ~100% instead of drifting from independent per-row rounding.
2. **`< 1%` display rule.** `computePercentDisplay` now renders `"< 1%"` for a strictly-positive
   share under 1% (previously would round to `"0%"` or `"1%"`); `pct <= 0` or non-finite still →
   `null` (no pill); `pct >= 1` still rounds to the nearest whole percent. A sub-1% bucket still
   gets its (thin) proportional bar segment via `barFraction` — the two computations are
   deliberately independent (rounded display text vs. raw fraction).

Explicitly out of scope for this follow-up (per the review-feedback instructions): PR #812's
stale-zero-override / >100%-when-total-null follow-up — a separately tracked issue, not
regressed by either fix above.

TD-41 (`docs/exec-plans/tech-debt-tracker.md`) extended to cover both fixes as the same category
of guarded, documented, client-computed proportion over real sources. Tests extended in
`-useCapitalAllocationCard.test.ts` (barFraction computation, `< 1%` boundary at exactly 1%) and
`-CapitalAllocationCard.test.tsx` (segment width assertions, `< 1%` pill rendering).
