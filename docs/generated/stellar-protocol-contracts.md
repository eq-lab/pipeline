# Stellar Protocol Contracts — Generated Reference

Source: testnet WASM, originally fetched 2026-06-10 via
`stellar contract info interface --id <C...> --network testnet`.

`deposit_manager` and `withdrawal_queue` addresses updated 2026-06-16 after a
testnet redeployment, to match the live backend config in the ArgoCD repo
(`pipeline/test.yaml`, chain `99000001`). The WASM interface below is unchanged.

WARNING: Stellar testnet is periodically reset. If contract calls fail with
"contract not found", the contracts must be re-deployed. The ABI/interface
below remains valid for the same WASM version. Update the addresses in
`.env` and `.env.example` after re-deployment.

---

## Verified Testnet Addresses

| Contract          | Soroban Contract ID (C…)                             |
| ----------------- | ---------------------------------------------------- |
| `deposit_manager` | `CARFA2QETOZVKHSG4BCEEXMJHTYR2Z75VR7WQNX4MWZ33RQMKRKATIVI` |
| `withdrawal_queue`| `CC3TWGFXP2XUZJXGLVTM2G4K2PF2YTC6BKDRPZIUPSVETNYAO57GU3Q7` |
| USDC SAC          | `CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7` |
| PLUSD SAC         | `CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN` |

The USDC and PLUSD contract IDs above are NOT in env — they are derived at
runtime by calling `asset()` / `share()` on `deposit_manager`.

**Live app-config vs. indexer-default discrepancy (see #800):** the addresses
above are the indexer defaults captured on 2026-06-10/06-16. The frontend's
LIVE `.env` / `.env.example` config points at a *different*, more recently
deployed pair — `VITE_STELLAR_DEPOSIT_MANAGER_ID = CBN4P3NYJQKMRQ5EKMYLY26TBOJRT2CRW4SUTHZFQ2HAK3KXHDIZTLCX`
and `VITE_STELLAR_WITHDRAWAL_QUEUE_ID = CCWP3P4CJRKHFL5ADFI4QFFUKSLKABRBBVJ6VS52VOGY2RMYZ6FT56K6`.
The 4-arg `digest` / 3-arg `claim_request` interface below reflects the LIVE
contract (verified via Soroban RPC introspection against `CBN4P3NY…`), which
is the one the app actually calls. Two DepositManager contracts have
coexisted on testnet with *different* `digest` arities — always verify
against the address in `.env`, not just this table, before trusting the
interface shape.

---

## SAC Facts

Both USDC and PLUSD are Stellar Asset Contracts (SEP-41 standard interface):

- **Decimals**: **7** (Stellar SAC standard — not EVM USDC's 6).
  `1 USDC = 10_000_000` raw units.
- **Protocol issuer**: `GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU`.
  This is distinct from the Circle testnet USDC issuer (`GBBD47…`) used by
  the existing Blend integration (`VITE_STELLAR_USDC_ISSUER`).
- **Trustline requirement**: accounts must have an established trustline before
  receiving either asset. Detected via Horizon `loadAccount().balances` scan
  matching BOTH `asset_code` and `asset_issuer`.

---

## `deposit_manager` Interface Subset

Contract: `CARFA2QETOZVKHSG4BCEEXMJHTYR2Z75VR7WQNX4MWZ33RQMKRKATIVI`

```
struct Request { amount: i128, claimed: bool, timestamp: u64, user: Address }

// Read views (no auth required)
fn asset() -> Address;                       // USDC SAC contract ID
fn share() -> Address;                       // PLUSD SAC contract ID
fn paused() -> bool;
fn verifier() -> BytesN<32>;
fn get_request(request_id: u128) -> Request;
fn digest(request_id: u128, sender: Address, amount: i128, deadline: u64) -> BytesN<32>;
fn domain_separator() -> BytesN<32>;

// Write operations (require sender auth)
fn request_deposit(sender: Address, amount: i128) -> u128;
fn claim_request(request_id: u128, verifier_signature: BytesN<64>, deadline: u64) -> i128;
fn pause(caller: Address);
fn unpause(caller: Address);
fn upgrade(new_wasm_hash: BytesN<32>, caller: Address);
```

---

## `withdrawal_queue` Interface Subset

Contract: `CC3TWGFXP2XUZJXGLVTM2G4K2PF2YTC6BKDRPZIUPSVETNYAO57GU3Q7`

```
struct Request { amount: i128, claimed: bool, timestamp: u64, user: Address }

// Read views (no auth required)
fn asset() -> Address;                       // PLUSD SAC contract ID (asset to withdraw)
fn share() -> Address;                       // share token contract ID
fn paused() -> bool;
fn verifier() -> BytesN<32>;
fn get_request(request_id: u128) -> Request;
fn digest(request_id: u128, sender: Address, amount: i128, deadline: u64) -> BytesN<32>;
fn domain_separator() -> BytesN<32>;

// Write operations (require sender auth)
fn request_withdrawal(sender: Address, amount: i128) -> u128;
fn claim_request(request_id: u128, verifier_signature: BytesN<64>, deadline: u64) -> i128;
fn pause(caller: Address);
fn unpause(caller: Address);
fn upgrade(new_wasm_hash: BytesN<32>, caller: Address);
```

---

## On-Chain Verification Snapshot (2026-06-10)

Verified against testnet by calling read views:

| Check                                              | Result   |
| -------------------------------------------------- | -------- |
| `deposit_manager.asset()` == USDC SAC              | PASS     |
| `deposit_manager.share()` == PLUSD SAC             | PASS     |
| `deposit_manager.paused()`                         | `false`  |
| `deposit_manager.verifier()` returns 32-byte key   | PASS     |
| `withdrawal_queue.asset()` returns PLUSD SAC       | PASS     |
| `withdrawal_queue.paused()`                        | `false`  |
| USDC SAC `decimals()` = 7                          | PASS     |
| PLUSD SAC `decimals()` = 7                         | PASS     |
| USDC SAC `asset()` = `"USDC:GC5SUAXM…"`            | PASS     |
| PLUSD SAC `asset()` = `"PLUSD:GC5SUAXM…"`          | PASS     |

---

## Frontend Integration

- **Env vars**: `VITE_STELLAR_DEPOSIT_MANAGER_ID`, `VITE_STELLAR_WITHDRAWAL_QUEUE_ID`
  (empty default → hooks short-circuit).
- **Chain constants**: `depositManagerId`, `withdrawalQueueId` in
  `packages/frontend/src/wallet/stellar/chain.ts`.
- **Typed clients**: `DepositManagerClient`, `WithdrawalQueueClient` in
  `packages/frontend/src/wallet/stellar/contracts/`.
- **Address derivation**: `useStellarDepositManagerAddresses` in
  `packages/frontend/src/wallet/stellar/useStellarDepositManagerAddresses.ts`.
- **SAC token balance**: `useStellarSacToken` in
  `packages/frontend/src/wallet/stellar/useStellarSacToken.ts`.
