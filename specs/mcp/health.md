Status: draft

# `health`: one probe per source

`health` returns `{api, worker, db, grafana, k8s}`, each `ok` or `{ error, detail }` with a short summary. It runs one cheap probe per source, all at once, each bounded by 2 s. A source that is down or slow is reported in its own field; it never fails the whole call. The worker is judged by its indexer cursors (`log_collector_state.updated_at`): a cursor that stopped moving is `stale`.

The scenarios are queries against the fakes: `SourceDown: { source, error }` makes a probe fail, `SourceSlow: { source, ms }` makes it answer after `ms`, `IndexerCursor: { chainId, lastIndexedBlock, updatedAt }` is a row of `log_collector_state`. Sources not mentioned answer at once. Calls reach the tool already authenticated (`specs/mcp/transport.md`).

## Every source answering is all ok

```spec
now: 2026-11-21T12:00:00Z
given:
  - IndexerCursor: { chainId: 1, lastIndexedBlock: 1201, updatedAt: 2026-11-21T11:59:50Z }
query:
  Health: {}
then:
  api: ok
  worker: ok
  db: ok
  grafana: ok
  k8s: ok
```

## One unreachable service does not fail health

```spec
now: 2026-11-21T12:00:00Z
given:
  - IndexerCursor: { chainId: 1, lastIndexedBlock: 1201, updatedAt: 2026-11-21T11:59:50Z }
  - SourceDown: { source: grafana, error: connection refused }
query:
  Health: {}
then:
  api: ok
  worker: ok
  db: ok
  grafana: { error: unreachable }
  k8s: ok
```

## A probe slower than 2 s is a timeout

```spec
now: 2026-11-21T12:00:00Z
given:
  - IndexerCursor: { chainId: 1, lastIndexedBlock: 1201, updatedAt: 2026-11-21T11:59:50Z }
  - SourceSlow: { source: k8s, ms: 5000 }
query:
  Health: {}
then:
  api: ok
  worker: ok
  db: ok
  grafana: ok
  k8s: { error: timeout }
```

## An unreachable database leaves the other sources reported

```spec
now: 2026-11-21T12:00:00Z
given:
  - SourceDown: { source: db, error: connection refused }
query:
  Health: {}
then:
  api: ok
  db: { error: unreachable }
  grafana: ok
  k8s: ok
```

## A cursor that stopped moving makes the worker stale

The stale threshold is a parameter; a cursor two days old is beyond any reasonable value of it.

```spec
now: 2026-11-21T12:00:00Z
given:
  - IndexerCursor: { chainId: 1, lastIndexedBlock: 1201, updatedAt: 2026-11-21T11:59:50Z }
  - IndexerCursor: { chainId: 99000001, lastIndexedBlock: 5400, updatedAt: 2026-11-19T12:00:00Z }
query:
  Health: {}
then:
  api: ok
  worker: { error: stale }
  db: ok
  grafana: ok
  k8s: ok
```
