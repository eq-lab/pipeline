# Issue #1032: Wallet block: testnet ↔ mainnet network switcher (trustee dashboard + protocol app)

Source: https://github.com/eq-lab/pipeline/issues/1032

Labels: `enhancement`, `frontend`, `planning`. No comments on the Issue — the body is the
authoritative "what". No Figma reference exists for this feature (see
[Assumptions and Risks](#assumptions-and-risks)).

## Scope

### In scope

1. **Per-network config sets.** Replace the flat, single-valued chain env vars with a
   *catalogue* of network descriptors (`testnet`, `mainnet`), still 100 % env-driven so deploys
   stay configuration-only. Networks whose descriptor cannot be fully resolved are hidden.
2. **Runtime selection state.** A shared, persisted network store (`localStorage`), defaulted
   from env, read at app bootstrap.
3. **Switch mechanism.** Selecting a network persists the choice and performs a full document
   reload, so every singleton (AppKit/wagmi adapter, StellarWalletsKit, `QueryClient`, the
   `ENV`-derived chain constants) is reconstructed against the new descriptor. See
   [Decision D1](#d1-switching-reloads-the-document).
4. **Chain-scoped API + query keys.** Every `chain_id` query param and every React Query
   `queryKey` in both apps is derived from the selected network rather than from `ENV`
   directly, so no cross-network data can be served from cache.
5. **Trustee session scoping.** The trustee JWT is already stored with a `chainId`
   (`packages/trustee/src/auth/sessionStore.ts` → `StoredSession.chainId`). Make the store
   evict a session whose `chainId` does not match the active network.
6. **Two UI surfaces.**
   - LP app: a network row inside `packages/frontend/src/components/AccountDropdown.tsx`.
   - Trustee: the sidebar account chip / `AccountMenu` popover in
     `packages/trustee/src/components/TrusteeSidebar.tsx`.
   Both always label the active network; mainnet is visually distinct from testnet.
7. **Docs**: the shared approach in `docs/frontend/wallet-flows.md` (explicitly required by the
   Issue), plus the per-surface specs and the runtime-config tables.

### Out of scope

- Any backend/API change. The API already accepts `chain_id` on every relevant endpoint
  (verified against the live `https://api.pipeline.one/api-docs/openapi.json`, 2026-08-06:
  28 endpoints expose `chain_id`, all "optional — defaults to `DEFAULT_CHAIN_ID`" except
  `/v1/stats/yield` where it is required).
- Deploying anything, or editing the ArgoCD repo. This plan defines the *shape* the mainnet
  values must be supplied in; supplying them is an ops prerequisite (see
  [Step 0](#step-0-prerequisite-source-the-mainnet-values-blocking-for-a-functional-mainnet)).
- Adding a third network (futurenet/standalone). The design must not preclude it, but no
  descriptor is authored for it.
- Mobile treatment of either surface (both wallet blocks are desktop-only today).

## Assumptions and Risks

### Architectural findings this plan is built on

- **Both apps pin the network into module-scope constants at boot, not just at build.** The
  runtime-env mechanism (`window.__ENV__` via `vite-plugin-runtime-env`) already lets a single
  image be re-pointed without a rebuild, but only at *container start*:
  - `packages/frontend/src/lib/env.ts` and `packages/trustee/src/lib/env.ts` each build one
    frozen `ENV` object at module load.
  - `packages/frontend/src/wallet/evm/chain.ts` evaluates
    `export const hoodi = defineChain({ id: ENV.EVM_CHAIN_ID, … })` **at module scope**.
  - `packages/frontend/src/wallet/stellar/chain.ts` exports `kitNetwork`, `horizonUrl`,
    `sorobanRpcUrl`, `depositManagerId`, `withdrawalQueueId`, `stakedPlusdId`, `plusdIssuerId`,
    `usdcId`, `usdcCustodyId` — all `export const … = ENV.…`, module scope.
  - `@pipeline/wallet-connect` is lazier but still write-once:
    `setWalletConnectConfig()` (`packages/wallet-connect/src/config.ts`) sets a module-level
    singleton; `initStellarWalletConnect()` (`stellar/config.ts`) guards on an `initialized`
    boolean; `getHoodiChain()` (`evm/chain.ts`) memoizes into `cached`.
  Turning all of that reactive is a rewrite of every wallet hook in both apps. Hence D1.
- **`@pipeline/wallet-connect` is the natural shared home.** It is a source-only workspace
  package consumed by both apps, it already owns the "config injected once at bootstrap"
  contract, and it already has a test setup (`vitest run`).
- **The trustee `sessionStore` is a proven precedent** for the store shape we need: a
  module-level external store with `useSyncExternalStore`, storage hydrate/write helpers,
  a `_reset…ForTests()` helper, and non-hook accessors for code outside React.
- **The LP `AccountDropdown` already has a segmented control** (`SegmentedControl`, EVM /
  Stellar `WalletViewKind`). That is a *namespace* switch, orthogonal to the *network* switch —
  do not conflate them; the new control is a separate row.

### Risks

- **R1 — Cross-origin API base URL.** `https://api.pipeline.one` responds `200` for
  `chain_id=99000001`, `99000002`, `560048` and `1` alike (it does not validate the parameter),
  but the `99000001` response differs from the no-parameter default while the `99000002`
  response is byte-identical to it. That is consistent with `api.pipeline.one` being a
  *mainnet-scoped* deployment whose `DEFAULT_CHAIN_ID` is `99000002`, with no testnet data
  indexed. If so, the network descriptor must carry its own `apiBaseUrl` and switching crosses
  origins — which needs the testnet API host (not in this repo) and CORS allow-listing on both
  API deployments. See Open Question Q2.
- **R2 — Mainnet contract IDs / RPC URLs are not in this repo.** Only the passphrase
  (`Public Global Stellar Network ; September 2015`, already documented in
  `packages/frontend/src/lib/env.ts`) and the reserved chain-id sentinel `99000002`
  (`docs/design-docs/multi-chain-kyc-sharding.md`) are known here. Everything else must come
  from the ArgoCD repo, per the precedent recorded in the header of
  `docs/generated/stellar-protocol-contracts.md`. The switcher *mechanics* are not blocked —
  an unresolvable mainnet descriptor is simply hidden, which is exactly the required
  config-driven behavior — but a *functional* mainnet is.
- **R3 — Real funds.** Mainnet is live (`https://app.pipeline.one`,
  `https://dashboard.pipeline.one`). A user who switches to mainnet without noticing can sign a
  real-money transaction. The visual distinction and the reload-with-confirmation are the
  mitigations; treat this as the acceptance bar, not a nicety.
- **R4 — Concurrent edit of `docs/frontend/trustee-flows.md`.** Issue #997's
  comments→specs extraction is in flight against `packages/trustee/src/**` and that doc. Rebase
  onto `main` after #997 merges before touching `trustee-flows.md`, and re-read the trustee
  source files then — the file-header docblocks quoted in this plan may have moved into the doc.
- **R5 — Docker entrypoint key explosion.** `docker/frontend/entrypoint.sh` enumerates every
  `VITE_*` key explicitly as a `jq --arg`. Per-network suffixing doubles that list and every
  future network adds another block. Step 7 replaces the enumeration with a generic
  `VITE_`-prefix passthrough so adding a network stays configuration-only.
- **R6 — No Figma.** The Issue references no design. Styling follows the existing wallet-block
  idiom in each app (documented in the steps below); genuinely new design choices are listed in
  Open Questions rather than invented.

### Dependencies

- No blocking open Issue or unmerged PR for the code itself.
- Ops prerequisite for a *usable* mainnet entry: the values in Step 0.

## Open Questions

1. **Env var naming convention for per-network config sets.** This plan proposes the prefix
   form `VITE_<NETWORK>_<EXISTING_SUFFIX>` (e.g. `VITE_MAINNET_STELLAR_CHAIN_ID`,
   `VITE_TESTNET_STELLAR_DEPOSIT_MANAGER_ID`) with the existing flat names retained as the
   fallback for the default network so current deployments keep working unchanged. Alternatives:
   a suffix form (`VITE_STELLAR_CHAIN_ID_MAINNET`), or a single JSON blob
   (`VITE_NETWORKS='{"testnet":{…},"mainnet":{…}}'`). This is an ops/ArgoCD contract — confirm
   before writing the descriptors.
2. **Is the API base URL per-network, and what is the testnet API host?** Evidence (R1) points
   at `api.pipeline.one` being mainnet-only, which makes `apiBaseUrl` part of the descriptor and
   makes the switch cross-origin. Confirm: (a) whether one API deployment serves both chain ids
   or there are two hosts; (b) the testnet/stage API hostname; (c) that CORS on both hosts
   allows both `app.pipeline.one` and `dashboard.pipeline.one`.
3. **Is `99000002` actually the mainnet `chain_id` on the live backend?** The sentinel is
   *reserved* in `docs/design-docs/multi-chain-kyc-sharding.md` and the live default-response
   comparison is consistent with it, but the API does not validate `chain_id`, so this is
   inference, not confirmation. Needs the ArgoCD `CHAINS` / `DEFAULT_CHAIN_ID` values.
4. **Are EVM networks in scope, or Stellar-only for now?** Both apps send
   `ENV.STELLAR_CHAIN_ID` for effectively all API reads, and no Pipeline EVM mainnet deployment
   exists (`docs/user-docs/technical/audits-and-addresses.md`: "Contracts are not yet deployed
   to mainnet"). Proposal: make the descriptor's EVM fields optional and author Stellar-only
   descriptors now, so the mainnet entry does not offer a non-existent EVM deployment. Confirm.
5. **Switcher UX placement and appearance in each app.** No Figma. For the LP app: a network
   row at the top of `AccountDropdown` (above the EVM/Stellar segmented control), or a separate
   control in `TopBar` next to the `WalletPill`? For the trustee: a new row in the existing
   `⋯` `AccountMenu` popover (lowest-risk, reuses the built control), or a dedicated chip in the
   sidebar? And what is the mainnet "visually distinct" treatment — a colored dot, a tinted
   pill, a persistent banner?
6. **Trustee session policy on switch.** Proposal: evict the session when its stored `chainId`
   does not match the active network, forcing a fresh sign-in per network. Alternative: keep one
   session *per network* by suffixing the `sessionStorage` key
   (`pipeline.trustee.session.<network>`) so switching back does not require re-signing. Which
   does the product want? (Note the JWT is minted against a specific `chain_id` server-side, so
   reusing one across networks is not an option.)
7. **Should switching require an explicit confirmation when the target is mainnet?** Given R3
   and that the switch reloads the page (dropping any in-progress deposit/withdraw form state),
   a confirm step is defensible. Not assumed.
8. **Does the LP app switch anything but the wallet context — e.g. should a mainnet-selected LP
   app hide testnet-only affordances?** No known ones today, but confirm there is no
   testnet-only surface that must be gated.

## Implementation Steps

### Step 0 (prerequisite): source the mainnet values (blocking for a *functional* mainnet)

Not a code step. Collect from the ArgoCD deployment repo (precedent: the header of
`docs/generated/stellar-protocol-contracts.md`, which cites `pipeline/test.yaml`, chain
`99000001`) and record them in the Decision Log of this plan:

| Value | Known here? |
|---|---|
| Stellar mainnet network passphrase | Yes — `Public Global Stellar Network ; September 2015` |
| Stellar mainnet `chain_id` | Inferred `99000002` — confirm (Q3) |
| Horizon URL | No |
| Soroban RPC URL | No |
| `DepositManager` contract id | No |
| `WithdrawalQueue` contract id | No |
| `StakedPLUSD` contract id | No |
| `LoanRegistry` + executor contract ids | No |
| USDC SAC id, USDC custody `G…`, PLUSD issuer `G…` | No |
| API base URL (per network) | Mainnet `https://api.pipeline.one`; testnet host unknown (Q2) |

If a value is unavailable when implementation starts, leave it unset: the mainnet descriptor
then fails to resolve and the entry is hidden, which is the required config-driven behavior and
is independently worth shipping and testing.

### Step 1: network descriptor + catalogue resolver (shared)

New directory `packages/wallet-connect/src/network/`.

`packages/wallet-connect/src/network/types.ts`:

- `export type NetworkId = "testnet" | "mainnet";`
- `export interface NetworkDescriptor` with: `id: NetworkId`, `label: string` (e.g. `"Testnet"`
  / `"Mainnet"`), `isMainnet: boolean`, `apiBaseUrl: string`, `stellar: { chainId: number;
  networkPassphrase: string; horizonUrl: string; rpcUrl: string; contracts: { depositManagerId;
  withdrawalQueueId; stakedPlusdId; plusdIssuerId; usdcId; usdcCustodyId; loanRegistryId;
  loanRegistryExecutorId } }`, and `evm?: { chainId: number; rpcUrl: string; depositManager;
  withdrawalQueue; stakedPlusd }` (optional per Q4).
- Contract-id fields stay `string` with `""` meaning unconfigured — this preserves the existing
  short-circuit semantics documented in both `env.ts` files ("empty string means unconfigured;
  hooks short-circuit to `undefined` / render `—`"). They are therefore **not** part of the
  resolution predicate.

`packages/wallet-connect/src/network/resolve.ts`:

- `export function resolveNetworks(read: (key: string) => string | undefined):
  NetworkDescriptor[]` — a pure function taking a raw env reader, so the package stays decoupled
  from either app's Vite env plumbing (same rationale as `config.ts`'s injected-config comment).
- Resolution predicate: a descriptor is **available** only when its *connection-critical* fields
  are all non-empty — `apiBaseUrl`, `stellar.chainId`, `stellar.networkPassphrase`,
  `stellar.horizonUrl`, `stellar.rpcUrl`. Missing any → the network is omitted from the returned
  array (this is the Issue's "networks with no config set are hidden or disabled").
- Key lookup order per field: `VITE_<NETWORK>_<SUFFIX>` first, then the existing flat
  `VITE_<SUFFIX>` **only for the default network** (back-compat, so today's testnet deployments
  keep working with zero ArgoCD change), then the built-in default. Pending Q1.
- `export const DEFAULT_NETWORK_ID` resolved from `VITE_DEFAULT_NETWORK` (fallback
  `"testnet"`).
- Deterministic ordering: testnet first, mainnet second (stable UI order).

### Step 2: the persisted network store (shared)

`packages/wallet-connect/src/network/networkStore.ts` — modeled directly on
`packages/trustee/src/auth/sessionStore.ts`:

- `const STORAGE_KEY = "pipeline.network";` (`localStorage`, per the Issue — unlike the trustee
  session, the choice must outlive the tab).
- Module state + `listeners: Set<() => void>` + `notify()`.
- `hydrate()` at module load: read the key; accept it **only if** it names a currently
  *available* descriptor (a stored `"mainnet"` whose config was withdrawn must fall back to the
  default, not crash); otherwise fall back to `DEFAULT_NETWORK_ID`; tolerate
  `localStorage` being unavailable (private browsing) exactly as `sessionStore` does.
- Public API: `getSelectedNetworkId()`, `getSelectedNetwork(): NetworkDescriptor`,
  `getAvailableNetworks(): NetworkDescriptor[]`, `useSelectedNetwork()` (via
  `useSyncExternalStore`, with the cached-snapshot trick `sessionStore.computeSnapshot()` uses
  to stay referentially stable), `subscribeNetwork()`, and
  `_resetNetworkStoreForTests()`.
- `initNetworks(descriptors: NetworkDescriptor[], defaultId: NetworkId)` — called once from each
  app's `main.tsx` before rendering, mirroring `setWalletConnectConfig()`.
- `switchNetwork(id: NetworkId): void` — persists, then `window.location.reload()`. Keep the
  persist and the reload in this one function so no call site can persist without reloading.
  Guard: no-op when `id` is already selected.

Export all of the above from `packages/wallet-connect/src/index.ts` under a new
`// ── Network selection ──` block.

### Step 3: re-point both apps' `ENV` at the selected descriptor

The goal is that **no consumer changes**: `ENV.STELLAR_CHAIN_ID` etc. keep their names and stay
frozen-at-boot constants, but their *values* now come from the selected descriptor.

- `packages/frontend/src/main.tsx` and `packages/trustee/src/main.tsx`: at the very top (before
  `setWalletConnectConfig(...)`, which trustee already calls there and which the LP app must now
  also call — see Step 4), call `initNetworks(resolveNetworks(rawEnvRead), DEFAULT_NETWORK_ID)`.
- `packages/frontend/src/lib/env.ts` / `packages/trustee/src/lib/env.ts`: keep `readString` /
  `readNumber` (they remain the only place reading `import.meta.env` / `window.__ENV__`, per the
  `no-restricted-syntax` ESLint rule), but build the exported `ENV` from
  `getSelectedNetwork()` for every chain-scoped field. Non-chain fields
  (`WALLETCONNECT_PROJECT_ID`) stay flat.
  - This creates a module-init ordering constraint: `env.ts` must not evaluate before
    `initNetworks()` runs. Two options, pick the simpler at implementation time: (a) make the
    network resolution itself live inside `env.ts` (it already owns the raw reader, and
    `resolveNetworks` is a pure function of it) so ordering is impossible to get wrong; or
    (b) make `ENV` a lazily-built memoized getter. **(a) is preferred** — `env.ts` calls
    `resolveNetworks(rawRead)` + `initNetworks(...)` at module load, and `main.tsx` just imports
    `ENV` as it does today. Keep `withEnvOverride()` working for tests.
- `packages/frontend/src/wallet/stellar/chain.ts` and `evm/chain.ts` need **no change** — they
  read `ENV`, which now tracks the selection.

### Step 4: wallet-kit coordination

- **Stellar.** `setWalletConnectConfig({ stellarNetworkPassphrase: … })` already feeds
  `getKitNetwork()` → `StellarWalletsKit.init({ network })`. Because the switch reloads, the kit
  is initialised fresh against the selected passphrase; no teardown code is needed. The LP app
  currently does *not* call `setWalletConnectConfig` in `main.tsx` (it still uses its own
  `packages/frontend/src/wallet` copy, TD-35) — add the call there for parity so both apps drive
  the shared slice identically, but do **not** attempt the TD-35 migration in this Issue.
- **EVM.** `getHoodiChain()` / the LP's `hoodi` constant are rebuilt from the descriptor's
  `evm.chainId` at boot, so AppKit/wagmi are configured for the right chain from the first
  render and will prompt `wallet_switchEthereumChain` through their normal wrong-chain path. No
  bespoke `wallet_switchEthereumChain` call is required by the reload design. If Q4 resolves to
  "Stellar-only", the mainnet descriptor simply omits `evm` and the EVM namespace is unavailable
  there (surface that in the `AccountDropdown` segmented control as a disabled EVM tab with a
  hint, rather than a silently broken tab).
- **Wrong-network wallet.** A wallet whose own network differs from the app's (e.g. Freighter on
  testnet while the app is on mainnet) must be surfaced, not silently mis-signed. Stellar
  signing already carries `networkPassphrase`, so the kit/wallet rejects the mismatch; catch it
  and route the message through the existing `toError` normalization
  (`useStellarWithdrawalQueue.ts`, documented in `docs/frontend/wallet-flows.md` → "Error
  normalization") with copy naming both the expected and actual network.

### Step 5: chain-scope every API call and query key

- **LP app** (`packages/frontend/src/api/**`): the hooks already read `ENV.STELLAR_CHAIN_ID` /
  `ENV.EVM_CHAIN_ID` (`useDashboardSummary.ts:81`, `useDashboardTvlHistory.ts:65`,
  `useDashboardYieldHistory.ts:69`, `useLoanBook.ts:125`, `useLoanSubmissions.ts:137`,
  `usePnl.ts:71`, `useStellarDepositVoucher.ts:104`, `useStellarWithdrawalVoucher.ts:122`,
  `components/dashboard/useYieldHistoryPanel.ts:85`, `routes/index.tsx:185`) — those keep
  working unchanged once `ENV` follows the selection.
- **Add the network id as the first element of every `queryKey`** in both apps'
  `src/api/**`. Several keys carry no chain scope today and would collide across networks if the
  cache ever outlived a switch: `["financial-position"]`
  (`useFinancialPosition.ts:115`), `["stats"]` (`useStats.ts:58`), `["withdrawal-queue"]`
  (`useWithdrawalQueue.ts:98`), `["requests", address, mockVer]` (`useRequests.ts:128`),
  `["deposit-voucher", …]` / `["withdrawal-voucher", …]`. Prefix all of them:
  `[networkId, "financial-position"]`, etc. Defense-in-depth — with D1 the cache is already
  discarded on switch, but this makes a future no-reload switch a pure store change and makes
  the invariant testable.
- **Trustee app** (`packages/trustee/src/api/**`): every hook reads `ENV.STELLAR_CHAIN_ID`
  already (`useAuditLog.ts:41`, `useCapitalAllocation.ts:74`, `useCompleteDisbursement.ts:32`,
  `useLoanBook.ts:246`, `useLoanCcrHistory.ts:50`, `useLoanFinancials.ts:98`,
  `useLoanSubmissions.ts:226`, `useLoanValuation.ts:147`, `useLoanWaterfall.ts:54`,
  `useRampAddresses.ts:29`, …). Same treatment: values follow the selection automatically; add
  the network-id prefix to the query keys.
- `apiFetch` in both apps resolves `ENV.API_BASE_URL`, which now comes from the descriptor
  (subject to Q2).

### Step 6: trustee session scoping

In `packages/trustee/src/auth/sessionStore.ts`:

- `hydrate()` currently drops a stored session only when expired. Add a chain check: if
  `stored.chainId !== getSelectedNetwork().stellar.chainId`, treat it as stale — `writeStorage(
  undefined)` and stay `unauthenticated`. This also fixes the pre-existing case where a deploy
  re-points `VITE_STELLAR_CHAIN_ID` under a live tab.
- Because `switchNetwork()` reloads, the hydrate-time check is the only enforcement point
  needed; no separate "on switch, sign out" call site.
- `sessionStorage` is per-tab and the reload preserves it, so the eviction genuinely fires.
- If Q6 resolves to "keep a session per network", change `STORAGE_KEY` to
  `pipeline.trustee.session.<networkId>` instead and drop the eviction. Do not implement both.

### Step 7: env plumbing and deploy surface

- `.env.example`: add the per-network block(s) under the existing
  `# ── Frontend (VITE_) ──` section (currently lines ~291–314), keeping the flat vars documented
  as the back-compat default-network fallback. Add `VITE_DEFAULT_NETWORK=testnet`.
- `docker/frontend/entrypoint.sh` and `docker/trustee/entrypoint.sh`: replace the explicit
  `jq --arg VITE_…` enumeration (frontend lines 10–26) with a generic passthrough that emits
  every `VITE_`-prefixed environment variable into `window.__ENV__`. This keeps adding a network
  a pure ArgoCD change and stops the key list from doubling per network (R5). Preserve the exact
  output shape (`window.__ENV__ = { … };`) that `index.html` loads.

### Step 8: LP app UI — `AccountDropdown` network row

`packages/frontend/src/components/AccountDropdown.tsx` (+ a co-located
`useNetworkRow.ts` if the logic is non-trivial, per `docs/FRONTEND.md` rule 2 — the view file
stays JSX-and-styling only).

- Add a **network row above the existing `SegmentedControl`**, inside the same dark panel
  (`panelClasses` → `--color-pipeline-ink` surface, `--color-pipeline-on-dark` text,
  `dividerClasses` between blocks). Reuse `captionClasses` for the "Network" label and
  `bodyClasses` for the value, matching the existing wallet/balance rows.
- Shape: a caption "Network", the active descriptor's `label`, and — only when
  `getAvailableNetworks().length > 1` — a control to change it. With exactly two networks a
  segmented control identical in styling to the existing `SegmentedControl` is the cheapest
  consistent choice; with one, render the label as a static badge and no control (pending Q5).
- Mainnet distinction: a colored status dot before the label plus a `data-network` attribute for
  testability. Exact treatment pending Q5.
- Props: keep the component presentational — pass `networks`, `selectedNetworkId`, and
  `onNetworkChange` in from `TopBar`, exactly as `kind` / `onKindChange` are today. Add
  `data-testid="topbar-network-row"` and `data-testid="topbar-network-<id>"` per option,
  following the existing `topbar-*` testid convention.
- `onNetworkChange` calls `switchNetwork(id)` from `@pipeline/wallet-connect`.

### Step 9: trustee UI — sidebar wallet block

`packages/trustee/src/components/TrusteeSidebar.tsx` (re-read from `main` first — R4).

- The account chip currently renders the truncated address plus a fixed subtitle
  `"Trustee · connected"` (in `AccountChip`), with an `AccountMenu` `⋯` popover containing
  "Sign out".
- Change the subtitle to include the active network: `Trustee · <Network> · connected`, using
  the existing `SUBTITLE_COLOR` (`rgba(235,233,230,0.7)`) constant.
- Add a "Network" group to the existing `AccountMenu` popover (above a divider, above "Sign
  out"): one `role="menuitemradio"` per available network, `aria-checked` on the active one,
  each calling `switchNetwork(id)`. Reusing the built popover avoids inventing a new control on
  a surface with no Figma (pending Q5). The popover already handles outside-click and Escape.
- Mainnet distinction: the same colored dot treatment as the LP app so the two apps read as one
  system. Render nothing extra when only one network is available (keep the label).
- Keep `AccountChip`'s `if (!address) return null` guard and the existing
  `data-testid="trustee-account-chip"` / `trustee-account-address` hooks; add
  `data-testid="trustee-network-<id>"`.

### Step 10: lint, typecheck, docs lint

- `yarn workspace @pipeline/wallet-connect lint && yarn workspace @pipeline/frontend lint &&
  yarn workspace @pipeline/trustee lint`
- `tsc -b` in each of the three packages (`yarn workspace <pkg> build`).
- `npx tsx scripts/lint-docs.ts` (required by `AGENTS.md` after any TypeScript change).

## Test Strategy

Every package uses `vitest run`. Note the trustee's test files are `-`-prefixed
(`-sessionStore.test.ts`, `-TrusteeSidebar.test.tsx`) so TanStack Router's file-based routing
excludes them — follow that convention for new trustee tests.

### `packages/wallet-connect` (new — the bulk of the logic)

`src/network/resolve.test.ts`:
- A fully-specified testnet + mainnet env yields two descriptors, testnet first.
- A mainnet env missing `stellar.rpcUrl` (or passphrase, or chain id, or `apiBaseUrl`) yields
  **one** descriptor — the hidden-network requirement, asserted per missing field.
- Empty contract ids do **not** hide a network (they are unconfigured-but-usable; the
  short-circuit-to-`—` contract is preserved).
- Back-compat: flat `VITE_STELLAR_*` vars with no per-network vars resolve the default network
  exactly as today (assert the resolved descriptor field-by-field against the current `ENV`
  defaults).
- Unknown `VITE_DEFAULT_NETWORK` falls back to `"testnet"`.

`src/network/networkStore.test.ts`:
- Hydrates from `localStorage`; persists on `switchNetwork`.
- A stored id that is no longer available falls back to the default (do not crash, do not
  select a hidden network).
- Corrupt / non-JSON / unknown stored value → default.
- `localStorage` throwing (private browsing) → in-memory default, no throw. Mirror
  `-sessionStore.test.ts`'s existing storage-unavailable case.
- `useSelectedNetwork()` returns a referentially stable snapshot across unrelated notifications
  (guards the `useSyncExternalStore` infinite-render trap the session store documents).
- `switchNetwork` to the already-selected id is a no-op (no reload, no write) — stub
  `window.location.reload`.
- `switchNetwork` to a different id writes **then** reloads, in that order.

### `packages/frontend`

- `src/lib/env.test.ts` (extend or add): `ENV` chain fields track the selected descriptor;
  `withEnvOverride` still works.
- `src/components/AccountDropdown.test.tsx` (extend — it already mocks `QueryClientProvider`):
  network row renders with the active label; both options render when two networks are
  available; the control is absent (label still shown) when only one is; clicking an option
  fires `onNetworkChange` with the right id; the mainnet option carries the distinguishing
  marker.
- One representative api-hook test asserting the emitted URL's `chain_id` and the `queryKey`
  prefix both follow the selected network (e.g. `useLoanBook`), plus a test that two different
  selected networks produce different query keys for a previously unscoped hook
  (`useFinancialPosition` or `useStats`) — this is the "no cross-network data bleed" assertion.

### `packages/trustee`

- `src/auth/-sessionStore.test.ts` (extend): a stored session whose `chainId` matches the active
  network hydrates to `authenticated`; a mismatching `chainId` is evicted from `sessionStorage`
  and hydrates to `unauthenticated`; an expired session still evicts (no regression).
- `src/components/-TrusteeSidebar.test.tsx` (extend): the account chip subtitle contains the
  active network label; the `⋯` menu lists the available networks with the active one
  `aria-checked`; selecting another calls `switchNetwork`; with one available network the menu
  shows no network group but the subtitle still names it; the `!address → null` guard is intact.
- One api-hook test (e.g. `-useCapitalAllocation.test.tsx`) asserting the `chain_id` query param
  and the network-prefixed `queryKey`.

### Manual verification (no Figma to diff against)

Both dev servers are user-run (do not start or restart one that is already running):
`http://localhost:5173` (LP) and `http://localhost:5174` (trustee). Ask the user to confirm:

1. With only testnet configured, each wallet block shows "Testnet" and no switcher.
2. With both configured, switching to mainnet reloads, the label updates, and the Network tab
   shows `chain_id=<mainnet>` on subsequent API calls (per the no-mocks / check-the-Network-tab
   rule).
3. The selection survives a manual reload.
4. On the trustee, switching networks returns the app to the sign-in gate (or preserves the
   per-network session, per Q6).

## Docs to Update

| Doc | Change |
|---|---|
| `docs/frontend/wallet-flows.md` | **New top-level section "Network selection (testnet ↔ mainnet)"** — explicitly required by the Issue as the home of the shared approach. Cover: the descriptor shape, the resolver's hidden-network predicate, the store + `localStorage` key, the reload-on-switch decision and *why* (the module-scope/memoized-singleton constraint), query-key scoping, and the wrong-network wallet behavior. |
| `docs/frontend/dashboard-components.md` | `### AccountDropdown` (line ~418): add the network row to the props-contract table and the behavior notes; note it is distinct from the EVM/Stellar namespace control. Also the `TopBar` section (~line 393) if the props pass through there. |
| `docs/frontend/trustee-flows.md` | The sidebar account-chip section (subtitle now names the network; the `⋯` menu gains the network group) and the `#session-store-sessionstorets` section (chain-mismatch eviction). **Rebase after #997 merges before editing** (R4). |
| `docs/FRONTEND.md` | The two "Supported runtime keys" tables (frontend ~line 205, trustee ~line 243) — the per-network keys and `VITE_DEFAULT_NETWORK`; note the entrypoint now passes through any `VITE_*`. Also the "Web3 integration → Chain:" bullet, which currently states Hoodi-by-default as a build-time fact. |
| `docs/frontend/hooks.md` | Add `useSelectedNetwork` (shared across both apps → qualifies under `docs/FRONTEND.md` rule 5). |
| `.env.example` | Per-network vars + `VITE_DEFAULT_NETWORK`, with the flat vars annotated as the default-network fallback. |
| `docs/product-specs/trustee-dashboard.md` | Only if Q5/Q6 land as user-facing behavior changes to the trustee console (network label + sign-in-per-network). Add a short "Network selection" note if so. |
| `docs/exec-plans/tech-debt-tracker.md` | Log the residual: the switch is a **document reload**, not a live re-configuration, because the LP `wallet/**` chain constants and the wallet-kit singletons are write-once. Reference TD-35 (the LP app not yet using `@pipeline/wallet-connect`), which is what makes a live switch expensive today. |

## Decision Log

### D1: switching reloads the document

`switchNetwork()` persists the selection and calls `window.location.reload()`.

Rationale: the network is baked into module-scope constants and write-once singletons in three
places — `packages/frontend/src/wallet/{stellar,evm}/chain.ts` (`export const … = ENV.…`),
`packages/wallet-connect/src/config.ts` (`setWalletConnectConfig` module singleton, read by
`getKitNetwork()`), and the memoized `initStellarWalletConnect()` / `getHoodiChain()`. A live
switch means making all of them reactive and re-mounting AppKit, the wagmi adapter, the Stellar
kit and the `QueryClient` — a rewrite of every wallet hook in both apps, with a large surface for
stale-client bugs precisely where real funds are at stake.

A reload satisfies every acceptance criterion in the Issue directly: the chain context swaps
wholesale, the React Query cache is discarded (no persister is configured in either app, so
nothing survives), the wallet kit re-initialises on the new passphrase, and the selection
survives because persistence is what drives the boot. Cost: any in-progress form state is lost —
which is why Q7 asks whether a confirmation step is wanted.

Query keys are still network-scoped (Step 5) so that a future no-reload switch becomes a pure
store change.

### D2: the shared code lives in `@pipeline/wallet-connect`, the UI does not

The descriptor type, resolver and store go in the shared package (both apps need them, it
already owns the bootstrap-config contract, and it has a test setup). The two switcher
*components* stay per-app: the LP surface is a dark dropdown panel on
`--color-pipeline-ink`, the trustee surface is a navy sidebar chip on
`--color-pipeline-brand`, and neither app's wallet block is a shared component today. The
Issue's "both apps behave identically in pattern" is satisfied by the shared store and the
shared doc section. Revisit if Q5 asks for a single shared visual component.
