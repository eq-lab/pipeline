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
resubmission is a complete new payload. Only the originator who made the submission
(`originator` = token `sub`) may resubmit it: a submission that does not exist and one
owned by another originator both return `404`, so ids are not confirmed to other
originators; the UPDATE also filters on `originator`.

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

**Payload.** `POST /v1/loan-book/loan` carries the on-chain `metadata_uri`, the
off-chain metadata document fields (`originator`, `borrower_id`, `commodity`,
`corridor`, `governing_law`, `protection`, optional `secondary_metadata_uri`, and
`documents` — an array of `{ name, uri }` links such as the Agreement, License, and
Terms & Conditions), the `economics` block (human-unit USDC decimal strings with at
most 6 fractional digits, bps rate, origination/maturity timestamps), an optional
`data_room_id` (required in a later release), `collateral_valuation` and
`fee_schedule`. `to`, `initial_ccr` and `initial_location` are deprecated: still
accepted and stored verbatim when sent, never validated, and not `draw_loan` inputs.
The whole payload is stored verbatim as JSONB. `data_room_id` is trimmed at ingest and
an empty value is treated as absent. Submission validation mirrors the three contract
invariants (tranches sum to the facility size, maturity is after origination, offtaker
price covers the facility) plus the valuation and fee-schedule checks.

### `draw_loan` arguments

`POST /loan` (`201`), `POST /resubmit` (`200`) and each item of `GET /submissions`
carry a contract-ready `draw_loan` block, derived at read time from `loan_data`:

```json
"draw_loan": {
  "metadata_uri": "ipfs://…",
  "economics": {
    "borrower_ref": "aeaa7d34…d5d7",
    "original_facility_size": "1000000000000",
    "original_senior_tranche": "800000000000",
    "original_equity_tranche": "200000000000",
    "original_offtaker_price": "1050000000000",
    "senior_interest_rate": 120000,
    "origination_date": 1700000000,
    "original_maturity_date": 1715000000
  },
  "missing_inputs": []
}
```

The `economics` keys are exactly the 8 fields of the Stellar loan-registry
`ImmutableLoanData`; `draw_loan(metadata_uri, economics)` is called through
`access_manager.execute`.

| Field | Served as | Unit |
|-------|-----------|------|
| `original_*` money | plain integer string | u128, 7-decimal base units (USDC-SAC / PLUSD scale): human amount × 10^7, never rounded |
| `senior_interest_rate` | JSON number | u32 fixed point with `ONE = 1_000_000` = 100 %/yr, i.e. `senior_interest_rate_bps × 100` |
| `origination_date`, `original_maturity_date` | JSON number | u64 unix seconds |
| `borrower_ref` | 64 lowercase hex, no `0x` | `sha256(UTF-8 bytes of the trimmed data_room_id)`, computed at read time and never stored |

- **Stellar targets only.** The block is `null` for an EVM target until #1573 decides the EVM shape, and `null` when the submission's `target_chain_id` is not in `CHAINS`.
- **`missing_inputs`.** Any input that is absent or not representable in the contract type (a negative or non-numeric amount, more than 7 fractional digits, above `u128::MAX`, a rate overflowing `u32`) is served as `null` and its name is listed, in this order: `metadata_uri`, `data_room_id`, `economics.original_facility_size`, `economics.original_senior_tranche`, `economics.original_equity_tranche`, `economics.original_offtaker_price`, `economics.senior_interest_rate_bps`, `economics.origination_date`, `economics.original_maturity_date`. The names are the input keys the submitter must fix.
- **Amount format.** An amount must match `^\d+(\.\d+)?$` (no sign, exponent, underscore, leading dot or trailing dot) with at most 39 integer digits and at most 7 fractional digits to be served; `POST /loan` and `POST /resubmit` reject an amount with more than 6 fractional digits or outside that format (`400`, naming the field).
- **Drawn or rejected.** `draw_loan` in `GET /submissions` is `null` once the submission is drawn (`loan_id` set) or `Rejected`.
- **Do not draw while `missing_inputs` is non-empty.** Economics of rows submitted before #1620 may be in base units; such rows carry no `data_room_id`, report `missing_inputs`, and must be resubmitted through the current UI.
- **Existing rows are not migrated.** Rows without `data_room_id` serve `borrower_ref: null` and `missing_inputs: ["data_room_id"]`.
- **Public exposure.** `GET /submissions` is public, so `data_room_id` in `loan_data` is served verbatim, like `borrower_id`.
- **Rollout.** Step 1 (this change) makes `data_room_id` optional and serves the block; step 2, after the frontend follow-up #1805 is deployed, makes `data_room_id` required.

`submitted_loans` — one row per application:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGINT` (identity) | surrogate PK — the submission id used by the review endpoint. **Not** the on-chain `loan_id`, which does not exist until the loan is drawn |
| `loan_data` | `JSONB` | the full submitted payload, verbatim; may carry `data_room_id` (trimmed) |
| `status` | `TEXT` | `InReview` \| `Approved` \| `Rejected` \| `ChangesRequested` (CHECK-constrained) |
| `reason` | `TEXT` | rejection/feedback reason; present **iff** `status IN (Rejected, ChangesRequested)` (CHECK-enforced) |
| `originator` | `TEXT` | the submitter's authenticated address (JWT `sub`) |
| `target_chain_id` | `BIGINT NOT NULL` | chain the submission is meant to be drawn on; set at submission, kept on resubmit |
| `chain_id` / `loan_id` | `BIGINT` / `NUMERIC(78,0)` | drawn pointer, `NULL` until the loan is drawn and linked; `chain_id` must equal `target_chain_id` when set (CHECK); unique on `(chain_id, loan_id) WHERE loan_id IS NOT NULL` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | bookkeeping |

The `originator` / `trustee` roles are granted via `auth_users.roles` (seeded
manually like any other role).

The endpoint contract is in [api-authorization.md](./api-authorization.md#api-contract).
