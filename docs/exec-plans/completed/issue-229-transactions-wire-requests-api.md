# Issue #229: Wire /transactions to GET /v1/requests; drop 'All' tab; mockable API base

Source: https://github.com/eq-lab/pipeline/issues/229

## Scope

Wire the `/transactions` page (`packages/frontend/src/routes/transactions.tsx`) to the
existing backend `GET /v1/requests` endpoint, drop the **All** tab from the segmented
filter, and introduce a small `src/api/` module that mirrors the existing wallet
mock-layer pattern.

In scope:

- New env var `VITE_API_BASE_URL` plumbed through `packages/frontend/src/lib/env.ts`
  and `.env.example` (root file — there is no per-package frontend `.env.example`).
- New `packages/frontend/src/api/` module:
  - `client.ts` — `apiFetch<T>(path, init?)` helper. Resolves the URL against
    `ENV.API_BASE_URL`. Consults the `pipeline.mock.api.<METHOD>.<path>` localStorage
    keys before issuing a real fetch. Throws on non-2xx with the parsed `{ error }`
    message when available.
  - `useRequests.ts` — React Query hook around `apiFetch("/v1/requests?wallet=…")`.
    Disabled when wallet is disconnected. Returns `{ data, isLoading, error, refetch }`.
  - `index.ts` — barrel re-exports.
  - `README.md` — documents the `pipeline.mock.api.*` key schema with a DevTools
    snippet (parallel to `src/wallet/README.md`).
- Mock-layer reactivity: extend the same-tab bridge so `pipeline.mock.api.*` writes
  fan out the same way `pipeline.mock.wallet.*` writes do today.
- ESLint `no-restricted-imports` extension to forbid direct `fetch` outside
  `src/api/` (mirrors the `viem`/`wagmi` boundary).
- Page rewrite of `transactions.tsx`:
  - Drop the `"all"` tab; default `activeTab = "buy"`.
  - Replace the five hardcoded rows with `useRequests()` output.
  - Client-side filter on the in-memory array per the type → tab mapping below.
  - Empty / loading / error states.
- New `packages/frontend/src/lib/format.ts` helpers built on top of the existing
  `lib/usdc.ts` primitives:
  - `formatTokenAmount(raw: bigint | string, decimals: number): string` — generalizes
    `formatUsdc` to any decimals (6 for USDC, 18 for PLUSD/sPLUSD).
  - `formatActivityTime(iso: string): string` — formats an ISO-8601 UTC timestamp as
    `"Apr 17, 2:17 PM"` in the user's local timezone via `Intl.DateTimeFormat`.
- Tests for the new module and the page.

Out of scope (explicitly listed in the Issue):

- Pagination — endpoint returns the full list.
- `status=pending` filtering — pending is a UI concern; the API call always uses the
  default (`status=all`).
- Linking rows to a tx-detail page.
- Reconnect / retry-on-disconnect logic — the hook is simply disabled when no wallet
  is connected.
- Generalizing `apiFetch` beyond GET (POST/PUT/etc.) — only GET is required by this
  Issue. Keep the mock-key shape future-proof (`pipeline.mock.api.<METHOD>.<path>`)
  but only the GET branch is implemented and tested.

## Assumptions and Risks

- **`useUsdcBalance` is gone.** The Issue body references a "formatter from
  `useUsdcBalance`"; that hook was removed in #220 and replaced by `useToken`. The
  user-supplied note clarifies we should generalize the helpers in
  `packages/frontend/src/lib/usdc.ts` (added in #227) into a new
  `packages/frontend/src/lib/format.ts#formatTokenAmount(raw, decimals)`. We follow
  that direction. `lib/usdc.ts` is left in place; `formatUsdc` becomes a thin
  6-decimals wrapper around `formatTokenAmount` to avoid duplicate Intl formatters
  and to keep call sites (deposit / quick-amount chips / low-balance banner)
  unchanged.
- **Shared `QueryClient`.** `WalletProvider` instantiates its own `QueryClient`
  (a module-level singleton). The wallet module's barrel does not currently
  re-export that client. Rather than punching a hole through the wallet boundary,
  the new `useRequests` hook will use `useQuery` from `@tanstack/react-query`
  directly. Because `@tanstack/react-query` is restricted to `src/wallet/**` by
  ESLint today, we extend the restriction allow-list to also include
  `src/api/**` — the api module is the second island of "library boundary"
  code, analogous to the wallet module. Without this the hook cannot import
  `useQuery`. Documented and enforced via `no-restricted-imports` (see
  Implementation Step 7).
- **Mock-bridge event name.** The existing bridge dispatches `pipeline-mock:wallet`
  for any `pipeline.mock.*` write. We reuse the same event (it already covers all
  `pipeline.mock.*` keys, not just wallet ones). The event name is a minor
  misnomer but renaming it is out of scope; document the reuse in the new
  `src/api/README.md`.
- **Mock lookup priority.** Two keys are documented in the Issue:
  `pipeline.mock.api.GET./v1/requests` (un-keyed alias) and
  `pipeline.mock.api.GET./v1/requests?wallet=<addr>` (per-wallet). `apiFetch` first
  tries the exact path-with-query key, then falls back to the path-without-query
  alias, then to a real `fetch`. This is consistent with the Issue's "with query
  string" → "without query string" → "real fetch" order.
- **Timestamp formatting.** `formatActivityTime` uses
  `Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })`
  on the runtime's local timezone. Snapshot tests pin a UTC date and assert on the
  *shape* (`/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/`) rather than the exact
  string to avoid TZ-dependent CI flakiness.
- **Empty / error states.** The Issue accepts utilitarian copy ("Loading…",
  "Couldn't load activity"). No new UI primitives needed.
- **Risk — API not yet reachable in dev.** The default `VITE_API_BASE_URL`
  (`http://localhost:8080`) is the API crate's default port (`API_PORT=8080` in
  `.env.example`). When the API is not running, `useRequests` surfaces a network
  error and the page renders the "Couldn't load activity" state. This is fine — the
  mock layer is the documented workaround.

## Open Questions

_None._

## Implementation Steps

1. **Env: add `API_BASE_URL`.**
   - Edit `packages/frontend/src/lib/env.ts` — add
     `API_BASE_URL: readString("VITE_API_BASE_URL", "http://localhost:8080")` to the
     `ENV` object (alphabetical insertion among the other keys).
   - Edit the root `.env.example` (the only `.env.example` in the repo) — add
     `VITE_API_BASE_URL=http://localhost:8080` to the `# ── Frontend (VITE_)` block.

2. **New helpers — `packages/frontend/src/lib/format.ts`.**
   - `formatTokenAmount(raw: bigint | string, decimals: number): string` — pure
     wrapper around `formatUnits(BigInt(raw), decimals)` plus a shared
     `Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`
     formatter. Imports `formatUnits` from `@/wallet` (see `lib/usdc.ts` for the
     existing pattern).
   - `formatActivityTime(iso: string): string` — uses `Intl.DateTimeFormat` (see
     Assumptions). Returns `"—"` for unparseable input.
   - Add `packages/frontend/src/lib/format.test.ts` (Vitest) — coverage for
     6-dp USDC, 18-dp PLUSD, zero, and large bigint inputs; plus shape-only
     assertions for `formatActivityTime`.
   - Update `packages/frontend/src/lib/usdc.ts` to delegate `formatUsdc` to
     `formatTokenAmount`. Keep the public `formatUsdc` / `formatUsdcCurrency` API
     unchanged. Existing `usdc.test.ts` cases must still pass.

3. **Mock-layer parse helpers — reuse.**
   - The existing `packages/frontend/src/wallet/mock.ts` already exports
     `readMock`, `useMock`, `parseJson`, and `installSameTabMockBridge` which fires
     for *any* `pipeline.mock.*` key. The api module imports these directly from
     `./wallet/mock` via a relative path inside `src/api/client.ts`. (The wallet
     barrel does not currently re-export `readMock`/`useMock`/`parseJson`; we can
     either import them via the existing barrel after adding exports or import them
     by relative path. The plan: re-export `readMock`, `useMock`, `subscribeMock`,
     and `parseJson` from `src/wallet/index.ts` so the api module reads them
     through the public surface.)

4. **New module — `packages/frontend/src/api/client.ts`.**
   - Exports `apiFetch<T>(path: string, init?: RequestInit): Promise<T>`:
     - Resolves URL as `${ENV.API_BASE_URL}${path}`.
     - Method = `init?.method ?? "GET"` (uppercased).
     - Mock key 1 (with query string): `pipeline.mock.api.${method}.${path}` —
       e.g. `pipeline.mock.api.GET./v1/requests?wallet=0x1234`.
     - Mock key 2 (without query string): strip everything from `?` onwards from
       `path`. If `mock1` is absent and `mock2` is present, return parsed `mock2`.
     - Otherwise `await fetch(url, init)`. On non-2xx, attempt
       `await response.json()` and throw
       `new Error(payload?.error ?? response.statusText)`. On 2xx, return
       `response.json() as T`.
   - The mock read uses `readMock(key, parseJson)` from `@/wallet`.
   - **Non-reactive lookup at fetch time.** `apiFetch` reads the mock keys with
     `readMock` (not `useMock`) — reactivity is supplied by the hook layer via
     React Query's `queryKey`, which includes the wallet address; mock-key changes
     cause `useRequests` to re-issue the query. See step 6 for the reactive
     `useSyncExternalStore` wrapper.

5. **New hook — `packages/frontend/src/api/useRequests.ts`.**
   - Inputs: none; reads `useWallet()` for the connected address.
   - `useQuery({ queryKey: ["requests", address], queryFn: () => apiFetch(...), enabled: isConnected && !!address })`.
   - Subscribe to the mock event via `useSyncExternalStore` on `subscribeMock` (any
     key — same trick as `useMock`), and call `query.refetch()` whenever the
     `pipeline.mock.api.GET./v1/requests*` keys change. This guarantees DevTools
     console writes update the page without reload, matching the wallet module's
     UX.
   - Return type: `{ data, isLoading, error, refetch }` (subset of React Query's
     surface).
   - Export a `RequestItem` TypeScript type that mirrors the Rust `RequestItem`
     schema (see `packages/api/src/routes/analytics.rs:37`):
     ```ts
     export type RequestStatus =
       | "PendingVerification"
       | "PendingClaim"
       | "Completed"
       | "VerificationFailed";
     export type RequestType = "Deposit" | "Withdraw" | "Stake" | "Unstake";
     export interface RequestItem {
       type: RequestType;
       request_id?: string;
       amount: string;
       assets?: string;
       shares?: string;
       status: RequestStatus;
       created_at: string;
     }
     export interface RequestsResponse { requests: RequestItem[] }
     ```

6. **New barrel — `packages/frontend/src/api/index.ts`.**
   - Re-export `apiFetch` from `./client`.
   - Re-export `useRequests` and types (`RequestItem`, `RequestType`,
     `RequestStatus`, `RequestsResponse`) from `./useRequests`.

7. **ESLint — extend `no-restricted-imports`.**
   - Edit `packages/frontend/eslint.config.js`:
     - In the `no-restricted-imports` block that currently lists
       `wagmi`/`viem`/`@reown/*`/`@tanstack/react-query`: add `src/api/**` to the
       `ignores` array so the api module can `import { useQuery } from "@tanstack/react-query"`.
     - Add a NEW block that restricts the global `fetch` call to `src/api/**`:
       ```js
       {
         files: ["**/*.{ts,tsx}"],
         ignores: ["src/api/**", "src/test-setup.ts"],
         rules: {
           "no-restricted-globals": [
             "error",
             { name: "fetch", message: "Call fetch only via @/api (src/api/client.ts)." },
           ],
         },
       },
       ```
       (`no-restricted-globals` catches bare `fetch(...)` references; this is the
       same enforcement style used for `viem`/`wagmi` boundaries.)

8. **Wallet barrel — expose mock helpers.**
   - Edit `packages/frontend/src/wallet/index.ts` to also export `readMock`,
     `useMock`, `subscribeMock`, and `parseJson` from `./mock`. This keeps
     `src/api/` from reaching across module boundaries via relative paths.

9. **`src/api/README.md`.**
   - Mirror the structure of `src/wallet/README.md`:
     - "Public API" section listing `apiFetch`, `useRequests`, and exported types.
     - "localStorage mock key schema" section with the table from the Issue body
       (un-keyed + per-wallet keys, lookup order), plus a DevTools snippet that
       seeds three example rows (Deposit Completed, Withdraw PendingClaim, Stake).

10. **Page rewrite — `packages/frontend/src/routes/transactions.tsx`.**
    - Drop `{ id: "all", label: "All" }` from `TABS`. Default
      `activeTab = "buy"`.
    - Replace hardcoded rows with a `useRequests()` call:
      ```tsx
      const { data, isLoading, error, refetch } = useRequests();
      const items = data?.requests ?? [];
      const filtered = items.filter((r) => TYPE_TO_TAB[r.type] === activeTab);
      ```
    - Type → tab map:
      ```ts
      const TYPE_TO_TAB: Record<RequestType, string> = {
        Deposit: "buy",
        Withdraw: "sell",
        Stake: "stake",
        Unstake: "unstake",
      };
      ```
    - Render rules (each branch maps an item to an `<ActivityRow>`):
      - **Deposit Completed** — `icon="check-circle"`, `tone="success"`,
        `title="Buy"`, right slot `<AmountPill>+{formatTokenAmount(amount, 6)} USDC</AmountPill>`.
      - **Deposit PendingClaim / PendingVerification** — `icon="clock-pending"`,
        `tone="warning"`, `title="Buy"`,
        right slot `<TwoLineAmount primary="+{...} USDC" secondary="Pending" tone="muted" />`.
      - **Deposit VerificationFailed** — same as above with
        `secondary="Verification failed"`.
      - **Withdraw** — same shape as Deposit with `−` sign and `title="Sell"`.
      - **Stake** — `icon="arrow-down-circle"`, `title="Stake"`,
        `<TwoLineAmount primary="−{formatTokenAmount(assets, 18)} PLUSD" secondary="+{formatTokenAmount(shares, 18)} sPLUSD" />`.
      - **Unstake** — `icon="arrow-up-circle"`, `title="Unstake"`,
        `<TwoLineAmount primary="+{formatTokenAmount(assets, 18)} PLUSD" secondary="−{formatTokenAmount(shares, 18)} sPLUSD" />`.
    - Timestamps: `formatActivityTime(item.created_at)`.
    - States:
      - `isLoading && !data` → render `<div className="text-[color:var(--color-pipeline-ink-muted)]">Loading…</div>`.
      - `error && !data` → render a muted line `"Couldn't load activity"` + a
        Retry button that calls `refetch()`.
      - `data && filtered.length === 0` → render `"No activity yet"` muted line.
      - Otherwise → render the filtered rows.
    - Keep the existing `TwoLineAmount` helper as-is.
    - Keep token discipline: no raw colors / pixel sizes — all values through
      design tokens.

11. **Lint guard — verify trapped imports.**
    - Run `yarn workspace @pipeline/frontend lint` (or repo-level `lint` step) to
      confirm:
      - Direct `fetch` outside `src/api/` errors.
      - Direct `@tanstack/react-query` outside `src/wallet/**` and `src/api/**`
        errors.

## Test Strategy

1. **`packages/frontend/src/lib/format.test.ts`** (new):
   - `formatTokenAmount(1_000_000n, 6)` → `"1.00"`
   - `formatTokenAmount(1_000_000_000n, 6)` → `"1,000.00"`
   - `formatTokenAmount(1_000_000_000_000_000_000_000n, 18)` → `"1,000.00"`
   - `formatTokenAmount(0n, 6)` → `"0.00"`
   - Accepts a `string` raw (`"1000000"`) as well as `bigint`.
   - `formatActivityTime("2026-04-17T14:17:00Z")` matches
     `/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/`.
   - `formatActivityTime("not-a-date")` → `"—"`.

2. **`packages/frontend/src/lib/usdc.test.ts`** (existing):
   - Re-run to confirm the `formatUsdc` delegation to `formatTokenAmount` is
     backwards-compatible (no behavior change). No new cases needed.

3. **`packages/frontend/src/api/client.test.ts`** (new):
   - Path-with-query mock key resolves first (highest priority).
   - Path-without-query mock key resolves when the with-query key is absent.
   - With no mock key set, `apiFetch` calls `globalThis.fetch` with the resolved
     URL (`${ENV.API_BASE_URL}${path}`).
   - Non-2xx response with JSON body `{ error: "boom" }` rejects with
     `new Error("boom")`.
   - Non-2xx with non-JSON body falls back to `response.statusText`.
   - Use `vi.spyOn(globalThis, "fetch")` for the real-fetch branch.

4. **`packages/frontend/src/api/useRequests.test.tsx`** (new):
   - With `pipeline.mock.wallet.address` and `pipeline.mock.wallet.isConnected`
     set + `pipeline.mock.api.GET./v1/requests` set to a fixture: hook returns
     fixture data immediately, never calls `fetch`.
   - With no mock keys but a connected wallet (`useWallet` mocked): hook calls
     `apiFetch("/v1/requests?wallet=0x…")` and returns the parsed body.
   - With a disconnected wallet: `query.enabled` is false; hook returns
     `{ data: undefined, isLoading: false }` and never calls `fetch`.
   - Writing to `pipeline.mock.api.GET./v1/requests` after mount triggers a
     re-render with the new value (verifies the `useSyncExternalStore` glue).
   - Use the project's existing test patterns from
     `packages/frontend/src/wallet/useToken.test.tsx` (test-setup, mock layer).

5. **`packages/frontend/src/routes/transactions.test.tsx`** (new — file does not
   exist today; `routes/-deposit.test.tsx` is the closest sibling and shows the
   `-`-prefixed pattern that TanStack Router excludes from route generation):
   - With a mocked `pipeline.mock.api.GET./v1/requests` payload containing one
     Deposit Completed + one Withdraw PendingClaim + one Stake Completed:
     - All three rows render under the default `"buy"` tab → only Deposit visible.
     - Clicking `"Sell"` → only Withdraw visible.
     - Clicking `"Stake"` → only Stake visible.
   - The `"All"` tab is not present (`getByText("All")` throws).
   - Empty fixture (`{ requests: [] }`) renders the "No activity yet" empty state.
   - Force the `apiFetch` to throw (no mock + `fetch` mock rejecting) →
     "Couldn't load activity" + Retry button visible. Clicking Retry re-issues
     the query.
   - Disconnected wallet → hook is disabled; an empty state or "Loading…" is fine
     (we explicitly assert that no `fetch` call is made).
   - Formatting assertions: `"+1,000.00 USDC"`, `"−1,000.00 USDC"`,
     `"−1,000.00 PLUSD"` / `"+999.50 sPLUSD"` style strings appear in the rendered
     output.
   - Timestamp shape assertion uses the regex from format.test.ts.

6. **Lint + build:**
   - `yarn workspace @pipeline/frontend lint` passes.
   - `yarn workspace @pipeline/frontend build` passes (TypeScript check).
   - `yarn workspace @pipeline/frontend test` passes.

## Docs to Update

- `packages/frontend/src/api/README.md` — new file (Public API + mock-key schema +
  DevTools snippet).
- `packages/frontend/src/wallet/README.md` — add a short pointer to
  `src/api/README.md` from the "localStorage mock key schema" section so readers
  discover the api-side mock keys when looking at the wallet-side ones. (Cross-link
  only; do not duplicate the table.)
- `.env.example` — add `VITE_API_BASE_URL=http://localhost:8080` in the Frontend
  block.
- No product-spec change required. This is a behavior-preserving wiring task: the
  page already advertises an "Activity" view; the data source moves from inline
  hardcoded rows to the existing API. No user-facing feature change. No
  `docs/product-specs/` update.
- No design-doc change required. The Figma reference (`1497-94912`) is unchanged;
  the visual structure of each row family (Deposit Completed, pending, stake,
  unstake, etc.) is preserved 1:1.
