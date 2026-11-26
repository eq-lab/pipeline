Status: approved

# `errors`: error lines grouped by message

`errors` takes `service` and `since` and returns `{count, groups: [{message, count, lastTs}]}`: the error-level lines of the service within `since`, grouped by normalised message (runs of digits become `<n>`, `0x` hex values become `<hex>`), most frequent first, ties by the latest `lastTs`. `count` is the total number of error lines. Lines come from the same Loki selection as `logs` (`specs/mcp/logs.md`).

Limits: `since` ≤ 24 h, at most 50 groups.

The scenarios are queries against the `Logs` fake: `ServiceContainer` is the configured map, `LokiLine: { container, ts, line, level }` a stored line. Calls reach the tool already authenticated (`specs/mcp/transport.md`).

## Error lines are grouped by normalised message

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:50:00Z, level: error, line: "rpc timeout after 2000 ms" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:52:00Z, level: error, line: "tx 0xabc123 reverted" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:53:00Z, level: error, line: "rpc timeout after 3000 ms" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:54:00Z, level: info, line: "indexed block 1201" }
  - LokiLine: { container: pipeline-api-test-main, ts: 2026-11-21T11:55:00Z, level: error, line: "db pool exhausted" }
query:
  Errors: { service: worker, since: 15m }
then:
  count: 3
  groups:
    - { message: "rpc timeout after <n> ms", count: 2, lastTs: 2026-11-21T11:53:00Z }
    - { message: "tx <hex> reverted", count: 1, lastTs: 2026-11-21T11:52:00Z }
```

## No errors in the window is an empty result

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T10:00:00Z, level: error, line: "rpc timeout after 2000 ms" }
query:
  Errors: { service: worker, since: 15m }
then:
  count: 0
  groups: []
```

## A window over 24 hours is clamped to 24 hours

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-19T12:00:00Z, level: error, line: "two days ago" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:00:00Z, level: error, line: "an hour ago" }
query:
  Errors: { service: worker, since: 72h }
then:
  count: 1
  groups:
    - { message: "an hour ago", count: 1, lastTs: 2026-11-21T11:00:00Z }
```

## An unknown service is rejected

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
query:
  Errors: { service: postgres, since: 15m }
then:
  rejected: unknown_service
```

## Unreachable Grafana is reported, not hidden

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - SourceDown: { source: grafana, error: connection refused }
query:
  Errors: { service: worker, since: 15m }
then:
  rejected: logs_unavailable
```
