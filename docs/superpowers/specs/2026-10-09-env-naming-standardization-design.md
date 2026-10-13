# Per-chain environment variable naming standardization

Epic: #1431. Supersedes no prior spec; the naming grew organically across #439 (multi-chain),
#528 (Stellar indexer), #562 (Stellar relayer), #568 (Stellar price-poller) and #1435
(per-chain tuning), each adding a prefix shape without revisiting the others.

## Problem

Seven incompatible naming shapes coexist for per-chain configuration:

| Shape | Component | Example |
|---|---|---|
| `CHAIN_<id>_<KEY>` | indexer EVM, API EVM | `CHAIN_1_DM_CONTRACTS` |
| `CHAIN_<id>_STELLAR_<KEY>` | indexer Stellar | `CHAIN_X_STELLAR_DEPOSIT_MANAGER_ID` |
| `CHAIN_<id>_INDEXER_<KEY>` | indexer tuning, both arms | `CHAIN_X_INDEXER_POLLING_INTERVAL_MS` |
| `CHAIN_<id>_RELAYER_<KEY>` | relayer EVM | `CHAIN_1_RELAYER_SIGNER_KEY` |
| `CHAIN_<id>_RELAYER_STELLAR_<KEY>` | relayer Stellar | `CHAIN_X_RELAYER_STELLAR_PLUSD_SAC_ID` |
| `CHAIN_<id>_PRICE_POLLER_STELLAR_<KEY>` | price-poller Stellar | `CHAIN_X_PRICE_POLLER_STELLAR_INTERVAL_SECS` |
| `CHAIN_<id>_API_STELLAR_<KEY>` | API Stellar | `CHAIN_X_API_STELLAR_DM_CONTRACT_ID` |

Three axes — chain, component, network type — combine in a different order in each shape, and
EVM is expressed by the absence of a type rather than by a token. The vocabulary diverges too:
the same contract is `DM_CONTRACTS`, `DEPOSIT_MANAGER_ID`, `DM_CONTRACT_ID` and
`DEPOSIT_MANAGER_ADDRESS` depending on who reads it. `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID`
and `CHAIN_<id>_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID` disagree under one prefix.

Observed cost, all found while configuring one chain in one afternoon:

- `CHAIN_<id>_STELLAR_INDEXER_POLLING_BLOCK_RANGE` — the spelling the surrounding block teaches
  — is read by nothing and was silently ignored until #1435 added a warning for it.
- `.env.example` documented `CHAIN_<id>_START_LEDGER`, a name no code reads.
- Answering "what is the Stellar poll interval" requires knowing the resolution rules, because
  the answer lives in `JOB_INDEXER_POLLING_INTERVAL_MS`, whose name names no chain.

## Goal

An operator reading one line of a deployment manifest can tell which chain, which network kind
and which component it configures, without consulting the code. Stated priority: manifest
readability. Startup validation of unknown keys and per-job chain lists are explicitly out of
scope and tracked separately.

## Scope: indexer and chain-wide settings only

This issue renames the chain-wide variables and the indexer's own — 19 keys. The relayer,
price-poller and API keep their current names and migrate in follow-up issues, one per
component. The scheme below is defined for all four so the follow-ups have nothing left to
decide; only the indexer and chain-wide rows are implemented here.

The cost is a manifest that is mixed for a while: indexer lines in the new scheme, relayer and
API lines in the old one. That is accepted in exchange for a rollout small enough to verify by
eye.

Chain-wide keys cannot be renamed in isolation even so: the relayer and price-poller read them
as fallbacks (`CHAIN_<id>_RELAYER_STELLAR_RPC_URL` falls back to `CHAIN_<id>_STELLAR_RPC_URL`,
the EVM relayer to `CHAIN_<id>_ETH_RPC_URL`). Those fallback lookups are updated to the new
names here; the relayer's and price-poller's own variables are not touched.

## Scheme

```
CHAIN_<id>_TYPE                                  # the declaration; cannot carry its own answer
CHAIN_<id>_<TYPE>_<KEY>                          # chain-wide fact, no single owning component
CHAIN_<id>_<TYPE>_<COMPONENT>_<KEY>              # one component's setting
```

`<TYPE>` is `EVM` or `STELLAR`, never omitted. `<COMPONENT>` is `INDEXER`, `PRICE_POLLER`,
`RELAYER` or `API`. Chain-wide is reserved for values every component shares — the RPC URL, the
network passphrase, the cursor seed — where a component segment would be a lie.

Vocabulary: full words, no abbreviations — `DEPOSIT_MANAGER`, `WITHDRAWAL_QUEUE`,
`STAKED_PLUSD`, `LOAN_REGISTRY`, `MINTER`, `ACCESS_MANAGER`. This follows the majority already
in `test.yaml`, where the full spelling outnumbers the abbreviation 5:2, 7:2 and 5:1 for the
three contracts that have both.

A contract location is `_ADDRESS`, singular, on both networks. Lists of wallets that are
genuinely lists — `CUSTODY_ADDRESSES`, `RAMP_ADDRESSES` — stay plural.

`YIELD_MINTER` becomes `MINTER`. The contract was renamed to `PipelineMinter` in
`pipeline-contracts` and to `minter` in `pipeline-stellar-contracts` #33; the variable name is
the last place carrying the retired identity.

`START_LEDGER` becomes `START_BLOCK` on both arms. With the type in the prefix,
`CHAIN_X_STELLAR_START_BLOCK` is unambiguous, and the existing `START_LEDGER` → `START_BLOCK`
fallback disappears rather than being renamed.

## Consequence worth noting

The confirmation delay becomes `CHAIN_<id>_EVM_INDEXER_LOG_CONFIRMATIONS_DELAY`. Because the
type is in the name, the Stellar spelling cannot be written at all — the inert-key problem that
#1435 had to paper over with a startup warning stops being expressible. That warning is deleted
by this change.

The mirror risk: the type now appears in roughly forty keys that must all agree with
`CHAIN_<id>_TYPE`. Flipping the declaration silently orphans every key of the old type. A
startup check that rejects `CHAIN_<id>_<othertype>_*` keys is therefore part of this change, not
a follow-up — without it the standardization trades three silent-ignore traps for one bigger one.

## Behaviour changes

Two, both deliberate, both verified against every deployment first:

1. **EVM contract lists collapse to a single address.** `_CONTRACTS` was a CSV; `_ADDRESS` is
   one value. No `.env` or argocd manifest has ever set more than one address per role, so this
   removes an unused capability rather than a used one.
2. **`CHAIN_<id>_STELLAR_START_LEDGER` loses its `CHAIN_<id>_START_BLOCK` fallback**, which
   existed only to bridge the two spellings.

Everything else is a rename with identical semantics, defaults and validation.

## Migration: clean break

No dual-read, no deprecation window — decided up front. The code reads only new names. That
makes the rollout order load-bearing:

1. Add the renamed keys to Vault at `secrets/data/pipeline/{test,prod}/{api,worker}`, alongside
   the old ones. Both sets coexist harmlessly; nothing reads the new ones yet.
2. Merge the code change.
3. Update `argocd/pipeline/test.yaml` and `prod.yaml` in one commit each, and let ArgoCD sync.
4. Remove the old Vault keys.

Steps 2 and 3 must not be separated by a sync. A manifest synced against new code while still
carrying old names fails at startup on the first `env_require` — which is the intended loud
failure, but it is an outage if it happens in prod.

`.env.example` and every developer's local `.env` migrate with step 2. A rename script is part
of the deliverable so no one does forty substitutions by hand.

## Full mapping

### Chain-wide

| Old | New |
|---|---|
| `CHAIN_<id>_TYPE` | unchanged |
| `CHAIN_<id>_ETH_RPC_URL` | `CHAIN_<id>_EVM_RPC_URL` |
| `CHAIN_<id>_START_BLOCK` | `CHAIN_<id>_EVM_START_BLOCK` |
| `CHAIN_<id>_STELLAR_RPC_URL` | unchanged |
| `CHAIN_<id>_STELLAR_NETWORK_PASSPHRASE` | unchanged |
| `CHAIN_<id>_STELLAR_START_LEDGER` | `CHAIN_<id>_STELLAR_START_BLOCK` |

### Indexer

| Old | New |
|---|---|
| `CHAIN_<id>_DM_CONTRACTS` | `CHAIN_<id>_EVM_INDEXER_DEPOSIT_MANAGER_ADDRESS` |
| `CHAIN_<id>_WQ_CONTRACTS` | `CHAIN_<id>_EVM_INDEXER_WITHDRAWAL_QUEUE_ADDRESS` |
| `CHAIN_<id>_SPLUSD_CONTRACTS` | `CHAIN_<id>_EVM_INDEXER_STAKED_PLUSD_ADDRESS` |
| `CHAIN_<id>_LOAN_REGISTRY_CONTRACTS` | `CHAIN_<id>_EVM_INDEXER_LOAN_REGISTRY_ADDRESS` |
| `CHAIN_<id>_YIELD_MINTER_CONTRACTS` | `CHAIN_<id>_EVM_INDEXER_MINTER_ADDRESS` |
| `CHAIN_<id>_STELLAR_DEPOSIT_MANAGER_ID` | `CHAIN_<id>_STELLAR_INDEXER_DEPOSIT_MANAGER_ADDRESS` |
| `CHAIN_<id>_STELLAR_WITHDRAWAL_QUEUE_ID` | `CHAIN_<id>_STELLAR_INDEXER_WITHDRAWAL_QUEUE_ADDRESS` |
| `CHAIN_<id>_STELLAR_STAKED_PLUSD_ID` | `CHAIN_<id>_STELLAR_INDEXER_STAKED_PLUSD_ADDRESS` |
| `CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID` | `CHAIN_<id>_STELLAR_INDEXER_LOAN_REGISTRY_ADDRESS` |
| `CHAIN_<id>_STELLAR_YIELD_MINTER_ID` | `CHAIN_<id>_STELLAR_INDEXER_MINTER_ADDRESS` |
| `CHAIN_<id>_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID` | `CHAIN_<id>_STELLAR_INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS` |
| `CHAIN_<id>_INDEXER_POLLING_BLOCK_RANGE` | `CHAIN_<id>_<TYPE>_INDEXER_POLLING_BLOCK_RANGE` |
| `CHAIN_<id>_INDEXER_POLLING_INTERVAL_MS` | `CHAIN_<id>_<TYPE>_INDEXER_POLLING_INTERVAL_MS` |
| `CHAIN_<id>_INDEXER_LOG_CONFIRMATIONS_DELAY` | `CHAIN_<id>_EVM_INDEXER_LOG_CONFIRMATIONS_DELAY` |

### Price-poller — deferred, defined but not implemented in this issue

| Old | New |
|---|---|
| `CHAIN_<id>_PRICE_POLLER_STELLAR_RPC_URL` | `CHAIN_<id>_STELLAR_PRICE_POLLER_RPC_URL` |
| `CHAIN_<id>_PRICE_POLLER_STELLAR_NETWORK_PASSPHRASE` | `CHAIN_<id>_STELLAR_PRICE_POLLER_NETWORK_PASSPHRASE` |
| `CHAIN_<id>_PRICE_POLLER_STELLAR_INTERVAL_SECS` | `CHAIN_<id>_STELLAR_PRICE_POLLER_INTERVAL_SECS` |

### Relayer — deferred, defined but not implemented in this issue

| Old | New |
|---|---|
| `CHAIN_<id>_RELAYER_ETH_RPC_URL` | `CHAIN_<id>_EVM_RELAYER_RPC_URL` |
| `CHAIN_<id>_RELAYER_SIGNER_KEY` | `CHAIN_<id>_EVM_RELAYER_SIGNER_KEY` |
| `CHAIN_<id>_RELAYER_REGISTRY_ADDRESS` | `CHAIN_<id>_EVM_RELAYER_WHITELIST_REGISTRY_ADDRESS` |
| `CHAIN_<id>_RELAYER_YIELD_MINTER_ADDRESS` | `CHAIN_<id>_EVM_RELAYER_MINTER_ADDRESS` |
| `CHAIN_<id>_RELAYER_LOAN_REGISTRY_ADDRESS` | `CHAIN_<id>_EVM_RELAYER_LOAN_REGISTRY_ADDRESS` |
| `CHAIN_<id>_RELAYER_STELLAR_RPC_URL` | `CHAIN_<id>_STELLAR_RELAYER_RPC_URL` |
| `CHAIN_<id>_RELAYER_STELLAR_NETWORK_PASSPHRASE` | `CHAIN_<id>_STELLAR_RELAYER_NETWORK_PASSPHRASE` |
| `CHAIN_<id>_RELAYER_STELLAR_ACCESS_MANAGER_ID` | `CHAIN_<id>_STELLAR_RELAYER_ACCESS_MANAGER_ADDRESS` |
| `CHAIN_<id>_RELAYER_STELLAR_PLUSD_SAC_ID` | `CHAIN_<id>_STELLAR_RELAYER_PLUSD_SAC_ADDRESS` |
| `CHAIN_<id>_RELAYER_STELLAR_SIGNER_SECRET` | `CHAIN_<id>_STELLAR_RELAYER_SIGNER_KEY` |
| `CHAIN_<id>_RELAYER_STELLAR_YIELD_MINTER_ID` | `CHAIN_<id>_STELLAR_RELAYER_MINTER_ADDRESS` |
| `CHAIN_<id>_RELAYER_STELLAR_LOAN_REGISTRY_ID` | `CHAIN_<id>_STELLAR_RELAYER_LOAN_REGISTRY_ADDRESS` |

### API — deferred, defined but not implemented in this issue

| Old | New |
|---|---|
| `CHAIN_<id>_SIGNER_KEY` | `CHAIN_<id>_EVM_API_SIGNER_KEY` |
| `CHAIN_<id>_DM_ADDRESS` | `CHAIN_<id>_EVM_API_DEPOSIT_MANAGER_ADDRESS` |
| `CHAIN_<id>_WQ_ADDRESS` | `CHAIN_<id>_EVM_API_WITHDRAWAL_QUEUE_ADDRESS` |
| `CHAIN_<id>_API_STELLAR_DM_CONTRACT_ID` | `CHAIN_<id>_STELLAR_API_DEPOSIT_MANAGER_ADDRESS` |
| `CHAIN_<id>_API_STELLAR_WQ_CONTRACT_ID` | `CHAIN_<id>_STELLAR_API_WITHDRAWAL_QUEUE_ADDRESS` |
| `CHAIN_<id>_API_STELLAR_NETWORK_PASSPHRASE` | `CHAIN_<id>_STELLAR_API_NETWORK_PASSPHRASE` |
| `CHAIN_<id>_API_STELLAR_CUSTODY_ADDRESSES` | `CHAIN_<id>_STELLAR_API_CUSTODY_ADDRESSES` |
| `CHAIN_<id>_API_STELLAR_RAMP_ADDRESSES` | `CHAIN_<id>_STELLAR_API_RAMP_ADDRESSES` |
| `CHAIN_<id>_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID` | `CHAIN_<id>_STELLAR_API_WITHDRAWAL_QUEUE_WALLET_ADDRESS` |
| `CHAIN_<id>_API_STELLAR_ASSET_DECIMALS` | `CHAIN_<id>_STELLAR_API_ASSET_DECIMALS` |

Job-level `JOB_*` variables are untouched: they are not per-chain, so the scheme does not apply.

## Out of scope

- The relayer, price-poller and API renames — defined above, implemented in follow-up issues.
  That defers the one naming question still open: `WhitelistRegistry` (EVM) and `AccessManager`
  (Stellar) are genuinely different contract names for the same role, so the pair either keeps
  two names or is renamed to the role. It belongs with the relayer.
- Rejecting unknown `CHAIN_*` keys outright. Only the type-mismatch check above is included.
- Per-job chain lists (`JOB_RELAYER_CHAINS` and friends). Separate problem, separate issue.
- `VITE_*` frontend variables. They are build-time, configured per app rather than per chain,
  and renaming them is a frontend concern.
- BUG-26 (unvalidated EVM addresses) and TD-134 (cadence doubling).

## Testing

Pure unit tests in `packages/worker/tests/` and `packages/api/tests/`, no database:

- Every renamed key resolves; the old spelling resolves to nothing.
- The type-mismatch check rejects `CHAIN_1_STELLAR_*` on a chain declared `evm`, and vice versa.
- Defaults, validation errors and fallback chains behave exactly as before the rename, asserted
  per settings struct.
- `IndexerSettings::all_from_env` with one chain of each type still dispatches correctly.

A grep-based check that no old spelling survives anywhere in the repo guards the mechanical part.
