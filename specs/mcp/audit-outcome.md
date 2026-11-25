Status: draft

# Audit outcome of rejected tool calls

Proposed additions to `specs/mcp/transport.md` (issue #2247): the audit outcome of a tool call is `ok` only for a successful result, otherwise the rejection reason, also when the server rejects the parameters before the tool runs.

## A timed-out statement is audited as statement_timeout

```spec
given:
  - TokenConfigured: { id: agent-a, secret: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 }
  - DbFails: { sql: "SELECT pg_sleep(60)", error: statement_timeout }
when:
  Call: { authorization: "Bearer a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718", tool: query, args: { sql: "SELECT pg_sleep(60)" } }
then:
  - Responded: { status: 200 }
  - AuditRecorded: { tokenId: agent-a, tool: query, outcome: statement_timeout }
```

## Parameters the tool's schema rejects are audited as invalid_input

```spec
given:
  - TokenConfigured: { id: agent-a, secret: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 }
when:
  Call: { authorization: "Bearer a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718", tool: query, args: { sql: "" } }
then:
  - Responded: { status: 200 }
  - AuditRecorded: { tokenId: agent-a, tool: query, outcome: invalid_input }
```
