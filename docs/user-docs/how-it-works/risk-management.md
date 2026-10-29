---
title: Risk management
order: 8
section: How Pipeline works
---

# Risk management

Pipeline's risk management rests on two documents: the Risk Mandate and the Credit Policy. Both are published, board-approved documents that define what Pipeline finances, on what terms, and within what limits.

## Risk Mandate

The Risk Mandate is Pipeline's foundational risk document. It sets the boundaries within which the Credit Policy is written and the Risk Council operates.

The Mandate defines:

- Risk appetite: target loss rate, protocol-wide loss tolerance, capital-at-risk ceiling
- Authority and discretion of the Risk Council, and what requires Trustee escalation
- Recusal and conflict-of-interest rules
- Review cadence and amendment process

The Trustee approves the Mandate. The Credit Policy and every Risk Council decision derive from it.

## Credit policy

The Credit Policy puts the Risk Mandate into practice. It is the underwriting and monitoring rulebook for every loan. It defines:

- Eligible commodities, corridors, and counterparty profiles
- Borrower tier framework and pricing envelopes
- LTV ladder with stacking modifiers for corridor, commodity, and counterparty tier
- Duration bounds and structural requirements
- Hedging and benchmark price linkage requirements
- Concentration limits: hard ceilings on commodity, corridor, single-borrower, single-offtaker, and single-Originator exposure, scaled to pool size
- Affiliated-party lending rules and structural protections
- Default triggers and workout protocols

Every loan is underwritten against the Credit Policy by the Originator and re-tested by the Risk Council before origination. A summary is published in [Credit policy overview](/risks/credit-policy/).

## Risk Council

The standing body that operates the Credit Policy and acts under the Risk Mandate. The Risk Council:

- Approves every loan before origination
- Reviews concentration weekly
- Monitors live loans and escalates material events
- Declares default when triggers fire
- Writes down losses, cures defaults and closes defaulted loans
- Amends loan terms and extends loans
- Reverses wrong disbursement and repayment entries
- Resolves inspection flags and may set a manual collateral price

Its on-chain actions run through the Risk Council role. Default declaration and repayment reversals run without delay. Its other actions run with a 24-hour delay. The role is held by a multisig of several people. While Pipeline is the only lender, the Risk Council acts for the Majority Lenders. Recusal rules apply per the Risk Mandate. See [Risk Council](/governance/risk-committee/).

## Continuous monitoring

Every live loan is monitored daily.

*Cargo and security.* Independent inspectors, appointed by the lending vehicle, verify cargo at every stage of the trade: load port, transit, storage handover, and discharge. One inspection operator enters each result and a second one approves it. The security registry compares each result with the documents and the previous inspection. A shortfall above tolerance flags the record for the Risk Council. The Security Agent confirms each security record at a set interval; a record not confirmed in time is stale. Material events escalate to the Risk Council within 24 hours.

*LTV and price.* The platform feeds market prices into the security registry daily and on any move above 2%. LTV is the loan's principal outstanding plus accrued interest, divided by the value of its active security. Goods count at counted quantity times market price. Cash cover, prepayments, receivables and LC proceeds count at face value. Insurance never counts. There is no haircut.

| Term | Default value |
|---|---|
| Advance ratio: the highest LTV at drawdown, and the LTV a margin call must restore | 80% |
| Margin-call ratio: the LTV that opens a margin call | 85% |

{% include diagram.html src="boss-ccr-thresholds.png" caption="LTV thresholds. A loan is drawn up to 80 %. A margin call opens above 85 % and must bring LTV back to 80 % within the cure period." %}

Both ratios are set per loan. When LTV rises above the margin-call ratio, a margin call opens. The borrower then has the cure period to bring LTV back to the advance ratio with cash or goods. A stale price does not open a margin call; it alerts the Risk Council. The end of the cure period does not trigger default by itself.

*Interest.* Accrued interest is invoiced monthly per loan and paid separately from principal. Unpaid interest past its due date alerts the Risk Council.

*Counterparty.* Every counterparty passes KYB and KYT. Borrower, offtaker, CMA, and inspector are under continuous sanctions and adverse-media screening. Hedge positions marked daily.

## Default declaration

A loan is declared in default when one of the Credit Policy triggers fires:

- Missed scheduled payment beyond the cure window
- Material covenant breach uncured within the contractual window
- Collateral seizure, fraud discovery, or CMA breach
- Force majeure beyond the covered insurance window
- Sanctions hit on a counterparty

The Risk Council declares default on the loan registry. The loan's principal outstanding then moves from the vault into a pocket owned by the vault holders at that moment. Recoveries go to that pocket. Write-downs burn from it. From there, [Default management](/risks/default-management/) governs the workout: collateral enforcement and resale through pre-onboarded liquidators, and the equity tranche's first loss.
