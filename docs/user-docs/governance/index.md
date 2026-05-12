---
title: Overview
order: 24
section: Governance
---

# Overview

Pipeline's governance is split between off-chain and on-chain surfaces. The Trustee carries fiduciary authority off-chain. Three MPCs carry technical authority on-chain — ADMIN, RISK_COUNCIL, GUARDIAN. Neither side acts alone: the Trustee moves capital only on authenticated on-chain instructions, and the MPCs act only within the boundaries the trust deed and Risk Mandate define.

## The four governance surfaces

| Body | Type | Function |
|---|---|---|
| **Fiduciary trustee** | Off-chain legal entity | Acts in investor interests. Holds custody cosigner shares, signs YieldAttestations, instructs on-ramping, holds the USD account. |
| **Risk committee** | Off-chain governance body | Approves loans, reviews concentration, declares defaults, sets the WithdrawalQueue exchange coefficient in recovery. Expressed on-chain via RISK_COUNCIL. |
| **Multisig set** | On-chain MPCs | ADMIN (3/5, 3-day standard, 7-day upgrades, 14-day meta-timelock), RISK_COUNCIL (3/5, 3-day), GUARDIAN (2/5, instant). Distinct signer sets, non-overlapping powers, all routed through AccessManager. |
| **Operators** | Custody cosigners + Relayer | Day-to-day operations. |

## On-chain surface

| MPC | Threshold | Tempo | Powers |
|---|---|---|---|
| **ADMIN** | 3-of-5 | 3-day standard, 7-day upgrades, 14-day meta-timelock | Role grants and re-grants, unpauses, upgrades, parameter changes, attestor rotation |
| **RISK_COUNCIL** | 3-of-5 | 3-day timelock | `setDefault`, write-down closures, exchange-coefficient changes on the WithdrawalQueue |
| **GUARDIAN** | 2-of-5 | Instant | Pause any pausable contract, cancel pending scheduled actions, revoke named operational-role holders one at a time |

GUARDIAN can stop things instantly. Only ADMIN can start them again, and only after a window GUARDIAN can veto. RISK_COUNCIL operates between the two with credit-event tempo.

## Distinct signer sets

Each MPC carries a distinct signer set. Overlap collapses the separation: an attacker compromising a member on two MPCs pushes two roles' worth of authority. Enforced at signer-set construction and in the rotation playbook. Published signer registry is source of truth.

## Why the meta-timelock

Without it, ADMIN could call `setTargetAdminDelay(0)` under the 3-day delay, then immediately execute any hostile change. The 14-day meta-timelock gates the delay parameter itself. A captured ADMIN waits 14 days to unlock a faster lever — long enough for GUARDIAN, the community, or auditors to respond.
