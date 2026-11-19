# Loan Security State — EVM

## Overview

The EVM chains serve `GET /v1/loan-book/{loan_id}/security` and the loan-book LTV fields from the same code as Stellar ([loan-security-state.md](./loan-security-state.md), #1940, epic #1937). This page lists the differences; everything else is identical.

## Differences

Identical on both chains: the route, the 400 / 404 / 500 rules, every Stellar key and its meaning, the `refresh_pending` rule and the staleness rules. The log-address sets differ: the loan's own rows are checked against `[registry, nft]` on EVM and `[registry]` on Stellar, and the valuation check adds the loan registry (`[registry, nft, loan_registry]` on EVM, `[registry, loan_registry]` on Stellar).

| Area | Stellar | EVM |
|---|---|---|
| Config keys | one: `CHAIN_<id>_STELLAR_API_SECURITY_REGISTRY_ADDRESS` | two, set together: `CHAIN_<id>_EVM_API_SECURITY_REGISTRY_ADDRESS` and `CHAIN_<id>_EVM_API_SECURITY_RECORD_NFT_ADDRESS`. The RecordNft events are stored under the RecordNft address, so `refresh_pending` needs it |
| Amount, quantity, grade and price strings | 7 dp, `raw / 1e7` | 6 dp, `raw / 1e6` (`PAR_VALUE = 1_000_000`; PLUSD has 6 decimals). The grade scale is assumed to be the quantity's |
| Per-record value, `agent_release`, suggested mark | `1e7` | `1e6` |
| `agent_release` debt | `outstanding + accrued_interest` | the snapshot's `debt`, the Reader's `_facilityDebt`: `ceil((outstanding + accrued) × originalFacilitySize / originalSeniorTranche)`, or the pool debt when the senior tranche is 0. `valuation.debt` is therefore larger than `outstanding + accrued_interest` whenever the senior tranche is below the facility. The served `ltv_bps` and `coverage_bps` are the contract's, verbatim |
| `terms.default_ratio_bps`, `terms.originator_fee_rate` | `null` | served (`originator_fee_rate` is on the 1e6 economics scale, like `default_rate`) |
| `default_breach` | `null` | served when terms exist |
| Address text | Strkey | EIP-55 |
| `pending_operations` | served (#1922), `args_xdr` | served (#1941), `calldata` |

On EVM an expired pending operation can still be canceled (OpenZeppelin `cancel` checks only that the schedule exists), which closes the row and removes it from `pending_operations`.

`loan_id` stays a `u32` on both chains: an EVM id above `u32::MAX` answers `400`.

**`default_breach`.** The `DefaultBreach`, `DefaultBreachPriceStale` and `DefaultBreachCleared` events and `Terms.defaultBreachAt` exist only on EVM. They are served apart from the margin call: breach rows never appear in `margin_call.events`, and `margin_call.last_price_stale` ignores `default_breach_price_stale`.

| Field | Type | Source |
|---|---|---|
| `open` | `bool` or `null` | `security_terms.default_breach_at != 0`; `null` when the column is `NULL` or cannot be decoded |
| `opened_at` | string or `null` | `default_breach_at` while open |
| `last_default_breach_ltv_bps` | `u32` or `null` | the last `default_breach` event |
| `last_price_stale` | `{ltv_bps, at}` or `null` | the last `default_breach_price_stale` event |
| `ltv_above_ratio_no_onchain_breach` | `bool` or `null` | computed: no breach open, loan not `Closed`, a valuation exists and `valuation.ltv_bps > default_ratio_bps`; `null` without `default_ratio_bps` or `open` |
| `open_breach_clearable` | `bool` or `null` | computed: a breach is open, a valuation exists and `valuation.ltv_bps <= default_ratio_bps` (the contract clears at `ltvBps <= defaultRatioBps`, `_signalOrClearDefaultBreach`); `null` without `default_ratio_bps` or `open` |
| `events[]` | list | `security_margin_call_events` rows of kind `default_breach`, `default_breach_price_stale`, `default_breach_cleared`, each `{kind, ltv_bps, default_ratio_bps, at, block_number, tx_hash}`, in order |

The loan book and the attention counts do not carry the default breach.

## Audit log

The EVM `Security*` rows render in `GET /v1/audit-log` with 6 dp amounts, and the three `SecurityDefaultBreach*` names are EVM only. Renderings: [audit-logging.md](./audit-logging.md).

## Contract references

`pipeline-contracts@150631a`: `_requireReleasable` (`src/securityRegistry/SecurityRegistryUpgradeable.sol:601`), `_facilityDebt` (`:652`), `_ltvBps` (`:708`), `_signalOrClearDefaultBreach` (`:452`) and the Reader's `coverageDetail` (`src/PipelineSecurityRegistryReader.sol:75`).
