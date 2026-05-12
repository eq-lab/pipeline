---
title: Risk committee
order: 26
section: Governance
---

# Risk committee

The Risk committee is the standing body that operates the Credit Policy. Every loan is approved by the committee before origination; every live facility is monitored under its oversight; every default is declared by it. Underwriting discipline and ongoing loan management both run through it. The committee acts within the Risk Mandate's boundaries and reaches the protocol through the RISK_COUNCIL Safe on-chain.

## Composition

Five members. Distinct from ADMIN and GUARDIAN. Includes The Trust Company representative. Composition published; rotation timelocked under ADMIN.

## Mandate

- Approve every loan before origination, against the published Credit Policy
- Review every concentration ceiling weekly
- Declare default when triggers fire (via `setDefault`)
- Propose protocol-wide shutdown if the loss waterfall threatens lender principal
- Adjust the recovery rate upward as recoveries land during shutdown

## On-chain expression

Decisions reach the protocol via the RISK_COUNCIL MPC (3-of-5, 3-day timelock). Off-chain deliberation produces a written decision; that decision is then expressed on-chain by a 3-of-5 signer quorum and lands after the 3-day delay (GUARDIAN-cancelable).

## Recusal

Members must recuse from decisions involving an entity they have a material relationship with. Recusal is logged in the meeting record and the on-chain signer rotation. The grandfather arrangement covering Pipeline-affiliated members operates under explicit recusal rules.

## Decentralisation roadmap

Centralised at MVP, weighted toward Pipeline-affiliated and contracted-counsel members. Decentralisation gated at $30M, $100M, and $500M pool size:

- **$30M** — first independent industry expert added
- **$100M** — Pipeline-affiliated representation reduced; two independent industry experts
- **$500M** — committee majority independent; rotation cadence formalised
