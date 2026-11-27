---
title: Overview
order: 28
section: Security & Transparency
---

# Overview

Credit protection comes from the loan structure: the advance ratio, margin calls, first-ranking security held by an independent Security Agent, and the Originator's own money lent in each loan on the same terms as the pool. Contract protection comes from custody outside the contracts, role separation, mint limits and pause. A defaulted loan's loss stays with the investors who held the vault at the default.

## Security model in one diagram

{% include diagram.html src="boss-loss-defense.jpeg" caption="Layered protection for credit losses and contract incidents." %}

## Protection mechanisms

- Advance ratio. A loan is drawn up to 80 %, 75 % or 65 % of the security value, by commodity class. A margin call opens 5 points above the advance ratio and must restore it within 3 business days. See [Investor protection](/security/investor-protection/).
- Co-lending. The Originator lends at least 5–20 % of each loan on the same terms as the pool, so it shares any loss. See [Investor protection](/security/investor-protection/).
- Custody. Investor USDC sits in custody accounts outside the smart contracts: MPC wallets with a 3-of-5 quorum, in which the Independent Trustee holds a mandatory key. See [Custody](/security/custody/).
- Independent Trustee. A licensed trust company co-signs every payment out of Pipeline's accounts, except withdrawals paid automatically from the on-chain buffer. See [Independent Trustee](/governance/fiduciary-trustee/).
- Capital safeguards. Screened deposits with signed vouchers, withdrawals from a liquidity buffer, mint limits, single-use bank references. See [Capital safeguards](/security/capital-safeguards/).
- Emergency response. Pause, cancellation of scheduled calls, role revocation, and a hardware circuit breaker on the relayer's access to custody. See [Emergency response](/security/emergency-response/).

## Transparency

Every facility is a record in the on-chain loan registry. Every PLUSD mint and burn is on-chain. Every privileged action goes through the access manager, and scheduled actions are visible during their delay. The minter reports pool assets on-chain: custody USDC, booked bank cash, cash in transit and the pool's share of loan principal outstanding. Custody account addresses: to be published.
