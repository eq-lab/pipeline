---
title: How Pipeline works
order: 2
section: How Pipeline works
---

# How Pipeline works

Pipeline runs on two layers connected by a relayer. The **Capital Layer** is off-chain and holds every USD and USDC in an institutional MPC custody. The **Protocol Layer** is on-chain and issues PLUSD and sPLUSD, records loans, and runs Lender-facing business logic. The **Relayer** sits between them. It watches the chain, co-signs yield mints, but never custodies USDC and cannot mint PLUSD.

A second human surface sits alongside the two layers. **Operators and Governance** is who actually moves things: the cosigners who hold custody shares, the relayer that connects the two layers, and the three governance MPCs that gate every privileged change.

<div class="callout safety">
  <h4>Split-layer safety property</h4>
  <p><em>"A bug or exploit in on-chain code cannot drain investor capital unilaterally."</em></p>
</div>

{% include diagram.html src="d1-system-context.png" caption="Pipeline system context. Capital Layer off-chain, Relayer in the middle, Protocol Layer on-chain. The Trustee co-signs every USDC movement and records every loan." %}

---

## Capital Layer

Lender USDC and the USYC reserve sit in an **institutional MPC custody** by Bitgo. The custody is configured with **five cosigner shares** with a hard policy rule that no transfer signs without both Team and Trustee participating. No protocol contract can spend from the custody.

### USD Account

A USD bank account in the Trustee's name. Handles physical-world cash movements: loan origination, offtaker repayments, on-ramp into the Capital Wallet.

### Capital Wallet

The MPC address holding all lender USDC plus the USYC (tokenised T-bill) position. Target USDC buffer is 15% with a 10–20% band. USYC NAV drifts up daily as the underlying T-bills accrue, but that gain is **unrealised** until the Trustee instructs the wallet to sell USYC for USDC against the Hashnote redemption rail. Only realised proceeds can feed a PLUSD yield mint.

### Withdrawal Queue Wallet

A separate institutional-custody address that holds USDC earmarked for lender withdrawals. The Trustee and Team periodically top it up from the Capital Wallet under the 3-of-5 cosigner quorum. The on-chain WithdrawalQueue contract pulls from this wallet (not from the Capital Wallet) when a lender claims, against an allowance the Queue Wallet has granted to the contract. Isolating settlement funds in their own wallet means a WithdrawalQueue contract bug or exploit can drain only the topped-up amount, not the full Capital Wallet.

### Treasury Wallet

A separate institutional-custody address that collects protocol fees (management, performance, OET). Same Bitgo custody, separate cosigner-policy configuration.

### Emergency disconnect

Custody policy carries a **hardware circuit breaker** that disconnects the Capital Wallet and the Withdrawal Queue Wallet from the protocol contracts on alarm. Pre-approved allowances are revoked, all standing transfer authorisations are frozen. The breaker is a custody-side action. It does not require a smart-contract upgrade or a governance vote, and BitGo cannot pull this lever.

---

## Protocol Layer

The Protocol Layer is a set of on-chain contracts. **Token architecture** sits at the top: PLUSD as the dollar receipt and sPLUSD as the yield-bearing share. **LoanRegistry** sits as the second-priority surface, the public audit trail of every loan facility. The remaining contracts run the deposit, mint, withdraw, and access flows.

### PLUSD and sPLUSD

**PLUSD** is the dollar receipt. An ERC-20 minted 1:1 against USDC entering the Capital Wallet. Every PLUSD transfer is gated by the WhitelistRegistry. Two mint paths exist: mint from deposits, and mint from yield. The contract asserts a reserve invariant (there is always enough USDC backing every PLUSD in existence) on every mint.

**sPLUSD** is the yield-bearing share. A standard ERC-4626 vault whose underlying asset is PLUSD. Any PLUSD holder can stake. The sPLUSD share price rises in relation to PLUSD when a yield mint lands in the vault.

### LoanRegistry

Every originated loan is one NFT carrying immutable origination data (borrower, commodity, corridor, facility size, tranche split, original offtaker price, senior coupon rate) plus mutable lifecycle state (status, current maturity, CCR, cumulative repayment split). LoanRegistry is the public audit trail of the book.

### Core protocol contracts

These five contracts run the operational flows. Together they are how the Protocol Layer actually works day to day:

- **DepositManager**. Pulls USDC from the lender to the Capital Wallet and mints PLUSD 1:1 in the same transaction.
- **YieldMinter**. Gates yield mints. Verifies a Relayer signature and a Trustee signature on-chain before minting. Destinations are hard-constrained to the sPLUSD vault or Treasury Wallet.
- **WithdrawalQueue**. FIFO exit queue. Lenders escrow PLUSD via `requestWithdrawal`, then call `claim` themselves to burn PLUSD and pull USDC from the Withdrawal Queue Wallet via the queue contract's pre-approved allowance. No off-chain signer in the critical path. The queue self-limits via three aggregates (`totalRequested`, `totalClaimed`, `totalClaimable`) and asserts `claimAmount ≤ totalClaimable` on every claim.
- **WhitelistRegistry**. On-chain allowlist of KYB-ed lender addresses. Gates every PLUSD transfer and every deposit-side mint.
- **AccessManager**. The role hub. Every privileged call routes through this contract: instantly for GUARDIAN, through a timelock for ADMIN and RISK_COUNCIL.

---

## Operators and Governance

The two layers above describe what holds capital and what records claims. This section describes who actually moves things. Distinct roles. **Operators** do continuous work (every day, every block, every withdrawal). **Governance** handles privileged events (role grants, defaults, parameter changes). Both interact with the protocol from the outside.

### Operators

These parties are active day to day, not just during privileged events.

- **Trustee**. Independent legal entity, holds one cosigner share on the institutional custody, second signer on every yield attestation, holder of the LoanRegistry write role.
- **Pipeline Team**. Holds two cosigner shares on the institutional custody. Required (with the Trustee) on every transfer.
- **External Counterparties**. Two reputable third parties hold the remaining two cosigner shares. Their role is structural: they make a Team-only or Trustee-only quorum impossible.
- **Relayer**. The off-chain backend that bridges the two layers. Indexes on-chain events, co-signs yield attestations, maintains the whitelist. Holds no cosigner share. Not in the withdrawal critical path. Claims are user-pulled.

### Governance

The privileged-event surface. Three MPCs with distinct signer sets, every write routed through AccessManager.

- **ADMIN (3/5)**. Role grants, re-grants, unpauses, upgrades, parameter changes. Standard delay 3 days. Upgrades 7 days. The meta-timelock on the delay setting itself is 14 days.
- **RISK_COUNCIL (3/5)**. `setDefault` on LoanRegistry, write-down closures, exchange-coefficient changes on the WithdrawalQueue. 3-day timelock, GUARDIAN-cancelable.
- **GUARDIAN (2/5, instant)**. Pause any pausable contract, cancel pending scheduled actions, revoke named operational-role holders. Cannot grant roles, cannot unpause, cannot upgrade, cannot move funds.

**Defensive action is fast. Constructive action is slow.** GUARDIAN can stop things instantly. Only ADMIN can start them again, and only after a window that GUARDIAN itself can veto.
