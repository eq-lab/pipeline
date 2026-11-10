# Minter Cash Book

## Overview

The Stellar minter holds the protocol's off-chain bank cash: wires in, wires out, loan disbursements and repayments, and USDC/bank ramps. The API rebuilds that cash book from the minter events the indexer stores in `contract_logs`, with no RPC call. `GET /v1/cash-book` serves the totals (`bank_cash`, `in_flight`) and the wire-in, wire-out and ramp lists to the Trustee. The LP's own wire-ins and wire-outs ride on `GET /v1/requests`. `GET /v1/capital-allocation` can read its Stellar `in_transit` and `trust_account` from the same fold, behind a per-chain switch that is off by default.

Scope is Stellar only. An EVM chain has no minter address configured and no cash book.

## Behavior

**Scope.** Every fold and list is scoped by `(chain_id, contract_address)`, where the address is `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS`. It must equal the indexer's `CHAIN_<id>_STELLAR_INDEXER_MINTER_ADDRESS`.

**Checkpoint.** The totals read only the latest `MinterSnapshot`, the events after it and every `RampOpened` (for ramp direction), in chain order, so the cost does not grow with history. The permissionless minter `snapshot()` emits the pool state, which the indexer stores as `MinterSnapshot`. The fold starts from `bank_cash` and `in_flight` of the latest valid snapshot, ordered by `(block_number, log_index)`, and applies only the events strictly after it, including later events in the same ledger. A snapshot is valid when its params parse; the fold takes the latest stored one.

**Fold rules** (raw 7-decimal values):

| Event | `bank_cash` | `in_flight` |
|---|---|---|
| `WireIn` (direct or escrowed) | `+amount` | |
| `CashDisbursementReversed` | `+amount` | |
| `CashRepaid` | `+cash` | |
| `CashRecorded` (any reason) | `+delta`, signed as emitted | |
| `RampOpened` `BankToUsdc` | `−amount` | `+amount` |
| `RampOpened` `UsdcToBank` | | `+amount` |
| `RampClosed` of a `UsdcToBank` ramp | `+received` | `−(received + loss)` |
| `RampClosed` of a `BankToUsdc` ramp | | `−(received + loss)` |
| `WireInReturned` | `−amount` | |
| `CashDisbursed` | `−amount` | |
| `CashRepaymentReversed` | `−cash` | |
| `WireOutSettled` | `−amount` | |

`WireInAssigned`, `WireOutRequested`, `WireOutCancelled`, `MintCorrected` and `LossAbsorbed` have no cash effect. `RampClosed` carries neither amount nor direction, so the direction comes from the `RampOpened` with the same id, which is looked up over all indexed history, not only after the checkpoint.

**`complete`.** `summary.complete` is `true` iff a valid `MinterSnapshot` exists for the chain's minter and every post-checkpoint event folds cleanly. It is `false` when:

- no valid snapshot is indexed;
- an amount does not parse;
- a ramp direction is unknown;
- a `RampClosed` has no indexed `RampOpened`;
- `received + loss` differs from the opened amount.

`bank_cash` and `in_flight` are always served, never `null`; when `complete` is `false` they are partial.

`complete` means no gap since the latest snapshot the indexer stored. It is not proof that no event was dropped: a minter event the worker could not decode is logged and skipped while the cursor advances, and the fold cannot see it. Call `snapshot()` again before setting the Capital Allocation switch and compare the new snapshot's `bank_cash` / `in_flight` with the fold; a difference means an event was missed.

**Lists.** `wire_ins`, `wire_outs` and `ramps` are built from the whole indexed history, newest on-chain id first. They can be partial before the indexer's coverage starts, which `complete` does not claim to cover. A follow-up event whose origin is not indexed is folded into the totals but left out of the lists.

**Statuses.**

- Wire-in: `Direct` (receiver is not the minter), `Escrowed` (receiver is the minter), `Assigned` (receiver replaced, `assigned_at` set), `Returned` (`returned_at`, `return_ref_hash` set).
- Wire-out: `Pending`, `Settled`, `Cancelled`.
- Ramp: `Open`, `Closed`; `direction` is `UsdcToBank` or `BankToUsdc`.

**Units.** Folds run on raw 7-decimal integers. The final totals and every listed amount are floored to 6 decimals (`÷10`) and rendered as dollar strings, e.g. raw `12345678` is `"1.234567"`. The on-chain `bank_cash` / `in_flight` compare as `floor(onchain / 10)`.

**Capital Allocation switch.** With `CHAIN_<id>_STELLAR_API_CAPITAL_ALLOCATION_FROM_MINTER=true` and a `complete` fold, that chain's `in_transit` is `in_flight` and its `trust_account` contribution is `bank_cash` in dollars. Its Trustee-entered `loan_capital_transfers` trust-account and on/off-ramp figures stop counting; `deployed` is unchanged. With an incomplete fold the chain keeps its legacy sources and the API logs a warning. EVM chains always use their legacy sources, and the endpoint still sums across chains.

**Operations.** After a worker release that indexes `MinterSnapshot`, call `snapshot()` once on the network's minter. A snapshot emitted under an older worker is lost and must be emitted again. Turn the switch on only when a `MinterSnapshot` row exists, `summary.complete` is `true`, and the summary matches the on-chain `bank_cash` / `in_flight` read at the same ledger.

## API Contract

`GET /v1/cash-book?chain_id=<id>`: bearer token with the `trustee` role (`403` otherwise). `chain_id` is required (`400` when missing, malformed or not in `CHAINS`). A chain with no minter address, including every EVM chain, answers `404 {"error":"minter_not_configured"}`.

```json
{ "chain_id": 99000001, "minter": "C...",
  "summary": { "bank_cash": "0.000000", "in_flight": "0.000000", "complete": true,
               "checkpoint_ledger": 123, "as_of_ledger": 456 },
  "wire_ins":  [{ "id": 1, "status": "Escrowed", "receiver": "C...", "amount": "0.000000",
                  "value_date": "ISO", "ref_hash": "hex", "recorded_at": "ISO",
                  "assigned_at?": "ISO", "returned_at?": "ISO", "return_ref_hash?": "hex" }],
  "wire_outs": [{ "id": 1, "status": "Pending", "lp": "G...", "lp_id?": 7, "lp_legal_name?": "...",
                  "amount": "0.000000", "requested_at": "ISO", "settled_at?": "ISO",
                  "value_date?": "ISO", "ref_hash?": "hex", "cancelled_at?": "ISO",
                  "bank_account?": { "account_holder_name": "...", "bank_name": "...", "bank_address": null,
                                    "account_number": null, "iban": null, "swift_bic_code": null,
                                    "routing_number": null } }],
  "ramps":     [{ "id": 1, "status": "Open", "direction": "UsdcToBank", "amount": "0.000000",
                  "opened_at": "ISO", "open_ref_hash": "hex", "received?": "0.000000",
                  "loss?": "0.000000", "closed_at?": "ISO", "close_ref_hash?": "hex" }] }
```

`as_of_ledger` is the last ledger the indexer has fully covered (its stored cursor holds the next ledger, so the API reports it minus one); the cursor is read before the events, so the fold never claims ledgers it lacks. A wire-out's `lp_id` and `lp_legal_name` come from the LP whose link to that Stellar address was active at the wire-out's `requested_at` (linked at or before it and not replaced by a later link of the same LP before it), on the same chain or a legacy link with no recorded chain, so a relinked LP keeps its earlier wire-outs; both are absent when no link was active. The `trustee` role is required because the response joins on-chain addresses to LP accounts. The Trustee console's Escrowed wires tab (#1763) reads `wire_ins` with `status = Escrowed` ([deposits.md](./deposits.md#escrowed-wires)). `bank_account` is the resolved LP's current settlement bank account in full ([kyb-lp-verification.md](./kyb-lp-verification.md#settlement-bank-account)), on `Pending` rows only, so the Trustee settles from the row; settled and cancelled rows and rows with no resolved LP omit it.

`GET /v1/requests` gains an optional `wire_outs` list beside `requests`: the wallet's own wire-outs on the in-scope chains that have a minter address, as `{ chain_id, id, status, amount, requested_at, settled_at?, value_date?, ref_hash?, cancelled_at? }`, newest first. With `status=pending` only `Pending` ones are kept. The key is omitted when no in-scope chain has a minter address, so EVM-only responses are unchanged. `requests[]` gets no new `type` value.

`GET /v1/requests` also gains an optional `wire_ins` list (#1314): the wallet's own wire-ins on the same in-scope minter chains, as `{ chain_id, id, status, amount, value_date, ref_hash, recorded_at, assigned_at? }`. `status` is `Direct` (the `WireIn` receiver is the wallet) or `Assigned` (an escrowed wire later `WireInAssigned` to the wallet, with `assigned_at`). An escrowed wire shows only once assigned to the wallet and never if returned, since the contract returns only escrowed wires, so a returned wire never had an LP receiver. Newest first by `assigned_at`, else `recorded_at`, then `chain_id` and `id`. With `status=pending` the list is empty and no query runs, because both states are terminal and the PLUSD is staked in the same call; the not-yet-minted bank deposit is the `pending_bank_deposits` total on `GET /v1/lps/me`. The key is omitted when no in-scope chain has a minter address, and a failed lookup is logged and omits it. The wallet is upper-cased before matching the stored strkey, as for `wire_outs`. The lookup filters only with `params @>` containment, which the GIN index `idx_contract_logs_params` can serve (not yet confirmed with `EXPLAIN` on testnet data); an assigned wire whose `id` is not a plain integer is skipped instead of failing the query. A wallet equal to the minter address returns no rows.

## Data Model

No table. `MinterSnapshot` is an `event_name` in `contract_logs`, with params `ledger`, `bank_cash`, `in_flight`, `outstanding_total`, `unabsorbed_total`, `total_assets` (decimal strings, raw 7-decimal) and `read_failed` (JSON bool). The snapshot's `custody` list is not stored. The fold reads these minter rows: `WireIn`, `WireInAssigned`, `WireInReturned`, `CashDisbursed`, `CashDisbursementReversed`, `CashRepaid`, `CashRepaymentReversed`, `WireOutRequested`, `WireOutSettled`, `WireOutCancelled`, `RampOpened`, `RampClosed`, `CashRecorded`, `MinterSnapshot`. Event params are in [backend.md](../references/backend.md#stellar-soroban-events). `WireIn` / `WireInAssigned` keep `params.id` as a JSON number and the others as a string; the fold reads both.

## Security

The cash book is Trustee-only. The API makes no RPC call and writes nothing. `snapshot()` is permissionless and only emits the minter's own state; a snapshot never changes a total by itself, it only moves the fold's starting point.
