Status: approved

# `logs`: recent log lines of a service

`logs` takes `service`, `since` (a duration such as `15m`), optional `grep` and `limit`, and returns `{lines: [{ts, line}], truncated}`: the most recent `limit` lines of the service within `since`, oldest first. Lines come from Loki through Grafana, selected by the label `container`; the `service → container` map is configuration. `grep` is a literal line filter, never raw LogQL, so a caller cannot reach another container.

Limits: `since` ≤ 24 h, `limit` ≤ 500 (default 100), a line ≤ 2048 bytes (a longer line keeps its first 2048). A clamped input, a cut line, or more lines than `limit` sets `truncated: true`.

The scenarios are queries against the `Logs` fake: `ServiceContainer: { service, container }` is the configured map, `LokiLine: { container, ts, line }` a stored line (`line: { repeat, times }` stands for the text repeated that many times), `SourceDown` makes Grafana fail. Calls reach the tool already authenticated (`specs/mcp/transport.md`).

## Lines of the service within the window, oldest first

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:30:00Z, line: "too old" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:50:00Z, line: "indexed block 1200" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:55:00Z, line: "indexed block 1201" }
  - LokiLine: { container: pipeline-api-test-main, ts: 2026-11-21T11:56:00Z, line: "GET /health" }
query:
  Logs: { service: worker, since: 15m }
then:
  lines:
    - { ts: 2026-11-21T11:50:00Z, line: "indexed block 1200" }
    - { ts: 2026-11-21T11:55:00Z, line: "indexed block 1201" }
  truncated: false
```

## Grep keeps only matching lines

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:50:00Z, line: "indexed block 1200" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:51:00Z, line: "ERROR rpc timeout" }
query:
  Logs: { service: worker, since: 15m, grep: "rpc timeout" }
then:
  lines:
    - { ts: 2026-11-21T11:51:00Z, line: "ERROR rpc timeout" }
  truncated: false
```

## Grep is a literal filter, not LogQL

A grep that looks like a selector matches only lines containing that exact text; it never selects another container.

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:50:00Z, line: "indexed block 1200" }
  - LokiLine: { container: pipeline-api-test-main, ts: 2026-11-21T11:51:00Z, line: "password reset for x@example.com" }
query:
  Logs: { service: worker, since: 15m, grep: "\"} or {container=\"pipeline-api-test-main\"} |= \"" }
then:
  lines: []
  truncated: false
```

## More lines than the limit keeps the most recent and flags it

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:50:00Z, line: "a" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:51:00Z, line: "b" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:52:00Z, line: "c" }
query:
  Logs: { service: worker, since: 15m, limit: 2 }
then:
  lines:
    - { ts: 2026-11-21T11:51:00Z, line: "b" }
    - { ts: 2026-11-21T11:52:00Z, line: "c" }
  truncated: true
```

## A limit above 500 is clamped and flagged

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:50:00Z, line: "a" }
query:
  Logs: { service: worker, since: 15m, limit: 5000 }
then:
  lines:
    - { ts: 2026-11-21T11:50:00Z, line: "a" }
  truncated: true
```

## A window over 24 hours is clamped to 24 hours and flagged

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-19T12:00:00Z, line: "two days ago" }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:00:00Z, line: "an hour ago" }
query:
  Logs: { service: worker, since: 72h }
then:
  lines:
    - { ts: 2026-11-21T11:00:00Z, line: "an hour ago" }
  truncated: true
```

## A line of 2048 bytes is kept whole

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:50:00Z, line: { repeat: "a", times: 2048 } }
query:
  Logs: { service: worker, since: 15m }
then:
  lines:
    - ts: 2026-11-21T11:50:00Z
      line: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  truncated: false
```

## A line over 2048 bytes is cut and flagged

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - LokiLine: { container: pipeline-worker-test-main, ts: 2026-11-21T11:50:00Z, line: { repeat: "a", times: 2049 } }
query:
  Logs: { service: worker, since: 15m }
then:
  lines:
    - ts: 2026-11-21T11:50:00Z
      line: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  truncated: true
```

## An unknown service is rejected

Only configured services map to a container; nothing else is queried.

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
query:
  Logs: { service: postgres, since: 15m }
then:
  rejected: unknown_service
```

## A malformed window is invalid input

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
query:
  Logs: { service: worker, since: "yesterday" }
then:
  rejected: invalid_input
```

## Unreachable Grafana is reported, not hidden

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - SourceDown: { source: grafana, error: connection refused }
query:
  Logs: { service: worker, since: 15m }
then:
  rejected: logs_unavailable
```
