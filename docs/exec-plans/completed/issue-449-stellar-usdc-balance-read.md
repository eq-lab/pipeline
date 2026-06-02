# Issue #449: [FE] [Stellar] USDC balance read via Horizon (useStellarToken)

Source: https://github.com/eq-lab/pipeline/issues/449

Part of epic #444 (Stellar/Soroban multi-chain wallet), sub-issue 2. Blocker
#448 (Stellar wallet plumbing) is **closed and merged to `main`**: the modules
`src/wallet/stellar/{config,chain,mock,StellarWalletProvider,useStellarWallet}.ts(x)`,
the shared `QueryClientProvider` (provided by `EvmWalletProvider`, wraps
`StellarWalletProvider` per `main.tsx`), and the split ESLint boundary are all in
place. This issue is purely additive — a new read hook plus tests and docs.

## Scope

Add `src/wallet/stellar/useStellarToken.ts` — reads the connected Stellar
account's USDC balance from Horizon and returns it in a shape consistent with the
EVM `useEvmToken` consumers (a formatted currency string + loading/error). No UI
wiring (the dropdown / pill switching is epic sub-issue 3).

In scope:

- `src/wallet/stellar/useStellarToken.ts` — new read hook:
  - Resolves the connected account via the existing `useStellarWallet()`
    (`{ address, isConnected }`).
  - Uses `@stellar/stellar-sdk` `Horizon.Server.loadAccount(address)` against
    `horizonUrl` from `stellar/chain.ts`.
  - Picks the USDC balance out of the `balances` array by matching
    `asset_issuer === usdcIssuer` (from `stellar/chain.ts`) AND
    `asset_code === "USDC"`.
  - Registers its own TanStack Query key on the existing shared `QueryClient`
    (the same client `EvmWalletProvider` mounts), following the
    `useNetworkFeeEstimate.ts` precedent (`useQuery` is allowed directly inside
    `src/wallet/**`).
  - Honors the `pipeline.mock.wallet.stellar.balance.usdc` mock key (already
    defined as `STELLAR_MOCK_KEYS.balanceUsdc` in `stellar/mock.ts`).
  - Returns `{ balance, formattedBalance, isLoading, error, refetch }` (see
    "Return shape" below).
- A small decimal-string formatting helper (`formatUsdcDisplay`) so the balance
  renders as a USD currency string (`"$1,234.56"`) consistent with the EVM
  pill, per the epic risk note (Horizon returns a plain decimal string — no
  on-chain `decimals()` call needed).
- Export `useStellarToken` + its result type from the `src/wallet/index.ts`
  barrel.
- Unit tests: `src/wallet/stellar/useStellarToken.test.tsx` with mocked Horizon
  `loadAccount` responses (with-balance, no-trustline, error, disconnected,
  mock-key).
- Doc updates: wallet `README.md` (Stellar namespace — balance now wired),
  `docs/frontend/hooks.md` (`useStellarToken` row; update the `useStellarWallet`
  row's "Balance not yet wired" note).

Out of scope (later epic sub-issues / future epics):

- `WalletViewContext`, dropdown segmented control, `TopBar` pill switching,
  connect chooser modal — epic sub-issue 3. This issue does **not** edit
  `TopBar.tsx` / `AccountDropdown.tsx` / any route.
- Soroban contract calls / signing; trustline creation; sending payments.
- Stellar transaction history / Activity tab.
- Multi-asset support — only USDC is read.

## Assumptions and Risks

- **Horizon server class is `Horizon.Server`, not the top-level `Server`.** The
  Issue body says "`Server.loadAccount`", but in the installed
  `@stellar/stellar-sdk` (v15.1.0, pinned by #448) the class is exported as
  `Horizon.Server` — verified at the installed package
  (`s.Horizon.Server.prototype.loadAccount` is a function; top-level `s.Server`
  is `undefined`). The hook must use `new Horizon.Server(horizonUrl)`. Keep this
  import confined to `stellar/**` (ESLint boundary already allows it there).
- **Balance entry shape.** Horizon `loadAccount(address)` resolves an
  `AccountResponse` whose `balances` is an array. For a credit asset each entry
  has `{ asset_type: "credit_alphanum4" | "credit_alphanum12", asset_code,
  asset_issuer, balance }`; the native XLM entry has `asset_type: "native"` and
  no `asset_code`/`asset_issuer`. USDC is `credit_alphanum4` with
  `asset_code === "USDC"`. Match on BOTH `asset_code === "USDC"` AND
  `asset_issuer === usdcIssuer` to avoid picking up a same-code asset from a
  different (fake) issuer. The `balance` field is a **plain decimal string**
  (e.g. `"1234.5678900"`), already human-scaled (Stellar uses 7 decimals
  internally but Horizon returns the scaled decimal) — no `formatUnits` /
  decimals call is needed.
- **No-trustline case = 0 USDC.** If the account has no USDC trustline, no entry
  matches → treat as balance `"0"` (display `"$0.00"`), NOT an error. The "Done
  when" criterion requires `0`/empty in this case.
- **Account-not-found (unfunded account).** A brand-new/unfunded Stellar account
  makes `loadAccount` reject with a `NotFoundError` (404). Treat this the same as
  no-trustline → balance `"0"` (the account simply holds nothing yet), not a
  hard error, so a freshly connected-but-unfunded wallet shows `$0.00` rather
  than an error state. Distinguish 404 (→ `"0"`) from other failures (→ surface
  as `error`). Network/5xx/parse errors surface via `error`.
- **Return-shape parity with `useEvmToken`, but typed for a decimal string.**
  `useEvmToken` returns `balance: bigint | undefined` (raw integer) +
  `formattedBalance: string | undefined` (`"$1,000.00"`) + `refetchBalance` +
  `isLoading` + `error`. Horizon gives a decimal string, so `useStellarToken`
  returns `balance: string | undefined` (the raw Horizon decimal string) +
  `formattedBalance: string | undefined` (USD currency string) + `refetch` +
  `isLoading` + `error: Error | null`. This keeps the consumer ergonomics
  (`formattedBalance ?? "—"`, used by `TopBar`) identical while being honest
  about the underlying type. The naming (`refetch` vs EVM's `refetchBalance`) is
  an open question — see Open Questions.
- **Shared QueryClient.** `StellarWalletProvider` mounts INSIDE
  `EvmWalletProvider` (confirmed in `main.tsx` and documented in
  `StellarWalletProvider.tsx`), so it sits within the single
  `QueryClientProvider`. `useStellarToken` therefore calls `useQuery` directly
  (allowed in `src/wallet/**`) and gets the shared client for free — exactly the
  `useNetworkFeeEstimate.ts` pattern. The test wrapper must provide a
  `QueryClientProvider` (the EVM token test mocks it away; the network-fee test
  wraps with a real client — follow the network-fee approach so `useQuery`
  actually runs).
- **Mock fast-path must issue zero network calls.** When
  `pipeline.mock.wallet.stellar.balance.usdc` is set, the hook returns the mock
  value without constructing a `Horizon.Server` / calling `loadAccount`
  (`enabled: false` on the query, mirroring the EVM "no RPC in full mock mode"
  lock-in guard). The mock value is a **plain decimal string** (per the
  `STELLAR_MOCK_KEYS.balanceUsdc` doc comment) — parse it as-is, do NOT divide by
  `1e7`. (Note: the comment in `stellar/mock.ts` gives an example `"10000000" =
  1 USDC` implying a 7-decimal integer; this conflicts with the Horizon decimal
  string the real path returns. Resolving this is an Open Question — the plan's
  default is a human-scaled decimal string to match Horizon, but the coder must
  align the mock-key semantics and its doc comment to whichever the manager
  picks.)
- **`@stellar/stellar-sdk` is already a dependency** (added by #448, pinned
  `15.1.0`). No `package.json` change. The Horizon import is what justified the
  ESLint boundary in #448; this issue is the first real consumer.
- **`Server` construction is network-only on use.** `new Horizon.Server(url)`
  does not call the network at construction; only `loadAccount` does. Constructing
  it inside the `queryFn` (lazily, only when the query is enabled) keeps test
  isolation simple and avoids any module-load network/DOM work.

## Open Questions

- **Result field naming.** EVM's hook exposes `refetchBalance`; should the
  Stellar hook mirror that exact name or use a shorter `refetch`? (The plan
  proposes `refetch` for the Stellar hook since it reads a single value, but the
  manager/coder may prefer strict `refetchBalance` parity for symmetric
  consumers in sub-issue 3.)
- **Mock-key value semantics for `pipeline.mock.wallet.stellar.balance.usdc`.**
  The existing `stellar/mock.ts` doc comment describes it as a 7-decimal integer
  string (`"10000000" = 1 USDC`), but the real Horizon path returns a
  human-scaled decimal string (`"1.0000000"`). These are inconsistent. The plan
  defaults to **human-scaled decimal string** (so mock and real paths agree and
  no scaling math is needed), which requires correcting the `stellar/mock.ts`
  doc comment. Confirm this is the intended semantics before the coder edits the
  comment, or specify the integer-string convention instead (in which case the
  hook divides by 1e7 on the mock path only).

## Implementation Steps

1. **`src/wallet/stellar/useStellarToken.ts`** — new hook. Structure mirrors
   `evm/useEvmToken.ts` (return shape) and `evm/useNetworkFeeEstimate.ts`
   (`useQuery` + mock fast-path + `enabled` gating):
   - Imports:
     - `import { useQuery } from "@tanstack/react-query";`
     - `import { Horizon } from "@stellar/stellar-sdk";`
     - `import { horizonUrl, usdcIssuer } from "./chain";`
     - `import { useMock, readMock } from "../evm/mock";` plus a local
       `parseUsdcMock` (identity decimal-string parser) or reuse a generic string
       parse. Use `STELLAR_MOCK_KEYS.balanceUsdc` from `./mock`.
     - `import { useStellarWallet } from "./useStellarWallet";`
   - Read `{ address, isConnected }` from `useStellarWallet()`.
   - Mock read: `const mockBalance = useMock(STELLAR_MOCK_KEYS.balanceUsdc, parseString)`.
   - `queryFn` (async): re-read the mock at query time (defensive, like
     network-fee); if disconnected/no address return `undefined`; otherwise
     `const server = new Horizon.Server(horizonUrl); const account =
     await server.loadAccount(address);` then scan `account.balances` for the
     entry where `b.asset_type !== "native"` && `b.asset_code === "USDC"` &&
     `b.asset_issuer === usdcIssuer`; return that entry's `balance` string, or
     `"0"` when none matches. Wrap `loadAccount` so a 404 / `NotFoundError`
     resolves to `"0"` (unfunded account = no balance), and rethrow other errors
     so `useQuery` surfaces them.
   - `enabled`: `mockBalance === undefined && isConnected && !!address`.
   - Query key: `["stellarUsdcBalance", address, usdcIssuer, horizonUrl]`.
   - `staleTime` / `refetchInterval`: pick a sensible polling cadence
     (e.g. `staleTime: 30_000`); `retry: false` (or a small count) to avoid
     hammering Horizon on hard failures.
   - Mock fast-path (before returning real path): when `mockBalance !== undefined`
     return `{ balance: mockBalance, formattedBalance:
     formatUsdcDisplay(mockBalance), isLoading: false, error: null, refetch:
     () => {} }`.
   - Disconnected: return
     `{ balance: undefined, formattedBalance: undefined, isLoading: false,
     error: null, refetch: query.refetch }`.
   - Real path: `balance = query.data`, `formattedBalance = query.data !==
     undefined ? formatUsdcDisplay(query.data) : undefined`,
     `isLoading: query.isLoading`, `error: (query.error as Error|null) ?? null`,
     `refetch: query.refetch`.
   - `formatUsdcDisplay(decimalStr: string): string` — `new
     Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
     minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
     Number(decimalStr))`. Export it for reuse/testing. (Mirror the
     `formattedBalance` formatter in `useEvmToken.ts` so the pill is consistent.)
   - Full JSDoc header mirroring the other wallet hooks (mock key, return shape,
     no-trustline → `$0.00`, unfunded → `$0.00`).

2. **Barrel — `src/wallet/index.ts`** — add to the Stellar namespace section:
   `export { useStellarToken } from "./stellar/useStellarToken";` and
   `export type { UseStellarTokenResult } from "./stellar/useStellarToken";`
   (and `formatUsdcDisplay` only if a consumer/test outside `stellar/**` needs
   it — otherwise keep it internal). Do NOT re-export raw `@stellar/stellar-sdk`
   types through the barrel.

3. **Tests — `src/wallet/stellar/useStellarToken.test.tsx`** (see Test
   Strategy). Mock `@stellar/stellar-sdk` so `Horizon.Server` is a fake whose
   `loadAccount` is a controllable spy; wrap the hook in a real
   `QueryClientProvider` (follow `useNetworkFeeEstimate.test.tsx`); mock
   `./useStellarWallet` (or its `./config`/gate deps) so `address`/`isConnected`
   are controllable without touching the kit.

4. **Docs:**
   - `packages/frontend/src/wallet/README.md` — in the Stellar namespace
     section, document `useStellarToken` (API table, the
     `pipeline.mock.wallet.stellar.balance.usdc` key now wired, no-trustline /
     unfunded → `$0.00`, USDC matched by issuer + code). Update the
     "balance is not yet wired" statement left by #448.
   - `docs/frontend/hooks.md` — add a `useStellarToken` row (sorted
     alphabetically) and update the `useStellarWallet` row to drop the
     "Balance not yet wired (sub-issue 2)" clause.
   - If the mock-key semantics decision (Open Question) lands on human-scaled
     decimal strings, fix the `STELLAR_MOCK_KEYS.balanceUsdc` doc comment in
     `src/wallet/stellar/mock.ts` to match.

## Test Strategy

Add `src/wallet/stellar/useStellarToken.test.tsx` (mirror
`useNetworkFeeEstimate.test.tsx` for the QueryClient wrapper and
`useEvmToken.test.tsx` for the mock-key / balance assertions):

- **Mock `@stellar/stellar-sdk`** with `vi.mock` so `Horizon.Server` is a class
  whose `loadAccount` is a hoisted spy (`mockLoadAccount`), controllable per
  test. **Mock `./useStellarWallet`** to return controllable
  `{ address, isConnected }` (avoids pulling in the kit `./config` and the gate).
  Wrap the hook under test in a real `QueryClientProvider` with a fresh
  `QueryClient` per test (so `useQuery` actually executes the `queryFn`).
- Cases:
  - **With balance:** connected; `loadAccount` resolves an account whose
    `balances` includes a USDC entry (`asset_code: "USDC"`,
    `asset_issuer: <usdcIssuer>`, `balance: "1234.5678900"`). Assert
    `balance === "1234.5678900"` and `formattedBalance === "$1,234.57"` (await
    via `waitFor`).
  - **Issuer mismatch is ignored:** `balances` has a `USDC` entry from a
    DIFFERENT issuer → treated as no match → `balance === "0"`,
    `formattedBalance === "$0.00"`.
  - **No trustline:** `balances` has only the native XLM entry → `balance ===
    "0"`, `formattedBalance === "$0.00"`, `error === null`.
  - **Unfunded account (404):** `loadAccount` rejects with a `NotFoundError`-shaped
    error (status/response 404) → `balance === "0"`, `error === null`.
  - **Hard error:** `loadAccount` rejects with a generic/network error →
    `balance === undefined`, `error` is the Error, `formattedBalance` undefined.
  - **Disconnected:** `isConnected: false` / no address → `balance` undefined,
    `loadAccount` never called, query disabled.
  - **Mock key:** `pipeline.mock.wallet.stellar.balance.usdc` set → hook returns
    the mock balance + formatted string and **`loadAccount` is never called**
    (assert the spy has zero calls — the EVM "no RPC in full mock mode" lock-in
    guard, adapted).
  - **`refetch` exposed:** returned `refetch` is a function and (optionally)
    delegates to the query refetch.
- Run the full frontend gate before handing back:
  `yarn workspace @pipeline/frontend lint` (ESLint + prettier — confirms the
  `@stellar/stellar-sdk` import stays within the Stellar boundary),
  `yarn workspace @pipeline/frontend build` (tsc -b + vite build), and
  `yarn workspace @pipeline/frontend test`. Per AGENTS.md also run
  `npx tsx scripts/lint-docs.ts` for the doc edits.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — `useStellarToken` in the Stellar
  namespace section; mark the balance mock key as wired; document
  no-trustline / unfunded → `$0.00` and issuer+code matching.
- `docs/frontend/hooks.md` — add `useStellarToken` row; update `useStellarWallet`
  row to drop the "balance not yet wired" note.
- `src/wallet/stellar/mock.ts` — only if the Open Question resolves to
  human-scaled decimal strings (fix the `balanceUsdc` doc comment).
- No product-spec change required: this is internal read plumbing with no
  user-facing UI in this issue (the pill wiring is sub-issue 3, which carries the
  user-facing spec impact). The epic #444 already captures product intent.
