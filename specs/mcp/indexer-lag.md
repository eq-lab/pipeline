Status: approved

# `indexer_lag`: how far the worker is behind

`indexer_lag` returns `{chains, projections}`.

- `chains`, one per row of `log_collector_state`, sorted by `chainId`: `{chainId, lastIndexedBlock, head, lagBlocks}`. The column holds the next block (EVM) or ledger (Stellar) to index, so `lastIndexedBlock` is the column value − 1 and `lagBlocks = max(0, head − lastIndexedBlock)`. The head comes from chain RPC (`eth_blockNumber`, `getLatestLedger`); for a Stellar chain the numbers are ledgers. A chain whose RPC fails gets `error` instead of `head` and `lagBlocks`; the other chains are still reported.
- `projections`, sorted by `name` then `chainId`: `{name, chainId, contract, cursor, latest, lagLogs}`, where `lagLogs = max(0, latest − cursor)`. For the SecurityRegistry projection (`security_registry_state.projected_log_id`) `latest` is the max `contract_logs.id` of the same chain over the registry's log contracts; for the AccessManager sync (`access_manager_sync_state.last_log_id`) it is the max over the same contract and its three `AccessManagerOperation*` events. Never the table-wide max, which other contracts keep moving.

The scenarios are queries against the fakes: `IndexerCursor` is a row of `log_collector_state`, `ChainHead: { chainId, head }` and `ChainDown: { chainId, error }` are the chain RPC fake, `ContractLog`, `SecurityRegistryCursor`, `AccessManagerCursor` are rows of their tables, `RegistryLogContracts` is the configured contract list of the registry projection. Calls reach the tool already authenticated (`specs/mcp/transport.md`).

## Lag is the head minus the last indexed block

```spec
given:
  - IndexerCursor: { chainId: 1, lastIndexedBlock: 1201 }
  - IndexerCursor: { chainId: 99000001, lastIndexedBlock: 5400 }
  - ChainHead: { chainId: 1, head: 1250 }
  - ChainHead: { chainId: 99000001, head: 5399 }
query:
  IndexerLag: {}
then:
  chains:
    - { chainId: 1, lastIndexedBlock: 1200, head: 1250, lagBlocks: 50 }
    - { chainId: 99000001, lastIndexedBlock: 5399, head: 5399, lagBlocks: 0 }
  projections: []
```

## A cursor ahead of the head is no lag

The RPC node may be a block behind the one the worker read from.

```spec
given:
  - IndexerCursor: { chainId: 1, lastIndexedBlock: 1252 }
  - ChainHead: { chainId: 1, head: 1250 }
query:
  IndexerLag: {}
then:
  chains:
    - { chainId: 1, lastIndexedBlock: 1251, head: 1250, lagBlocks: 0 }
  projections: []
```

## One unreachable RPC does not hide the other chains

```spec
given:
  - IndexerCursor: { chainId: 1, lastIndexedBlock: 1201 }
  - IndexerCursor: { chainId: 99000001, lastIndexedBlock: 5400 }
  - ChainDown: { chainId: 1, error: connection refused }
  - ChainHead: { chainId: 99000001, head: 5410 }
query:
  IndexerLag: {}
then:
  chains:
    - { chainId: 1, lastIndexedBlock: 1200, error: unreachable }
    - { chainId: 99000001, lastIndexedBlock: 5399, head: 5410, lagBlocks: 11 }
  projections: []
```

## Registry projection lag counts only the registry's log contracts

```spec
given:
  - RegistryLogContracts: { chainId: 1, contracts: ["0xregistry", "0xvault"] }
  - SecurityRegistryCursor: { chainId: 1, contract: "0xregistry", projectedLogId: 40 }
  - ContractLog: { id: 41, chainId: 1, contract: "0xregistry", event: SecurityRegistered }
  - ContractLog: { id: 45, chainId: 1, contract: "0xvault", event: Deposit }
  - ContractLog: { id: 90, chainId: 1, contract: "0xother", event: Transfer }
  - ContractLog: { id: 95, chainId: 2, contract: "0xregistry", event: SecurityRegistered }
query:
  IndexerLag: {}
then:
  chains: []
  projections:
    - { name: security_registry, chainId: 1, contract: "0xregistry", cursor: 40, latest: 45, lagLogs: 5 }
```

## AccessManager sync lag counts only the operation events

The sync watermark advances only over `AccessManagerOperationScheduled`, `AccessManagerOperationExecuted` and `AccessManagerOperationCanceled`, so other events of the contract do not count as lag.

```spec
given:
  - AccessManagerCursor: { chainId: 1, contract: "0xmanager", lastLogId: 10 }
  - ContractLog: { id: 12, chainId: 1, contract: "0xmanager", event: AccessManagerOperationScheduled }
  - ContractLog: { id: 13, chainId: 1, contract: "0xmanager", event: AccessManagerOperationExecuted }
  - ContractLog: { id: 14, chainId: 1, contract: "0xmanager", event: AccessManagerOperationCanceled }
  - ContractLog: { id: 20, chainId: 1, contract: "0xmanager", event: RoleGranted }
  - ContractLog: { id: 30, chainId: 1, contract: "0xother", event: AccessManagerOperationScheduled }
query:
  IndexerLag: {}
then:
  chains: []
  projections:
    - { name: access_manager, chainId: 1, contract: "0xmanager", cursor: 10, latest: 14, lagLogs: 4 }
```

## An unreachable database is reported, not hidden

```spec
given:
  - SourceDown: { source: db, error: connection refused }
query:
  IndexerLag: {}
then:
  rejected: db_unavailable
```
