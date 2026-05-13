---
title: Operators & Multisigs
order: 27
section: Governance
---

# Operators & Multisigs

Three MPCs hold every privileged role across the protocol. Their powers do not overlap. Their signer sets are operationally required to be distinct. Every privileged write routes through the AccessManager hub, which schedules timelocked actions and enforces role gating on every selector.

**Three MPCs, distinct signer sets, all writes through AccessManager.**

{% include diagram.html src="boss-governance-detail.png" caption="Three MPCs with distinct signer sets. ADMIN 3/5 (3-day standard, 7-day upgrades, 14-day meta-timelock). RISK_COUNCIL 3/5 (3-day). GUARDIAN 2/5 (instant)." %}

## ADMIN — 3-of-5 MPC, 3-day timelock (7-day for upgrades)

#### Powers

- Role grants and re-grants (after GUARDIAN revokes an operational-role holder)
- Unpauses (after GUARDIAN has paused)
- Contract upgrades via the AccessManager-mediated proxy pattern
- Parameter changes — rate limits, fee schedules, supply ceilings, attestor key rotation (`setKytAttestor`, `proposeYieldAttestors`)

#### Powers it does NOT have

- Cannot pause
- Cannot revoke roles unilaterally (only re-grant after GUARDIAN revokes)
- Cannot move funds
- Cannot declare default or set the WithdrawalQueue exchange coefficient

#### Composition at MVP

Five members from The Trust Company senior representatives, external counsel (Reed Smith partner, Carey Olsen partner), and one technical lead. Distinct from RISK_COUNCIL and GUARDIAN.

#### Tempo

Standard ADMIN actions scheduled through AccessManager with a 3-day delay. Upgrades carry a 7-day delay. GUARDIAN can cancel during the window. A 14-day meta-timelock gates the delay parameter itself.

## RISK_COUNCIL — 3-of-5 MPC, 3-day timelock

#### Powers

- `setDefault` on LoanRegistry — declares default, opens the workout
- Write-down closures (`closeLoan` with reason `Default` or `OtherWriteDown`)
- Exchange-coefficient changes on the WithdrawalQueue (set the recovery coefficient, `adjustExchangeCoefficientUp`)

#### Powers it does NOT have

- No upgrade authority
- No role-grant authority
- Cannot move funds
- Cannot edit parameters outside the credit and recovery surfaces

#### Composition at MVP

Five members from the off-chain [Risk committee](/governance/risk-committee/). Reed Smith, Carey Olsen, The Trust Company, plus two further committee members. Decentralisation roadmap as in [Risk committee](/governance/risk-committee/).

#### Tempo

3-day delay. Credit and recovery decisions need to land within a working week. Pre-announced and reversible until execution. GUARDIAN-cancelable.

## GUARDIAN — 2-of-5 MPC, instant

#### Powers

- `pause()` any pausable contract
- `AccessManager.cancel(actionId)` on any pending scheduled action — vetoes a captured ADMIN or RISK_COUNCIL during its delay window
- `AccessManager.revokeRole(role, holder)` for the operational EOA-held set — `WHITELIST_REVOKER` (Relayer), `TRUSTEE` (Trustee key) — one named holder at a time. Contract-held roles (`DEPOSITOR`, `YIELD_MINTER`, `BURNER`, `WHITELIST_ADMIN` held by the relevant proxy contracts) are not the revocation target — pause is the lever for suspected contract problems.

#### Powers it does NOT have

- Cannot grant roles
- Cannot unpause
- Cannot upgrade
- Cannot move funds

#### Composition at MVP

Five members optimised for fast response — security-experienced operators across multiple time zones. Distinct from ADMIN and RISK_COUNCIL. Lower threshold (2-of-5) reflects the defensive-only role: a compromised GUARDIAN can grief but cannot escalate, and restoration is ADMIN's job.

#### Tempo

Instant. Every action reviewable on-chain. No single-call "revoke everything" switch — every revocation is a named record with bounded blast radius.

## Signer-set rotation

Rotation requires off-chain review and is published in the signer registry. The protocol does not enforce signer-set distinctness on-chain — that is procedural, enforced at construction. A rotation that violated the constraint would not be caught by the contracts; the mitigation is the published registry and the rotation playbook.
