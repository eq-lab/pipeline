# User Stories: #1413 — Per-LP bank deposits

Epic: [#1269 — Trustee LP Counterparties](https://github.com/eq-lab/pipeline/issues/1269)
Issue: [#1413](https://github.com/eq-lab/pipeline/issues/1413)
Spec: [Trustee Dashboard](../../product-specs/trustee-dashboard.md)

Backend-only. Exercise `GET`/`POST /v1/lps/{id}/bank-deposits` against a live API with a trustee
bearer token; no UI ships with this issue. `POST /v1/lp-ledger/deposits` is gone — a call to it
answers 404 (no route). `GET /v1/lp-ledger` is unchanged.

## Story 1: Record a received wire against an LP

With a trustee token, post
`{"amount":"50000.00","payment_reference":"WIRE-REF-1","occurred_at":"2026-10-05T15:41:00Z"}`
to an existing LP. The response is 201 and carries the stored deposit: `lp_id` equal to the path id
(never a body value), `recorded_by` equal to the token's `sub`, `amount` as `"50000.00"`,
`occurred_at` as ISO-8601 UTC, `created_at` as the UTC moment of the write, and a non-null
`lp_ledger_id`. The body carries no `dealing_date` on the way in or out — the paired ledger row is
priced at `occurred_at`. Post the same instant with an offset instead (`2026-10-05T18:41:00+03:00`):
the response comes back as the same `2026-10-05T15:41:00Z`. A reference with surrounding whitespace
comes back trimmed. `is_minted` is `false` — nothing mints yet.

## Story 2: The reference carries its on-chain key

Every response, from both halves, carries `ref_hash`: 64 lowercase hex characters, equal to
`sha256` of the stored (trimmed) `payment_reference` — check it with
`printf 'WIRE-REF-1' | shasum -a 256`. A reference posted with padding hashes to the same value as
the clean one. This is the `ref_hash: BytesN<32>` the Stellar minter's `record_wire_in` consumes, so
it must never be 32 zero bytes; a non-empty reference cannot produce that.

## Story 3: Each deposit lands in the claim ledger too

After each successful post, `GET /v1/lp-ledger?lp_id=<id>` shows `committed` and `balance` grown by
the posted amount, and `GET /v1/lps/{id}/bank-deposits` returns the deposit. The deposit body itself
carries no ledger id and no transaction hash. Deposits list newest-`occurred_at` first, ties broken
by newest id. An LP with no recorded wires returns `{"deposits":[]}`, not 404. Deposits recorded
against one LP never appear under another.

## Story 4: Malformed entry is refused before anything is written

Post each of: a non-numeric `amount`, `"0"`, `"-50000.00"`, `"50000.001"` (finer than cents),
`"1000000000000001"` (above the quadrillion bound), an `occurred_at` of `"yesterday"`,
`"1790000000"`, `"2026-10-05"`, `"2026-10-05T15:41:00"` (no offset) and `"2026-13-05T15:41:00Z"`,
and a `payment_reference` that is missing, empty, or whitespace-only. Each answers 400 naming the
offending field. `"50000.000"` and `"50000"` are accepted — both are whole cents. After every
refusal, the LP's deposit list and its `GET /v1/lp-ledger` summary are unchanged: no deposit row,
no ledger row.

## Story 5: The same wire cannot be recorded twice

Post a wire, then post it again with the same `payment_reference` — same amount or different, same
LP or another one. The second answers **409**, and the LP's list still shows one deposit with
`committed` counting the amount once. A different reference for the same amount and instant is
accepted: two genuine same-day wires are still two deposits. This replaces the duplicate-entry gap
TD-113 described — the reference's uniqueness is the double-submit guard.

## Story 6: Both halves are trustee-only and LP-scoped

Call `GET` and `POST` with no token (401), with an expired token (401), and with a non-trustee
token (403). With a trustee token, call both against an id that is not an LP: 404 naming the id.
A 403, 404 or 409 on `POST` writes nothing — neither a deposit row nor a ledger row.
