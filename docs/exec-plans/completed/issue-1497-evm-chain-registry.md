# Issue #1497: EVM chain registry: mainnet + Hoodi definitions by chain id, wrong-network detection, EVM identity in the network switcher

Source: https://github.com/eq-lab/pipeline/issues/1497

Parent epic: #1494 (EVM support for the LP app). Frontend flow. No Figma reference is attached to
this Issue or to #1494, so there is no Figma verification step (see Open Questions for the
wrong-network banner and pill visuals).

## Scope

### In scope

1. **One EVM chain registry, defined once in `@pipeline/wallet-connect`** and consumed by both
   the shared slice and the LP app (`packages/frontend`), keyed by chain id:
   - `1`: Ethereum mainnet. Name `Ethereum`, explorer `Etherscan` / `https://etherscan.io`,
     native `ETH`, `testnet: false`.
   - `560048`: Hoodi. Name `Hoodi`, explorer `Etherscan` / `https://hoodi.etherscan.io`, native
     `ETH`, `testnet: true`.
   - Any other id: a generic definition. Name `EVM chain <id>`, no explorer, native `ETH`,
     `testnet: true`, so it is styled as testnet and never shown as real funds (mirrors the
     unknown-passphrase rule in `networkIdFromPassphrase`).
   - The RPC URL always comes from config (`VITE_EVM_RPC_URL` / `WalletConnectConfig.evmRpcUrl`),
     never from the registry. Selection is by `ENV.EVM_CHAIN_ID` / `config.evmChainId`.
2. **Wrong-network detection and switch on the LP app**, active only in the EVM view
   (`useWalletView().kind === "evm"`) with a connected EVM wallet whose chain id is not
   `ENV.EVM_CHAIN_ID`:
   - A `WrongNetworkBanner` that replaces the steps card on `/deposit` (both directions, which
     also covers `/withdraw`, a redirect to `/deposit?direction=withdraw`) and on `/stake` (both
     tabs). Its action is "Switch network", backed by wagmi `useSwitchChain`.
   - The `TopBar` / `MobileNavMenu` network pill (`NetworkSwitcher`) shows a wrong-network state
     with the same switch action.
   - Defense in depth: every wagmi `writeContract` call in `packages/frontend/src/wallet/evm/**`
     passes `chainId: ENV.EVM_CHAIN_ID`. wagmi then throws a chain-mismatch error instead of
     sending a transaction on the wrong chain.
   - The mock layer is honoured: `pipeline.mock.wallet.chainId` drives detection.
3. **The network identity follows the active view.** The pill, the `AccountDropdown` network row
   and the mainnet gate use the Stellar passphrase in the Stellar view and `ENV.EVM_CHAIN_ID`
   (through the registry) in the EVM view. `isMainnetDeployment` consumers follow the view:
   `HomeStatsStrip`, `TopBar`, `MobileNavMenu` and the `/dashboard` `beforeLoad` guard.
4. **Fix the chain id source.** `useEvmWallet` (both copies) reads `useChainId()`. In wagmi v3
   that returns the config's chain (`config.state.chainId`), which is always a configured chain.
   It is not the connected wallet's chain, so wrong-network detection could never fire. Switch
   the real-path source to `useAccount().chainId` (the connection's raw chain id, which is
   `undefined` when disconnected).
5. **Spec.** Add the chain registry and wrong-network rules to `docs/frontend/wallet-flows.md`,
   update the network-switcher identity rule, the banner precedence in
   `docs/frontend/dashboard-components.md`, and the `VITE_EVM_CHAIN_ID` row and "Web3
   integration" bullet in `docs/FRONTEND.md`.

### Out of scope

- Re-pointing the LP app wholesale at `@pipeline/wallet-connect` and deleting the duplicated LP
  slice (#1349). This Issue only moves the chain registry into the shared package. Each slice
  keeps its own `chain.ts` / `config.ts` wrapper, and both wrappers are kept in lockstep.
- Stats, dashboard and withdrawal-queue hooks following the active chain (#1498). This Issue
  only switches the mainnet gate (`isMainnetDeployment`) to the active view.
- The rest of the `wallet-flows.md` "EVM integration" section (hook-level migration from
  `wallet/evm/**`, deposit/withdraw model realignment). That is #1504. This Issue writes only the
  chain-registry and wrong-network subsections and leaves a scaffold note for the rest.
- Deployment values (`argocd` `test.yaml` / `prod.yaml`, `hoodi-v5` addresses, a mainnet RPC
  URL). Those belong to #1503 and #1436. No new env var is introduced.
- The Trustee app's network switcher. It has no EVM/Stellar view toggle and stays
  Stellar-passphrase based. Its EVM sign-in does pick up the registry, because its
  `getEvmChain()` (renamed from `getHoodiChain()`) now reports the correct name and explorer.
- Multi-chain AppKit (offering several EVM networks in one deployment). Each deployment is still
  single-chain.

## Assumptions and Risks

- **Behaviour change in `useEvmWallet().chainId`.** It moves from `useChainId()` to
  `useAccount().chainId`. Consumers that assumed a number while connected still get one.
  Disconnected now yields `undefined` instead of the config chain. A grep of
  `packages/frontend/src` shows that no production consumer reads `chainId` from `useEvmWallet`
  today. API hooks use `ENV.EVM_CHAIN_ID` directly, so the change is safe. Several tests mock
  `wagmi.useChainId` and must also mock `useAccount` with a `chainId`.
- **wagmi mock surface in route tests.** `-deposit.test.tsx` and `-stake.test.tsx` spread the
  real `wagmi` module and override individual hooks. Calling the real `useSwitchChain` outside a
  `WagmiProvider` throws, so those test mocks must add a `useSwitchChain` stub. The same applies
  to `TopBar.test.tsx`, `MobileNavMenu.test.tsx` and `AccountDropdown.test.tsx` wherever they
  render the real `NetworkSwitcher`.
- **`switchChain` to a chain the wallet does not know.** MetaMask does not ship Hoodi. wagmi's
  injected connector falls back to `wallet_addEthereumChain` using the chain definition
  (`rpcUrls`, `nativeCurrency`, `blockExplorers`). The registry entry must therefore be complete
  and correct, or the add-chain prompt fails. WalletConnect wallets may reject unknown chains.
  The banner then surfaces the error (see Implementation Step 5).
- **AppKit's own unsupported-network UI.** AppKit can show an "unsupported network" view of its
  own when the wallet is on a chain outside `networks`. The app connects through its own
  `ConnectWalletModal` (`useConnect`), so the AppKit modal is rarely open. If both prompts
  appear, the coder verifies that they do not conflict. AppKit's `allowUnsupportedChain` stays
  at its default.
- **Mainnet gate becomes view-dependent.** In every real deployment both networks share a tier:
  staging is Stellar testnet plus Hoodi, prod is Stellar mainnet plus Ethereum mainnet. The
  view-aware gate therefore gives the same answer as today. It diverges only in a mixed local
  setup. The `/dashboard` `beforeLoad` guard cannot use React context, so it reads the persisted
  view kind (`pipeline.wallet.view.kind`, via a new exported reader in `WalletViewContext.tsx`).
  See Open Questions.
- **File overlap with sibling Issues.** #1498 also edits `HomeStatsStrip.tsx` and possibly
  `useYieldHistoryPanel` / dashboard hooks. #1504 edits `wallet-flows.md` "EVM integration". The
  user merges PRs incrementally, so whichever lands second rebases. The edits here are confined
  to the mainnet-gate line in `HomeStatsStrip` and to two new subsections in `wallet-flows.md`.
- **Hoisted workspace dependency.** `packages/frontend` imports `@pipeline/wallet-connect`
  without declaring it (`networkSwitcher.ts` relies on root hoisting). This Issue adds a runtime
  import of the registry, so the dependency gets declared (Step 1). This updates `yarn.lock`.
- **Comment style.** Per project convention, each touched or new file gets only a 2–3-line
  spec-pointer header. There are no narrative JSDoc or inline comments. The rationale lives in
  `wallet-flows.md`. The existing long `chain.ts` docblocks are replaced by the header.

## Open Questions

1. **Wrong-network banner and pill visuals.** There is no Figma frame for a wrong-network state.
   The default plan reuses the existing yellow banner `Card` chrome (same classes as
   `connect-wallet-banner`), with the title "Wrong network", the subtitle "Switch your wallet to
   {chain name} to continue" and a "Switch network" button ("Switching…" while pending). The
   pill shows a `--color-pipeline-danger` dot with the label "Wrong network". Is there a design,
   or is this copy and styling acceptable?
2. **EVM-view pill label.** Does the pill show the tier ("Testnet" / "Mainnet", the same labels
   as the Stellar view, so `VITE_NETWORK_LINKS` ids still match) or the chain name ("Hoodi" /
   "Ethereum")? The default plan keeps the tier label, with the id still `testnet` / `mainnet`
   either way.
3. **Mainnet gate scope.** Should `TopBar` / `MobileNavMenu` nav links and the `/dashboard`
   route guard follow the active view, as `HomeStatsStrip` does? The Issue names only
   `HomeStatsStrip`. The default plan makes all four view-aware for consistency. The
   alternative is to keep a deployment-level gate that is true when either network is mainnet.
4. **Mock-mode "Switch network".** With `pipeline.mock.wallet.address` set, the default plan
   mirrors mock `disconnect()`: it logs a `console.warn` that names the
   `pipeline.mock.wallet.chainId` key to change, and it does not write to localStorage. Should
   the mock switch rewrite `pipeline.mock.wallet.chainId` to `ENV.EVM_CHAIN_ID` instead?

## Decision Log

User answers (issue #1497 comment, 2026-10-14) amend the steps below:

1. **No standalone `WrongNetworkBanner`** (Step 8 and the banner routing in Step 9 are replaced):
   - Auto-prompt: `<EvmChainAutoSwitch />` (mounted once in `main.tsx`) calls wagmi `switchChain` once per connection when an EVM wallet connects or restores on a chain other than `ENV.EVM_CHAIN_ID`. wagmi's injected connector adds the chain (Hoodi in MetaMask) first.
   - Inline fallback: `useDepositFlow` / `useStakeFlow` expose `wrongNetwork`; the steps cards disable every step action and show a one-line "Switch your wallet to {chain}" row with a Switch button (`StepsCard` `notice` prop, `useChainNotice` in the routes), styled like the disabled / inline-error steps (#1024 / #1034).
   - The `chainId` backstop on every `writeContract` is kept; the pill keeps its wrong-network state.
2. Pill label in the EVM view is Testnet / Mainnet (`networkIdFromEvmChainId`).
3. TopBar / MobileNavMenu nav links and the `/dashboard` guard follow the active view.
4. Mock mode: Switch logs a `console.warn`; the auto-prompt never fires for a mocked wallet.

Deviations from the plan after rebasing on #1512 / #1498:

- "Active view" is `useActiveChain().kind` (added by #1498), not `useWalletView().kind`; `HomeStatsStrip` uses `isMainnetNetwork(kind)` with the `kind` it already reads.
- `kind` is no longer persisted (#1512), so `readStoredWalletViewKind` is not added. The `/dashboard` `beforeLoad` gate evaluates the default (Stellar) view and the component additionally redirects when `useIsMainnetNetwork()` is true.
- The view-aware hooks (`useNetworkSwitcherState`, `useIsMainnetNetwork`) live in `wallet/useNetworkIdentity.ts` so `networkSwitcher.ts` stays a pure module.
- `useEvmNetworkGuard` also returns `wrongNetwork` (the `WrongNetworkInfo` the flows hand to the steps card).
- `isKnownEvmChain` is exported from `chains.ts` (used by `networkIdFromEvmChainId` for the `Chain <id>` label).
- The gas / simulate header comments are reworded only for "Hoodi" in `gas.ts`.

Status: all steps implemented; the plan's banner tests are replaced by steps-card notice tests.

## Implementation Steps

1. **Shared registry: `packages/wallet-connect/src/evm/chains.ts` (new).**
   - `export interface EvmChainInfo { id: number; name: string; nativeCurrency: { name: string; symbol: string; decimals: number }; explorer?: { name: string; url: string }; testnet: boolean }`.
   - `const KNOWN_EVM_CHAINS: Readonly<Record<number, Omit<EvmChainInfo, "id">>>` with entries
     for `1` and `560048`, using the values in Scope 1.
   - `export function evmChainInfo(chainId: number): EvmChainInfo`. It returns the known entry,
     or the generic fallback for any other id.
   - `export function defineEvmChain(chainId: number, rpcUrl: string)`. It wraps
     `defineChain` from `@reown/appkit/networks`, setting `caipNetworkId: eip155:<id>`,
     `chainNamespace: "eip155"`, `rpcUrls.default.http: [rpcUrl]`, and `blockExplorers.default`
     only when `explorer` is set. Memoize it on `${chainId}|${rpcUrl}` so repeated calls return
     the same object identity (AppKit and wagmi compare by reference). Export
     `_resetEvmChainCacheForTests()`.
   - Export `evmChainInfo`, `defineEvmChain` and type `EvmChainInfo` from
     `packages/wallet-connect/src/index.ts` (EVM namespace block).
   - Add `"@pipeline/wallet-connect": "workspace:^"` to `packages/frontend/package.json`
     `dependencies` and run `yarn install` to update `yarn.lock`.
2. **Shared slice wrappers (`packages/wallet-connect`).**
   - `src/evm/chain.ts`: replace the hard-coded Hoodi definition with
     `export function getEvmChain() { const c = getWalletConnectConfig(); return defineEvmChain(c.evmChainId, c.evmRpcUrl); }`.
     Rename `getHoodiChain` to `getEvmChain` and `_resetHoodiChainForTests` to
     `_resetEvmChainForTests`, which calls `_resetEvmChainCacheForTests`. Update the importer
     `src/evm/config.ts` (local `hoodi` becomes `chain`). Keep it lazy: nothing reads config at
     module scope.
   - `src/config.ts`: update the `evmChainId` field comment (`e.g. 560048 for Hoodi`) so it
     points at the registry.
   - `src/evm/useEvmWallet.ts`: take the real chain id from `useAccount().chainId`, not
     `useChainId()`; the mock override stays as is. Mirror the LP slice change in Step 4.
3. **Network identity for chain ids: `packages/wallet-connect/src/network/links.ts`.**
   - Add `export function networkIdFromEvmChainId(chainId: number): NetworkIdentity`. It uses
     `evmChainInfo(chainId)`: when `testnet` is false it returns
     `{ id: "mainnet", label: "Mainnet" }`. A known testnet returns
     `{ id: "testnet", label: "Testnet" }`. An unknown id returns
     `{ id: "testnet", label: "Chain <id>" }`, mirroring the unknown-passphrase rule. (The label
     choice is pending Open Question 2.)
   - Export it from `src/index.ts` next to `networkIdFromPassphrase`.
4. **LP slice chain + wallet (`packages/frontend/src/wallet/evm`).**
   - `chain.ts`: replace the body with
     `export const evmChain = defineEvmChain(ENV.EVM_CHAIN_ID, ENV.EVM_RPC_URL);` imported from
     `@pipeline/wallet-connect`. Module scope is fine here because the LP app reads its own
     `ENV`, not the injected wallet-connect config. Rename the export from `hoodi` to `evmChain`.
   - `config.ts`: use `evmChain` in `WagmiAdapter.networks`, `transports` and
     `createAppKit.networks`.
   - `useEvmWallet.ts`: `const { address, isConnected, status, chainId: realChainId } = useAccount();`
     and drop the `useChainId` import. The rest of the mock precedence is unchanged.
   - `gas.ts` / `simulate.ts`: these are comment-only references to "Hoodi". The 2^24 per-tx gas
     cap (EIP-7825) also applies on mainnet after Fusaka. Reword the headers to say "target
     chain" so the code does not imply Hoodi only. There is no logic change.
5. **Wrong-network hook: `packages/frontend/src/wallet/evm/useEvmNetworkGuard.ts` (new).**
   - Signature:
     `useEvmNetworkGuard(): { expectedChain: EvmChainInfo; currentChainId: number | undefined; isWrongNetwork: boolean; switchNetwork(): void; isSwitching: boolean; switchError: Error | null }`.
   - It reads `useEvmWallet()` (`isConnected`, `chainId`, already mock-aware) and
     `useWalletView().kind`.
   - `isWrongNetwork = kind === "evm" && isConnected && currentChainId !== undefined && currentChainId !== ENV.EVM_CHAIN_ID`.
   - `switchNetwork()`:
     - In mock mode (a `pipeline.mock.wallet.address` key is present, read via
       `useMock(KEYS.address, parseAddress)`), it logs a `console.warn` naming
       `pipeline.mock.wallet.chainId` and returns. This follows Open Question 4.
     - Otherwise it calls wagmi `useSwitchChain().mutate({ chainId: ENV.EVM_CHAIN_ID })`. Use
       `switchChain` if `mutate` is not the v3 field. Check
       `node_modules/wagmi/src/hooks/useSwitchChain.ts`, which in v3.6 exposes `mutate`, with
       `switchChain` deprecated.
   - `isSwitching` and `switchError` come from the mutation's `isPending` and `error`.
     `switchError` feeds a danger toast through the existing `toUserError` mapping. A user
     rejection maps to the existing "rejected" copy.
   - Export it from `packages/frontend/src/wallet/index.ts`.
6. **Network identity follows the view: `packages/frontend/src/wallet/networkSwitcher.ts`.**
   - `export function currentNetworkFor(kind: WalletViewKind): NetworkIdentity`. It returns
     `networkIdFromPassphrase(ENV.STELLAR_NETWORK_PASSPHRASE)` for `"stellar"` and
     `networkIdFromEvmChainId(ENV.EVM_CHAIN_ID)` for `"evm"`.
   - `getNetworkSwitcherState(kind: WalletViewKind)` takes the kind. `otherNetworks` still
     filters `parseNetworkLinks(ENV.NETWORK_LINKS)` by `currentNetwork.id`.
   - `isMainnetNetwork(kind: WalletViewKind): boolean`. It replaces `isMainnetDeployment()`;
     remove the old export and update every caller, so that no deployment-level variant is left
     behind.
   - Hooks: `useNetworkSwitcherState()` and `useIsMainnetNetwork()` read `useWalletView().kind`
     and delegate to the functions above.
   - `packages/frontend/src/wallet/WalletViewContext.tsx`: export the existing
     `readStoredKind` as `readStoredWalletViewKind()` for non-React callers.
   - Update the re-export in `packages/frontend/src/wallet/index.ts` (line ~222).
7. **Consumers of the identity and the gate.**
   - `components/NetworkSwitcher.tsx`: use `useNetworkSwitcherState()` and
     `useEvmNetworkGuard()`. When `isWrongNetwork`, the pill renders the wrong-network state
     (danger dot, label "Wrong network"; see Open Question 1) as a button. Clicking it opens the
     menu, whose first row is "Switch to {expectedChain.name}" and calls `switchNetwork()`. It
     is disabled while `isSwitching`. The sibling-deployment rows follow below it unchanged.
     Testids: `topbar-network-badge` (unchanged) gains
     `data-state="wrong-network"`; the new row is `topbar-network-switch-chain`.
   - `components/useAccountDropdown.ts`: replace `getNetworkSwitcherState()` with
     `useNetworkSwitcherState()`.
   - `components/HomeStatsStrip.tsx`: `const mainnet = useIsMainnetNetwork();`.
   - `components/TopBar.tsx` (line 46) and `components/MobileNavMenu.tsx` (line 374): replace
     with `useIsMainnetNetwork()`. This is pending Open Question 3. If the answer is
     "deployment-level", they and the dashboard guard instead use a
     `isMainnetEitherNetwork()` helper (true when either the passphrase or the chain id is
     mainnet).
   - `routes/dashboard.tsx` `beforeLoad`: `isMainnetNetwork(readStoredWalletViewKind())`.
8. **Banner: `packages/frontend/src/components/WrongNetworkBanner.tsx` (new).**
   - Props: `{ chainName: string; onSwitch(): void; switching: boolean }`.
   - It uses `Card variant="yellow"` with the same border/shadow classes as the
     `connect-wallet-banner` in `routes/deposit.tsx`, and a `Button variant="primary-dark"
     size="compact"`.
   - Testids: `wrong-network-banner`, `wrong-network-banner-title`,
     `wrong-network-banner-subtitle`, `wrong-network-banner-action`.
   - Copy is per Open Question 1.
9. **Routes.**
   - `routes/deposit.tsx`: call `useEvmNetworkGuard()` unconditionally. Insert a branch right
     after `!flow.isConnected` and before the initial-data-load branch:
     `guard.isWrongNetwork ? <WrongNetworkBanner … /> : …`. Wire `switchError` to a danger
     toast with id `evm-switch-chain` (it reuses the page's existing `toast` / `toUserError`
     usage).
   - `routes/stake.tsx`: add the same branch after `!flow.isConnected` and before the
     `needsXlmFunding` branch, with the same toast id.
   - When the chain flips back to the expected id the banner disappears with no reset, because
     the flows keep their own state. A transaction already in flight during a mid-flow chain
     change is guarded by Step 10.
10. **Defense in depth on writes.** Add `chainId: ENV.EVM_CHAIN_ID` to every
    `wagmiWrite.writeContract({...})` call in `wallet/evm/useApproval.ts` (~298),
    `useDepositManager.ts` (~422, ~610), `useStakedPlusd.ts` (~476, ~666) and
    `useWithdrawalQueue.ts` (~226, ~419). Also add it to any `simulateContract` /
    `estimateContractGas` calls in `simulate.ts` / `estimateGas.ts` that accept it. wagmi then
    rejects a write on a mismatched chain with `ChainMismatchError`. That error surfaces through
    the existing step error state.
11. **README.** In `packages/frontend/src/wallet/README.md`, update the `chainId` row (line ~111:
    "connected wallet's chain id, `undefined` when disconnected") and the
    `pipeline.mock.wallet.chainId` row (line ~478: "Overrides the connected chain id
    (`useAccount().chainId`); a value other than `VITE_EVM_CHAIN_ID` triggers the wrong-network
    state"). Document `useEvmNetworkGuard` in the public API list.
12. **Lint, typecheck and docs lint.** Run `yarn workspace @pipeline/frontend lint`,
    `yarn workspace @pipeline/wallet-connect lint` (or the package equivalents),
    `yarn workspace @pipeline/frontend build` (which runs `tsc -b`), the trustee build (the
    trustee consumes the renamed `getEvmChain` only indirectly through `initEvmWalletConnect`),
    and `npx tsx scripts/lint-docs.ts`.

## Test Strategy

Unit tests use vitest, co-located with the existing pattern.

- **`packages/wallet-connect/src/evm/chains.test.ts` (new).**
  - `evmChainInfo(1)` gives `Ethereum`, `etherscan.io`, `testnet: false`.
  - `evmChainInfo(560048)` gives `Hoodi`, `hoodi.etherscan.io`, `testnet: true`.
  - `evmChainInfo(31337)` gives the generic name, no explorer, `testnet: true`.
  - `defineEvmChain` sets `id`, `caipNetworkId` and `rpcUrls.default.http` to the passed RPC.
    It omits `blockExplorers` for an unknown id and is memoized: the same args return the same
    reference, while a different RPC returns a different reference.
- **`packages/wallet-connect/src/evm/chain.test.ts` (new) or the existing config tests.**
  - `getEvmChain()` with `evmChainId: 1` returns `name: "Ethereum"` and `testnet: false`. This
    is the prod regression for the "Hoodi on chain 1" bug.
  - It throws before `setWalletConnectConfig`. The lazy contract still holds.
- **`packages/wallet-connect/src/network/links.test.ts`.** Add cases for
  `networkIdFromEvmChainId` with 1 (mainnet), 560048 (testnet) and an unknown id (testnet
  styled, `Chain <id>` label).
- **`packages/wallet-connect/src/evm/useEvmWallet.test.tsx` and
  `packages/frontend/src/wallet/evm/useEvmWallet.test.tsx`.**
  - `chainId` comes from `useAccount().chainId`.
  - A mock `pipeline.mock.wallet.chainId` overrides it.
  - `chainId` is `undefined` when disconnected.
  - Update the existing `useChainId` mocks in the other `wallet/evm/*.test.tsx` and
    `useStakeFlow.test.tsx`: add `chainId` to the `useAccount` mock wherever a test needs it.
- **`packages/frontend/src/wallet/evm/useEvmNetworkGuard.test.tsx` (new).** Mock `wagmi`
  (`useAccount`, `useSwitchChain`) and `useWalletView`.
  - Correct chain gives `isWrongNetwork` false.
  - Wrong chain in the EVM view gives true.
  - Wrong chain in the Stellar view gives false.
  - Disconnected gives false.
  - The mock `pipeline.mock.wallet.chainId = "1"` with `ENV.EVM_CHAIN_ID = 560048` gives true.
  - `switchNetwork()` calls the mutation with `{ chainId: ENV.EVM_CHAIN_ID }`.
  - In mock mode it only `console.warn`s.
  - `isSwitching` and `switchError` pass through.
- **`packages/frontend/src/wallet/networkSwitcher.test.ts`.**
  - `getNetworkSwitcherState("evm")` with `EVM_CHAIN_ID` 1 gives the mainnet identity, and
    `otherNetworks` excludes `mainnet`.
  - `"stellar"` keeps the passphrase behaviour.
  - `isMainnetNetwork` covers each view against both mainnet and testnet config.
  - Rename the `isMainnetDeployment` cases.
- **`components/HomeStatsStrip.test.tsx`, `TopBar.test.tsx`, `MobileNavMenu.test.tsx`,
  `routes/-dashboard-redirect.test.tsx`, `routes/-root.test.tsx`.** Switch the
  `isMainnetDeployment` stubs to `useIsMainnetNetwork` / `isMainnetNetwork`. Add one case each
  showing the gate follows the view: Stellar testnet with EVM mainnet hides TVL in the EVM view
  and shows it in the Stellar view. The dashboard redirect follows the stored view kind.
- **`components/NetworkSwitcher` coverage (new `NetworkSwitcher.test.tsx`, or inside
  `TopBar.test.tsx`).**
  - In the EVM view on the wrong chain, `topbar-network-badge` has
    `data-state="wrong-network"`, the label is "Wrong network", and the menu shows
    `topbar-network-switch-chain`. Clicking it calls `switchNetwork`.
  - In the Stellar view, a wrong EVM chain is ignored.
  - With the correct chain, the existing behaviour is unchanged.
- **`AccountDropdown.test.tsx`.** Update the stub from `getNetworkSwitcherState` to
  `useNetworkSwitcherState`.
- **`routes/-deposit.test.tsx` and `routes/-stake.test.tsx`.** Add `useSwitchChain` to the
  wagmi mock.
  - EVM, connected, wrong chain: `wrong-network-banner` renders and no steps card renders
    (deposit, withdraw direction, stake, unstake tab).
  - Clicking the action calls the switch mutation.
  - Disconnected still shows `connect-wallet-banner`, which outranks wrong-network.
  - The Stellar view with a wrong EVM chain shows no wrong-network banner.
  - The correct chain shows the steps card as before.
- **Write guard.** In the existing `useDepositManager` / `useApproval` / `useStakedPlusd` /
  `useWithdrawalQueue` tests, assert that the `writeContract` call args include
  `chainId: 560048`.
- **Manual check.** Use the user's running dev server; do not start one if it is already up,
  and do not drive the user's browser. Ask the user to verify the following and report back:
  - With `localStorage.setItem("pipeline.mock.wallet.chainId","1")` and a mock address on a
    Hoodi config, the banner appears on `/deposit`, `/deposit?direction=withdraw` and `/stake`,
    and the pill turns into the wrong-network state.
  - A real MetaMask session on Ethereum mainnet against a Hoodi deployment is prompted to
    switch or add Hoodi.
- Run `yarn workspace @pipeline/frontend test`, `yarn workspace @pipeline/wallet-connect test`
  and `yarn workspace @pipeline/trustee test`. Trustee tests cover the renamed `getEvmChain`
  path transitively.

## Docs to Update

- **`docs/frontend/wallet-flows.md`.**
  - Under "EVM integration", add a "Chain registry" subsection covering:
    - the source (`packages/wallet-connect/src/evm/chains.ts`) and the per-slice wrappers;
    - the table of known ids (1, 560048) with name, explorer and `testnet`;
    - the generic fallback rule;
    - that the RPC always comes from config;
    - the memoization and lazy-config rules.
  - Add a "Wrong network" subsection covering:
    - the detection rule (EVM view, connected, `useAccount().chainId` ≠ `VITE_EVM_CHAIN_ID`,
      mock-key aware);
    - the surfaces (deposit/withdraw/stake banner, pill state);
    - the switch via `useSwitchChain`, including the add-chain fallback;
    - the `writeContract` `chainId` guard;
    - the mock-mode behaviour.
  - Keep a one-line scaffold note for the remainder, which is owned by #1504.
  - In "Network switcher → Design §1", extend the current-network identity rule: the Stellar
    view uses the passphrase, the EVM view uses `networkIdFromEvmChainId(VITE_EVM_CHAIN_ID)`,
    and the mainnet gate follows the view. Add `networkIdFromEvmChainId` to the §5 shared-helper
    list.
- **`docs/frontend/dashboard-components.md`.**
  - "Deposit and withdraw route" banner precedence: insert a wrong-network item after "Wallet
    not connected" (EVM only), and do the same for the Stake route.
  - "HomeStatsStrip" and "Dashboard route" mainnet-gate paragraphs: change "mainnet deployment"
    to "active view's network is mainnet" (or keep it deployment-level, per Open Question 3).
  - "TopBar" / "MobileNavMenu": note the pill's wrong-network state.
- **`docs/FRONTEND.md`.**
  - "Web3 integration → Chain": the registry-selected chain, with ids 1 and 560048 known and
    others generic.
  - Runtime keys table: annotate `VITE_EVM_CHAIN_ID` as "selects the chain-registry entry
    (1 = Ethereum mainnet, 560048 = Hoodi; other ids use a generic testnet-styled definition)".
    The defaults are unchanged.
- **`packages/frontend/src/wallet/README.md`.** The `chainId` row, the mock-key row and
  `useEvmNetworkGuard` (Step 11).
- **`docs/frontend/utils.md`.** If it catalogues shared helpers, add `evmChainInfo` /
  `defineEvmChain` / `networkIdFromEvmChainId`. The coder checks for an existing
  network-switcher entry.
