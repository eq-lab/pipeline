Status: approved

# `schema`: tables of the database

`schema` lists the tables of the `public` schema with their columns, so an agent can write a `query` without guessing. Other schemas are never listed. Tables are sorted by name; columns keep their position in the table.

The scenarios are queries against the `Db` fake: `given` describes its tables (`Table`), `query` is the tool call. Calls reach the tool already authenticated (`specs/mcp/transport.md`).

## Tables of the public schema with their columns

```spec
given:
  - Table:
      schema: public
      name: log_collector_state
      columns:
        - { name: chain_id, type: bigint, nullable: false }
        - { name: last_indexed_block, type: bigint, nullable: false }
        - { name: updated_at, type: timestamp with time zone, nullable: false }
  - Table:
      schema: public
      name: kyc_outbox
      columns:
        - { name: id, type: bigint, nullable: false }
        - { name: error, type: text, nullable: true }
query:
  Schema: {}
then:
  tables:
    - name: kyc_outbox
      columns:
        - { name: id, type: bigint, nullable: false }
        - { name: error, type: text, nullable: true }
    - name: log_collector_state
      columns:
        - { name: chain_id, type: bigint, nullable: false }
        - { name: last_indexed_block, type: bigint, nullable: false }
        - { name: updated_at, type: timestamp with time zone, nullable: false }
```

## Tables outside the public schema are not listed

```spec
given:
  - Table: { schema: public, name: accounts, columns: [{ name: id, type: bigint, nullable: false }] }
  - Table: { schema: pg_catalog, name: pg_authid, columns: [{ name: rolpassword, type: text, nullable: true }] }
  - Table: { schema: internal, name: audit, columns: [{ name: id, type: bigint, nullable: false }] }
query:
  Schema: {}
then:
  tables:
    - { name: accounts, columns: [{ name: id, type: bigint, nullable: false }] }
```

## An empty database has no tables

```spec
given: []
query:
  Schema: {}
then:
  tables: []
```

## An unreachable database is reported, not hidden

```spec
given:
  - SourceDown: { source: db, error: connection refused }
query:
  Schema: {}
then:
  rejected: db_unavailable
```
