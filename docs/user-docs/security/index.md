---
title: Overview
order: 28
section: Security & Transparency
---

# Overview

Credit protection comes from the loan structure: the advance ratio, margin calls and the Originator's equity tranche. Contract protection comes from custody outside the contracts, role separation, mint limits and pause. A defaulted loan's loss stays with the investors who held the vault at the default.

## Security model in one diagram

{% include diagram.html src="boss-loss-defense.jpeg" caption="Layered protection for credit losses and contract incidents." %}

## Protection mechanisms

- Advance ratio. A loan is drawn up to 80 % of the security value. A margin call opens above 85 % and must restore 80 %. See [Investor protection](/security/investor-protection/).
- Equity tranche. The Originator funds a junior tranche on each loan. See [Investor protection](/security/investor-protection/).
- Custody. Investor USDC sits in custody accounts outside the smart contracts. See [Custody](/security/custody/).
- Capital safeguards. Screened deposits with signed vouchers, a FIFO withdrawal queue, mint limits, single-use bank references. See [Capital safeguards](/security/capital-safeguards/).
- Emergency response. Pause, cancellation of scheduled calls, role revocation. See [Emergency response](/security/emergency-response/).

## Transparency

Every loan is a record in the on-chain loan registry. Every PLUSD mint and burn is on-chain. Every privileged action goes through the access manager, and scheduled actions are visible during their delay. The minter reports pool assets on-chain: custody USDC, booked bank cash, cash in transit and loan principal outstanding. Custody account addresses: to be published.
