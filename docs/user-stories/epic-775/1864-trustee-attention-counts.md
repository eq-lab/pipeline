# Issue #1864 — Per-section pending counts for the Trustee sidebar badges

## Story

As a Trustee, I need one call that tells me how many items wait for me in Origination, Loans and Cash Management, so the sidebar badges show real numbers. Spec: [trustee-attention-counts.md](../../product-specs/trustee-attention-counts.md).

## Test Cases

### A Trustee reads the counts for all chains

1. Call `GET /v1/attention-counts` with a Trustee token and no `chain_id`.
2. Confirm `200`, with `origination`, `loans` and `cash_management` sections of integer counts and a `chains` array in `CHAINS` order.
3. Confirm each combined `count` is the sum of the `chains[]` counts. Cash Management carries the chain-agnostic `pending_bank_deposits` in every entry and once in the combined count.

### A Trustee reads the counts for one chain

1. Call `GET /v1/attention-counts?chain_id=99000001`.
2. Confirm `chains` has one entry and the combined sections equal it.
3. Call it with a well-formed id outside `CHAINS` and confirm `200` with zero counts and `chains: []`.
4. Call it with `chain_id=abc` and with `chain_id` twice and confirm `400`.

### Access control

1. Call the route with no token and confirm `401`.
2. Call it with a non-Trustee token and confirm `403`, with or without `chain_id`.

### Counts match the pages they badge

On pipeline-test (Stellar 99000001 and Hoodi 560048), read these at the same time:

1. `GET /v1/loan-book/submissions`: `origination.in_review` equals the undrawn `InReview` rows and `approved_undrawn` the undrawn `Approved` rows.
2. `GET /v1/loan-book`: `loans.watch_list`, `past_due` and `disbursing` equal the rows with those display statuses; `loans.count` also includes loans with an open margin call.
3. `GET /v1/cash-book?chain_id=99000001`: the chain's `escrowed_wire_ins`, `pending_wire_outs` and `open_ramps` match the `Escrowed`, `Pending` and `Open` rows, and `pending_ramp_events` is `null` (the minter chain counts open ramps, not review events).
4. `GET /v1/lps/{id}/bank-deposits`: `pending_bank_deposits` equals the recorded deposits that are not minted and have no on-chain `WireIn` for their reference hash.

### EVM keeps working

1. In the Hoodi `chains[]` entry, confirm `escrowed_wire_ins`, `pending_wire_outs`, `open_ramps` and `margin_call_open` are `null`.
2. Confirm its submission and loan figures are numbers, `pending_ramp_events` equals the length of `GET /v1/ramp/events?chain_id=560048`, and `pending_bank_deposits` is the same number as in the Stellar entry.
