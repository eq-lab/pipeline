# Issue #181: EVM wallet connection with WalletConnect and localStorage mock layer

Source: https://github.com/eq-lab/pipeline/issues/181

## Scope

Land the first real wallet integration in `packages/frontend`. A new `wallet/`
module owns every blockchain side effect; the rest of the app reads connection
state and contract data through a single `useWallet()` hook. A `localStorage`
mock layer can short-circuit every value the hook exposes without going to RPC,
so E2E / UX tests work without a real wallet or a live Hoodi node.

In scope:

- New module `packages/frontend/src/wallet/` containing:
  - `chain.ts` — Hoodi testnet definition via `defineChain` (viem-compatible
    shape used by `@reown/appkit/networks`).
  - `config.ts` — `WagmiAdapter` construction, AppKit `createAppKit` call,
    metadata, transports per chain (custom RPC URL from env).
  - `WalletProvider.tsx` — top-level provider that mounts `WagmiProvider`
    (from `wagmi`) and `QueryClientProvider` (from `@tanstack/react-query`).
  - `mock.ts` — `localStorage` resolution helpers + a small reactive
    subscription primitive (re-renders on `storage` events and on a local
    `window.dispatchEvent` for same-tab writes).
  - `useWallet.ts` — the public hook. Returns `address`, `isConnected`,
    `chainId`, `connect`, `disconnect`, plus `useUsdcBalance()` and
    `useContractRead({ address, abi, functionName, args })` thin wrappers
    that consult the mock layer first.
  - `abis/erc20.ts` — minimal ERC-20 ABI (`balanceOf`, `decimals`, `symbol`,
    `name`) used by `useUsdcBalance`.
  - `index.ts` — barrel that re-exports only the public surface
    (`WalletProvider`, `useWallet`, `useUsdcBalance`, `useContractRead`,
    plus the relevant TS types).
  - `README.md` — short doc listing every `pipeline.mock.wallet.*` key, type,
    and example value (so devs can flip state from the DevTools console).
- New `packages/frontend/src/lib/env.ts` (anticipated by the existing eslint
  rule that exempts this path): a single, typed accessor over the four
  `VITE_*` vars listed below, reading via `import.meta.env` and validating at
  module load (helpful runtime error if missing). All env reads in the wallet
  module go through this helper.
- `packages/frontend/src/main.tsx`: wrap `RouterProvider` with
  `<WalletProvider>`.
- `packages/frontend/src/routes/index.tsx`: wire the `TopBar` Connect Wallet
  click handler to `useWallet().connect()`. When `isConnected`, render the
  connected `TopBar` variant (`wallet={{ balance }}` — pre-formatted USDC
  balance from `useUsdcBalance`).
- `packages/frontend/src/routes/deposit.tsx` and `routes/withdraw.tsx`:
  replace the hardcoded `wallet={{ balance: "$10,000.00" }}` with real
  values from `useWallet()` + `useUsdcBalance()` (gracefully degrading to
  the disconnected variant when no wallet is connected).
- `packages/frontend/package.json`: add runtime deps `wagmi`, `viem`,
  `@reown/appkit`, `@reown/appkit-adapter-wagmi`, `@tanstack/react-query`.
- `packages/frontend/eslint.config.js`: add a `no-restricted-imports` rule
  forbidding `wagmi`, `viem`, `@reown/appkit*`, and `@tanstack/react-query`
  imports outside `src/wallet/**` (and outside `src/lib/env.ts` for the
  pre-existing exemption). This codifies the Issue's "no `wagmi`/`viem`
  imports outside the wallet module" rule.
- `.env.example`: add the four `VITE_*` keys with documented defaults for
  Hoodi (chain id `560048`, public Hoodi RPC, USDC test token address,
  WalletConnect project id placeholder), plus `VITE_WALLET_MOCKS_ENABLED`
  (default unset → mocks ON, see decision below).
- `docs/FRONTEND.md`: update the Web3 integration section. Today it lists
  "WalletConnect v2 / RainbowKit" and "ethers.js direct calls" — replace
  with the wagmi + viem + Reown AppKit stack and a pointer to
  `packages/frontend/src/wallet/README.md` for the mock key schema.
- `docs/STORIES.md`: add a new story `S-181` with three TC entries (real
  connect, mock connect, contract-read mock). The ux-tester flow needs these
  to verify acceptance.

Out of scope (per Issue):

- Real on-chain transactions (deposit / stake / withdraw flows). Those will
  be separate Issues that consume `useWallet()`.
- USDC approval flows.
- Network-switching UX (we surface `chainId` but do not prompt to switch).
- A connected-account dropdown / disconnect UI in `TopBar` beyond the
  existing pill (a `disconnect` function is exposed but no UI is wired —
  follow-up Issue).
- A backend / API for fetching balances. `useUsdcBalance` is a direct
  on-chain read via wagmi/viem (with mock override).
- Multi-account / wallet-switcher logic beyond what AppKit gives us for free.
- Operations Console wallet auth (operators authenticate by email + 2FA per
  `docs/product-specs/operations-console.md`).

## Assumptions and Risks

- **Stack is locked.** wagmi + viem + Reown AppKit (WalletConnect v2) is
  user-confirmed (Issue body, memory `project_wallet_stack.md`). Do not
  propose RainbowKit, ethers.js, or plain `@walletconnect/ethereum-provider`.
  `docs/FRONTEND.md` still mentions RainbowKit and ethers.js — that is stale
  and gets fixed in this Issue (see `Docs to Update`).
- **Hoodi testnet identifiers.** Chain id `560048` is given in the Issue
  body. Hoodi is not in `@reown/appkit/networks`, so we define it via
  `defineChain` per the AppKit docs. Native currency is ETH; explorer URL
  and a public RPC come from `https://github.com/eth-clients/hoodi`. The
  RPC URL is env-driven so a private RPC can replace the public one without
  a rebuild (`vite-plugin-runtime-env` is already in deps for this exact
  reason).
- **USDC on Hoodi.** Hoodi is a testnet — there is no canonical Circle USDC
  on it. The USDC address must be supplied via `VITE_USDC_ADDRESS` and
  defaults to the zero address (`0x000…000`) in `.env.example`. When the
  address is the zero address the wallet module skips the balance read and
  `useUsdcBalance` returns `undefined` (treated as "balance unknown" by the
  UI). This is documented in the env example and the wallet README.
- **Reown project id.** A real WalletConnect/Reown project id is required
  to connect against real wallets. `.env.example` ships a placeholder
  (`VITE_WALLETCONNECT_PROJECT_ID=YOUR_REOWN_CLOUD_PROJECT_ID`). When the
  placeholder is in place the AppKit init will still succeed (Reown does
  not validate format at construct time), but the modal will fail to relay
  to real wallets. Mock mode is the supported path for CI / E2E / Storybook.
  Provisioning a real project id is an operator task, not a code task.
- **`vite-plugin-runtime-env`.** Already installed (`packages/frontend/package.json`)
  and wired in `vite.config.ts`. This means `import.meta.env.VITE_*` values
  resolve from the runtime environment at page load (a server can inject
  them via a single `window.__ENV__` lookup), not just from `.env` at build
  time. The wallet module reads env only at AppKit construction time, so a
  single top-level `createAppKit` call is correct — no dynamic re-init.
- **ESLint env-access rule.** `eslint.config.js` already forbids direct
  `import.meta.env` access outside `src/lib/env.ts`. Honour that pattern by
  creating `src/lib/env.ts` (it does not exist yet — the rule is pre-emptive).
- **No raw colors.** Per `docs/FRONTEND.md` and project lint conventions,
  the AppKit modal will be themed via the `themeMode` / `themeVariables`
  options on `createAppKit`. Reuse `--color-pipeline-*` tokens via
  `getComputedStyle` lookup in `config.ts` so the modal honours the
  existing palette without inlining hex codes. Verify on Storybook /
  manual run.
- **`StrictMode` double-init.** `main.tsx` wraps everything in `StrictMode`.
  `createAppKit` is module-scope (called once at module load, not in render),
  so StrictMode's double-mount does not double-init the modal. Verify by
  asserting `getAppKit()` returns the same instance on remount in tests.
- **Storage events do not fire in the same tab.** `localStorage`'s `storage`
  event only fires across tabs by spec. To make the requirement "flip state
  from DevTools and see UI update without reload" work in the SAME tab,
  the mock layer subscribes to a custom `pipeline-mock:wallet` event that
  it also dispatches when a key is written through its setter; for DevTools
  edits, we additionally poll `localStorage` on a `requestAnimationFrame`
  loop or — preferred — patch `localStorage.setItem` once at module load so
  writes from the console also fan out. Plan picks the localStorage.setItem
  patch approach (simpler, no polling); document in the README that this is
  installed exactly once on `WalletProvider` mount.
- **Mock-on-by-default vs. env flag.** Issue body explicitly leaves this to
  the planner. Decision: **mocks are honoured whenever a `pipeline.mock.wallet.*`
  key is present, with NO env gate.** Rationale: the absence of a key is
  already a perfect off-switch, an extra env flag introduces a second source
  of truth, and the Issue's acceptance criteria phrase it as "Setting the
  key in localStorage makes the app behave as if connected" — no flag
  toggling required. `VITE_WALLET_MOCKS_ENABLED` is therefore NOT
  introduced. Documented as a non-decision in the wallet README.
- **Type-only memory of wagmi `useReadContract`.** wagmi v2's
  `useReadContract` returns a discriminated result (`{ data, isLoading,
  error, … }`). Our `useContractRead` wrapper mirrors this shape so call
  sites read identical fields whether the value came from a mock or a
  real read. The wrapper does NOT widen the type of `data` — if mocks
  return a JSON-parsed value of the wrong type, the call site sees a TS
  type mismatch the moment it touches `.data`. This is intentional: the
  mock is a developer aid, not a runtime escape hatch.
- **Test isolation.** Each unit test must clear `localStorage` in
  `beforeEach`, otherwise mock-mode test pollution will leak across tests.
  Add to `test-setup.ts` if needed.
- **`@pipeline/ui` boundary.** None of the new code lives in `@pipeline/ui`.
  `TopBar` accepts an `onConnectWallet` handler and a `wallet` prop already
  (#112), so the connection wiring happens in the route components, not in
  the UI package. The UI package stays free of any Web3 dependency.
- **Risk: a hardcoded mainnet asset address slipping into prod.** Mitigated
  by reading USDC address from env and defaulting to the zero address. A
  smoke test asserts that the runtime config never points at a known
  mainnet USDC (`0xa0b86…`) on a non-mainnet chain.
- **Risk: WalletConnect v2 requires HTTPS in browsers that block mixed
  content.** Dev server uses HTTP. The AppKit modal works over HTTP on
  `localhost` (WalletConnect treats `localhost` as secure). Production
  hosting must be HTTPS — flagged but out of scope for this Issue.

## Open Questions

1. **Reown Cloud project id provisioning.** We ship a placeholder in
   `.env.example`. Who owns creating the real Reown Cloud project id and
   storing it as a deploy-time secret? (Answer affects ops handover, not
   the code in this Issue, so the coder can proceed and the manager can
   resolve this asynchronously.)
2. **USDC address on Hoodi.** Hoodi has no canonical Circle USDC. Options:
   (a) deploy a test ERC-20 we control and document the address; (b) leave
   `VITE_USDC_ADDRESS` unset and surface a "USDC not configured" state in
   the UI; (c) read the address from a future contracts deployment manifest.
   The plan defaults to option (b) with a zero-address fallback so the UI
   does not crash. Confirm with product before a real public deploy.

## Implementation Steps

> All file paths are absolute from the repo root. The coder runs every
> command from the repo root unless noted.

### 1. Install dependencies

Add to `/Users/dima/git/pipeline/packages/frontend/package.json` under
`dependencies` (use the highest stable line at the time of implementation):

- `wagmi`
- `viem`
- `@reown/appkit`
- `@reown/appkit-adapter-wagmi`
- `@tanstack/react-query`

Run `yarn install` from the repo root (workspace install). Confirm
`yarn workspace @pipeline/frontend build` still passes before any source
changes.

### 2. Create the typed env accessor

New file `/Users/dima/git/pipeline/packages/frontend/src/lib/env.ts`:

- Export a frozen `ENV` object with the four wallet-related values
  (`EVM_CHAIN_ID: number`, `EVM_RPC_URL: string`, `USDC_ADDRESS:
  \`0x${string}\``, `WALLETCONNECT_PROJECT_ID: string`).
- Source from `import.meta.env.VITE_*`. This is the ONE place in the
  codebase allowed to read `import.meta.env` directly (the eslint config
  already exempts this path).
- Validate at module load: each required value either has a documented
  default (`EVM_CHAIN_ID` → `560048`, `EVM_RPC_URL` →
  `https://ethereum-hoodi-rpc.publicnode.com`, `USDC_ADDRESS` →
  zero address, `WALLETCONNECT_PROJECT_ID` → placeholder string). Throw a
  descriptive `Error` if a required value is missing AND no default
  applies.
- Export a `withEnvOverride()` test helper that swaps the frozen object
  for the duration of a callback (used by unit tests).

### 3. Add Hoodi chain definition

New file `/Users/dima/git/pipeline/packages/frontend/src/wallet/chain.ts`:

```ts
import { defineChain } from "@reown/appkit/networks";
import { ENV } from "@/lib/env";

export const hoodi = defineChain({
  id: ENV.EVM_CHAIN_ID,
  caipNetworkId: `eip155:${ENV.EVM_CHAIN_ID}`,
  chainNamespace: "eip155",
  name: "Hoodi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ENV.EVM_RPC_URL] } },
  blockExplorers: {
    default: { name: "Hoodi Explorer", url: "https://hoodi.etherscan.io" },
  },
  testnet: true,
});
```

If `ENV.EVM_CHAIN_ID` is some non-Hoodi id at runtime (e.g. for a future
prod target), the export still works — we keep the export named `hoodi`
for readability; the constant simply tracks whatever chain the env points
at.

### 4. Construct the AppKit / wagmi adapter

New file `/Users/dima/git/pipeline/packages/frontend/src/wallet/config.ts`:

- Build `wagmiAdapter = new WagmiAdapter({ networks: [hoodi], projectId,
  transports: { [hoodi.id]: http(ENV.EVM_RPC_URL) } })`.
- Call `createAppKit({ adapters: [wagmiAdapter], networks: [hoodi],
  projectId, metadata: { … }, themeMode: 'light' (or 'dark', see below),
  themeVariables: { … pulled from --color-pipeline-* tokens via
  getComputedStyle on document.documentElement … }, features: { analytics:
  false, email: false, socials: false, swaps: false, onramp: false } })`.
  All AppKit "extra" features OFF — this Issue only needs the basic
  connect modal.
- Export `wagmiConfig = wagmiAdapter.wagmiConfig`.
- The theme lookup must guard against SSR / non-DOM (return `undefined` if
  `document` is unavailable); this app is SPA-only so the DOM is always
  present at runtime, but keep the guard for vitest's `jsdom` environment.

### 5. Mock layer

New file `/Users/dima/git/pipeline/packages/frontend/src/wallet/mock.ts`:

Key schema (final, locked):

| Key                                                  | Type                                       | Returned when absent |
|------------------------------------------------------|--------------------------------------------|----------------------|
| `pipeline.mock.wallet.address`                       | `string` (`0x${string}`)                   | undefined            |
| `pipeline.mock.wallet.isConnected`                   | `"true" \| "false"`                        | undefined            |
| `pipeline.mock.wallet.chainId`                       | numeric string, e.g. `"560048"`            | undefined            |
| `pipeline.mock.wallet.balance.usdc`                  | numeric string of `bigint`, raw 6dp        | undefined            |
| `pipeline.mock.wallet.contract.<address>.<fn>`       | JSON-encoded return value                  | undefined            |

Module exports:

- `readMock<T>(key: string, parse: (raw: string) => T): T | undefined`.
- `subscribeMock(key: string, listener: () => void): () => void` — wraps
  the `storage` event AND a custom `pipeline-mock:wallet` event so writes
  in the same tab fire too.
- `installSameTabMockBridge()` — patches `localStorage.setItem` and
  `localStorage.removeItem` ONCE per page lifetime to dispatch the custom
  event after the underlying mutation. Idempotent. Called from
  `WalletProvider` on mount.
- `useMock<T>(key, parse)` — React hook that pairs `readMock` with
  `useSyncExternalStore` so components re-render reactively.
- Helpers: `parseAddress`, `parseBoolean`, `parseNumber`, `parseBigInt`,
  `parseJson` (with a try/catch that returns `undefined` on bad JSON so a
  fat-finger in DevTools does not crash the app).

### 6. Provider + hooks

New file `/Users/dima/git/pipeline/packages/frontend/src/wallet/WalletProvider.tsx`:

```tsx
const queryClient = new QueryClient();

export function WalletProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => installSameTabMockBridge(), []);
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
```

New file `/Users/dima/git/pipeline/packages/frontend/src/wallet/useWallet.ts`:

- `useWallet()`:
  - `address`: prefer `useMock(..., parseAddress)`; else `useAccount().address`.
  - `isConnected`: prefer `useMock(..., parseBoolean)`; else `useAccount().isConnected`. If the mock `address` is set but `isConnected` is unset, default to `true`.
  - `chainId`: prefer mock; else `useChainId()`.
  - `connect()`: calls `useAppKit().open()` (no-op when mocked — mocks
    represent an already-connected wallet).
  - `disconnect()`: calls `useDisconnect().disconnect()` from wagmi (and
    is a no-op in mock mode; a console.warn nudges the dev to clear
    localStorage).
- `useUsdcBalance()`:
  - If `pipeline.mock.wallet.balance.usdc` is set → parse to `bigint`,
    return `{ data: bigint, isLoading: false, error: null }`. Skip the
    real read entirely (no network).
  - Else if `address` is `undefined` or `USDC_ADDRESS` is the zero
    address → return `{ data: undefined, … }`.
  - Else `useReadContract({ address: USDC_ADDRESS, abi: erc20Abi,
    functionName: "balanceOf", args: [address] })`.
  - Expose a `formatted` field via `viem`'s `formatUnits` (USDC = 6
    decimals).
- `useContractRead<Args>({ address, abi, functionName, args })`:
  - Look up `pipeline.mock.wallet.contract.<lowercased-address>.<functionName>`
    via `useMock(..., parseJson)`. If present → return the mocked value
    inside the wagmi-shaped result. Skip the real call.
  - Else delegate to wagmi's `useReadContract`.

New file `/Users/dima/git/pipeline/packages/frontend/src/wallet/abis/erc20.ts`:
minimal ABI containing only `balanceOf(address) → uint256`, `decimals() →
uint8`, `symbol() → string`, `name() → string`. Typed `as const` so viem
picks up exact return types.

New file `/Users/dima/git/pipeline/packages/frontend/src/wallet/index.ts`:
barrel exporting only `WalletProvider`, `useWallet`, `useUsdcBalance`,
`useContractRead`, plus the TS types `WalletState` and
`UseContractReadArgs`. Anything else (e.g. raw `wagmiConfig`, `hoodi`,
`mock.ts` internals) is NOT re-exported.

### 7. Wire into the app

- `/Users/dima/git/pipeline/packages/frontend/src/main.tsx`: import
  `WalletProvider` from `@/wallet` and wrap `<RouterProvider router={router} />`
  in it. Keep `StrictMode` outermost.

- `/Users/dima/git/pipeline/packages/frontend/src/routes/index.tsx`:
  - Replace `<TopBar />` with a small wrapper that reads
    `const { isConnected, connect } = useWallet(); const { data, formatted } = useUsdcBalance();`.
    When connected, render `<TopBar wallet={{ balance: formatted ?? "—" }}
    onConnectWallet={connect} />`; otherwise `<TopBar onConnectWallet={connect} />`.
  - Format helper: `$X,XXX.XX` — use `Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2 })`.

- `/Users/dima/git/pipeline/packages/frontend/src/routes/deposit.tsx`:
  - Drop the hardcoded `"$10,000.00"`. Wire the same `useWallet` +
    `useUsdcBalance` pair. When disconnected, render the connect variant
    of `TopBar` (the rest of the deposit page can still render — it is
    placeholder content anyway; the click-through on `Approve`/`Convert`
    is already disabled).

- `/Users/dima/git/pipeline/packages/frontend/src/routes/withdraw.tsx`:
  same change as `deposit.tsx`, with `"$9,000.00"` removed.

### 8. ESLint guard

Edit `/Users/dima/git/pipeline/packages/frontend/eslint.config.js`:

- Add a third config block (after the existing two) that applies to
  `**/*.{ts,tsx}` with `ignores: ["src/wallet/**", "src/lib/env.ts"]`,
  containing:
  ```js
  {
    "no-restricted-imports": ["error", { patterns: [
      "wagmi", "wagmi/*",
      "viem", "viem/*",
      "@reown/appkit", "@reown/appkit/*",
      "@reown/appkit-adapter-wagmi",
      "@tanstack/react-query"
    ]}]
  }
  ```
- Confirm `yarn workspace @pipeline/frontend lint` passes.

### 9. Env example + docs

- Edit `/Users/dima/git/pipeline/.env.example`. Append a new section after
  the existing ones:
  ```
  # ── Frontend (VITE_) ────────────────────────────────────────
  VITE_EVM_CHAIN_ID=560048
  VITE_EVM_RPC_URL=https://ethereum-hoodi-rpc.publicnode.com
  VITE_USDC_ADDRESS=0x0000000000000000000000000000000000000000   # set to test ERC-20 on Hoodi when available
  VITE_WALLETCONNECT_PROJECT_ID=YOUR_REOWN_CLOUD_PROJECT_ID      # https://cloud.reown.com
  ```
- Create `/Users/dima/git/pipeline/packages/frontend/src/wallet/README.md`
  with three sections: (a) the public API (`WalletProvider`, `useWallet`,
  `useUsdcBalance`, `useContractRead`); (b) the localStorage mock key
  table with worked DevTools console snippets; (c) the "no `wagmi`/`viem`
  outside this module" rule and how to extend the public surface.

### 10. Doc updates

- `/Users/dima/git/pipeline/docs/FRONTEND.md` — Web3 integration section:
  replace the WalletConnect v2 / RainbowKit + ethers.js sentences with
  "wagmi + viem + Reown AppKit (WalletConnect v2). All blockchain access
  is wrapped in `packages/frontend/src/wallet/`; see
  `packages/frontend/src/wallet/README.md` for the public API and the
  `pipeline.mock.wallet.*` localStorage mock key schema." Keep the
  contract-read / direct-tx points but reword them around wagmi/viem.

- `/Users/dima/git/pipeline/ARCHITECTURE.md` — `frontend` block: replace
  "ethers.js for contract interactions" with "wagmi + viem for contract
  interactions; Reown AppKit for the WalletConnect modal".

- `/Users/dima/git/pipeline/docs/STORIES.md` — add new story `S-181` with
  test cases TC-181-1 (real connect against Hoodi), TC-181-2 (mock connect
  via localStorage), TC-181-3 (mock contract-read override).

### 11. Verification

- `yarn workspace @pipeline/frontend build` — must pass.
- `yarn workspace @pipeline/frontend lint` — must pass.
- `yarn workspace @pipeline/frontend test` — new tests pass (see Test
  Strategy).
- `npx tsx scripts/lint-docs.ts` from the repo root — must pass (required
  by `AGENTS.md` after any TS change).
- Manual smoke run: `yarn workspace @pipeline/frontend dev`, open
  `http://localhost:3000/`, click Connect Wallet → AppKit modal appears.

## Test Strategy

New unit tests under `packages/frontend/src/wallet/`:

1. **`mock.test.ts`** — exhaustive coverage of the localStorage layer:
   - `readMock` returns `undefined` when the key is absent.
   - `readMock` returns parsed values for address / boolean / number /
     bigint / JSON.
   - `parseJson` returns `undefined` on malformed JSON (no throw).
   - `subscribeMock` fires on cross-tab `storage` events.
   - `installSameTabMockBridge` causes same-tab `localStorage.setItem`
     writes to fire the custom `pipeline-mock:wallet` event.
   - The bridge is idempotent (installing twice does not double-fire).
   - Tests must `beforeEach(() => localStorage.clear())` to prevent
     cross-test leakage.

2. **`useWallet.test.tsx`** — render-test the hook through `WalletProvider`:
   - With no mocks and no real wallet: `isConnected === false`,
     `address === undefined`.
   - With `pipeline.mock.wallet.address` and `…isConnected="true"`:
     `useWallet()` reports connected with the mock address.
   - Setting the address mock with no `isConnected` key: defaults to
     connected (documented behaviour).
   - Flipping `…isConnected` to `"false"` post-mount causes a re-render
     and the hook reports disconnected.
   - `connect()` triggers `useAppKit().open()` — assert that the AppKit
     `open` mock was called (mock the `@reown/appkit/react` import).

3. **`useUsdcBalance.test.tsx`**:
   - With `pipeline.mock.wallet.balance.usdc="1000000000"` → `data` equals
     `1_000_000_000n`, `formatted === "$1,000.00"` (6-decimal raw → 1000
     USDC).
   - Without the mock and without a connected address → `data ===
     undefined`.
   - Without the mock, with `USDC_ADDRESS === 0x0…0` → balance read is
     skipped, `data === undefined`.
   - **Network assertion:** spy on the global `fetch` and assert it was
     NOT called in mock mode (this validates the "zero RPC calls"
     acceptance criterion).

4. **`useContractRead.test.tsx`**:
   - With `pipeline.mock.wallet.contract.0xabc….balanceOf` set to
     `"\"42\""` (a JSON-encoded numeric string) → `data === "42"` and
     no real call is made. Cover address case-insensitivity (the wallet
     module lowercases the lookup key).
   - Without the mock → wagmi's `useReadContract` is invoked
     (assert via a wagmi mock).

5. **`config.test.ts`** — module-load side effects:
   - `createAppKit` is called exactly once on import (use module-mock
     spies).
   - Chain id, RPC, and projectId values flow from `ENV` into the
     `WagmiAdapter` constructor and the `createAppKit` call.
   - The Hoodi chain has `testnet: true` and `chainNamespace: "eip155"`.

6. **`TopBar` integration** — extend
   `packages/frontend/src/components/TopBar.test.tsx` (or co-locate next
   to the route) with:
   - On `/` with no mock: TopBar renders the Connect Wallet button.
   - On `/` with the address+isConnected mocks: TopBar renders the
     `WalletPill` and the mocked balance.

All tests run via `yarn workspace @pipeline/frontend test`. CI gate is the
existing `test` script in `package.json`.

Manual / UX testing — `docs/STORIES.md` S-181 (added in step 10):

- **TC-181-1 (real connect).** With env pointing at Hoodi and a real
  WalletConnect project id, click "Connect Wallet" → modal opens →
  pair with a mobile WC wallet on Hoodi → TopBar switches to the pill
  with the wallet's USDC balance (or "—" if `VITE_USDC_ADDRESS` is the
  zero default).
- **TC-181-2 (localStorage mock).** With NO connected wallet, in DevTools:
  ```js
  localStorage.setItem("pipeline.mock.wallet.address", "0x1234…");
  localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
  localStorage.setItem("pipeline.mock.wallet.balance.usdc", "1000000000");
  ```
  → TopBar updates without reload. DevTools Network panel shows zero
  WebSocket / HTTP traffic to a wallet relay or RPC.
- **TC-181-3 (contract-read mock).** Set
  `pipeline.mock.wallet.contract.<addr>.<fn>` to a JSON-encoded value
  and observe the consuming component pick it up reactively.

## Docs to Update

- `docs/FRONTEND.md` — Web3 integration section (replace RainbowKit +
  ethers.js with the wagmi + viem + Reown AppKit stack; link to the new
  wallet README).
- `ARCHITECTURE.md` — `packages/frontend` block (same swap as above).
- `docs/STORIES.md` — new story S-181 with the three test cases listed
  above.
- `.env.example` — append the new `VITE_*` keys.
- `packages/frontend/src/wallet/README.md` — new file; canonical doc for
  the public API and mock key schema (linked from `docs/FRONTEND.md`).

No product-spec changes required. The existing `lp-onboarding.md` /
`deposits.md` describe protocol-level behaviour that is unchanged by this
Issue (this is plumbing only: the wallet handshake itself, no deposit /
KYT / mint flow).
