---
title: Risk management
order: 8
section: How Pipeline works
---

# Risk management

Risk Mandate and Credit Policy sit at the foundation of Pipeline's approach to risk management. Both are published, board-approved documents that define what Pipeline finances, on what terms, and within what limits.

## Risk Mandate

The Risk Mandate is Pipeline's foundational risk document. It sets the boundaries within which the Credit Policy is written and the Risk committee operates.

The Mandate defines:

- Risk appetite — target loss rate, protocol-wide loss tolerance, capital-at-risk ceiling
- Authority and discretion of the Risk committee, and what requires Trustee escalation
- Recusal and conflict-of-interest rules
- Review cadence and amendment process

The Trust Company approves the Mandate. The Credit Policy and every committee decision derive from it.

## Credit policy

The Credit Policy operationalises the Risk Mandate. It is the underwriting and monitoring rulebook that governs every loan. It defines:

- Eligible commodities, corridors, and counterparty profiles
- Borrower tier framework and pricing envelopes
- LTV ladder with stacking modifiers for corridor, commodity, and counterparty tier
- Duration bounds and structural requirements
- Hedging and benchmark price linkage requirements
- Concentration limits — hard ceilings on commodity, corridor, single-borrower, single-offtaker, and single-Originator exposure, scaled to pool size
- Affiliated-party lending rules and structural protections
- Default triggers and workout protocols

Every loan is underwritten against the Credit Policy by the Originator and re-tested by the Risk committee before origination. A summary is published in [Credit policy overview](/risks/credit-policy/).

## Risk committee

The standing body that operates the Credit Policy and acts under the Risk Mandate. Initially includes five legitimate members, including the Trustee. The committee:

- Approves every loan before origination
- Reviews concentration weekly
- Monitors live loans and escalates material events
- Declares default when triggers fire (via on-chain `setDefault`)
- Proposes protocol-wide shutdown if losses threaten lender principal
- Adjusts the recovery rate upward as recoveries land during shutdown

Decisions reach the protocol via the RISK_COUNCIL MPC (3-of-5, 3-day timelock). Recusal rules apply per the Risk Mandate. See [Risk committee](/governance/risk-committee/).

## Continuous monitoring

Every live loan is monitored daily.

*Cargo and vessel.* Position tracked via CTRM. Independent inspectors verify cargo at every stage of the trade — load port, transit checkpoints, bonded storage handover, and discharge. CMA stock reports flow daily once cargo lands in bonded storage. Material events escalate to the committee within 24 hours.

*LTV and price.* Cargo value marked daily against independent price assessments. Threshold breach triggers a margin-call event; failure to cure within the window is a default trigger.

*Counterparty.* Borrower, offtaker, CMA, and inspector under continuous sanctions and adverse-media screening. Hedge positions marked daily.

## Default declaration

A loan is declared in default when one of the Credit Policy triggers fires:

- Missed scheduled payment beyond the cure window
- Material covenant breach uncured within the contractual window
- Collateral seizure, fraud discovery, or CMA breach
- Force majeure beyond the covered insurance window
- Sanctions hit on a counterparty

Default is declared by the Risk committee via `setDefault` on LoanRegistry. From there, [Default management](/risks/default-management/) governs the workout — collateral seizure and resale through pre-onboarded liquidators, equity-tranche absorption, and only as a last resort, residual flow to senior lenders.
