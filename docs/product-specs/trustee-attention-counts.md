# Trustee Attention Counts

## Overview

The Trustee sidebar shows a count badge on Origination, Loans and Cash Management. `GET /v1/attention-counts` serves those counts, so the frontend does no counting (wiring is #1350, TD-36). The route is Trustee-only and reads data the backend already stores. It has no table, no migration and no RPC call. Counts are JSON integers; there are no amounts.

## Behavior

**Chain scope.** `chain_id` follows the `GET /v1/loan-book` rule. Omitted means every configured chain. A configured id means that chain. A well-formed id outside `CHAINS` is `200` with zero counts, `null` nullable fields and `chains: []`. A malformed or repeated `chain_id` is `400`.

**Per-chain and combined.** The response carries the combined sections (sums over the in-scope chains) and a `chains[]` entry per chain in `CHAINS` order. Origination and Loans are cross-network pages and read the combined sections. Cash Management is per-network and reads the session chain's `chains[]` entry.

| Badge | `count` = | Breakdown served |
|---|---|---|
| Origination | `in_review + approved_undrawn` | `in_review` (stored `InReview`, no drawn `loan_id`), `changes_requested` (stored `ChangesRequested`, undrawn; waits on the originator, so not counted), `approved_undrawn` (stored `Approved`, `loan_id IS NULL`: approved, the draw not yet linked) |
| Loans | Distinct loans selected as the Loans page selects them (see Loan selection), whose status is neither `Closed` nor `Default` and whose display status is `WatchList`, `Past Due` or `Disbursing`, or that have an open margin call. A loan matching several conditions counts once | `watch_list`, `past_due`, `disbursing` (display statuses, as on `GET /v1/loan-book`), `margin_call_open` (`security_terms.margin_call_at <> 0` on a non-`Closed` loan; `null` when no in-scope chain has a SecurityRegistry), `defaulted` (raw `Default`; served, not counted: Risk Council domain) |
| Cash Management | `escrowed_wire_ins + pending_wire_outs + open_ramps + pending_ramp_events + pending_bank_deposits` (null terms skipped; one of the two ramp terms is `null`, see Ramp source) | `escrowed_wire_ins` (minter `WireIn` received by the minter, not assigned or returned), `pending_wire_outs` (`WireOutRequested` with no settle or cancel), `open_ramps` (`RampOpened` with no `RampClosed`, only on minter chains), `pending_ramp_events` (the pending list of `GET /v1/ramp/events`, only on chains without a minter), `pending_bank_deposits` |

The minter terms are `null` when the chain has no minter (every EVM chain). `pending_ramp_events` is also `null` when a chain without a minter has no custody and ramp address sets. The withdrawal queue is not counted.

**Ramp source.** A chain counts one ramp source, never both, so a ramp is never counted twice. With a minter configured (`CHAIN_<id>_STELLAR_API_MINTER_ADDRESS`), the open minter ramps count (`open_ramps`) and `pending_ramp_events` is `null`: the minter's own ramp lifecycle is the source of truth, and `GET /v1/ramp/events` reviews are not counted. Without a minter (every EVM chain, or Stellar without the key), the pending `GET /v1/ramp/events` list counts (`pending_ramp_events`) and `open_ramps` is `null`. The combined section sums each field over the chains that serve it.

**Pending bank deposits.** A deposit is pending when the Trustee recorded it in `lp_bank_deposits`, it is not minted (`is_minted = false`) and no on-chain `WireIn` carries its `ref_hash`: the Trustee still has to record it on-chain. A deposit whose `WireIn` is escrowed is already counted under `escrowed_wire_ins`, a Direct `WireIn` is already minted (the relayer has not flipped `is_minted` yet), and a returned one has a `WireIn`, so none of them counts here. This intentionally differs from the LP-facing `pending_bank_deposits` of #1285, which keeps escrowed wires pending for the LP. `lp_bank_deposits` has no `chain_id` (TD-117), so the figure is chain-agnostic until TD-117 adds one: the same number is in every `chains[]` entry (field and `count`) and once in the combined section. The `ref_hash` match uses JSON containment on `contract_logs.params`, so it needs the lowercase hex the indexer writes. The single repo function `LpBankDepositRepo::count_pending` is the one place to swap if a shared helper replaces it.

**Loan selection.** Loans are selected as the Loans page selects them: through `LoanTimeline` (legacy `LoanDefaulted` and `LoanClosed` events merged, `origination_date <= now`), so a loan the page does not show is never counted. Closed loans are skipped; Default loans are served as `defaulted` only.

**Union rules.** Combined sections are per-chain sums. A nullable field is `null` at the top only when it is `null` on every in-scope chain. `count` is never `null`. An EVM chain contributes its submissions, loan statuses and pending ramp events; its minter and margin-call fields are `null`.

**Known limits.** A submission targeting an unconfigured chain is not counted. A drawn submission that is still `InReview` (the #831 residual) is excluded by `loan_id IS NULL`. Open margin calls are matched to the chain's LoanRegistry snapshots by `loan_id`, as on `GET /v1/loan-book/{loan_id}/security`, and reflect the projection, not the chain. Any failing sub-read fails the whole response with `500`. The counts are recomputed per request (TD-174).

## API Contract

`GET /v1/attention-counts[?chain_id=<id>]`: bearer token with the `trustee` role (`401` without a token, `403` without the role, `400` for a malformed or repeated `chain_id`).

```json
{
  "origination": { "count": 2, "in_review": 2, "changes_requested": 1, "approved_undrawn": 0 },
  "loans": { "count": 3, "watch_list": 1, "past_due": 1, "margin_call_open": 1,
             "disbursing": 1, "defaulted": 0 },
  "cash_management": { "count": 5, "escrowed_wire_ins": 1, "pending_wire_outs": 1,
                       "open_ramps": 1, "pending_ramp_events": null,
                       "pending_bank_deposits": 2 },
  "chains": [
    { "chain_id": 99000001, "origination": { "...": "..." }, "loans": { "...": "..." },
      "cash_management": { "count": 5, "escrowed_wire_ins": 1, "pending_wire_outs": 1,
                           "open_ramps": 1, "pending_ramp_events": null,
                           "pending_bank_deposits": 2 } },
    { "chain_id": 560048, "origination": { "...": "..." },
      "loans": { "count": 1, "watch_list": 1, "past_due": 0, "margin_call_open": null,
                 "disbursing": 0, "defaulted": 0 },
      "cash_management": { "count": 2, "escrowed_wire_ins": null, "pending_wire_outs": null,
                           "open_ramps": null, "pending_ramp_events": 0,
                           "pending_bank_deposits": 2 } }
  ]
}
```

## Data Model

No table. Sources: `submitted_loans` (undrawn rows by `target_chain_id`), the latest LoanRegistry snapshots in `contract_logs`, `loan_disbursement`, `security_terms`, the minter `contract_logs` rows (`WireIn`, `WireInAssigned`, `WireInReturned`, `WireOutRequested`, `WireOutSettled`, `WireOutCancelled`, `RampOpened`, `RampClosed`), `AssetTransfer` rows with `ramp_reviews`, and `lp_bank_deposits`. Display statuses come from `routes::loan_book::display_status` and minter statuses from `minter_cash_book`, so the badges agree with the Loans page and `GET /v1/cash-book`.

## Security

Trustee-only, because it joins review state across Trustee queues. It writes nothing and makes no RPC call.
