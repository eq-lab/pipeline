---
title: Governance
order: 14
section: Security & Transparency
---

# Governance

Three MPC multisigs hold every privileged role across the protocol. Their powers do not overlap. Their signer sets are operationally required to be distinct. Every privileged write routes through the AccessManager hub, which schedules timelocked actions and enforces role gating on every selector.

{% include diagram.html src="d8-governance.svg" caption="Three MPCs with distinct signer sets. ADMIN 3/5 (3d standard, 7d upgrades, 14d meta-timelock). RISK_COUNCIL 3/5 (3d). GUARDIAN 2/5 (instant)." %}

## Three MPCs, three roles, three tempos

| MPC | Threshold | Tempo | Powers |
|---|---|---|---|
| **ADMIN** | 3/5 | 3-day timelock (7d upgrades, 14d meta) | Role grants and re-grants, unpauses, upgrades, parameter changes, attestor rotation |
| **RISK_COUNCIL** | 3/5 | 3-day timelock | `setDefault` on LoanRegistry, write-down closures, exchange-coefficient on the WithdrawalQueue |
| **GUARDIAN** | 2/5 | Instant | Pause any pausable contract, cancel pending scheduled actions, revoke named operational-role holders |

**Defensive action is fast. Constructive action is slow.** GUARDIAN can stop things instantly. Only ADMIN can start them again, and only after a window that GUARDIAN itself can veto.

---

## ADMIN: 3-of-5 MPC

Owns role grants and re-grants, unpauses, upgrades, and parameter changes. Standard ADMIN actions are scheduled through AccessManager with a **3-day delay**. Upgrades carry a **7-day delay**. GUARDIAN can cancel during those windows.

A **14-day meta-timelock gates the delay parameter itself** (`setTargetAdminDelay`). This blocks the "collapse the delay then exploit" attack pattern. A captured ADMIN cannot shorten the timelock to seconds and immediately push hostile changes. It would have to wait 14 days for the shorter delay to take effect, long enough for GUARDIAN, the community, or the auditor to notice and respond.

ADMIN cannot pause, cannot revoke, and cannot move funds. ADMIN's job is to add capability under reviewable delay. The symmetric defensive lever lives at GUARDIAN.

---

## RISK_COUNCIL: 3-of-5 MPC, 3-day timelock

Owns credit and recovery decisions. `setDefault` on LoanRegistry, write-down closures (`closeLoan` with reason `Default` or `OtherWriteDown`), and exchange-coefficient changes on the WithdrawalQueue (set or `adjustExchangeCoefficientUp`). Each selector is gated by a 3-day AccessManager delay, GUARDIAN-cancelable.

RISK_COUNCIL has no upgrade authority and no role-grant authority. It cannot move funds. It cannot edit parameters outside the credit and recovery surfaces. The 3-day delay matches the standard ADMIN delay because credit decisions need to land within a working week. They remain pre-announced and reversible until execution.

---

## GUARDIAN: 2-of-5 MPC, instant

Defensive only. GUARDIAN can:

- `pause()` any pausable contract. Stops mints, withdrawals, transfers depending on what's paused.
- `AccessManager.cancel(actionId)` on any pending scheduled action. Vetoes a captured ADMIN or RISK_COUNCIL move during its delay window.
- `AccessManager.revokeRole(role, holder)` for the operational-role set (`WHITELIST_MANAGER_ROLE`, `TRUSTEE`). Revokes one named holder at a time.

Every GUARDIAN action is **instant** and **named**. There is no single-call "revoke everything" switch. Every action is a reviewable record with a bounded blast radius.

GUARDIAN **cannot** grant roles, unpause, upgrade, or move funds. A compromised GUARDIAN can grief (pause, cancel, revoke) but cannot escalate. Restoration of service is strictly ADMIN's job, gated by the 3-day timelock and itself GUARDIAN-cancelable.

---

## Distinct signer sets

The three MPCs have **distinct signer sets** as an operational requirement. Overlapping signers would collapse the three-MPC separation. An attacker who compromises a member who sits on two MPCs could push two roles' worth of authority simultaneously. This constraint is enforced at signer-set construction and in the rotation playbook. It is not enforced on-chain, so a signer-set change that violates it would not be caught by the contracts. The mitigation is procedural. Signer rotations require an off-chain review and the published signer registry is the source of truth.

---

## Why the meta-timelock

Without it, ADMIN could call `setTargetAdminDelay(0)` under the standard 3-day delay, then immediately execute any hostile change with no further delay. The 14-day meta-timelock on the delay parameter itself means a captured ADMIN must wait 14 days to unlock a faster lever. Long enough for GUARDIAN, the community, or the auditor to notice and respond. The meta-timelock cannot be reduced by anyone short of an upgrade, which itself runs through ADMIN under the 7-day upgrade delay, which GUARDIAN can cancel.

---

## Related

- [Custody](/security/custody/). Institutional MPC and the cosigner policy.
- [Supply safeguards](/security/supply-safeguards/). Atomic deposits and two-party yield mints.
- [Emergency response](/security/emergency-response/). Incident playbooks.
- [Potential risks](/risks/). Governance risk in the full register.
