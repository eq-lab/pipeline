# Issue #457: [FE] [Stellar] Blend testnet deposit/withdraw integration (Soroban contract calls + signing)

Source: https://github.com/eq-lab/pipeline/issues/457

Part of epic #444 (Stellar/Soroban multi-chain wallet). This issue extends the
epic past its first milestone (wallet connect + USDC balance read via Horizon,
shipped in #448/#449/#450/#455) into the first **Soroban contract call + signing**
path. It integrates against the live **Blend** lending protocol on Stellar
**testnet** — no contract authoring or deployment.

Groundwork already on the feature branch `feat/457-stellar-blend-deposit-withdraw`
(commit `7a326e0`): `src/lib/env.ts` has `STELLAR_RPC_URL`, `STELLAR_BLEND_POOL_ID`,
`STELLAR_BLEND_USDC_ID`, `STELLAR_BLEND_XLM_ID` wired with verified testnet
defaults. This plan builds on those — it does **not** re-add them.

## Scope

**In scope** (all new code confined to `packages/frontend/src/wallet/stellar/**`):

- Add `@blend-capital/blend-sdk` as a `packages/frontend` dependency.
- New Soroban transaction-flow helper module (`src/wallet/stellar/blendPool.ts`)
  that:
  - builds the Blend `submit` operation XDR for deposit (`SupplyCollateral`) and
    withdraw (`WithdrawCollateral`);
  - wraps it in a transaction, simulates/assembles it against the **Soroban RPC**
    (`STELLAR_RPC_URL`, distinct from Horizon), signs via the wallets-kit, sends,
    and polls `getTransaction` to confirmation.
- Surface the kit's `signTransaction` through `useStellarWallet` (currently only
  `connect`/`disconnect`/`address`/`isConnected` are exposed).
- `useBlendDeposit` / `useBlendWithdraw` write hooks mirroring the EVM
  `useDepositManager`/`useWithdrawalQueue` conventions (localStorage mock layer +
  `{ write, data, isPending, isSuccess, error, reset }` shape).
- A `useBlendPosition` read hook that loads the connected account's supplied
  position for a given reserve via `PoolV2.load(...).loadUser(...)` (TanStack
  Query, mock fast-path).
- New Stellar chain constants in `stellar/chain.ts` for the Soroban RPC URL and
  the Blend contract IDs; a Blend `Network` object the SDK consumes.
- New `STELLAR_MOCK_KEYS` for the Blend hooks (deposit/withdraw write results +
  position).
- Extend the ESLint boundary so `@blend-capital/blend-sdk` is importable **only**
  from `src/wallet/stellar/**` (and `src/lib/env.ts` if needed), matching the
  existing kit / stellar-sdk boundary.
- Barrel exports (`src/wallet/index.ts`) for the new hooks + result types.
- Unit tests with mocked Soroban RPC, mocked blend-sdk, and mocked kit signing.
- Doc updates: wallet `README.md` (Stellar namespace + new mock keys + boundary),
  `docs/frontend/hooks.md` (new hook rows).

**Out of scope** (per issue body):

- Real product deposit/stake/withdrawal flows (PLUSD/USDC) — this validates the
  Soroban signing path only, not the production flow.
- Any backend/indexer awareness.
- Mainnet.
- New UI surfaces / routes / dropdown wiring. This issue ships the hooks +
  signing plumbing; whether a dev/QA-only UI affordance is needed to exercise the
  acceptance criterion is an Open Question (see below). The acceptance criterion
  ("deposit XLM … see the position reflected; withdraw it back") is exercisable
  via the hooks from a temporary harness or a minimal dev affordance, not a
  production screen.
- Borrow/repay (`RequestType.Borrow`/`Repay`), backstop, emissions, oracle-priced
  USD estimates (`PositionsEstimate`). Only supply/withdraw of a single reserve.

## Assumptions and Risks

- **V2 pool/contract classes, not V1.** The issue body's snippet says
  `new PoolContract(POOL_ID)` and `PoolV2.load(...)`, but the verified docs show
  the V2 surface is `PoolContractV2` (for `.submit(...)`) and `PoolV2` (for
  `.load(...)`/`.loadUser(...)`). The default pool ID
  `CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF` is Blend's
  "TestnetV2" pool. The plan uses `PoolContractV2` + `PoolV2`. The coder must
  confirm the exact exported names against the installed `@blend-capital/blend-sdk`
  version (`PoolContract`/`PoolContractV2` vs a versioned alias) at implementation
  time and use whichever the installed package exports for a V2 pool.
- **`submit()` returns a base64 XDR operation string**, not an `Operation`. It
  must be wrapped: `xdr.Operation.fromXDR(opXdr, "base64")`, added to a
  `TransactionBuilder` (built against a freshly fetched source `Account` from the
  Soroban RPC), then simulated/assembled. Confirmed against the SDK docs.
- **`RequestType` enum values:** `SupplyCollateral = 2` (deposit),
  `WithdrawCollateral = 3` (withdraw). Confirmed. (`Supply = 0`/`Withdraw = 1` are
  the non-collateral variants; the issue specifies the *Collateral* variants.) The
  coder must import the enum from blend-sdk rather than hard-coding integers.
- **Soroban RPC vs Horizon.** Blend calls go through the Soroban RPC
  (`STELLAR_RPC_URL`, default `https://soroban-testnet.stellar.org`) via
  `@stellar/stellar-sdk`'s `rpc.Server` (the `rpc` / `SorobanRpc` namespace in
  v15.1.0). The existing balance hook uses `Horizon.Server` — these are different
  servers. Confirm the exact namespace export (`rpc.Server` vs `SorobanRpc.Server`)
  in the installed `@stellar/stellar-sdk@15.1.0` at implementation time.
- **Soroban transaction lifecycle** (the load-bearing flow, all inside
  `blendPool.ts`):
  1. `const server = new rpc.Server(STELLAR_RPC_URL);`
  2. `const source = await server.getAccount(userAddress);` (sequence number).
  3. Build a `TransactionBuilder(source, { fee, networkPassphrase }).addOperation(op).setTimeout(...).build()`.
  4. `const sim = await server.simulateTransaction(tx);` → on error, surface it.
  5. `const assembled = rpc.assembleTransaction(tx, sim).build();` (attaches the
     Soroban resource footprint + auth from simulation).
  6. `const { signedTxXdr } = await StellarWalletsKit.signTransaction(assembled.toXDR(), { networkPassphrase, address });`
  7. Rebuild a `Transaction` from `signedTxXdr` (`TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase)`)
     and `await server.sendTransaction(...)`.
  8. Poll `await server.getTransaction(hash)` until status is `SUCCESS` / `FAILED`
     (or a `pollTransaction` helper if the installed SDK exposes one).
  The coder must verify the exact `assembleTransaction` / `pollTransaction` API
  shape against `@stellar/stellar-sdk@15.1.0` (these moved between SDK majors).
- **Soroban contracts require auth signing, not just envelope signing.** A
  `submit` call that moves the user's tokens needs the invoker's authorization.
  The standard path is: simulate → `assembleTransaction` (which embeds the
  required `SorobanAuthorizationEntry` for the source account) → sign the whole
  envelope with the wallet (the wallet covers source auth for the connected
  address). For a single-address call where `from`/`spender`/`to` are all the
  connected wallet, envelope signing after assembly is sufficient (no separate
  `signAuthEntry` round-trip). If simulation reveals auth entries that require
  `signAuthEntry`, that is a deeper integration — flagged as a risk; the XLM
  single-address supply/withdraw case (the chosen acceptance asset) should not hit
  it.
- **Decimals.** Stellar reserves use 7 decimals. `submit` `amount` is a `bigint`
  fixed-point with the asset's decimals (e.g. 1 XLM = `10_000_000n`). The hooks
  accept a `bigint` raw amount (mirroring EVM `write(amount: bigint)`); any
  human→raw scaling is the caller's responsibility, consistent with the EVM hooks.
- **Test asset = XLM (acceptance default).** Per the issue, XLM is the easiest
  acceptance asset: fund the account from Friendbot (free) and supply the XLM
  reserve (`STELLAR_BLEND_XLM_ID`) — no token faucet. Blend's USDC is a *Soroban
  token* (`CAQC…`), distinct from the classic USDC the existing balance pill reads
  via Horizon, and requires Blend's faucet. The hooks are asset-agnostic (the
  reserve `address` is a parameter); the acceptance run uses XLM.
- **Position read does not need oracle/USD.** The acceptance criterion is "see the
  position reflected", i.e. the supplied collateral amount for the chosen reserve.
  `poolUser.positions` exposes raw per-reserve collateral/supply/liability maps;
  the plan reads the collateral entry for the target reserve and returns the raw
  `bigint` (+ a 7-decimal-scaled display string). `PositionsEstimate` (USD,
  APY, borrow limit) is out of scope — avoids needing the oracle.
- **`useStellarWallet` signing surface.** The hook currently returns
  `{ address, isConnected, connect, disconnect }`. The plan adds a
  `signTransaction(xdr, opts?)` method that delegates to
  `StellarWalletsKit.signTransaction` (re-exported via `stellar/config.ts`,
  respecting the boundary). Mock path: when `pipeline.mock.wallet.stellar.address`
  is set, `signTransaction` should reject (or no-op) clearly — signing a real
  Soroban tx is not mockable at the kit layer; the *hooks* mock at their own
  result-level keys instead. This keeps the kit boundary intact.
- **blend-sdk pulls `@stellar/stellar-sdk` transitively.** It is already a direct
  dependency (`15.1.0`); confirm blend-sdk's peer/declared range is satisfied by
  `15.1.0`, otherwise the coder must reconcile versions (and re-check the boundary
  still passes). Note in tech-debt if a version bump is forced.
- **Testnet resets.** Stellar testnet is periodically reset; the env defaults note
  this. If acceptance calls fail with "contract not found", re-pull current IDs
  from `blend-capital/blend-utils` → `testnet.contracts.json`. This is an
  operational caveat, not a code change.
- **No Figma reference.** This is plumbing/hooks; the issue references no Figma
  link, so no Figma-driven verification step applies.

## Open Questions

- **How is the acceptance criterion exercised end-to-end?** The criterion
  ("deposit XLM into the Blend pool and see the position reflected; withdraw it
  back; confirmed on stellar.expert") implies a way to *trigger* the hooks against
  a live wallet. The hooks themselves are headless. Options: (a) ship hooks only
  and verify via a throwaway test harness / story, (b) add a dev-only QA affordance
  (e.g. a hidden panel behind a flag) to invoke deposit/withdraw, or (c) defer the
  live-testnet acceptance run to manual QA with a scripted harness. Which does the
  team want for this issue's "Done"? (Scope says no production UI; this asks what
  the *minimum* trigger surface is.)
- **Is a live-testnet round-trip required to close this issue, or is mocked
  unit-test coverage + a documented manual procedure sufficient?** A real
  round-trip depends on a funded testnet account + current (non-reset) contract
  IDs and is not reproducible in CI. Confirm whether the manager expects the live
  confirmation as a gating check or as a documented manual step.

## Implementation Steps

1. **Dependency.** Add `@blend-capital/blend-sdk` to `packages/frontend/package.json`
   (`yarn workspace @pipeline/frontend add @blend-capital/blend-sdk`). Verify it
   resolves against the existing `@stellar/stellar-sdk@15.1.0`; if it forces a
   different stellar-sdk version, reconcile and note in
   `docs/exec-plans/tech-debt-tracker.md`.

2. **ESLint boundary — `packages/frontend/eslint.config.js`.** In the block that
   restricts `@creit.tech/stellar-wallets-kit` / `@stellar/stellar-sdk` to
   `src/wallet/stellar/**` + `src/lib/env.ts` (currently lines ~70–90), add
   `"@blend-capital/blend-sdk"` and `"@blend-capital/blend-sdk/*"` to the
   `patterns` array so blend-sdk is confined to the same boundary.

3. **`src/wallet/stellar/chain.ts`** — add Soroban/Blend constants from `ENV`:
   - `export const sorobanRpcUrl: string = ENV.STELLAR_RPC_URL;`
   - `export const blendPoolId: string = ENV.STELLAR_BLEND_POOL_ID;`
   - `export const blendUsdcId: string = ENV.STELLAR_BLEND_USDC_ID;`
   - `export const blendXlmId: string = ENV.STELLAR_BLEND_XLM_ID;`
   - `export const blendNetwork = { rpc: ENV.STELLAR_RPC_URL, passphrase: networkPassphrase }`
     (the blend-sdk `Network` object; `passphrase` reuses the existing
     `networkPassphrase`). Confirm whether `opts: { allowHttp: ... }` is needed for
     the public testnet RPC (it is HTTPS, so no).

4. **`src/wallet/stellar/blendPool.ts`** — new internal helper module (the only
   place that imports `@blend-capital/blend-sdk` and `@stellar/stellar-sdk`'s
   `rpc` namespace). Exports:
   - `buildSubmitOpXdr({ poolId, from, reserveId, amount, requestType }): string`
     — `new PoolContractV2(poolId).submit({ from, spender: from, to: from,
     requests: [{ address: reserveId, amount, request_type: requestType }] })`.
   - `RequestType` re-export (or a thin `BlendRequest = { Supply: RequestType.SupplyCollateral, Withdraw: RequestType.WithdrawCollateral }` map) so callers don't hard-code integers.
   - `submitBlendTx({ opXdr, sourceAddress, sign }): Promise<{ hash: string }>` —
     runs the full lifecycle (Assumptions step 1–8): build `rpc.Server`, fetch
     `getAccount`, build tx, `simulateTransaction`, `assembleTransaction`, call the
     injected `sign(xdr, opts) => Promise<{ signedTxXdr }>` (so the hook injects
     `useStellarWallet().signTransaction`, keeping the kit out of this module's
     direct surface where practical — or import the re-exported kit from `./config`
     if cleaner), rebuild from signed XDR, `sendTransaction`, poll
     `getTransaction` to terminal status; throw on `FAILED`/simulation error with a
     readable message.
   - `loadBlendCollateral({ network, poolId, userAddress, reserveId }): Promise<bigint>`
     — `await PoolV2.load(network, poolId)` then `.loadUser(userAddress)`, read the
     collateral position for `reserveId` from `poolUser.positions`, return raw
     `bigint` (0 when no position / unfunded). Confirm the exact field path on
     `positions` (e.g. `positions.collateral` keyed by reserve index/id) against
     the installed SDK.
   - Full JSDoc header (mirror the other stellar modules) documenting the flow,
     the Soroban-vs-Horizon distinction, and the 7-decimal amount convention.

5. **`src/wallet/stellar/useStellarWallet.ts`** — extend `StellarWalletState` with
   `signTransaction(xdr: string, opts?: { networkPassphrase?: string; address?: string }): Promise<{ signedTxXdr: string; signerAddress?: string }>`.
   Implement by delegating to `StellarWalletsKit.signTransaction` (imported from
   `./config`). Default `networkPassphrase` to `networkPassphrase` from `./chain`
   and `address` to the connected address. Mock path: if a mock address is set,
   reject with a clear error (`"[stellar mock] signTransaction is not mockable; use
   the Blend hook mock keys instead"`) — document it. Update the JSDoc and the
   `StellarWalletState` interface comment.

6. **`src/wallet/stellar/mock.ts`** — add `STELLAR_MOCK_KEYS` entries:
   - `blendDeposit: "pipeline.mock.wallet.stellar.blend.deposit"` (JSON `{ hash }`),
   - `blendWithdraw: "pipeline.mock.wallet.stellar.blend.withdraw"` (JSON `{ hash }`),
   - `blendPosition: "pipeline.mock.wallet.stellar.blend.position"` (raw bigint
     string, the supplied collateral for the target reserve).
   Reuse `parseJson` / `parseBigInt` / `readMock` / `useMock` from `../evm/mock`.

7. **`src/wallet/stellar/useBlendDeposit.ts` / `useBlendWithdraw.ts`** — write
   hooks mirroring `evm/useDepositManager.ts` (`useRequestDeposit`) conventions:
   - Return `{ write(amount: bigint, reserveId?: string), data: { hash } | undefined,
     isPending, isSuccess, error, reset }`. Default `reserveId` to `blendXlmId`
     (acceptance asset) when omitted; allow override for USDC.
   - Mock fast-path: when the corresponding mock key is set, `write` settles
     `{ hash }` in the next microtask (`isPending` → `isSuccess`) with **no** RPC /
     signing, exactly like the EVM write-hook mock pattern (check via `readMock`
     inside `write`, not reactively, to avoid the `getSnapshot` warning).
   - Real path: read `{ address, isConnected, signTransaction }` from
     `useStellarWallet()`; build the op via `buildSubmitOpXdr` with
     `requestType = SupplyCollateral` (deposit) / `WithdrawCollateral` (withdraw);
     call `submitBlendTx`; set `isPending` across the async lifecycle; set
     `isSuccess` on terminal `SUCCESS`; surface errors. Guard re-entrant calls with
     an in-flight flag (mirror `isEstimating`).
   - Disconnected / not configured: `write` sets a clear `error`
     (`"Stellar wallet not connected"`).
   - These two hooks are near-identical; factor the shared body into a private
     `useBlendSubmit(requestType)` to avoid duplication, exporting the two named
     hooks as thin wrappers.

8. **`src/wallet/stellar/useBlendPosition.ts`** — read hook mirroring
   `useStellarToken` (TanStack Query + mock fast-path):
   - `useBlendPosition(reserveId?: string)` → `{ position: bigint | undefined,
     formattedPosition: string | undefined, refetch, isLoading, error }`.
   - Mock fast-path on `STELLAR_MOCK_KEYS.blendPosition`.
   - `queryFn`: `loadBlendCollateral({ network: blendNetwork, poolId: blendPoolId,
     userAddress: address, reserveId: reserveId ?? blendXlmId })`.
   - `enabled`: mock absent && `isConnected` && `address`.
   - Query key includes `address`, `poolId`, `reserveId`, `sorobanRpcUrl`.
   - `formattedPosition`: scale the raw `bigint` by 1e7 to a decimal display
     string (Stellar 7 decimals).

9. **Barrel — `src/wallet/index.ts`** — add to the Stellar namespace section:
   `useBlendDeposit`, `useBlendWithdraw`, `useBlendPosition` and their result
   types. Do **not** re-export raw blend-sdk / stellar-sdk types through the barrel.

10. **Tests** (see Test Strategy) — `blendPool.test.ts`, `useBlendDeposit.test.tsx`,
    `useBlendWithdraw.test.tsx`, `useBlendPosition.test.tsx`, and extend
    `useStellarWallet.test.tsx` for the new `signTransaction` method.

11. **Docs** — `src/wallet/README.md` (Stellar namespace: new hooks API, new mock
    keys, blend-sdk added to the boundary) and `docs/frontend/hooks.md` (rows for
    `useBlendDeposit`, `useBlendWithdraw`, `useBlendPosition`; update the
    `useStellarWallet` row to mention `signTransaction`).

12. **Full gate before hand-back:**
    `yarn workspace @pipeline/frontend lint` (confirms the blend-sdk boundary),
    `yarn workspace @pipeline/frontend build`,
    `yarn workspace @pipeline/frontend test`, and
    `npx tsx scripts/lint-docs.ts` for the doc edits.

## Test Strategy

All tests mock the network — no live RPC in CI. Mirror existing stellar/evm test
setups (`useStellarToken.test.tsx` for the QueryClient wrapper + mock-key
assertions; `useDepositManager.test.tsx` for write-hook mock/real paths).

- **`blendPool.test.ts`** — unit-test the helper with `@blend-capital/blend-sdk`
  and `@stellar/stellar-sdk`'s `rpc` namespace `vi.mock`ed:
  - `buildSubmitOpXdr` passes the right `request_type` (2 for deposit, 3 for
    withdraw), `address`, `amount`, and `from === spender === to`.
  - `submitBlendTx` happy path: simulate ok → assemble → sign (injected spy) →
    send → poll resolves `SUCCESS` → returns `{ hash }`. Assert the call order and
    that the signed XDR (not the unsigned) is sent.
  - Simulation error → throws with a readable message; sign never called.
  - `getTransaction` resolves `FAILED` → throws; `NOT_FOUND` then `SUCCESS` on a
    later poll → resolves (poll loop works).
  - `loadBlendCollateral`: with a position → returns the reserve's raw bigint;
    no position / unfunded → returns `0n`.
- **`useBlendDeposit.test.tsx` / `useBlendWithdraw.test.tsx`** (mock
  `./useStellarWallet` for `{ address, isConnected, signTransaction }` and
  `./blendPool` for `submitBlendTx`):
  - Mock key set → `write` returns `{ hash }`, `isPending`→`isSuccess`, and
    `submitBlendTx` is **never** called (zero-call assertion, the mock lock-in
    guard).
  - Disconnected → `write` sets the "not connected" error, no submit call.
  - Real path → `write` calls `submitBlendTx` with the correct `requestType`,
    transitions `isPending`→`isSuccess` on resolve, surfaces thrown errors via
    `error`; `reset` clears state.
  - Deposit uses `SupplyCollateral`, withdraw uses `WithdrawCollateral`; default
    `reserveId` is the XLM reserve, overridable.
- **`useBlendPosition.test.tsx`** (mock `./blendPool.loadBlendCollateral`,
  `./useStellarWallet`; wrap in a real `QueryClientProvider` per the
  `useStellarToken`/`useNetworkFeeEstimate` precedent):
  - With position → `position` bigint + `formattedPosition` 7-decimal string.
  - No position / unfunded → `position === 0n`, `formattedPosition` shows `0`.
  - Mock key → returns mock value, `loadBlendCollateral` never called.
  - Disconnected → `position` undefined, query disabled.
  - Error → surfaces via `error`.
- **`useStellarWallet.test.tsx`** — add cases: real path delegates to
  `StellarWalletsKit.signTransaction` with the right `networkPassphrase`/`address`
  and returns `{ signedTxXdr, signerAddress }`; mock-address path rejects with the
  documented error.
- **Boundary check** is covered by `yarn lint` (the blend-sdk import must stay
  inside `src/wallet/stellar/**`).
- **Manual / live acceptance** (gated by the Open Question on whether it's required
  to close): with a funded testnet account (Friendbot) and current contract IDs,
  drive `useBlendDeposit` (XLM), confirm via `useBlendPosition` and stellar.expert,
  then `useBlendWithdraw`. Document the procedure in the wallet README either way.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — Stellar namespace section: document
  `useBlendDeposit` / `useBlendWithdraw` / `useBlendPosition` (API + the
  Soroban-RPC-vs-Horizon distinction + 7-decimal amounts), the new
  `pipeline.mock.wallet.stellar.blend.*` mock keys, and add `@blend-capital/blend-sdk`
  to the documented Stellar ESLint boundary. Note the XLM/Friendbot acceptance
  procedure.
- `docs/frontend/hooks.md` — add rows for `useBlendDeposit`, `useBlendWithdraw`,
  `useBlendPosition`; update the `useStellarWallet` row to mention the new
  `signTransaction` action.
- `docs/exec-plans/tech-debt-tracker.md` — only if the blend-sdk install forces a
  `@stellar/stellar-sdk` version change or if a `signAuthEntry` path turns out to
  be required (deeper auth integration deferred).
- No product-spec change required: this is an internal testnet integration to
  validate the Soroban signing path, with no user-facing production flow (scope
  explicitly excludes the real product flow). Epic #444 already captures the
  multi-chain product intent.
