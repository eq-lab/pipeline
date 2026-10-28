# API Authorization — Loan Submission

## Overview

Originators submit loan applications that trustees review before a loan is drawn
on-chain. The flow is intentionally two-staged: submission only **persists and
validates** the application; calling `draw_loan` on an approved submission is a
separate, later step (not yet wired).

**Lifecycle.** A submission is `InReview` on insert. `Approved` and `Rejected`
are terminal — no further review is accepted once either is reached.
`ChangesRequested` is **non-final**: a submission left `ChangesRequested` can be
reviewed again, moving to `Approved`, `Rejected`, or another round of
`ChangesRequested`.

```
InReview ──────────approve──────────▶ Approved (terminal)
         ──────────reject───────────▶ Rejected (terminal, carries a reason)
         ──request changes──▶ ChangesRequested (carries a reason) ─┐
              ▲                                                    │
              └───────────── request changes again ────────────────┘
ChangesRequested ──approve─────────▶ Approved (terminal)
                 ──reject──────────▶ Rejected (terminal, carries a reason)
                 ──resubmit────────▶ InReview (originator replaces the payload)
```

Only `InReview` or `ChangesRequested` submissions can be reviewed; reviewing a
submission already `Approved`/`Rejected` returns `409 Conflict`. Each new review
decision overwrites the single `reason` column — there is no history of prior
`ChangesRequested` feedback text.

**Resubmission.** When a trustee requests changes, the originator acts on the
feedback via `POST /v1/loan-book/submissions/{id}/resubmit` — the counterpart to
the trustee's review action. It carries the full submission payload (same shape as
`POST /v1/loan-book/loan`), re-runs the same validation, and does a full replace of
`loan_data`, the valuation anchor, and the fee schedule, then resets the submission
to `InReview` (clearing `reason`) for another review round. Only `ChangesRequested`
submissions may be resubmitted: `InReview` is already open, and the terminal
`Approved`/`Rejected` states return `409 Conflict`. There is no partial edit — a
resubmission is a complete new payload.

**Target chain.** Each submission has a `target_chain_id`: the chain it is meant to be
drawn on. It is set at submission from the required `?chain_id` query parameter
(missing, malformed, or an id not in `CHAINS` returns `400`; checked before the token), is not part of
`loan_data`, and is kept on resubmit. `GET /v1/loan-book/submissions` is public: omitted
`chain_id` returns all rows, a configured id filters by target, a well-formed id not in
`CHAINS` returns `200` with an empty list, and a malformed or repeated one returns `400`.
The Trustee form always sends the target chain (#1536). When the indexer sees `LoanDrawn`, it links the
submission by `metadata_uri` only if the draw chain equals `target_chain_id`. A draw on
another chain leaves the submission unlinked and is logged at `warn`; so is a draw whose
`(chain_id, loan_id)` is already linked to another submission. The submission link is not
registry-scoped (TD-150).

**Payload.** `POST /v1/loan-book/loan` carries every input to the on-chain
`draw_loan`: the holder `to`, the on-chain `metadata_uri`, the off-chain metadata
document fields (`originator`, `borrower_id`, `commodity`, `corridor`,
`governing_law`, `protection`, optional `secondary_metadata_uri`, and
`documents` — an array of `{ name, uri }` links such as the Agreement,
License, and Terms & Conditions), the
`economics` block (`ImmutableLoanData` — base-6 USDC amount strings, bps rate,
origination/maturity timestamps), `initial_ccr`, and `initial_location`
(`LocationUpdate`). The whole payload is stored verbatim as JSONB. Submission
validation mirrors the contract invariants: tranches sum to the facility size,
maturity is after origination, offtaker price covers the facility, `initial_ccr`
is at least `1_000_000` (100 %), and `location_type` is one of
`Vessel`/`Warehouse`/`TankFarm`/`Other`.

`submitted_loans` — one row per application:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGINT` (identity) | surrogate PK — the submission id used by the review endpoint. **Not** the on-chain `loan_id`, which does not exist until the loan is drawn |
| `loan_data` | `JSONB` | the full submitted payload, verbatim |
| `status` | `TEXT` | `InReview` \| `Approved` \| `Rejected` \| `ChangesRequested` (CHECK-constrained) |
| `reason` | `TEXT` | rejection/feedback reason; present **iff** `status IN (Rejected, ChangesRequested)` (CHECK-enforced) |
| `originator` | `TEXT` | the submitter's authenticated address (JWT `sub`) |
| `target_chain_id` | `BIGINT NOT NULL` | chain the submission is meant to be drawn on; set at submission, kept on resubmit |
| `chain_id` / `loan_id` | `BIGINT` / `NUMERIC(78,0)` | drawn pointer, `NULL` until the loan is drawn and linked; `chain_id` must equal `target_chain_id` when set (CHECK); unique on `(chain_id, loan_id) WHERE loan_id IS NOT NULL` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | bookkeeping |

The `originator` / `trustee` roles are granted via `auth_users.roles` (seeded
manually like any other role).

The endpoint contract is in [api-authorization.md](./api-authorization.md#api-contract).
