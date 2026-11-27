---
title: Technical architecture
order: 20
section: Technical overview
---

# Technical architecture

For engineers and auditors. Off-chain custody, on-chain protocol, an off-chain backend, and roles. Every privileged call routes through one access manager.

## Layers and components

### Capital Layer

Custody accounts sit outside the smart contracts:

- The deposit custody account receives lender USDC directly at deposit.
- The withdrawal custody account holds the liquidity buffer, 10–15% of the pool, and pays withdrawals. It grants the withdrawal queue an allowance.
- The capital account receives Pipeline's performance fee.

Each account is an MPC wallet with a 3-of-5 quorum, in which the Independent Trustee holds a mandatory key.

A USD bank account receives lender wires and receipts from borrowers' collection accounts. It pays drawdowns into those accounts and lender wire-outs. The Independent Trustee co-signs every payment out of it. Every bank movement is booked on-chain in the cash book.

### Protocol Layer

- Tokens: PLUSD (permissioned dollar token; only approved addresses hold it), sPLUSD (staking vault share over PLUSD).
- Registries: loan registry (one record per facility: terms, each lender's share, lifecycle), security registry (one record per security instrument, written by the Security Agent).
- Operational contracts: deposit manager, withdrawal queue, minter (cash book), debt token factory, pocket (holds the pool's share of a defaulted facility in PLUSD for the respective sPLUSD holders).
- Role hub: access manager.

### Origination Layer

Off-chain backend and console used by Originators, Pipeline and the Independent Trustee.

- Lender addresses, deposits and withdrawal requests pass KYT through a screening provider. Lenders who wire USD also pass KYC or KYB.
- Originators pass KYB, KYT, AML and sanctions checks. Borrowers and every other party to a deal pass KYB, AML and sanctions checks. Results are stored in the backend.
- The backend tracks market prices for the goods and feeds them on-chain to the security registry.
- In the console, Originators submit loan applications. Pipeline screens them against the Credit Policy and reports to the Risk Council, which approves or rejects them.

The layer holds no custody. A facility reaches the Protocol Layer when the Risk Council adds it to the loan registry on-chain.

### Governance Layer

Roles in the access manager:

- Admin: grants and revokes roles, unpauses, sets limits and custody accounts. Held by a multisig. No delay.
- Risk Council: facility approval, default, write-down, cure, loan amendments, reversals and corrections, collateral risk settings. Held by the Risk Council Multisig of three voting members. Approval, default and the reversal of a repayment run at once. Its other actions run after a 24-hour delay.
- Trustee: services facilities and books drawdowns, wire-outs, ramps and expenses. Held by the Independent Trustee.
- Cash Reporter: books bank wires in, interest, loan repayments and bank income. Held by a 2-of-2 multisig.
- Guardian: cancels scheduled actions of the operational roles during their delay.
- Pauser: pauses each contract.
- Upgrader: upgrades contracts.

### Relayer

The Pipeline backend between the bank, custody and the Protocol Layer. It indexes on-chain events. It screens lender addresses, deposits and withdrawal requests. It approves screened addresses to hold PLUSD. It signs the vouchers that let deposit and withdrawal claims go through. It matches bank wires to their on-chain bookings. It holds no custody key and cannot mint PLUSD alone.

{% include diagram.html src="boss-system-architecture.png" caption="Technical architecture — capital, relayer, protocol, and origination layers, with governance routed through the access manager." %}

## Trust assumptions, summarised

| Assumption | What happens if it fails |
|---|---|
| **Custody keys uncompromised** | The signers of a custody account control the USDC in it. Each account is an MPC wallet with a 3-of-5 quorum, and the Independent Trustee holds a mandatory key. |
| **Trustee key uncompromised** | The Trustee role books drawdowns, wire-outs, ramps and expenses. Expenses have no cap. The Risk Council can reverse bookings. The Admin revokes the role. |
| **Relayer uncompromised** | Cannot mint PLUSD alone. Cannot move USDC out of custody. Worst case: deposits that should fail screening are approved, or deposits and withdrawals stall. The Admin revokes its role and replaces the voucher key. |
| **Smart contracts bug-free** | Lender USDC is held outside the contracts. A bug in the withdrawal queue can move USDC up to the allowance. Mint limits cap new PLUSD per transaction and per 24 hours. |
| **Admin multisig uncompromised** | The Admin can change roles, limits and custody accounts with no delay. |
