# MCP server for the test environment

Status: draft, for owner review. Package: `packages/mcp`. This document is the design only; the implementation and the argocd values PR are separate work.

## Context

Coding agents debug the test environment blind: they cannot read logs, the database, worker lag or the deployment state. A small read-only MCP server gives them exactly that and nothing else. Read-only is a hard property: no tool writes to Postgres, to Kubernetes, or to a chain.

## Decision

An HTTP MCP server deployed next to the test stack, exposing a fixed set of read-only tools over five sources: Postgres, Grafana/Loki, the Kubernetes API, EVM RPC and Stellar RPC.

### Architecture

- **Pure core.** Tool input validation, limit clamping, result shaping, truncation flags, secret masking and the audit record are pure functions over plain data.
- **Ports.** One port per source: `Db`, `Logs`, `Cluster`, `ChainRpc` (EVM and Stellar behind one interface keyed by chain). Each port is an Effect service with typed errors.
- **Adapters.** The only place with I/O and with `async`/`await`/`try`: Postgres (`pg`), Grafana HTTP, k8s API, EVM/Stellar RPC. Every adapter has a fake (in-memory) used by core and shell tests; the adapter itself is thin.
- **Shell.** Wires ports to the HTTP server, authentication and audit. Effect everywhere; no `async`/`await`/`try` outside adapters.

### Transport and auth

- HTTP MCP (streamable HTTP) on one endpoint.
- One Bearer token per client, configured as `{id, secret}` pairs. The presented token is compared with every configured secret in constant time (`crypto.timingSafeEqual` over equal-length digests); no match gives `401` with no detail.
- Audit: one log line per call with token id, tool, duration, result size and outcome. Never the token, the arguments' secrets or the result.
- Config from env, validated at startup (a bad value exits with the failing key, never its value): `MCP_PORT`, and `MCP_TOKENS` as a JSON array `[{"id": "...", "secret": "..."}]` (at least one client, unique ids and secrets, each secret ≥ 32 characters). The endpoint is `POST /mcp`.

### Tools

All tools clamp inputs to the limits below; a clamped result carries `truncated: true`.

| Tool | Input | Output | Limits |
|---|---|---|---|
| `logs` | `service`, `since` (duration, e.g. `15m`), `grep?`, `limit?` | `{lines: [{ts, line}], truncated}` | `since` ≤ 24 h, `limit` ≤ 500 (default 100), line ≤ 2 KB |
| `errors` | `service`, `since` | `{count, groups: [{message, count, lastTs}]}` | `since` ≤ 24 h, ≤ 50 groups; a `logs` query for error level, grouped by normalised message |
| `schema` | none | `{tables: [{name, columns: [{name, type, nullable}]}]}` | `public` schema only |
| `query` | `sql` | `{columns, rows, truncated}` | one statement only, read-only transaction (`BEGIN READ ONLY`), `statement_timeout` 5–10 s, ≤ 500 rows |
| `health` | none | `{api, worker, db, grafana, k8s}` each `ok` or an error summary | one cheap probe per source, 2 s each |
| `indexer_lag` | none | per chain: `{chainId, lastIndexedBlock, head, lagBlocks}` (`lastIndexedBlock` is the column value − 1) | head from RPC; see table map below |
| `queues` | none | outbox counts (pending, failed, oldest age) and the 20 most recent errors per outbox | errors truncated to 500 chars |
| `deployment` | `service?` | image tag, pods (phase, restarts, age) and recent events | events ≤ 50, last 1 h |
| `config` | none | non-secret runtime config with secret-like keys masked (`***`) | Kubernetes Secrets are never read |

`query` is defence in depth: the Postgres role is read-only (see checklist), the transaction is read-only, and the timeout bounds cost. SQL is not parsed, but it is always run as exactly one statement: the adapter sends it through the extended query protocol (a prepared statement), which rejects multi-statement text. With the simple protocol a caller could send `COMMIT; SET statement_timeout = 0; ...` and leave both the read-only transaction and the timeout behind, because the role-level `default_transaction_read_only` and `statement_timeout` are only defaults the session may override. Each call opens its own `BEGIN READ ONLY` transaction and sets `SET LOCAL statement_timeout` inside it before the caller's statement, so a setting changed by an earlier call on a pooled connection never carries over. The row limit is applied while fetching, not after: the portal is executed with a maximum of 501 rows (the 501st only sets `truncated`), so `SELECT * FROM contract_logs` never loads the whole table into the server's memory. `config` is built from the Deployment's env names and ConfigMap values; any value from a `secretKeyRef`, and any key matching `KEY`, `SECRET`, `TOKEN`, `PASSWORD` or a URL with credentials, is masked.

### Logs

Logs come from the Grafana HTTP API (Loki datasource proxy) with a Viewer service-account token. Loki streams are selected by the label `container`, e.g. `{container="pipeline-worker-test-main"}`. The worker is `pipeline-worker-test-main`. The mapping `service → container` comes from config, not code, so a rename or a new service needs no release. `grep` becomes a LogQL line filter (`|= "..."`, escaped), never raw LogQL, so callers cannot choose another label selector.

### Worker tables on main (`packages/shared/migrations`)

| Table | Meaning | Read by |
|---|---|---|
| `log_collector_state` (`chain_id`, `last_indexed_block`, `updated_at`) | Indexer cursor per chain, EVM and Stellar alike. Despite its name, `last_indexed_block` holds the next block (EVM) or ledger (Stellar) to index: the worker writes `commit + 1` and seeds it with the start block, so the last indexed one is `last_indexed_block − 1` | `indexer_lag` (`lagBlocks = max(0, head − (last_indexed_block − 1))`, head from `eth_blockNumber` on EVM, `getLatestLedger` on Stellar), `health` (stale `updated_at`) |
| `security_registry_state` (`chain_id`, `contract_address`, `projected_log_id`, `projected_snapshot_at`, `updated_at`) | SecurityRegistry projection cursor | `indexer_lag` (projection lag: `projected_log_id` vs max `contract_logs.id` for the same `chain_id` and the registry's log contracts, as the worker's projection step computes it; never the table-wide max, which other contracts keep moving) |
| `access_manager_sync_state` (`chain_id`, `contract_address`, `last_log_id`, `updated_at`) | AccessManager sync cursor | `indexer_lag` (`last_log_id` vs max `contract_logs.id` for the same `chain_id`, `contract_address` and the three `AccessManagerOperation*` events the sync reads, since the watermark only advances over those) |
| `kyc_outbox` (`chain_id`, `processed_at`, `error`, `created_at`) | KYC status pushes to chain | `queues` (unprocessed count and age, recent `error`) |
| `yield_mint_outbox` (`chain_id`, `status`, `last_error`, `submitted_at`, `confirmed_at`) | yield mint submissions | `queues` (count per `status`, recent `last_error`) |

Every table is also reachable through `query`. The Stellar indexer writes its cursor to `log_collector_state` through the same repository as the EVM indexer, keyed by its own `chain_id`, so `indexer_lag` covers Stellar from the start; `lagBlocks` counts ledgers for a Stellar chain.

### Deployment sketch

A `pipeline-mcp` Deployment (one replica) in the test namespace via `eq-lab/argocd`, `pipeline/test.yaml`, alongside the other pipeline services: image from the `packages/mcp` build, a ConfigMap for the service→container map, Loki datasource uid, chain RPC URLs and ports; Secrets for tokens and credentials (env from `secretKeyRef`); a ServiceAccount bound to a read-only Role; a Service and an Ingress with TLS and an IP allowlist. The values PR is out of scope here.

The Kubernetes adapter reaches the API server through the in-cluster `KUBERNETES_SERVICE_HOST`/`KUBERNETES_SERVICE_PORT` (set by Kubernetes in every pod, also required) with the mounted ServiceAccount token and CA, and only `GET`s deployments, pods and events of the namespace.

### Environment variables

`packages/mcp/src/config.ts` (plus `services.ts` for `MCP_SERVICES` and `k8s.ts` for `MCP_K8S_NAMESPACE`) is the source of truth; this list matches it. All are read once at startup. A missing or invalid required variable stops the server with exit code 1 and the failing key (never its value). Put secrets in Secrets (`secretKeyRef`), the rest in the ConfigMap.

| Variable | Required | Format | Example | Used by |
|---|---|---|---|---|
| `MCP_PORT` | yes | port, 0–65535 | `8080` | the HTTP server |
| `MCP_TOKENS` | yes | JSON array `[{"id","secret"}]`, at least one, unique ids and secrets, `secret` ≥ 32 chars | `[{"id":"coding-flow","secret":"<32+ random chars>"}]` | auth of every call |
| `MCP_SERVICES` | yes | JSON object `service → container`, non-empty string values; the container name is also the Deployment name | `{"worker":"pipeline-worker-test-main"}` | `logs`, `errors`, `deployment` |
| `MCP_K8S_NAMESPACE` | yes | non-empty string | `pipeline-test` | `deployment`, `config` |
| `GRAFANA_URL` | yes | `http(s)://` URL | `https://grafana.example.net` | `logs`, `errors`; `health` probes `GRAFANA_URL/api/health` |
| `GRAFANA_TOKEN` | yes | non-empty string, a Viewer service-account token (secret) | `glsa_...` | `logs`, `errors` |
| `LOKI_DATASOURCE_UID` | yes | non-empty string | `P8E80F9AEF21F6940` | `logs`, `errors` |
| `MCP_API_URL` | yes | `http(s)://` URL of the test API | `http://pipeline-api-test-main:3000` | `health` probes it |
| `MCP_CHAINS` | yes | JSON object `chainId → {kind, rpcUrl, registryLogContracts?}`: `chainId` a positive integer without leading zeros (≤ 16 digits), `kind` is `evm` or `stellar`, `rpcUrl` an `http(s)://` URL, `registryLogContracts` an optional array of non-empty contract addresses | `{"11155111":{"kind":"evm","rpcUrl":"https://rpc.example.net","registryLogContracts":["0xAbC...checksummed"]}}` | `indexer_lag` (head from RPC; `registryLogContracts` bound the SecurityRegistry projection lag) |
| `MCP_DATABASE_URL` | yes | Postgres connection string of the read-only role (secret) | `postgres://mcp_ro:...@db:5432/pipeline` | `schema`, `query`, `indexer_lag`, `queues`, `health` |
| `MCP_STATEMENT_TIMEOUT_MS` | no, default `10000` | integer, 5000–10000 | `8000` | `query` (`statement_timeout` of every call) |

Notes:

- `health` probes `MCP_API_URL` and `GRAFANA_URL/api/health` with a plain GET; any HTTP response below 500 counts as up, a 5xx or no answer is an error.
- `registryLogContracts` addresses are compared exactly with `contract_logs.contract_address`, which the worker stores in EIP-55 checksum case for EVM, so give EVM addresses in checksum case (a lowercase address matches nothing). Stellar contracts are given as the Strkey `C…` form verbatim. A chain without the key counts only the cursor's own contract.
- An indexed chain id without an `MCP_CHAINS` entry gets an `error` instead of `head` and `lagBlocks` in `indexer_lag`.

### Devops checklist (ready to send)

Create by hand in the test environment:

1. **Postgres read-only role** on the test database: `LOGIN`, `CONNECT`, `USAGE` on schema `public`, `SELECT` on all tables (and default privileges for future tables), no other grants; revoke `TEMP` on the database and `CREATE` on schema `public` from `PUBLIC` if they are still granted (Postgres before 15 grants `CREATE` on `public` by default), so the role cannot create objects even outside a read-only transaction; `default_transaction_read_only = on`, `statement_timeout = 10s`, connection limit ~5. Send the connection string through a Secret.
2. **Grafana Viewer service account and token** with access to the Loki datasource. Send the token through a Secret and tell us the datasource uid.
3. **Kubernetes read-only ServiceAccount** in the test namespace with a Role granting `get`/`list` on `pods`, `events`, `configmaps` (read by the `config` tool), `deployments` (apps), and optionally `pods/log`. No Secrets, no write verbs, no cluster-wide rights.
4. **Ingress with TLS and an IP allowlist** limited to the coding-flow machine's address(es).
5. **Secrets**: the MCP Bearer token(s), one per client (random, ≥ 32 bytes), plus the Postgres and Grafana credentials above.

### Open questions

- Loki datasource uid.
- `container` values for api (probably `pipeline-api-test-main`, unconfirmed), frontend and trustee.
- Ingress hostname.

## Rationale

- Ports plus fakes keep nearly all logic testable without Postgres, Grafana or a cluster.
- Fixed tools, not a generic proxy: Loki selectors and Kubernetes calls are fixed server-side, so a leaked token reads logs and rows but cannot reach anything else. Only `query` is open-ended, and it is bounded by the DB role.
- Least privilege is enforced by the infrastructure (role, service account, allowlist), not only by the code.

## Consequences

- A leaked MCP token exposes the whole test database content, including personal test data; the IP allowlist and per-client tokens limit and attribute that. Tokens are rotated by changing the Secret.
- Per-client tokens give attribution in the audit line but no per-client permissions.
- Adding a service means a config entry; adding a source means a new port, adapter and fake.
