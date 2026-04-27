# Relayer Service — Internal Architecture

> Service decomposition detail for the Relayer Service. See [relayer-service.md](./relayer-service.md) for the main spec (behavior, on-chain events, role assignments, security).

---

## Service Decomposition

Relayer is described as a "single backend" for simplicity, but is deployed as **separate
internal services** sharing a Postgres database and communicating via internal RPC. No
service is internet-facing except the API Gateway.

```
                    ┌──────────────────────────────────────────────┐
                    │              Relayer Cluster                   │
                    │                                              │
 Ethereum RPC ────► │  ┌─────────────┐    ┌──────────────────┐    │
                    │  │ Indexer     │───►│ Postgres          │    │
                    │  │ (no keys)   │    │ (shared state)    │    │
                    │  └─────────────┘    └──────┬───────────┘    │
                    │                            │                 │
                    │  ┌─────────────┐    ┌──────┴───────────┐    │
                    │  │ Orchestrator│───►│ Tx Outbox         │    │
                    │  │ (no keys)   │    └──────┬───────────┘    │
                    │  └─────────────┘           │                 │
                    │                     ┌──────┴───────────┐    │
                    │                     │ Tx Submitter      │───►  Ethereum
                    │                     │ (holds Relayer EOA)│    │
                    │                     └──────────────────┘    │
                    │                                              │
                    │  ┌──────────────────┐                       │
                    │  │ Signer            │  (holds              │
                    │  │ (air-gapped       │   relayerYieldAttestor│
                    │  │  hardware signer) │   — yield            │
                    │  └──────────────────┘   attestations only;  │
                    │                         no internet egress) │
                    │                                              │
 Frontend ────────► │  ┌─────────────┐                            │
 Trustee UI ──────► │  │ API Gateway │  (reads DB, proxies to     │
 Admin ───────────► │  │ (no keys)   │   Orchestrator)            │
                    │  └─────────────┘                            │
                    │                                              │
                    │  ┌────────────────────┐                     │
                    │  │ Custodian Co-Signer│───────────────────► Custodian API
                    │  │ Client             │   (EIP-1271 co-sig) │ (yield only)
                    │  └────────────────────┘                     │
                    └──────────────────────────────────────────────┘
```

### Blast radius per internal service compromise

| Service compromised | Can do | Cannot do |
|---|---|---|
| Indexer | Poison event data in DB | Sign attestations, submit txs, mint PLUSD |
| Orchestrator | Queue malicious yield-mint intents | Obtain custodian co-sig (no yield mint possible); submit txs |
| Tx Submitter | Front-run internal tx queue; submit arbitrary txs under Relayer EOA authority | Forge Relayer yield sig; forge custodian sig; operate outside the permissions granted to the Relayer EOA |
| Signer | Produce Relayer yield sigs without custodian co-sig | Mint PLUSD alone — custodian EIP-1271 sig and `YIELD_MINTER` caller role are independent requirements |
| API Gateway | Leak read data; inject bad Trustee approvals into the review queue | Sign, submit, or index |
| Custodian alone (external) | Produce a custodian EIP-1271 sig | Mint PLUSD alone — Relayer ECDSA sig and `YIELD_MINTER` caller role are independent requirements |

All service-to-service communication is mTLS with auto-provisioned certificates. No
service has internet egress except Tx Submitter (Ethereum RPC), API Gateway (frontend),
and the Custodian Co-Signer Client (custodian API).
