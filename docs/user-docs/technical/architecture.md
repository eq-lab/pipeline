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
- The withdrawal custody account pays queued withdrawals. It grants the withdrawal queue an allowance.
- The capital account holds the loan records and the per-loan debt tokens. It also receives protocol fees.

Each account is a multisig account.

A USD bank account receives lender and offtaker wires and pays borrowers and lender wire-outs. Every bank movement is booked on-chain in the cash book.

### Protocol Layer

- Tokens: PLUSD (permissioned dollar token; only approved addresses hold it), sPLUSD (staking vault share over PLUSD), one debt token per loan (1 token = 1 USD of principal outstanding).
- Registries: loan registry (one non-transferable record per loan), security registry (one record per security instrument, written by the Security Agent).
- Operational contracts: deposit manager, withdrawal queue, minter (cash book), debt token factory, pocket (holds a defaulted loan's PLUSD for its sPLUSD holders).
- Role hub: access manager.

### Origination Layer

Off-chain backend and console used by Originators and the Trustee.

- Every counterparty passes KYB and KYT: lenders, Originators, borrowers and every other party. Addresses and deposits are screened through a screening provider. Results are stored in the backend.
- The backend tracks market prices for the goods and feeds them on-chain to the security registry.
- In the console, Originators submit loan applications. The Trustee reviews them and approves, rejects or requests changes.

The layer holds no custody. Approved loans reach the Protocol Layer when the Trustee records them in the loan registry.

### Governance Layer

Roles in the access manager:

- Admin: grants and revokes roles, unpauses, sets limits and custody accounts. Held by a multisig. No delay.
- Risk Council: default, write-down, cure, loan amendments, reversals and corrections, collateral risk settings. Held by a multisig of several people. Default and the reversal of a repayment run at once. Its other actions run after a 24-hour delay. While Pipeline is the only lender, the Risk Council acts for the Majority Lenders.
- Cash Reporter: books bank wires in, loan repayments and bank income. Held by a 2-of-2 multisig.
- Guardian: cancels scheduled actions of the operational roles during their delay.
- Pauser: pauses each contract.
- Upgrader: upgrades contracts.

### Relayer

The Pipeline backend between the bank, custody and the Protocol Layer. It indexes on-chain events. It screens lender addresses and deposits. It approves screened addresses to hold PLUSD. It signs the vouchers that let deposit and withdrawal claims go through. It matches bank wires to their on-chain bookings. It holds no custody key and cannot mint PLUSD alone.

{% include diagram.html src="boss-system-architecture.png" caption="Technical architecture — capital, relayer, protocol, and origination layers, with governance routed through the access manager." %}

## Trust assumptions, summarised

| Assumption | What happens if it fails |
|---|---|
| **Custody keys uncompromised** | The signers of a custody account control the USDC in it. Each account is a multisig account. |
| **Trustee key uncompromised** | The Trustee books disbursements, wire-outs, ramps and expenses. Expenses have no cap. The Risk Council can reverse bookings. The Admin revokes the role. |
| **Relayer uncompromised** | Cannot mint PLUSD alone. Cannot move USDC out of custody. Worst case: deposits that should fail screening are approved, or deposits and withdrawals stall. The Admin revokes its role and replaces the voucher key. |
| **Smart contracts bug-free** | Lender USDC is held outside the contracts. A bug in the withdrawal queue can move USDC up to the allowance. Mint limits cap new PLUSD per transaction and per 24 hours. |
| **Admin multisig uncompromised** | The Admin can change roles, limits and custody accounts with no delay. |
