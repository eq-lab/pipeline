# Issue #692: [FE] [Stellar] Connecting a Stellar wallet doesn't update the UI — connect buttons persist (no shared connection state)

Source: https://github.com/eq-lab/pipeline/issues/692

## Scope

Make the real (non-mock) Stellar connection state reactive across **all**
`useStellarWallet()` consumers. After this change, connecting or disconnecting a
Stellar wallet in any component updates every consumer immediately (connect
buttons flip to the connected pill without a page reload).

In scope:

- Replace the per-instance `useState<string | undefined>(realAddress)` in
  `packages/frontend/src/wallet/stellar/useStellarWallet.ts` with a single
  module-level external store read via `useSyncExternalStore`.
- Route `runConnect()` (in `useStellarWallet`) and `connectWallet()` (in
  `useStellarConnectors`) success, and `disconnect()`, through the shared store
  setter so all instances re-render.
- Hydrate the store once from `StellarWalletsKit.getAddress()` on first mount
  (the mount-time effect currently per-instance).
- Subscribe to kit connection/disconnection events **if the kit exposes them**;
  if it does not, document that external (extension-initiated) disconnects are
  out of scope (see Open Questions).

Out of scope:

- The mock path is already reactive (`useMockStellarAddress` via
  `useSyncExternalStore`) and is unchanged. Mock precedence (mock wins over real)
  is preserved.
- EVM wallet behaviour (already reactive via wagmi).
- Home-page Stellar view wiring (#684 — closed/complementary).

## Assumptions and Risks

- **Module-level store is acceptable here.** The store is a singleton mirroring
  the kit singleton (`StellarWalletsKit` is itself a module-level singleton from
  `./config`), so a module-scoped store does not break SSR assumptions beyond
  what already exists. `StellarWalletProvider` stays thin; no React context is
  required. This matches the existing `useSyncExternalStore` pattern in
  `evm/mock.ts` (`subscribeMock`/`useMock`).
- **Test isolation risk.** A module-level store persists across tests in the same
  file/worker. `useStellarWallet.test.tsx` must reset the store between tests
  (export a `_resetStellarConnectionStoreForTests()` helper, mirroring
  `_resetBridgeForTests` in `evm/mock.ts`).
- **Kit event API uncertainty.** It is unconfirmed whether
  `@creit.tech/stellar-wallets-kit` v2.x exposes a subscribe/`on(...)` API for
  connection changes. The issue says "if available". The core fix (shared store
  driven by our own connect/disconnect calls) does not depend on it. See Open
  Questions.
- **getAddress hydration race.** Today each instance calls `getAddress()` on
  mount. Consolidating to a single hydration must still tolerate `getAddress()`
  throwing when no prior connection exists (leave store `undefined`).

## Open Questions

- Does `@creit.tech/stellar-wallets-kit` v2.x expose a connection-change event
  subscription (e.g. `StellarWalletsKit.on(...)` or a callback in `init`)? If
  yes, subscribe so extension-initiated disconnects propagate; if no, scope this
  issue to in-app connect/disconnect only and log the external-disconnect gap in
  `docs/exec-plans/tech-debt-tracker.md`. The coder should confirm against the
  installed version before implementing the event subscription (the rest of the
  fix proceeds regardless).

## Implementation Steps

1. **Create the shared connection store.** In a new module
   `packages/frontend/src/wallet/stellar/connectionStore.ts` (or a top-of-file
   section in `useStellarWallet.ts` — prefer a separate module for testability),
   implement a minimal external store:
   - Module-level `let currentAddress: string | undefined`.
   - `Set<() => void>` of listeners.
   - `getStellarConnectionAddress(): string | undefined` — snapshot getter.
   - `setStellarConnectionAddress(addr: string | undefined): void` — updates
     `currentAddress` only when it actually changes, then notifies listeners.
   - `subscribeStellarConnection(listener): () => void` — add/remove listener.
   - `useStellarConnectionAddress(): string | undefined` — wraps
     `useSyncExternalStore(subscribe, snapshot, () => undefined)` (SSR snapshot
     `undefined`, mirroring `useMock`).
   - `_resetStellarConnectionStoreForTests(): void` — clears `currentAddress`
     and listeners (TESTS ONLY), mirroring `_resetBridgeForTests`.
   - Add a module doc comment explaining why this is module-level (singleton kit
     mirror) and how it relates to the mock store.

2. **Rewire `useStellarWallet()`** in
   `packages/frontend/src/wallet/stellar/useStellarWallet.ts`:
   - Remove `const [realAddress, setRealAddress] = useState(...)`.
   - Read `const realAddress = useStellarConnectionAddress();`.
   - Keep `unmountedRef` only if still needed; the store no longer requires an
     unmounted guard for setters (the store is global, not tied to a mounted
     component), so the `unmountedRef` guards around `setRealAddress` can be
     dropped. Verify no other use of `unmountedRef` remains; remove it if unused.
   - Mount-time hydration: keep the `useEffect(... getAddress())` but call
     `setStellarConnectionAddress(address)` on success. To avoid every one of the
     ~43 consumers firing `getAddress()` on mount, guard hydration so it runs once
     per page lifetime (module-level `let hydrated = false` in the store module,
     set true on first run; the effect early-returns if already hydrated). Ensure
     `_resetStellarConnectionStoreForTests()` also resets `hydrated`.
   - `runConnect()`: replace `setRealAddress(newAddress)` with
     `setStellarConnectionAddress(newAddress)` (drop the unmounted guard).
   - `disconnect()`: replace `setRealAddress(undefined)` with
     `setStellarConnectionAddress(undefined)` (keep the `void StellarWalletsKit.disconnect()` call and the mock warning branch).
   - Leave `address`/`isConnected` resolution and mock precedence unchanged.

3. **Rewire `useStellarConnectors()`** in the same file:
   - Remove its local `const [, setRealAddress] = useState(...)`.
   - On `fetchAddress()` success, call `setStellarConnectionAddress(newAddress)`
     so the per-wallet connect path (used by the Connect modal) also propagates
     globally. This is the actual code path the bug report describes (connect
     modal instance updating only itself).
   - Reassess whether `useStellarConnectors` still needs `unmountedRef`; remove
     if unused after the change.

4. **(Conditional) Kit event subscription.** If the Open Question resolves that a
   kit subscription API exists, add a one-time subscription (in the store module
   or the hydration effect) that calls `setStellarConnectionAddress(...)` on kit
   connection-change events so extension-initiated disconnects propagate. If not
   available, skip and record the gap in
   `docs/exec-plans/tech-debt-tracker.md`.

5. **Update tests** (see Test Strategy).

6. **Update wallet README** if it documents the Stellar connection-state
   mechanism (`packages/frontend/src/wallet/README.md` — verify whether the
   Stellar section describes per-instance state; update to describe the shared
   store).

## Test Strategy

Update `packages/frontend/src/wallet/stellar/useStellarWallet.test.tsx`:

- Add `beforeEach`/`afterEach` call to `_resetStellarConnectionStoreForTests()`
  so the module-level store does not leak across tests.
- **New cross-instance test (the regression guard):** render two independent
  `useStellarWallet()` hooks (`renderHook` twice, or a wrapper rendering two
  consumers). Drive `connect()` → resolve `mockAuthModal` with an address on the
  first instance; assert the **second** instance's `address`/`isConnected`
  updates without re-mount. This directly encodes the bug.
- **Connector path test:** call `useStellarConnectors().connectWallet(id)`,
  resolve `mockFetchAddress`; assert a separate `useStellarWallet()` instance
  reflects the new address.
- **Disconnect propagation test:** connect, then `disconnect()` on one instance;
  assert another instance flips to disconnected.
- Preserve existing tests: mount-time `getAddress()` hydration, mock precedence,
  terms-gate routing, `signTransaction` mock rejection. Verify the once-per-page
  hydration guard does not break the existing mount-hydration test (reset the
  `hydrated` flag in the test reset helper).
- Add a focused unit test for `connectionStore.ts` if implemented as a separate
  module (set/get/subscribe/notify-on-change-only).

Run: `npx vitest run` for the frontend package (or the project `/test-fast`),
plus `npx tsx scripts/lint-docs.ts` per AGENTS.md after the TS change.

Manual/Figma verification: no Figma URL is referenced in the issue. Manual check
(optional, mock-free env): connect a real Stellar wallet and confirm the header
"Connect Wallet" button flips to the connected pill without reload.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — update the Stellar wallet section if
  it documents per-instance connection state; describe the shared store.
- `docs/exec-plans/tech-debt-tracker.md` — only if the kit lacks a
  connection-event API (record the external-disconnect propagation gap).
- No product-spec change: this is a `fix/` with no user-facing behavior change
  beyond making the existing intended behavior reliable.
