# Issue #448: [FE] [Stellar] Wallet plumbing: provider, connect hook, ESLint boundary, env, mock keys

Source: https://github.com/eq-lab/pipeline/issues/448

Part of epic #444 (Stellar/Soroban multi-chain wallet), sub-issue 1. Blocker #447
(EVM restructure into `src/wallet/evm/`) is merged (PR #451, `f5593fb`); the
symmetric `src/wallet/evm/` layout and the split ESLint boundary are on `main`
and present on this branch.

## Scope

Stand up the Stellar wallet namespace alongside the existing EVM namespace.
Plumbing only — **no UI changes** (the dropdown toggle, connect chooser, and
balance pill are epic sub-issues 2 and 3).

In scope:

- `packages/frontend/src/wallet/stellar/` new module:
  - `chain.ts` — network passphrase, Horizon URL, USDC issuer (all read from `ENV`).
  - `config.ts` — `@creit.tech/stellar-wallets-kit` instance, created once at module load.
  - `StellarWalletProvider.tsx` — provider mounted under `<EvmWalletProvider>` in `main.tsx`.
  - `useStellarWallet.ts` — `{ address, isConnected, connect, disconnect }`, mock-aware.
  - `mock.ts` — Stellar mock-key constants + parse/read helpers, reusing the shared
    bridge primitives from `../evm/mock` (do **not** duplicate the localStorage bridge).
- ESLint boundary (Stellar half): a `no-restricted-imports` rule so
  `@creit.tech/stellar-wallets-kit` and `@stellar/stellar-sdk` are only importable
  from `src/wallet/stellar/**`.
- Env vars in `packages/frontend/src/lib/env.ts` + `.env.example`:
  `VITE_STELLAR_NETWORK`, `VITE_STELLAR_HORIZON_URL`, `VITE_STELLAR_USDC_ISSUER`.
- New Stellar mock keys: `pipeline.mock.wallet.stellar.address`,
  `pipeline.mock.wallet.stellar.isConnected`, `pipeline.mock.wallet.stellar.balance.usdc`.
- Export the new public surface from the `src/wallet/index.ts` barrel.
- Add the two new dependencies to `packages/frontend/package.json`.
- Unit tests for `useStellarWallet` and the new mock helpers.
- Doc updates: wallet `README.md`, `docs/frontend/hooks.md`, `.env.example`.

Also in scope (added by resolved decision — shared terms gate):

- Refactor the existing EVM-scoped terms gate to be chain-agnostic and shared so the
  first connect of EITHER chain triggers the single terms attestation: move
  `WalletGateContext.ts` and `useTermsAcknowledgement.ts` out of `src/wallet/evm/`
  into a shared `src/wallet/` location, switch the storage to a single chain-agnostic
  flag (`pipeline.wallet.termsAcknowledged`) with migration from the legacy
  address-scoped keys, hoist the gate provider above both wallet providers, and route
  Stellar `connect()` through it. `FirstConnectionModal` (already chain-neutral UI in
  `src/components/`) is reused unchanged.

Out of scope (later epic sub-issues / future epics):

- `useStellarToken` (USDC balance from Horizon) — epic sub-issue 2.
- `WalletViewContext`, dropdown segmented control, `TopBar` pill switching, connect
  chooser modal — epic sub-issue 3.
- Soroban contract calls / signing; mainnet network-switch UI; backend awareness.
- Wiring the Stellar `balance.usdc` mock key into any consumer (no balance hook
  exists yet — the key is defined and documented now so sub-issue 2 has the schema,
  but nothing reads it in this issue).

## Assumptions and Risks

- **#447 is landed.** Confirmed: `src/wallet/evm/` exists, `src/wallet/index.ts`
  re-exports the EVM surface, and `eslint.config.js` already restricts wagmi/viem/
  AppKit to `src/wallet/evm/**`. The Stellar work is purely additive.
- **USDC testnet issuer default (epic open decision — resolved in-plan).** Circle's
  official USDC issuer on Stellar **testnet** is
  `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (confirmed via Circle
  developer docs and the StellarExpert testnet explorer; this differs from the
  **mainnet** issuer `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`).
  Ship the testnet issuer as the default for `VITE_STELLAR_USDC_ISSUER` since the
  default network is `testnet`. No consumer reads it in this issue, so even if the
  value needed correcting later it would not block this plumbing — it is wired into
  `chain.ts` and `.env.example` only.
- **Stellar Wallets Kit — newer singleton SDK API, pinned to an EXACT version
  (resolved decision).** The package ships two API styles: the classic instance API
  (`new StellarWalletsKit({...})` + `kit.openModal()` + `kit.setWallet()`) and the
  newer **singleton SDK API**. Per the resolved decision this plan targets the
  **singleton SDK API** and pins `@creit.tech/stellar-wallets-kit` to the latest
  stable EXACT version **`2.2.0`** (no `^`/range). The v2.x surface was verified by
  unpacking the published tarball — the relevant symbols (all imported from the
  package root `@creit.tech/stellar-wallets-kit`) are:
  - `StellarWalletsKit.init(params)` — **static**, returns `void`, called once at
    module load. `params: { modules: ModuleInterface[]; network?: Networks;
    selectedWalletId?: string; theme?; authModal?: { showInstallLabel?;
    hideUnsupportedWallets? } }`.
  - `StellarWalletsKit.authModal(): Promise<{ address: string }>` — opens the
    wallet-picker modal, sets the selected wallet as active, and resolves the public
    key in one call. This **replaces** the classic `openModal` + `setWallet` +
    `getAddress` three-step flow.
  - `StellarWalletsKit.getAddress(): Promise<{ address: string }>` — reads the
    currently-active address from kit memory (async; note the `{ address }` wrapper).
  - `StellarWalletsKit.disconnect(): Promise<void>` — async.
  - `Networks` enum (exported from the kit, **not** a separate `WalletNetwork` type):
    `Networks.TESTNET` / `Networks.PUBLIC`. Its string values **are the network
    passphrases** themselves (e.g. `TESTNET = "Test SDF Network ; September 2015"`),
    so the kit's `network` param is passed the passphrase-valued enum.
  - Modules helper is `defaultModules()` (from
    `@creit.tech/stellar-wallets-kit/modules/utils`), **not** `allowAllModules` — that
    name does not exist in v2.x. Individual module classes live under
    `@creit.tech/stellar-wallets-kit/modules/<name>` (e.g. `freighter`, `xbull`,
    `lobstr`, `albedo`, `rabet`, `wallet-connect`). `defaultModules()` returns the
    no-extra-config modules; use it unless a specific module needs options.
  The public hook contract (`{ address, isConnected, connect, disconnect }`) is
  unchanged. Blast radius of the API style is confined to `config.ts` +
  `useStellarWallet.ts`. **Risk:** because the static methods are async and the kit
  registers web components at `init`, the tests MUST mock the kit module (see Test
  Strategy) so jsdom never touches the DOM-bound singleton.
- **Exact version pins for both Stellar deps (resolved decision).** Pin
  `@stellar/stellar-sdk` to its latest stable EXACT version **`15.1.0`** (no `^`).
  Record both resolved versions in the PR. (The classic-API `^1`/`^13` ranges from
  the prior draft are superseded.)
- **Terms gate — GATED TOGETHER / shared across chains (resolved decision,
  supersedes prior "ungated" assumption).** The terms self-attestation must be asked
  **once on the first wallet connect of EITHER chain** (EVM or Stellar) and NOT
  re-asked when the user later connects the other chain. The existing EVM-scoped gate
  (`FirstConnectionModal` component in `src/components/`, plus `WalletGateContext.ts`
  and `useTermsAcknowledgement.ts` in `src/wallet/evm/`) must be refactored to be
  chain-agnostic and hoisted so both providers share it. Stellar `connect()` routes
  through the same gate. See Implementation Steps 5a–5d for the minimal refactor.
  The mock short-circuit still mirrors EVM: when `pipeline.mock.wallet.stellar.address`
  is set, `connect()`/`disconnect()` are no-ops with a console hint and bypass the gate.
- **Storage key becomes chain-agnostic (single flag) + migration.** The current EVM
  gate persists acknowledgement under **address-scoped** keys
  (`pipeline.wallet.termsAcknowledged.<address>`, plus a transient
  `pipeline.wallet.termsAcknowledged.pending` written before the address is known and
  migrated post-connect). Per the resolved decision the new gate uses a **single
  chain-agnostic flag** — `pipeline.wallet.termsAcknowledged` (value `"true"`) — not a
  per-chain or per-address key. The address-scoped/pending machinery
  (`termsKey(address)`, `PENDING_ACK_KEY`, the post-connect migration `useEffect` in
  `EvmWalletProvider`) is removed. **Migration of the old key:** on first read, treat
  the user as already acknowledged if EITHER the new flag is `"true"` OR any legacy
  `pipeline.wallet.termsAcknowledged.<something>` (`.pending` or an address-scoped
  key) is `"true"`; when a legacy value is found, write the new flat key and (best
  effort) leave the legacy keys in place (harmless). This avoids re-prompting existing
  users who already attested under the old EVM scheme.
- **`@stellar/stellar-sdk` is pulled in now but only `Networks`/passphrase constants
  are used** (for `chain.ts` / kit network config). The Horizon `Server` usage lands
  in sub-issue 2. Importing it now is what justifies adding it to the ESLint Stellar
  boundary in this issue.
- **SSR/test safety.** `config.ts` calls `StellarWalletsKit.init(...)` once at module
  load (mirroring EVM's `createAppKit` pattern). Tests must mock the kit module to
  avoid touching the DOM / registering web components, exactly as
  `useEvmWallet.test.tsx` mocks `./config`, `wagmi`, and `@reown/appkit/react`.
  Because the v2.x kit exposes only **static async** methods (`authModal`,
  `getAddress`, `disconnect`), the mock spies resolve promises rather than return
  synchronously — `useStellarWallet`'s `connect()`/`disconnect()` therefore handle the
  async kit calls internally (the public hook methods remain `void`-returning,
  fire-and-forget with internal state updates).

## Open Questions

_None_

## Implementation Steps

1. ✅ **Add dependencies (EXACT pins, no `^`/range).** In
   `packages/frontend/package.json` add to `dependencies`:
   `"@creit.tech/stellar-wallets-kit": "2.2.0"` and `"@stellar/stellar-sdk": "15.1.0"`
   — both pinned **exactly** (these are the latest stable versions as of this plan;
   if a newer stable exists at implementation time, pin that exact version and update
   the call shapes only if the singleton SDK API changed). Run `yarn install` from the
   repo root. Confirm the installed `@creit.tech/stellar-wallets-kit` exposes the
   **singleton SDK API** from the package root: `StellarWalletsKit` (class with static
   `init`/`authModal`/`getAddress`/`disconnect`), the `Networks` enum, and
   `defaultModules` from `@creit.tech/stellar-wallets-kit/modules/utils`. (`allowAllModules`
   does NOT exist in v2.x — do not use it.) Record both resolved versions in the PR.

2. ✅ **Env vars** — `packages/frontend/src/lib/env.ts`. Add three keys to the frozen
   `ENV` object using the existing `readString` helper with defaults:
   - `STELLAR_NETWORK: readString("VITE_STELLAR_NETWORK", "testnet")`
   - `STELLAR_HORIZON_URL: readString("VITE_STELLAR_HORIZON_URL", "https://horizon-testnet.stellar.org")`
   - `STELLAR_USDC_ISSUER: readString("VITE_STELLAR_USDC_ISSUER", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5")`
   Add a short doc comment per key mirroring the EVM entries. No allowlist validation
   on `STELLAR_NETWORK` (the EVM env keys are not validated either; keep symmetry).

3. ✅ **`.env.example`** — append the three vars under a `# Stellar` heading, mirroring
   the existing EVM block format, with the testnet defaults inline.

4. ✅ **`src/wallet/stellar/chain.ts`** — derive Stellar network config from `ENV`:
   - Map `ENV.STELLAR_NETWORK` (`"testnet"` | `"mainnet"`) to the kit's `Networks`
     enum (imported from `@creit.tech/stellar-wallets-kit`): `Networks.TESTNET` /
     `Networks.PUBLIC`. In v2.x this enum's string values **are** the network
     passphrases, so the kit `network` param and the on-chain `networkPassphrase` are
     the same value — also surface the `@stellar/stellar-sdk` `Networks` passphrase
     constant (`Networks.TESTNET` / `Networks.PUBLIC` from stellar-sdk) for sub-issue
     2's Horizon/Soroban calls and assert it equals the kit enum value. Export the
     resolved `kitNetwork` (kit `Networks` enum value), `networkPassphrase` (string),
     `horizonUrl` (`ENV.STELLAR_HORIZON_URL`), and `usdcIssuer`
     (`ENV.STELLAR_USDC_ISSUER`). This is the single place env → Stellar config
     translation happens (mirrors `evm/chain.ts`).

5. ✅ **`src/wallet/stellar/config.ts`** — initialise the singleton kit once at module
   scope via the static `init` (mirroring `evm/config.ts`'s module-load `createAppKit`).
   The v2.x singleton SDK API uses a static `init` (no `new`), and there is no
   instance to export — consumers call the `StellarWalletsKit` static methods
   directly:
   ```ts
   import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
   import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
   import { kitNetwork } from "./chain";

   StellarWalletsKit.init({
     network: kitNetwork,        // kit `Networks` enum value, from ./chain
     modules: defaultModules(),  // no-extra-config wallets (Freighter, xBull, Albedo, Rabet, Lobstr, …)
     // selectedWalletId optional — left unset; authModal lets the user pick
   });

   // Re-export the singleton class so the hook imports it from here (boundary).
   export { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
   ```
   Keep this the ONLY file that imports `@creit.tech/stellar-wallets-kit` (the hook
   imports the re-exported `StellarWalletsKit` from `./config`, not the library). If a
   WalletConnect-for-Stellar module is wanted it requires extra config (project id via
   `ENV.WALLETCONNECT_PROJECT_ID`) and is therefore NOT in `defaultModules()` — adding
   it is optional/out of scope for this plumbing issue; note it but ship
   `defaultModules()` only.

✅ **Shared terms-gate refactor (steps 5a–5e).** These hoist the existing EVM-scoped
gate into a chain-agnostic shared gate used by BOTH providers. Do this before wiring
Stellar `connect()` so the hook (step 7) can consume the shared `useWalletGate`.

5a. **Move + de-scope the gate context — `src/wallet/WalletGateContext.ts`.** Move
   `src/wallet/evm/WalletGateContext.ts` to `src/wallet/WalletGateContext.ts`
   (chain-agnostic location). The `WalletGateContextValue` (`openGate()`) and
   `useWalletGate()` no-op fallback are already chain-neutral and stay as-is. Update
   the doc comment to say it gates the first connect of EITHER chain. Fix imports in
   consumers (`useEvmWallet.ts` and the new `useStellarWallet.ts` import from
   `../WalletGateContext`).

5b. **De-scope terms acknowledgement to a single flag —
   `src/wallet/useTermsAcknowledgement.ts`.** Move
   `src/wallet/evm/useTermsAcknowledgement.ts` to `src/wallet/useTermsAcknowledgement.ts`
   and rewrite it to use a **single chain-agnostic key** instead of address-scoped
   keys:
   - New key constant: `const TERMS_KEY = "pipeline.wallet.termsAcknowledged";` (value
     `"true"`).
   - `readTermsAcknowledged()` becomes **argument-less** (drop the `address` param):
     returns `true` if `TERMS_KEY === "true"`, OR (migration) if any legacy key is
     `"true"` — check the old `pipeline.wallet.termsAcknowledged.pending` and scan
     `localStorage` for any `pipeline.wallet.termsAcknowledged.<addr>` key set to
     `"true"`. On a legacy hit, write `TERMS_KEY="true"` (best-effort, in a try/catch)
     so subsequent reads are cheap and the user is never re-prompted.
   - `useTermsAcknowledgement()` becomes argument-less, seeds state from
     `readTermsAcknowledged()`, subscribes to the native `storage` event filtered on
     `TERMS_KEY`, and `acknowledge()` writes `TERMS_KEY="true"` + sets local state.
   - Remove `termsKey(address)`, `PENDING_ACK_KEY`, and all address/pending plumbing.
   - Update `useEvmWallet.ts`: `connect()` now calls `readTermsAcknowledged()` (no
     address arg); when false → `openGate()`; else `void open()`. The mock
     short-circuit is unchanged.

5c. **Hoist + de-scope the gate provider.** Extract the `WalletGateProvider` inner
   component out of `EvmWalletProvider.tsx` into its own chain-agnostic
   `src/wallet/WalletGateProvider.tsx`:
   - It renders `FirstConnectionModal` (unchanged, from `src/components/`) and provides
     `WalletGateContext`.
   - Remove the AppKit/`useAccount` coupling: the old provider called AppKit `open()`
     itself inside `handleContinue` and read `useAccount()` for address-scoped acks.
     The shared gate must NOT know about AppKit or wagmi. Instead, `openGate()` accepts
     (or stores) an `onContinue` callback supplied by the caller of `openGate`, OR the
     gate exposes a generic "proceed" that the triggering hook wired. Concretely:
     change `WalletGateContextValue` to `openGate(onProceed: () => void): void`; the
     provider stores the latest `onProceed`, and `handleContinue` calls
     `acknowledge()` (writes the single flag) then invokes the stored `onProceed()`.
     EVM passes `() => void open()`; Stellar passes `() => void runConnect()`.
   - Drop the post-connect address migration `useEffect` and `pendingAckRef` entirely
     (the single flag is written at acknowledge time, before connect — no address
     needed). Keep focus-restore (`triggerRef`) and the "already acknowledged → close"
     guard (now using argument-less `readTermsAcknowledged()`).

5d. **`EvmWalletProvider` slims down.** `src/wallet/evm/EvmWalletProvider.tsx` keeps
   `WagmiProvider` + `QueryClientProvider` + `installSameTabMockBridge`, but no longer
   owns the gate. The shared `WalletGateProvider` is hoisted to wrap BOTH wallet
   providers in `main.tsx` (step 9) so a single modal instance serves both chains.
   Remove the gate imports (`FirstConnectionModal`, `WalletGateContext`,
   `readTermsAcknowledged`, `useAppKit`/`useAccount` usage that existed only for the
   gate) from this file.

5e. **Barrel + tests for the moved files.** Update `src/wallet/index.ts` if it
   re-exported any gate symbol. Move the gate test files alongside their new homes:
   `WalletGateContext`/`useTermsAcknowledgement` tests (currently
   `src/wallet/evm/useTermsAcknowledgement.test.tsx`) move to `src/wallet/` and are
   rewritten for the single-flag + migration behavior (see Test Strategy).
   `FirstConnectionModal.test.tsx` stays (UI unchanged).

6. ✅ **`src/wallet/stellar/mock.ts`** — define Stellar mock-key constants and typed
   readers, reusing the shared primitives from `../evm/mock` (`readMock`, `useMock`,
   `parseAddress`-equivalent, `parseBoolean`, `parseBigInt`/`parseJson`). Note:
   `parseAddress` in `evm/mock.ts` asserts a `0x` prefix and is EVM-specific — add a
   local `parseStellarAddress` (asserts a `G...` 56-char strkey shape, loosely) or
   reuse a generic string parse. Keys:
   - `pipeline.mock.wallet.stellar.address` (string, `G...`)
   - `pipeline.mock.wallet.stellar.isConnected` (`"true"`/`"false"`)
   - `pipeline.mock.wallet.stellar.balance.usdc` (decimal string; defined +
     documented for sub-issue 2, not consumed here)
   Do not re-install the same-tab bridge — it is already installed once by
   `EvmWalletProvider` and patches all `pipeline.mock.*` keys, so Stellar keys fan
   out for free. `StellarWalletProvider` should NOT call `installSameTabMockBridge`.

7. ✅ **`src/wallet/stellar/useStellarWallet.ts`** — public hook returning
   `{ address: string | undefined; isConnected: boolean; connect(): void; disconnect(): void }`.
   - Read `pipeline.mock.wallet.stellar.address` / `.isConnected` via `useMock`.
     Resolve `address`/`isConnected` with the same precedence as EVM: mock address
     wins; `isConnected` defaults to `true` when a mock address is present and the
     `isConnected` key is absent.
   - Track the real connected address in React state. Seed it on mount by calling the
     async `StellarWalletsKit.getAddress()` (resolves `{ address }`; the kit persists
     the last selection) inside an effect, guarding against unmount; tolerate the
     rejection/empty case (no prior connection) by leaving the address undefined.
   - `connect()`: if a mock address is set → no-op (dev affordance, bypasses the gate).
     Otherwise route through the **shared terms gate** exactly like EVM: read
     `readTermsAcknowledged()` (argument-less) synchronously — if not acknowledged,
     call `openGate(runConnect)` (from the shared `useWalletGate`) and return; the gate
     invokes `runConnect` after the user attests. `runConnect` performs the real kit
     flow: `await StellarWalletsKit.authModal()` → `{ address }` (this single call
     opens the picker, sets the active wallet, and returns the public key), then store
     `address` in state. `connect()` itself returns `void` (fire-and-forget; the async
     work updates state on resolution). If terms are already acknowledged, call
     `runConnect()` directly.
   - `disconnect()`: if a mock address is set → console-warn hint + return (mirror
     EVM). Otherwise `void StellarWalletsKit.disconnect()` (async) and clear local
     address state.
   - Import the gate via `useWalletGate` from `../WalletGateContext` and
     `readTermsAcknowledged` from `../useTermsAcknowledgement` (the moved shared
     modules from steps 5a–5b). Keep all kit access via the `StellarWalletsKit`
     re-export from `./config` — no direct `@creit.tech/stellar-wallets-kit` import in
     the hook beyond types.

8. ✅ **`src/wallet/stellar/StellarWalletProvider.tsx`** — lightweight provider. Unlike
   EVM it needs no `WagmiProvider`/`QueryClientProvider` (those are EVM-side and the
   shared `QueryClient` lives under `EvmWalletProvider`; Stellar balance reads that
   need Query land in sub-issue 2 and will consume the existing client by being
   mounted inside it). For this issue the provider can be a thin pass-through that
   simply renders `children` (and is the mount point future Stellar context/state
   attaches to). Importing `./config` at the top ensures the kit is constructed when
   the provider module loads. Document that it must mount **inside**
   `<EvmWalletProvider>` so it sits within the shared `QueryClientProvider` for
   sub-issue 2.

9. ✅ **`src/main.tsx`** — wrap the tree so the single shared gate sits ABOVE both
   wallet providers and serves both chains:
   ```tsx
   <WalletGateProvider>
     <EvmWalletProvider>
       <StellarWalletProvider>
         <ToastProvider>
           <RouterProvider router={router} />
         </ToastProvider>
       </StellarWalletProvider>
     </EvmWalletProvider>
   </WalletGateProvider>
   ```
   Import `WalletGateProvider`, `EvmWalletProvider`, and `StellarWalletProvider` from
   `@/wallet`. The gate provider is decoupled from wagmi/AppKit (step 5c), so it can
   sit at the top; the EVM `connect()` still gets AppKit `open` from `useAppKit()`
   inside `EvmWalletProvider` and hands it to the gate as the `onProceed` callback, and
   the Stellar hook hands `runConnect` — a single `FirstConnectionModal` instance
   serves both. `StellarWalletProvider` still mounts inside `EvmWalletProvider` so it
   sits within the shared `QueryClientProvider` for sub-issue 2.

10. ✅ **Barrel — `src/wallet/index.ts`** — export `StellarWalletProvider`,
    `useStellarWallet`, and its `StellarWalletState` type. Also export the hoisted
    shared `WalletGateProvider` from `./WalletGateProvider` (it is now consumed by
    `main.tsx`). Re-point any existing re-exports of `WalletGateContext`/
    `useTermsAcknowledgement` to their new `src/wallet/` paths (steps 5a–5b). Mirror
    the EVM mock re-exports if any Stellar mock helper needs to be public (likely only
    the key constants are internal; export only what a consumer/test outside
    `stellar/**` needs). Do not re-export raw Wallets Kit / stellar-sdk types through
    the barrel.

11. ✅ **ESLint boundary (Stellar half) — `packages/frontend/eslint.config.js`.** Add a
    new flat-config block mirroring the existing EVM block: `files: ["**/*.{ts,tsx}"]`,
    `ignores: ["src/wallet/stellar/**", "src/lib/env.ts"]`, with
    `no-restricted-imports` patterns `@creit.tech/stellar-wallets-kit`,
    `@creit.tech/stellar-wallets-kit/*`, `@stellar/stellar-sdk`,
    `@stellar/stellar-sdk/*`. (The existing EVM block already excludes
    `src/wallet/evm/**`; the two blocks are independent so EVM files remain barred
    from Stellar libs and vice versa.)

12. ✅ **Docs:**
    - `packages/frontend/src/wallet/README.md` — add a "Stellar namespace" section:
      `StellarWalletProvider`, `useStellarWallet` API table, the new
      `pipeline.mock.wallet.stellar.*` key table + a DevTools snippet, and a note on
      the ESLint Stellar boundary. State explicitly that balance is not yet wired.
    - `docs/frontend/hooks.md` — add a `useStellarWallet` row (it is a shared hook).
    - Update the README's intro boundary paragraph to mention the Stellar libs are
      restricted to `src/wallet/stellar/**`.
    - Document the **shared terms gate** change: the gate is now chain-agnostic
      (triggers on the first connect of either chain, asked once), lives in
      `src/wallet/WalletGateProvider.tsx` / `WalletGateContext.ts` /
      `useTermsAcknowledgement.ts`, and persists a single
      `pipeline.wallet.termsAcknowledged` flag (note the migration from the legacy
      address-scoped keys). Update any README text that described the gate as
      EVM-scoped or address-scoped.

## Test Strategy

Add `src/wallet/stellar/useStellarWallet.test.tsx` and
`src/wallet/stellar/mock.test.ts`, mirroring the EVM test scaffolding:

- **Mock the kit module** (`vi.mock("./config", ...)`) so no web component /
  modal / DOM work runs in jsdom. Expose async spies for the v2.x singleton SDK API:
  `mockAuthModal` (resolves `{ address }`), `mockGetAddress` (resolves `{ address }`
  or rejects/empty for "no prior connection"), and `mockDisconnect` (resolves), each
  hung off the mocked `StellarWalletsKit` static methods, mirroring how
  `useEvmWallet.test.tsx` mocks `mockOpen`. Also mock the shared `../WalletGateContext`
  so tests can assert gate routing (a spy `openGate`).
- `useStellarWallet` cases:
  - Disconnected by default (no mocks, `getAddress` resolves empty/rejects → address
    undefined).
  - Reports connected when `pipeline.mock.wallet.stellar.address` +
    `.isConnected` are set.
  - Defaults `isConnected` to `true` when only the address key is set.
  - Reports disconnected when `.isConnected` mock is `"false"`.
  - Re-renders when `.isConnected` is flipped post-mount (dispatch the
    `pipeline-mock:wallet` custom event, as the EVM test does).
  - **Gated path:** when terms are NOT acknowledged, `connect()` calls
    `openGate(onProceed)` and does NOT call `authModal` directly; invoking the captured
    `onProceed` then calls `authModal` and stores the resolved address. (await the
    async resolution with `waitFor`.)
  - **Pre-acknowledged path:** when the single terms flag
    (`pipeline.wallet.termsAcknowledged="true"`) is set, `connect()` calls `authModal`
    directly (gate not opened) and stores the returned address.
  - `connect()` is a no-op when a mock address is set (dev affordance) — neither
    `openGate` nor `authModal` called.
  - `disconnect()` calls `StellarWalletsKit.disconnect()` on the real path and clears
    the address; is a no-op + console-warn on the mock path.
- **Shared gate tests** (moved to `src/wallet/`, rewritten for the single-flag model):
  - `useTermsAcknowledgement` / `readTermsAcknowledged()` (argument-less): false when
    no key set; true when `pipeline.wallet.termsAcknowledged="true"`; `acknowledge()`
    writes the flag and flips state; `storage`-event sync on the single key.
  - **Migration:** `readTermsAcknowledged()` returns true and back-fills the new flat
    key when a legacy `pipeline.wallet.termsAcknowledged.pending="true"` OR a legacy
    address-scoped `pipeline.wallet.termsAcknowledged.0xabc...="true"` is present.
  - `WalletGateProvider`: `openGate(onProceed)` opens `FirstConnectionModal`; Continue
    writes the flag and invokes `onProceed`; dismiss does neither; "already
    acknowledged" auto-closes. (Adapt the existing `FirstConnectionModal.test.tsx` and
    `useEvmWallet.test.tsx` gate assertions to the new `openGate(onProceed)` signature
    and single flag — EVM `connect()` now passes `() => void open()`.)
- `mock.ts` cases: key constants resolve via `readMock`; Stellar address parser
  accepts a `G...` strkey and rejects an EVM `0x...` value; reuse the EVM
  `mock.test.ts` structure.
- Run the full frontend gate before handing back: `yarn workspace @pipeline/frontend
  lint` (ESLint + prettier — confirms both the new ESLint Stellar block passes and
  that no out-of-boundary file imports the Stellar libs), `yarn workspace
  @pipeline/frontend build` (tsc -b + vite build), and `yarn workspace
  @pipeline/frontend test`. Per AGENTS.md also run `npx tsx scripts/lint-docs.ts`
  for the doc edits.
- Manual smoke (coder, optional): `yarn workspace @pipeline/frontend dev`, confirm
  the app boots with both providers mounted and no console errors; set the
  `pipeline.mock.wallet.stellar.*` keys in DevTools and confirm `useStellarWallet`
  reflects them (exercised via the existing `/test` diagnostic page only if a field
  is wired there — otherwise covered by unit tests).

## Docs to Update

- `packages/frontend/src/wallet/README.md` — Stellar namespace section + mock key
  schema + ESLint boundary note + the shared chain-agnostic terms-gate change (single
  `pipeline.wallet.termsAcknowledged` flag, hoisted `WalletGateProvider`, legacy-key
  migration).
- `docs/frontend/hooks.md` — `useStellarWallet` row; update the `useEvmWallet` /
  terms-gate entries if they describe the gate as address-scoped or EVM-only.
- `.env.example` — three `VITE_STELLAR_*` vars with testnet defaults.
- No product-spec change required: this is internal plumbing with no user- or
  agent-facing behavior change (no UI). The epic #444 already captures product
  intent; sub-issues 2/3 carry the user-facing spec impact.
