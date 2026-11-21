Status: draft

# `query`: read-only SQL

`query` runs one caller-written SQL statement and returns `{columns, rows, truncated}`. It is defence in depth around open-ended SQL: the database role is read-only, every call runs in its own `BEGIN READ ONLY` transaction with `SET LOCAL statement_timeout`, the statement is sent as exactly one prepared statement (multi-statement text is refused), and at most 500 rows come back. The 501st row is fetched only to set `truncated: true`; the rest of the result is never loaded.

The scenarios are queries against the `Db` fake. `given` says how the fake answers a statement: `DbReturns: { sql, columns, rows }`, or `DbReturns: { sql, columns: [id], rowCount: N }` for a result of N rows `{id: 1..N}`, or `DbFails: { sql, error }` with the error the database port reports for it (`read_only_violation`, `statement_timeout`, `multiple_statements`, `syntax_error`). Calls reach the tool already authenticated (`specs/mcp/transport.md`).

## A select returns columns and rows in database order

```spec
given:
  - DbReturns:
      sql: "SELECT chain_id, last_indexed_block FROM log_collector_state ORDER BY chain_id"
      columns: [chain_id, last_indexed_block]
      rows:
        - [1, 1201]
        - [99000001, 5400]
query:
  Query: { sql: "SELECT chain_id, last_indexed_block FROM log_collector_state ORDER BY chain_id" }
then:
  columns: [chain_id, last_indexed_block]
  rows:
    - [1, 1201]
    - [99000001, 5400]
  truncated: false
```

## Write SQL is rejected

The read-only transaction makes Postgres refuse any write; the tool reports it as `write_rejected`.

```spec
given:
  - DbFails: { sql: "UPDATE accounts SET email = 'x@example.com'", error: read_only_violation }
query:
  Query: { sql: "UPDATE accounts SET email = 'x@example.com'" }
then:
  rejected: write_rejected
```

## DDL is rejected as a write

```spec
given:
  - DbFails: { sql: "DROP TABLE kyc_outbox", error: read_only_violation }
query:
  Query: { sql: "DROP TABLE kyc_outbox" }
then:
  rejected: write_rejected
```

## Multi-statement text is rejected

Without this, `COMMIT; SET statement_timeout = 0; ...` would leave the read-only transaction and the timeout behind.

```spec
given:
  - DbFails: { sql: "COMMIT; DELETE FROM kyc_outbox", error: multiple_statements }
query:
  Query: { sql: "COMMIT; DELETE FROM kyc_outbox" }
then:
  rejected: multiple_statements
```

## A statement over the timeout is cancelled

```spec
given:
  - DbFails: { sql: "SELECT pg_sleep(60)", error: statement_timeout }
query:
  Query: { sql: "SELECT pg_sleep(60)" }
then:
  rejected: statement_timeout
```

## 500 rows are returned whole

```spec
given:
  - DbReturns: { sql: "SELECT id FROM contract_logs", columns: [id], rowCount: 500 }
query:
  Query: { sql: "SELECT id FROM contract_logs" }
then:
  columns: [id]
  truncated: false
```

## More than 500 rows are cut at 500 and flagged

The caller gets the first 500 rows and `truncated: true`, so it knows to narrow the query.

```spec
given:
  - DbReturns: { sql: "SELECT id FROM contract_logs", columns: [id], rowCount: 100000 }
query:
  Query: { sql: "SELECT id FROM contract_logs" }
then:
  columns: [id]
  truncated: true
```

## A syntax error is reported as an SQL error

```spec
given:
  - DbFails: { sql: "SELEC 1", error: syntax_error }
query:
  Query: { sql: "SELEC 1" }
then:
  rejected: sql_error
```

## A missing or empty statement is invalid input

```spec
given: []
query:
  Query: { sql: "   " }
then:
  rejected: invalid_input
```

## A statement that is not text is invalid input

```spec
given: []
query:
  Query: { sql: [ "SELECT 1" ] }
then:
  rejected: invalid_input
```

## An unreachable database is reported, not hidden

```spec
given:
  - SourceDown: { source: db, error: connection refused }
query:
  Query: { sql: "SELECT 1" }
then:
  rejected: db_unavailable
```
