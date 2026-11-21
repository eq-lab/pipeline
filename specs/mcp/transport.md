Status: draft

# Transport, authentication and audit

The MCP server answers on one streamable HTTP endpoint. Every request carries `Authorization: Bearer <token>`; the token is compared in constant time with every configured client secret (`{id, secret}` pairs). No match gives `401` with an empty body: no hint whether the header was missing, malformed or wrong.

Every request writes exactly one audit record: token id, tool, duration, result size and outcome. The record has only these fields: never the presented token, the call's arguments or the result.

The scenarios are commands against the fakes: `given` configures clients (`TokenConfigured`), `when` is one HTTP request (`Call`), `then` is the response (`Responded`) followed by the audit record (`AuditRecorded`). Sources not mentioned answer normally.

## A configured token reaches the tool

```spec
given:
  - TokenConfigured: { id: agent-a, secret: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 }
when:
  Call: { authorization: "Bearer a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718", tool: health }
then:
  - Responded: { status: 200 }
  - AuditRecorded: { tokenId: agent-a, tool: health, outcome: ok }
```

## Each client is audited under its own token id

Tokens are per client, so the audit line attributes the call to the client whose secret matched.

```spec
given:
  - TokenConfigured: { id: agent-a, secret: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 }
  - TokenConfigured: { id: agent-b, secret: f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a59687 }
when:
  Call: { authorization: "Bearer f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a59687", tool: schema }
then:
  - Responded: { status: 200 }
  - AuditRecorded: { tokenId: agent-b, tool: schema, outcome: ok }
```

## An invalid token gets 401 with no detail

```spec
given:
  - TokenConfigured: { id: agent-a, secret: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 }
when:
  Call: { authorization: "Bearer not-a-configured-token", tool: query, args: { sql: "SELECT 1" } }
then:
  - Responded: { status: 401, body: "" }
  - AuditRecorded: { tokenId: null, tool: null, outcome: unauthorized }
```

## A missing Authorization header gets 401

```spec
given:
  - TokenConfigured: { id: agent-a, secret: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 }
when:
  Call: { tool: health }
then:
  - Responded: { status: 401, body: "" }
  - AuditRecorded: { tokenId: null, tool: null, outcome: unauthorized }
```

## A prefix of a configured secret gets 401

Comparison is over equal-length digests, so a token that is a prefix of a secret neither matches nor fails differently.

```spec
given:
  - TokenConfigured: { id: agent-a, secret: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 }
when:
  Call: { authorization: "Bearer a1b2c3d4e5f60718", tool: health }
then:
  - Responded: { status: 401, body: "" }
  - AuditRecorded: { tokenId: null, tool: null, outcome: unauthorized }
```

## A secret sent with another scheme gets 401

```spec
given:
  - TokenConfigured: { id: agent-a, secret: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 }
when:
  Call: { authorization: "Basic a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718", tool: health }
then:
  - Responded: { status: 401, body: "" }
  - AuditRecorded: { tokenId: null, tool: null, outcome: unauthorized }
```

## With no configured tokens every request gets 401

An empty client list is not an open server.

```spec
given: []
when:
  Call: { authorization: "Bearer ", tool: health }
then:
  - Responded: { status: 401, body: "" }
  - AuditRecorded: { tokenId: null, tool: null, outcome: unauthorized }
```

## A rejected tool call is audited with its reason

The outcome of a call the tool rejects is the rejection reason; the SQL itself is not in the record.

```spec
given:
  - TokenConfigured: { id: agent-a, secret: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718 }
  - DbFails: { sql: "DELETE FROM kyc_outbox", error: read_only_violation }
when:
  Call: { authorization: "Bearer a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718", tool: query, args: { sql: "DELETE FROM kyc_outbox" } }
then:
  - Responded: { status: 200 }
  - AuditRecorded: { tokenId: agent-a, tool: query, outcome: write_rejected }
```
