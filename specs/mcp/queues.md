Status: approved

# `queues`: outboxes and their job errors

`queues` shows what the worker still has to push to chain and why jobs fail. It returns `{kyc, yieldMint}`:

- `kyc` (`kyc_outbox`, KYC status pushes): `unprocessed` (rows with no `processed_at`), `oldestUnprocessedAgeSeconds` (null when none), and `recentErrors`, the 20 newest rows by `created_at` with an `error`, newest first.
- `yieldMint` (`yield_mint_outbox`, yield mint submissions): `byStatus`, the row count per `status`, and `recentErrors`, the 20 newest rows by `created_at` with a `last_error`, newest first.

Every error text is cut to 500 characters.

The scenarios are queries against the `Db` fake: `KycOutboxRow` and `YieldMintOutboxRow` are rows of the two tables. Calls reach the tool already authenticated (`specs/mcp/transport.md`).

## Counts, oldest age and errors of both outboxes

```spec
now: 2026-11-21T12:00:00Z
given:
  - KycOutboxRow: { id: 1, chainId: 1, createdAt: 2026-11-21T11:00:00Z, processedAt: 2026-11-21T11:00:05Z, error: null }
  - KycOutboxRow: { id: 2, chainId: 1, createdAt: 2026-11-21T11:30:00Z, processedAt: null, error: "nonce too low" }
  - KycOutboxRow: { id: 3, chainId: 99000001, createdAt: 2026-11-21T11:50:00Z, processedAt: null, error: null }
  - YieldMintOutboxRow: { chainId: 1, loanId: 7, repaymentId: 1, status: confirmed, createdAt: 2026-11-21T10:00:00Z, lastError: null }
  - YieldMintOutboxRow: { chainId: 1, loanId: 7, repaymentId: 2, status: pending, createdAt: 2026-11-21T11:00:00Z, lastError: "bitgo: 503" }
  - YieldMintOutboxRow: { chainId: 1, loanId: 8, repaymentId: 1, status: pending, createdAt: 2026-11-21T11:10:00Z, lastError: null }
query:
  Queues: {}
then:
  kyc:
    unprocessed: 2
    oldestUnprocessedAgeSeconds: 1800
    recentErrors:
      - { id: 2, chainId: 1, error: "nonce too low" }
  yieldMint:
    byStatus: { confirmed: 1, pending: 2 }
    recentErrors:
      - { chainId: 1, loanId: 7, repaymentId: 2, status: pending, error: "bitgo: 503" }
```

## Empty outboxes report nothing pending

```spec
given: []
query:
  Queues: {}
then:
  kyc: { unprocessed: 0, oldestUnprocessedAgeSeconds: null, recentErrors: [] }
  yieldMint: { recentErrors: [] }
```

## Only the 20 most recent errors are returned

```spec
now: 2026-11-21T12:00:00Z
given:
  - KycOutboxRow: { id: 1, chainId: 1, createdAt: 2026-11-21T11:01:00Z, processedAt: null, error: "push failed 1" }
  - KycOutboxRow: { id: 2, chainId: 1, createdAt: 2026-11-21T11:02:00Z, processedAt: null, error: "push failed 2" }
  - KycOutboxRow: { id: 3, chainId: 1, createdAt: 2026-11-21T11:03:00Z, processedAt: null, error: "push failed 3" }
  - KycOutboxRow: { id: 4, chainId: 1, createdAt: 2026-11-21T11:04:00Z, processedAt: null, error: "push failed 4" }
  - KycOutboxRow: { id: 5, chainId: 1, createdAt: 2026-11-21T11:05:00Z, processedAt: null, error: "push failed 5" }
  - KycOutboxRow: { id: 6, chainId: 1, createdAt: 2026-11-21T11:06:00Z, processedAt: null, error: "push failed 6" }
  - KycOutboxRow: { id: 7, chainId: 1, createdAt: 2026-11-21T11:07:00Z, processedAt: null, error: "push failed 7" }
  - KycOutboxRow: { id: 8, chainId: 1, createdAt: 2026-11-21T11:08:00Z, processedAt: null, error: "push failed 8" }
  - KycOutboxRow: { id: 9, chainId: 1, createdAt: 2026-11-21T11:09:00Z, processedAt: null, error: "push failed 9" }
  - KycOutboxRow: { id: 10, chainId: 1, createdAt: 2026-11-21T11:10:00Z, processedAt: null, error: "push failed 10" }
  - KycOutboxRow: { id: 11, chainId: 1, createdAt: 2026-11-21T11:11:00Z, processedAt: null, error: "push failed 11" }
  - KycOutboxRow: { id: 12, chainId: 1, createdAt: 2026-11-21T11:12:00Z, processedAt: null, error: "push failed 12" }
  - KycOutboxRow: { id: 13, chainId: 1, createdAt: 2026-11-21T11:13:00Z, processedAt: null, error: "push failed 13" }
  - KycOutboxRow: { id: 14, chainId: 1, createdAt: 2026-11-21T11:14:00Z, processedAt: null, error: "push failed 14" }
  - KycOutboxRow: { id: 15, chainId: 1, createdAt: 2026-11-21T11:15:00Z, processedAt: null, error: "push failed 15" }
  - KycOutboxRow: { id: 16, chainId: 1, createdAt: 2026-11-21T11:16:00Z, processedAt: null, error: "push failed 16" }
  - KycOutboxRow: { id: 17, chainId: 1, createdAt: 2026-11-21T11:17:00Z, processedAt: null, error: "push failed 17" }
  - KycOutboxRow: { id: 18, chainId: 1, createdAt: 2026-11-21T11:18:00Z, processedAt: null, error: "push failed 18" }
  - KycOutboxRow: { id: 19, chainId: 1, createdAt: 2026-11-21T11:19:00Z, processedAt: null, error: "push failed 19" }
  - KycOutboxRow: { id: 20, chainId: 1, createdAt: 2026-11-21T11:20:00Z, processedAt: null, error: "push failed 20" }
  - KycOutboxRow: { id: 21, chainId: 1, createdAt: 2026-11-21T11:21:00Z, processedAt: null, error: "push failed 21" }
query:
  Queues: {}
then:
  kyc:
    unprocessed: 21
    recentErrors:
      - { id: 21, error: "push failed 21" }
      - { id: 20, error: "push failed 20" }
      - { id: 19, error: "push failed 19" }
      - { id: 18, error: "push failed 18" }
      - { id: 17, error: "push failed 17" }
      - { id: 16, error: "push failed 16" }
      - { id: 15, error: "push failed 15" }
      - { id: 14, error: "push failed 14" }
      - { id: 13, error: "push failed 13" }
      - { id: 12, error: "push failed 12" }
      - { id: 11, error: "push failed 11" }
      - { id: 10, error: "push failed 10" }
      - { id: 9, error: "push failed 9" }
      - { id: 8, error: "push failed 8" }
      - { id: 7, error: "push failed 7" }
      - { id: 6, error: "push failed 6" }
      - { id: 5, error: "push failed 5" }
      - { id: 4, error: "push failed 4" }
      - { id: 3, error: "push failed 3" }
      - { id: 2, error: "push failed 2" }
```

## A long error is cut to 500 characters

The stored error is 520 characters; the first 500 come back.

```spec
given:
  - YieldMintOutboxRow:
      chainId: 1
      loanId: 7
      repaymentId: 2
      status: failed
      createdAt: 2026-11-21T11:00:00Z
      lastError: "0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789\
        0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789\
        0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789\
        0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789\
        0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789\
        01234567890123456789"
query:
  Queues: {}
then:
  yieldMint:
    recentErrors:
      - loanId: 7
        error: "0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789\
          0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789\
          0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789\
          0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789\
          0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789"
```

## An unreachable database is reported, not hidden

```spec
given:
  - SourceDown: { source: db, error: connection refused }
query:
  Queues: {}
then:
  rejected: db_unavailable
```
