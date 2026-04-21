# Audit Logging

## Overview

Every privileged action executed by the bridge service is recorded in an append-only audit log. The log is the authoritative operational record for the protocol and is retained for the lifetime of the protocol.

## Log Structure

Each log entry captures:

| Field | Description |
|---|---|
| `timestamp` | Wall-clock time of the action |
| `action_type` | Categorised action label (see categories below) |
| `trigger` | The triggering on-chain event or trustee signature that authorised the action |
| `tx_hash` | On-chain transaction hash of any resulting blockchain transaction (null for off-chain-only actions) |
| `invariant_before` | State of the relevant invariant before the action |
| `invariant_after` | State of the relevant invariant after the action |
| `input_parameters` | Full input parameters passed to the action |

## Action Categories

| Category | Description |
|---|---|
| `deposit_mint` | PLUSD minted in response to a USDC Transfer event from a whitelisted LP |
| `yield_mint` | PLUSD minted in response to a trustee-signed RepaymentSettled or TreasuryYieldDistributed event |
| `lp_payout` | USDC outflow from the Capital Wallet to an LP destination address, triggered by a WithdrawalQueue fill |
| `usdc_usyc_swap` | Automated USDC ↔ USYC conversion executed by the bridge under the band-keeping rules |
| `loan_disbursement_preparation` | Bridge preparation of the Capital Wallet outflow transaction in response to a LoanMinted event (prior to trustee + team co-signature) |
| `loan_registry_mutation` | Any call to LoanRegistry: mintLoan, updateMutable, setDefault, closeLoan |
| `notification_dispatch` | Emission of a notification event to one or more recipients (watchlist, margin call, payment delay, AIS blackout, CMA discrepancy, status transition) |

## Purposes

The audit log serves three distinct purposes:

1. **Incident investigation.** Every symptom observed on-chain or off-chain can be traced back to the causing bridge action, the triggering event, and the full input state at that moment.

2. **Compliance evidence.** Every PLUSD mint and every Capital Wallet outflow is traceable to a specific authorised trigger (an on-chain event or a trustee signature). This satisfies the traceability requirement for regulatory and counterparty compliance review.

3. **Audit substrate.** The Tier 1 auditor consumes the log to verify that operational behaviour matches the specified design — that auto-signing occurred only within the pre-authorised patterns and that invariants held across all state transitions.

## Third-Party Log Sink

The audit log is mirrored in near-real-time to an independent third-party log sink operating outside the bridge service's infrastructure. The sink is either:
- A separate cloud account managed by the Pipeline Trust Company (trustee-managed), or
- A dedicated SIEM service.

Properties of the sink:
- **Append-only write access.** The bridge service can only append to the sink; it cannot modify or delete historical entries.
- **No-delete guarantee.** The sink configuration enforces immutability. Even a full compromise of the bridge service infrastructure cannot retroactively alter the log record.
- **Real-time mirroring.** Entries are pushed to the sink as they are written — not in batches — so the gap between the bridge log and the sink is minimised.

## Retention

Retention period is the lifetime of the protocol. No entries are deleted or archived to a lower-fidelity store.

## Scope

The audit log covers bridge service actions only. Operator actions taken by team members, trustees, and originators inside the Operations Console are also logged to the same append-only store, with the actor's authenticated session identifier, the target resource, and the outcome recorded for each action.
