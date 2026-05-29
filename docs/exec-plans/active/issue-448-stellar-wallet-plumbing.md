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
- **Stellar Wallets Kit API surface / version (real risk — see Open Questions).**
  The package has two distinct API styles in the wild: the classic instance API
  (`new StellarWalletsKit({ network, selectedWalletId, modules })` + `kit.openModal({
  onWalletSelected })` + `kit.getAddress()` + `kit.setWallet(id)` + `kit.disconnect()`)
  and a newer singleton SDK API (`StellarWalletsKit.init({...})` + `authModal()`).
  The epic's code sketch and the issue text describe the classic instance API. This
  plan targets the **instance API** and pins the dependency to a `1.x` release
  (`@creit.tech/stellar-wallets-kit@^1`) to match. If `yarn` resolves a major that
  only ships the singleton SDK API, the connect/disconnect call shapes in `config.ts`
  + `useStellarWallet.ts` change. Mitigation: pin and verify the installed version's
  exported symbols before writing the hook; the public hook contract
  (`{ address, isConnected, connect, disconnect }`) stays identical either way, so
  the blast radius is confined to those two files.
- **Modal vs. mock parity.** The EVM `connect()` is gated by `FirstConnectionModal`
  (terms attestation). The epic's open decisions explicitly leave "reuse the gate
  for Stellar or ship ungated" undecided. This plan ships Stellar connect
  **ungated** for now (simpler, matches "plumbing, no UI") and notes it in Open
  Questions so the manager can confirm. The mock short-circuit mirrors EVM: when
  `pipeline.mock.wallet.stellar.address` is set, `connect()`/`disconnect()` are
  no-ops with a console hint.
- **`@stellar/stellar-sdk` is pulled in now but only `Networks`/passphrase constants
  are used** (for `chain.ts` / kit network config). The Horizon `Server` usage lands
  in sub-issue 2. Importing it now is what justifies adding it to the ESLint Stellar
  boundary in this issue.
- **SSR/test safety.** `config.ts` constructs the kit at module load (mirroring EVM's
  `createAppKit` pattern). Tests must mock the kit module to avoid touching the DOM /
  registering web components, exactly as `useEvmWallet.test.tsx` mocks `./config`,
  `wagmi`, and `@reown/appkit/react`.

## Open Questions

- Should Stellar `connect()` reuse the `FirstConnectionModal` terms-attestation gate
  (currently EVM-scoped), or ship ungated for this plumbing issue? This plan assumes
  **ungated**; confirm before implementation (the epic flags this as an open decision).
- Confirm the Stellar Wallets Kit major to pin (`^1` instance API assumed). If the
  team standardises on the newer singleton SDK API, the `config.ts` +
  `useStellarWallet.ts` call shapes change (public hook contract is unaffected).

## Implementation Steps

1. **Add dependencies.** In `packages/frontend/package.json` add to `dependencies`:
   `"@creit.tech/stellar-wallets-kit": "^1"` and `"@stellar/stellar-sdk": "^13"`
   (pin to whatever current stable major resolves; record the resolved version in the
   PR). Run `yarn install` from the repo root. Inspect the installed package's
   exported symbols to confirm the instance API (`StellarWalletsKit`,
   `WalletNetwork`, module classes such as `FreighterModule`, `xBullModule`, etc.,
   and `allowAllModules` / `defaultModules` helper) before writing `config.ts`. If
   the resolved version only exposes the singleton SDK API, stop and raise with the
   manager (see Open Questions) — do not silently switch APIs.

2. **Env vars** — `packages/frontend/src/lib/env.ts`. Add three keys to the frozen
   `ENV` object using the existing `readString` helper with defaults:
   - `STELLAR_NETWORK: readString("VITE_STELLAR_NETWORK", "testnet")`
   - `STELLAR_HORIZON_URL: readString("VITE_STELLAR_HORIZON_URL", "https://horizon-testnet.stellar.org")`
   - `STELLAR_USDC_ISSUER: readString("VITE_STELLAR_USDC_ISSUER", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5")`
   Add a short doc comment per key mirroring the EVM entries. No allowlist validation
   on `STELLAR_NETWORK` (the EVM env keys are not validated either; keep symmetry).

3. **`.env.example`** — append the three vars under a `# Stellar` heading, mirroring
   the existing EVM block format, with the testnet defaults inline.

4. **`src/wallet/stellar/chain.ts`** — derive Stellar network config from `ENV`:
   - Map `ENV.STELLAR_NETWORK` (`"testnet"` | `"mainnet"`) to the Wallets Kit
     `WalletNetwork` enum and the `@stellar/stellar-sdk` `Networks` passphrase
     (`Networks.TESTNET` / `Networks.PUBLIC`). Export the resolved
     `networkPassphrase`, `walletNetwork`, `horizonUrl` (`ENV.STELLAR_HORIZON_URL`),
     and `usdcIssuer` (`ENV.STELLAR_USDC_ISSUER`). This is the single place env →
     Stellar config translation happens (mirrors `evm/chain.ts`).

5. **`src/wallet/stellar/config.ts`** — construct the Wallets Kit instance once at
   module scope (mirroring `evm/config.ts`'s module-load `createAppKit`):
   ```ts
   export const stellarKit = new StellarWalletsKit({
     network: walletNetwork,        // from ./chain
     modules: allowAllModules(),    // Freighter, Albedo, xBull, Rabet, Lobstr, WalletConnect-for-Stellar
     // selectedWalletId optional — left unset; modal picks
   });
   ```
   Keep this the ONLY file that imports `@creit.tech/stellar-wallets-kit`. Export
   `stellarKit`. (If WalletConnect-for-Stellar requires a project id, reuse
   `ENV.WALLETCONNECT_PROJECT_ID` via the kit's WalletConnect module options;
   otherwise omit it — confirm against the resolved package.)

6. **`src/wallet/stellar/mock.ts`** — define Stellar mock-key constants and typed
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

7. **`src/wallet/stellar/useStellarWallet.ts`** — public hook returning
   `{ address: string | undefined; isConnected: boolean; connect(): void; disconnect(): void }`.
   - Read `pipeline.mock.wallet.stellar.address` / `.isConnected` via `useMock`.
     Resolve `address`/`isConnected` with the same precedence as EVM: mock address
     wins; `isConnected` defaults to `true` when a mock address is present and the
     `isConnected` key is absent.
   - Track the real connected address in React state seeded from `stellarKit`
     (e.g. attempt `kit.getAddress()` on mount; the kit persists the last selection).
   - `connect()`: if a mock address is set → no-op (dev affordance). Otherwise open
     the kit modal (`kit.openModal({ onWalletSelected })` for the instance API),
     call `kit.setWallet(option.id)`, read `kit.getAddress()`, and store the address
     in state. Ungated (no terms modal) per the assumption above.
   - `disconnect()`: if a mock address is set → console-warn hint + return (mirror
     EVM). Otherwise call `kit.disconnect()` and clear local address state.
   - Keep all kit access via the `stellarKit` import from `./config` — no direct
     library import in the hook beyond types.

8. **`src/wallet/stellar/StellarWalletProvider.tsx`** — lightweight provider. Unlike
   EVM it needs no `WagmiProvider`/`QueryClientProvider` (those are EVM-side and the
   shared `QueryClient` lives under `EvmWalletProvider`; Stellar balance reads that
   need Query land in sub-issue 2 and will consume the existing client by being
   mounted inside it). For this issue the provider can be a thin pass-through that
   simply renders `children` (and is the mount point future Stellar context/state
   attaches to). Importing `./config` at the top ensures the kit is constructed when
   the provider module loads. Document that it must mount **inside**
   `<EvmWalletProvider>` so it sits within the shared `QueryClientProvider` for
   sub-issue 2.

9. **`src/main.tsx`** — wrap the tree: `<EvmWalletProvider><StellarWalletProvider>
   <ToastProvider><RouterProvider/></ToastProvider></StellarWalletProvider>
   </EvmWalletProvider>`. Import `StellarWalletProvider` from `@/wallet`.

10. **Barrel — `src/wallet/index.ts`** — export `StellarWalletProvider`,
    `useStellarWallet`, and its `StellarWalletState` type. Mirror the EVM mock
    re-exports if any Stellar mock helper needs to be public (likely only the key
    constants are internal; export only what a consumer/test outside `stellar/**`
    needs). Do not re-export raw Wallets Kit / stellar-sdk types through the barrel.

11. **ESLint boundary (Stellar half) — `packages/frontend/eslint.config.js`.** Add a
    new flat-config block mirroring the existing EVM block: `files: ["**/*.{ts,tsx}"]`,
    `ignores: ["src/wallet/stellar/**", "src/lib/env.ts"]`, with
    `no-restricted-imports` patterns `@creit.tech/stellar-wallets-kit`,
    `@creit.tech/stellar-wallets-kit/*`, `@stellar/stellar-sdk`,
    `@stellar/stellar-sdk/*`. (The existing EVM block already excludes
    `src/wallet/evm/**`; the two blocks are independent so EVM files remain barred
    from Stellar libs and vice versa.)

12. **Docs:**
    - `packages/frontend/src/wallet/README.md` — add a "Stellar namespace" section:
      `StellarWalletProvider`, `useStellarWallet` API table, the new
      `pipeline.mock.wallet.stellar.*` key table + a DevTools snippet, and a note on
      the ESLint Stellar boundary. State explicitly that balance is not yet wired.
    - `docs/frontend/hooks.md` — add a `useStellarWallet` row (it is a shared hook).
    - Update the README's intro boundary paragraph to mention the Stellar libs are
      restricted to `src/wallet/stellar/**`.

## Test Strategy

Add `src/wallet/stellar/useStellarWallet.test.tsx` and
`src/wallet/stellar/mock.test.ts`, mirroring the EVM test scaffolding:

- **Mock the kit module** (`vi.mock("./config", ...)`) so no web component /
  modal / DOM work runs in jsdom. Expose a `mockOpenModal` / `mockGetAddress` /
  `mockDisconnect` spy set, mirroring how `useEvmWallet.test.tsx` mocks `mockOpen`.
- `useStellarWallet` cases:
  - Disconnected by default (no mocks, kit reports no address).
  - Reports connected when `pipeline.mock.wallet.stellar.address` +
    `.isConnected` are set.
  - Defaults `isConnected` to `true` when only the address key is set.
  - Reports disconnected when `.isConnected` mock is `"false"`.
  - Re-renders when `.isConnected` is flipped post-mount (dispatch the
    `pipeline-mock:wallet` custom event, as the EVM test does).
  - `connect()` opens the kit modal and stores the returned address (real path,
    kit spy resolves an address).
  - `connect()` is a no-op when a mock address is set (dev affordance) — kit
    modal spy not called.
  - `disconnect()` calls `kit.disconnect()` on the real path; is a no-op +
    console-warn on the mock path.
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
  schema + ESLint boundary note.
- `docs/frontend/hooks.md` — `useStellarWallet` row.
- `.env.example` — three `VITE_STELLAR_*` vars with testnet defaults.
- No product-spec change required: this is internal plumbing with no user- or
  agent-facing behavior change (no UI). The epic #444 already captures product
  intent; sub-issues 2/3 carry the user-facing spec impact.
