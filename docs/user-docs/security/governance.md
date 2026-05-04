---
title: Governance
order: 14
section: Security & Transparency
---

# Governance

Three Gnosis Safes hold every privileged role across the protocol. Their powers do not overlap. Their signer sets are operationally required to be distinct. Every privileged write routes through the AccessManager hub, which schedules timelocked actions and enforces role gating on every selector.

{% include diagram.html src="d8-governance.svg" caption="Three Safes with distinct signer sets: ADMIN 3/5 (48h timelock), RISK_COUNCIL 3/5 (24h timelock), GUARDIAN 2/5 (instant)." %}

## Three Safes, three roles, three tempos

| Safe | Threshold | Tempo | Powers |
|---|---|---|---|
| **ADMIN** | 3/5 | 48h timelock | role grants and re-grants, unpauses, upgrades, parameter changes, attestor rotation |
| **RISK_COUNCIL** | 3/5 | 24h timelock | `setDefault` on LoanRegistry, `proposeShutdown` on ShutdownController, `adjustRecoveryRateUp` |
| **GUARDIAN** | 2/5 | instant | pause any pausable contract, cancel pending scheduled actions, revoke named operational-role holders |

The split is deliberate. **Defensive action is fast; constructive action is slow.** GUARDIAN can stop things instantly. Only ADMIN can start them again, and only after a window that GUARDIAN itself can veto.

---

## ADMIN · 3-of-5 Safe · 48h timelock

Owns role grants and re-grants, unpauses, upgrades, and parameter changes. Every ADMIN action is scheduled through AccessManager with a 48-hour delay; GUARDIAN can cancel during that window. A **14-day meta-timelock gates the delay setting itself** — this blocks the "collapse the delay then exploit" attack pattern in which a captured ADMIN Safe shortens the timelock to seconds and then immediately executes hostile changes.

ADMIN cannot pause, cannot revoke, and cannot move funds. ADMIN's job is to add capability under reviewable delay; the symmetric defensive lever lives at GUARDIAN.

---

## RISK_COUNCIL · 3-of-5 Safe · 24h timelock

Owns credit and wind-down decisions: `setDefault` on LoanRegistry, `proposeShutdown` on ShutdownController, and `adjustRecoveryRateUp`. Each selector is gated by a 24-hour AccessManager delay, GUARDIAN-cancelable.

RISK_COUNCIL has no upgrade authority and no role-grant authority. It cannot move funds. It cannot edit parameters outside the credit and shutdown surfaces. The 24-hour delay is shorter than ADMIN's because credit decisions need to land within a working week — but they are still pre-announced and still reversible until execution.

---

## GUARDIAN · 2-of-5 Safe · instant

Defensive only. GUARDIAN can:

- `pause()` any pausable contract — stops mints, withdrawals, transfers depending on what's paused.
- `AccessManager.cancel(actionId)` on any pending scheduled action — vetoes a captured ADMIN or RISK_COUNCIL move during its delay window.
- `AccessManager.revokeRole(role, holder)` for the operational-role set — `YIELD_MINTER`, `FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE` — revoking one named holder at a time.

Every GUARDIAN action is **instant** and **named**. There is no single-call "revoke everything" switch — every action is a reviewable record with a bounded blast radius.

GUARDIAN **cannot** grant roles, unpause, upgrade, or move funds. A compromised GUARDIAN can grief (pause, cancel, revoke) but cannot escalate — restoration of service is strictly ADMIN's job, gated by the 48-hour timelock and itself GUARDIAN-cancelable.

---

## Distinct signer sets

The three Safes have **distinct signer sets** as an operational requirement. Overlapping signers would collapse the three-Safe separation: an attacker who compromises a member who sits on two Safes could push two roles' worth of authority simultaneously. This constraint is enforced at signer-set construction and in the rotation playbook — it is not enforced on-chain, so a signer-set change that violates it would not be caught by the contracts. The mitigation is procedural: signer rotations require an off-chain review and the published signer registry is the source of truth.

---

## Why the meta-timelock

Without it, ADMIN could call `setTargetAdminDelay(0)` under the standard 48-hour delay, then immediately execute any hostile change with no further delay. The 14-day meta-timelock on the delay parameter itself means a captured ADMIN must wait 14 days to unlock a faster lever — long enough for GUARDIAN, the community, or the auditor to notice and respond. The meta-timelock cannot be reduced by anyone short of an upgrade, which itself runs through ADMIN under the 48-hour delay, which GUARDIAN can cancel.

---

## Related

- [Custody](/security/custody/) — institutional MPC and the cosigner policy
- [Supply safeguards](/security/supply-safeguards/) — atomic deposits and two-party yield mints
- [Emergency response](/security/emergency-response/) — incident playbooks
- [Potential risks](/risks/) — governance risk in the full register
