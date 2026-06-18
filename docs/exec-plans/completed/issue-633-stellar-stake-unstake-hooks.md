# Issue #633: [FE] [Stellar] Stake/unstake flow: deposit → redeem vault hooks

Source: https://github.com/eq-lab/pipeline/issues/633

## Scope

Add the Stellar/Soroban counterpart of the EVM `useStakedPlusd.ts` hooks — wallet-layer hooks that drive a real PLUSD ⇄ sPLUSD stake/unstake against the `staked_pipeline_usd` `FungibleVault` Soroban contract on testnet (`CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5`, env `CHAIN_..._STELLAR_STAKED_PLUSD_ID`).

In scope (all under `packages/frontend/src/wallet/stellar/`):

- A typed `FungibleVault` Soroban client `contracts/stakedPlusd.ts` (mirror `contracts/withdrawalQueue.ts` / `contracts/depositManager.ts`): read views (`asset`, `share`/share-contract, `paused`, `convert_to_assets`, `convert_to_shares`, `balance`, `total_supply`, `total_assets`) via simulation, plus unsigned write builders for `deposit` and `redeem` (and `withdraw` if exposed).
- Hooks file `useStellarStakedPlusd.ts` exposing: `useStellarStakedPlusdAsset` (underlying PLUSD), share-price / conversion reads (`useStellarStakeConvertToShares`, `useStellarUnstakeConvertToAssets` or a single share-price read mirroring the EVM convert hooks), `useStellarStakedPlusdBalance` (LP's sPLUSD share balance), `useStellarStake` (deposit), `useStellarUnstake` (redeem), and trustline guards `needsTrustline` + a `changeTrust` action for **sPLUSD** (and reuse of the existing **PLUSD** trustline guard for unstake delivery).
- Env + chain wiring: add `STELLAR_STAKED_PLUSD_ID` to `src/lib/env.ts` (`VITE_STELLAR_STAKED_PLUSD_ID`, default `""`) and export `stakedPlusdId` from `src/wallet/stellar/chain.ts`; update `.env.example` (uncomment the Stellar staked-plusd id and add the `VITE_` line).
- Mock-layer keys + reader helpers in `src/wallet/stellar/mock.ts` for stake/unstake/changeTrust(sPLUSD) and the conversion/balance reads, following the existing per-hook mock convention.
- Hook-level Vitest tests (`useStellarStakedPlusd.test.tsx`) + a contract-client test (`contracts/stakedPlusd.test.ts`) mirroring the deposit/withdrawal test files.
- A user-stories doc `docs/user-stories/epic-531/633-stellar-stake-unstake-hooks.md`, linked from `docs/user-stories/index.md`.
- Update `packages/frontend/src/wallet/README.md` with the new Stellar hooks (the EVM `useStakedPlusd` section already exists there; add the Stellar mirror + mock keys).

Out of scope:

- UI wiring of the stake/unstake page (separate sub-issue of #531).
- Any relayer/voucher/`claim_request` step — staking is a pure on-chain interaction (per `docs/product-specs/staking.md`); stake and unstake are each a single signed Soroban invocation.
- EVM `useStakedPlusd.ts` (already merged).

## Assumptions and Risks

- **Builds on merged foundation.** #549 (addresses config, typed Soroban clients, SAC token layer) and #604 (trustline plumbing) are merged on `main`; reuse `WithdrawalQueueClient`'s simulate/build pattern, `useStellarSacToken` (7-decimal SAC, `hasTrustline`), and the `useChangeTrust`/`useStellarChangeTrustUsdc` classic-`changeTrust` pattern. Confirmed present in the working tree.
- **7 decimals, not 18.** Amounts are `i128` at SAC 7-decimal scale. Get decimals from the vault/asset (or use `SAC_DECIMALS`), never hardcode 18. The EVM convert hooks use a 1e18 RATE_SCALE mock convention — the Stellar mock convention must use the SAC scale (1e7) to avoid the off-by-powers-of-ten class of bug (cf. #541).
- **No approve step.** `deposit(assets, receiver)` pulls PLUSD from the sender via Soroban auth inside the same invocation — a single `signTransaction`. Plan must verify simulation yields a single signable auth entry (acceptance criterion).
- **sPLUSD trustline required on stake.** Staking mints sPLUSD shares to the receiver; without an sPLUSD trustline the deposit fails. The share asset's classic `CODE:ISSUER` is derived the same way the deposit-manager addresses hook derives PLUSD/USDC: read the vault's share-token SAC contract, then its `name()` → `"CODE:ISSUER"`, then drive `useStellarSacToken` + a `changeTrust` op for that asset.
- **PLUSD trustline required on unstake delivery.** Reuse the existing PLUSD trustline state (the deposit/withdraw work already surfaces it) to guard `redeem`.
- **Testnet volatility.** Stellar testnet is periodically reset; the checked-in contract ID may go stale ("contract not found"). Hook-level tests use mocked RPC, so they are unaffected; the live acceptance check needs a re-pulled id + funded PLUSD account.
- **Stale-address risk in the client.** Follow the `withdrawalQueue.ts` header convention: record the contract id, the interface-capture date, and the testnet-reset warning in the client file header.

## Open Questions

- The exact `FungibleVault` (`staked_pipeline_usd`) Soroban interface is not checked into the frontend repo. The issue body gives strong hints (`deposit(assets, receiver)`, `redeem(shares, receiver, owner)`, optional `withdraw(assets, receiver, owner)`, `convert_to_assets`, `convert_to_shares`, `balance(account)`, `total_supply`, `total_assets`) but the **canonical method names and the share-contract accessor** (e.g. `share()` vs `query_share_address`/`query_token_address`, and whether share balance is read off the vault or off the share SAC) must be confirmed by extracting the WASM interface (`stellar contract info interface --id CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5 --network testnet`) before finalizing the client. If testnet is mid-reset, re-pull the id first. The coder must reconcile the client against the live interface rather than assume the EVM ERC-4626 names map 1:1.

## Implementation Steps

1. **Extract the live `FungibleVault` interface.** Run `stellar contract info interface --id CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5 --network testnet`. If "contract not found", re-pull/redeploy the testnet id (see `.env.example`) and update accordingly. Record the captured interface + date in the client header. Resolve the Open Question against this output.
2. **Env + chain wiring.** Add `STELLAR_STAKED_PLUSD_ID: readString("VITE_STELLAR_STAKED_PLUSD_ID", "")` to `packages/frontend/src/lib/env.ts` (next to `STELLAR_WITHDRAWAL_QUEUE_ID`). Export `stakedPlusdId: string = ENV.STELLAR_STAKED_PLUSD_ID` from `src/wallet/stellar/chain.ts` with the empty-string-means-unconfigured convention. Uncomment the `CHAIN_..._STELLAR_STAKED_PLUSD_ID` line in `.env.example` and add the matching `VITE_STELLAR_STAKED_PLUSD_ID=` line.
3. **Typed client `contracts/stakedPlusd.ts`.** Mirror `WithdrawalQueueClient`: constructor guards empty id; `simulateReadCall` helper using `READ_SIMULATION_SOURCE`. Read views: `asset()`, share-contract accessor, `paused()`, `convertToAssets(shares)`, `convertToShares(assets)`, `balance(account)` (LP share balance), `totalSupply()`/`totalAssets()` as needed for the conversion card. `i128` args via `nativeToScVal(x, { type: "i128" })`; `convert` inputs are unit-scaled (`10n ** BigInt(decimals)`). Write builders `buildDeposit(sender, assets, receiver, sourceAccount)` and `buildRedeem(sender, shares, receiver, owner, sourceAccount)` (+ `buildWithdraw` if the interface exposes it) returning assembled unsigned XDR via `SorobanRpc.assembleTransaction`. Module-level `createStakedPlusdClient(contractId)` returning `null` on empty id.
4. **Hooks `useStellarStakedPlusd.ts`.** Mirror `useStellarWithdrawalQueue.ts` state shape `{ write, data, isPending, isSuccess, error, reset }` for the two write hooks (`useStellarStake(amountRaw)`, `useStellarUnstake(sharesRaw)`), each: mock fast-path → unconfigured guard → disconnected guard → re-entrant guard → build/sign/submit/poll. Read hooks via `useQuery` (mirror `useStellarWithdrawalRequest` + the EVM convert hooks): asset, share-price/convert, LP share balance, paused. Conversion read mock convention uses SAC scale (1e7), documented inline.
5. **sPLUSD trustline guard.** Add `useStellarChangeTrustStakedPlusd()` mirroring `useStellarChangeTrustUsdc`: derive the share asset `{ code, issuer }` from the vault's share SAC `name()` (extend the addresses hook or add a small read), drive `useStellarSacToken` for `hasTrustline`, expose `needsTrustline` + `submit()` building a classic `changeTrust` op submitted via Horizon. Reuse the existing PLUSD trustline state for the unstake-delivery guard (do not duplicate it).
6. **Mock keys + readers.** In `src/wallet/stellar/mock.ts` add keys under a "StakedPlusd mock keys" section: `stakedPlusd.stake` (`{ hash, shares? }`), `stakedPlusd.unstake` (`{ hash, assets? }`), `stakedPlusd.changeTrust` (`{ hash }`, or reuse shared `changeTrust`), `stakedPlusd.convertToShares` / `convertToAssets` (SAC-scaled rate), `stakedPlusd.shareBalance`. Add non-reactive reader helpers mirroring the withdrawal-queue readers.
7. **Docs.** Add the Stellar hooks + mock keys to `packages/frontend/src/wallet/README.md`. Create `docs/user-stories/epic-531/633-stellar-stake-unstake-hooks.md` (personas/steps/expected for stake, unstake, missing sPLUSD trustline, missing PLUSD trustline on unstake, paused vault, declined signature, exchange-rate read). Link it from `docs/user-stories/index.md`.

## Test Strategy

- **Contract-client test** `contracts/stakedPlusd.test.ts` (mirror `depositManager.test.ts`): mock `SorobanRpc.Server`; assert read views decode correctly, `i128`/scale encoding is right, and write builders produce assembled XDR; assert simulation-error paths throw.
- **Hook tests** `useStellarStakedPlusd.test.tsx` with mocked RPC + wallet, covering exactly the issue's six scenarios: happy-path stake (sPLUSD balance increase path / success state + single auth entry assertion where feasible), happy-path unstake, missing sPLUSD trustline (stake), missing PLUSD trustline (unstake), paused vault (simulation failure surfaced as error state), declined signature (`signTransaction` rejection surfaced as error state). Plus: mock fast-path for each write hook, unconfigured (empty id) guard, disconnected guard.
- **Conversion-scale guard:** explicit test that the share-price / convert reads use 1e7 scaling, not 1e18 — guards against the #541 off-by-powers-of-ten regression.
- Run `yarn` workspace lint/typecheck for the frontend and `npx tsx scripts/lint-docs.ts` (docs structure) before completion.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — add Stellar stake/unstake hooks + mock-key schema.
- `docs/user-stories/epic-531/633-stellar-stake-unstake-hooks.md` (new) + link in `docs/user-stories/index.md`.
- `.env.example` — `VITE_STELLAR_STAKED_PLUSD_ID` and the `CHAIN_..._STELLAR_STAKED_PLUSD_ID` line.
- `docs/product-specs/staking.md` — no change required (behavior unchanged; this is the Stellar wallet mirror of documented ERC-4626 behavior). Note the Soroban single-invocation (no approve) difference is already reflected in the spec's Overview.
