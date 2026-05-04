---
title: How Pipeline works
order: 2
section: How Pipeline works
---

# How Pipeline works

Pipeline runs on two layers connected by a relayer. The **Capital Layer** is off-chain and holds every USD and USDC in an institutional MPC custody. The **Protocol Layer** is on-chain and issues PLUSD and sPLUSD, records loans, and runs Lender-facing business logic. The **Relayer** sits between them — it watches the chain, co-signs yield mints, but never custodies USDC and cannot mint PLUSD.

Two other system components sit alongside. **Recovery System** holds the protocol's terminal wind-down state and is dormant in normal operation. **Operators and Governance** is the human surface — the cosigners who hold custody shares, the relayer that connects the two layers, and the three governance MPCs that gate every privileged change.

<div class="callout safety">
  <h4>Split-layer safety property</h4>
  <p><em>"A bug or exploit in on-chain code cannot drain investor capital unilaterally."</em></p>
</div>

{% include diagram.html src="d1-system-context.png" caption="Pipeline system context — Capital Layer off-chain, Relayer in the middle, Protocol Layer on-chain. The Trustee co-signs every USDC movement and records every loan." %}

---

## Capital Layer

Lender USDC and the USYC reserve sit in an **institutional MPC custody** by Bitgo. The custody is configured with **five cosigner shares** with a hard policy rule that no transfer signs without both Team and Trustee participating. No protocol contract can spend from the custody.

### USD Account

A USD bank account in the Trustee's name. Handles physical world cash movementsL: loan origination, offtaker interest payments, lean repayment. 

### Capital Wallet

The MPC address holding all lender USDC plus the USYC (tokenised T-bill) position. Target USDC buffer is 15% with a 10–20% band. USYC NAV drifts up daily as the underlying T-bills accrue, but that gain is **unrealised** until the Trustee instructs the wallet to sell USYC for USDC against the Hashnote redemption rail — only realised proceeds can feed a PLUSD yield mint.

### Treasury Wallet

A separate institutional-custody address that collects protocol fees (management, performance, OET). Same Bitgo custody, separate cosigner-policy configuration.

### Emergency disconnect

Custody policy carries a **hardware circuit breaker** that disconnects the Capital Wallet from the protocol contracts on alarm — pre-approved allowances are revoked, all standing transfer authorisations are frozen. The breaker is a custody-side action; it does not require a smart-contract upgrade or a governance vote, and BitGo cannot pull this lever.

---

## Protocol Layer

The Protocol Layer is a set of on-chain contracts. **Token architecture** sits at the top — PLUSD as the dollar receipt and sPLUSD as the yield-bearing share. **LoanRegistry** sits as the second-priority surface — the public audit trail of every loan facility. The remaining contracts run the deposit, mint, withdraw, and access flows.

### PLUSD and sPLUSD

**PLUSD** is the dollar receipt — an ERC-20 minted 1:1 against USDC entering the Capital Wallet. Every PLUSD transfer is gated by the WhitelistRegistry. Two mint paths exist: mont from deposits, and mint from yield. The contract asserts a reserve invariant (there is always enough USDC in backing every PLUSD in existence) on every mint.

**sPLUSD** is the yield-bearing share — a standard ERC-4626 vault whose underlying asset is PLUSD. Any PLUSD holder can stake. The sPLUSD share prices rises in relation to PLUSD when a yield mint lands in the Vault. 

### LoanRegistry 

Every originated loan is one NFT carrying immutable origination data (borrower, commodity, corridor, facility size, tranche split, original offtaker price, senior coupon rate) plus mutable lifecycle state (status, current maturity, CCR, cumulative repayment split). LoanRegistry is the public audit trail of the book. 

### Core protocol contracts

These five contracts run the operational flows. Together they are how the Protocol Layer actually works day-to-day:

- **DepositManager** — Pulls USDC from the lender to the Capital Wallet and mints PLUSD 1:1 in the same transaction. 
- **YieldMinter** — Gates yield mints. Destinations are hard-constrained to the sPLUSD vault or Treasury Wallet.
- **WithdrawalQueue** — FIFO exit queue. Lenders escrow PLUSD and receive a `queue_id`, the Relayer pulls USDC from the Capital Wallet via a pre-approved allowance, the lender claims, burning PLUSD and receiving USDC atomically.
- **WhitelistRegistry** — on-chain allowlist of KYB-ed lender addresses. Gates every PLUSD transfer and every deposit-side mint.
- **AccessManager** — the role hub. Every privileged call routes through this contract — instantly for GUARDIAN, through a timelock for ADMIN and RISK_COUNCIL.

---

## Recovery System (terminal mode)

Two contracts, dormant in normal operation, engaged only on protocol-wide wind-down. **Recovery System is not a third operational layer.** It is the terminal exit door — when active, it freezes the mint paths, freezes the share price, and lets every holder redeem at one fixed rate. It exists so that a credit event severe enough to chew through the Equity tranche and the sPLUSD cushion has a deterministic exit instead of a panic-driven one.

### ShutdownController

A one-way switch. RISK_COUNCIL proposes shutdown at a fixed recovery rate; ADMIN executes after a 24-hour delay; GUARDIAN can cancel during the window. Once active, all mint paths revert and the recovery rate is fixed. The rate can ratchet up only — never down — as recovery cash is repatriated into the pool.

### RecoveryPool

A USDC escrow that holds the cash redeeming lenders pull against at the frozen recovery rate. ADMIN can deposit additional USDC into it over time as recovery progresses. Every PLUSD redeemed during shutdown — direct, via sPLUSD, or via the queue — pays the same USDC fraction. There is no race and no queue jump.

The Recovery System is invisible in normal operation. See [Default management](/defaults-and-losses/) for when and why it engages.

---

## Operators and Governance

The two layers above describe what holds capital and what records claims. This section describes who actually moves things. Distinct roles: **Operators** do continuous work (every day, every block, every withdrawal). **Governance** handles privileged events (role grants, defaults, shutdowns). Both interact with the protocol from the outside.

### Operators

These parties are active day to day, not just during privileged events.

- **Trustee** — independent legal entity, holds one cosigner share on the institutional custody, and is the second signer on every yield attestation along with the Relayer.
- **Pipeline Team** — holds two cosigner shares on the institutional custody. Required (with the Trustee) on every transfer.
- **External Counterparties** — two reputable third parties hold the remaining two cosigner shares. Their role is structural: they make a Team-only or Trustee-only quorum impossible.
- **Relayer** — the off-chain backend that bridges the two layers. Indexes on-chain events, co-signs yield attestations against repayments, and maintains the whitelist.

### Governance

The privileged-event surface. Three MPCs with distinct signer sets, every write routed through AccessManager.

- **ADMIN · 3/5 · 48h timelock** — role grants, re-grants, unpauses, upgrades, parameter changes. A 14-day meta-timelock gates the delay setting itself, blocking the "collapse the delay then exploit" pattern.
- **RISK_COUNCIL · 3/5 · 24h timelock** — `setDefault` on LoanRegistry, `proposeShutdown` on ShutdownController, `adjustRecoveryRateUp`. No upgrade authority, no role-grant authority.
- **GUARDIAN · 2/5 · instant** — pause any pausable contract, cancel pending scheduled actions, revoke named operational-role holders. Cannot grant roles, cannot unpause, cannot upgrade, cannot move funds. A compromised GUARDIAN can grief but cannot escalate.

The split is deliberate. **Defensive action is fast; constructive action is slow.** GUARDIAN can stop things instantly. Only ADMIN can start them again, and only after a window that GUARDIAN itself can veto. See [Governance](/security/governance/) for the full split.

---

## Why this matters for a lender

Your USDC sits in an institutional MPC custody, not inside a smart contract. A bug in the Protocol Layer cannot drain Capital Layer dollars. A single compromised cosigner cannot mint Protocol Layer PLUSD or move Capital Layer USDC. A captured ADMIN MPC cannot move quickly enough to outrun GUARDIAN's veto. Recovery System is dormant by design, deterministic when engaged.

---

## Related

- [Yield engines](/how-it-works/yield-engines/) — how senior coupons and realised T-bill yield reach the sPLUSD vault.
- [Custody](/security/custody/) — the institutional custody model and the cosigner policy in detail.
- [Governance](/security/governance/) — the three Safes and their powers.
- [For lenders](/lenders/) — the lender-side walkthrough.
- [Potential risks](/risks/) — what can still go wrong.
