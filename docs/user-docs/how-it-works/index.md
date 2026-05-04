---
title: How Pipeline works
order: 2
section: How Pipeline works
---

# How Pipeline works

Pipeline runs on two layers connected by a single bridge. The **Capital Layer** is off-chain and holds every USD and USDC in an institutional MPC custody. The **Protocol Layer** is on-chain and issues PLUSD and sPLUSD against that backing, records each loan, and runs Lender-facing business logic. The **Relayer** sits between them — it watches the chain, co-signs yield mints, and funds withdrawals, but never custodies USDC and cannot mint alone.

Two further bands sit alongside. **Recovery System** holds the protocol's terminal wind-down state and is dormant in normal operation. **Operators and Governance** is the human surface — the cosigners who hold custody shares, the backend that bridges the two layers, and the three governance Safes that gate every privileged change.

<div class="callout safety">
  <h4>Split-layer safety property</h4>
  <p><em>"A bug or exploit in on-chain code cannot drain investor capital unilaterally."</em></p>
</div>

{% include diagram.html src="d1-system-context.svg" caption="Pipeline system context — Capital Layer off-chain, Relayer in the middle, Protocol Layer on-chain. The Trustee co-signs every USDC movement and records every loan." %}

---

## Capital Layer

Lender USDC and the USYC reserve sit in an **institutional MPC custody** operated under BitGo's TSS policy. The custody is configured with **five cosigner shares** held by independent parties — the **Trustee**, the **Pipeline Team (two shares)**, and **two reputable external counterparties** — under a **3-of-5 threshold** with a hard policy rule that no transfer signs without both Team and Trustee participating. BitGo provides the substrate; **it holds no signing share, cannot freeze funds, and cannot seize them**. No protocol contract can spend from the custody.

### USD Account

A USD bank account in the Trustee's name. Offtaker payments for cargoes wire here; the Trustee identifies the wire, matches it to a loan, and on-ramps USD → USDC into the Capital Wallet via Circle Mint, Zodia, or a similar regulated provider. The USD account is the off-chain entry point for repayments.

### Capital Wallet

The MPC address holding all lender USDC plus the USYC (tokenised T-bill) position. Target USDC buffer is 15% (band 10–20%); the rest is held as USYC. USYC NAV drifts up daily as the underlying T-bills accrue, but that gain is **unrealised** until the Trustee instructs the wallet to sell USYC for USDC against the Hashnote redemption rail — only realised proceeds can feed a PLUSD yield mint.

### Treasury Wallet

A separate institutional-custody address that collects protocol fees (management, performance, OET) and the 30% Treasury share of realised T-bill yield. Same custody substrate, separate cosigner-policy configuration so a compromise at one wallet does not propagate to the other.

### Emergency disconnect

Custody policy carries a **hardware circuit breaker** that disconnects the Capital Wallet from the protocol contracts on alarm — pre-approved allowances are revoked, all standing transfer authorisations are frozen. The breaker is a custody-side action; it does not require a smart-contract upgrade or a governance vote, and BitGo cannot pull this lever.

---

## Protocol Layer

The Protocol Layer is a set of on-chain contracts. **Token architecture** sits at the top — PLUSD as the dollar receipt and sPLUSD as the yield-bearing share. **LoanRegistry** sits as the second-priority surface — the public audit trail of every loan facility. The remaining contracts run the deposit, mint, withdraw, and access flows; they are operationally essential, but they sit behind the headline tokens and the loan ledger.

### Token architecture · PLUSD and sPLUSD

**PLUSD** is the dollar receipt — an ERC-20 minted 1:1 against USDC entering the Capital Wallet. Every PLUSD transfer is gated by the WhitelistRegistry. Two mint paths exist (`mintForDeposit` from DepositManager, `mintForYield` from YieldMinter) and the contract asserts a reserve invariant on every mint.

**sPLUSD** is the yield-bearing share — a standard ERC-4626 vault whose underlying asset is PLUSD. Any PLUSD holder can stake; there is no whitelist at the share level. The vault's `totalAssets()` rises when a yield mint lands in it, and share price moves on that event — and only that event.

### LoanRegistry · second-priority surface

A soulbound ERC-721. Every originated loan is one NFT carrying immutable origination data (borrower, commodity, corridor, facility size, tranche split, original offtaker price, senior coupon rate) plus mutable lifecycle state (status, current maturity, CCR, cumulative repayment split). LoanRegistry is the public audit trail of the book. **It holds no capital and is not a NAV source.** sPLUSD share price does not read from it.

### Core protocol contracts

Five contracts run the operational flows. Together they are how the Protocol Layer actually works day-to-day; individually they sit behind the Token Architecture and the LoanRegistry in the public view, but every one of them is load-bearing.

- **DepositManager** — atomic entry point for deposits. Pulls USDC from the lender to the Capital Wallet and mints PLUSD 1:1 in the same transaction. No off-chain signer in the critical path.
- **YieldMinter** — gates yield-leg mints. Verifies a Relayer ECDSA signature and a Trustee EIP-1271 signature on-chain before calling `PLUSD.mintForYield`. Replay-protected by a per-attestation `ref` guard. Destinations are hard-constrained to the sPLUSD vault or Treasury Wallet.
- **WithdrawalQueue** — strict FIFO exit queue. Lenders escrow PLUSD and receive a `queue_id`; the Relayer pulls USDC from the Capital Wallet via a pre-approved allowance; the lender claims, burning PLUSD and receiving USDC atomically.
- **WhitelistRegistry** — on-chain allowlist of KYC'd lender addresses with their Chainalysis `approvedAt` timestamps. Gates every PLUSD transfer and every deposit-side mint.
- **AccessManager** — the role hub. Every privileged call routes through this contract — instantly for GUARDIAN, through a timelock for ADMIN and RISK_COUNCIL.

---

## Recovery System · terminal mode

Two contracts, dormant in normal operation, engaged only on protocol-wide wind-down. **Recovery System is not a third operational layer.** It is the terminal exit door — when active, it freezes the mint paths, freezes the share price, and lets every holder redeem at one fixed rate. It exists so that a credit event severe enough to chew through the Equity tranche and the sPLUSD cushion has a deterministic exit instead of a panic-driven one.

### ShutdownController

A one-way switch. RISK_COUNCIL proposes shutdown at a fixed recovery rate; ADMIN executes after a 24-hour delay; GUARDIAN can cancel during the window. Once active, all mint paths revert and the recovery rate is fixed. The rate can ratchet up only — never down — as recovery cash is repatriated into the pool.

### RecoveryPool

A USDC escrow that holds the cash redeeming lenders pull against at the frozen recovery rate. ADMIN can deposit additional USDC into it over time as recovery progresses. Every PLUSD redeemed during shutdown — direct, via sPLUSD, or via the queue — pays the same USDC fraction. There is no race and no queue jump.

The Recovery System is invisible in normal operation. See [Default management](/defaults-and-losses/) for when and why it engages.

---

## Operators and Governance

The two layers above describe what holds capital and what records claims. This section describes who actually moves things. Two surfaces, distinct cadences: **Operators** do continuous work (every day, every block, every withdrawal); **Governance** handles privileged events (role grants, defaults, shutdowns). Both sit outside the layer blocks and interact with the protocol from the outside.

### Operators

The continuous-work surface. These parties are active every day, not just during privileged events.

- **Trustee · Pipeline Trust Co.** — independent legal entity, holds one cosigner share on the institutional custody, and is the second signer on every yield attestation through `YieldMinter`'s Trustee EIP-1271 contract. Also holds the `TRUSTEE` role on LoanRegistry — mints loan NFTs, records repayment splits, closes loans at maturity. The Trustee cannot move USDC alone, cannot mint PLUSD, and cannot adjust sPLUSD share price.
- **Pipeline Team** — holds two cosigner shares on the institutional custody. Required (with the Trustee) on every transfer above the auto-funded withdrawal envelope.
- **External Counterparties** — two reputable third parties hold the remaining two cosigner shares. Their role is structural: they make a Team-only or Trustee-only quorum impossible.
- **Relayer** — the off-chain backend that bridges the two layers. Indexes on-chain events, co-signs yield attestations against repayments, funds withdrawal-queue entries via a pre-approved allowance, and maintains the whitelist. Holds the `FUNDER` role on WithdrawalQueue and the `WHITELIST_ADMIN` role on WhitelistRegistry. **Holds no cosigner share on the Capital Wallet.** A fully compromised Relayer cannot mint deposit-leg PLUSD (deposits are atomic), cannot mint yield PLUSD alone (Trustee co-signature required), and cannot move USDC at all.

### Governance

The privileged-event surface. Three Gnosis Safes with distinct signer sets, every write routed through AccessManager.

- **ADMIN · 3/5 · 48h timelock** — role grants, re-grants, unpauses, upgrades, parameter changes. A 14-day meta-timelock gates the delay setting itself, blocking the "collapse the delay then exploit" pattern.
- **RISK_COUNCIL · 3/5 · 24h timelock** — `setDefault` on LoanRegistry, `proposeShutdown` on ShutdownController, `adjustRecoveryRateUp`. No upgrade authority, no role-grant authority.
- **GUARDIAN · 2/5 · instant** — pause any pausable contract, cancel pending scheduled actions, revoke named operational-role holders. Cannot grant roles, cannot unpause, cannot upgrade, cannot move funds. A compromised GUARDIAN can grief but cannot escalate.

The split is deliberate. **Defensive action is fast; constructive action is slow.** GUARDIAN can stop things instantly. Only ADMIN can start them again, and only after a window that GUARDIAN itself can veto. See [Governance](/security/governance/) for the full split.

---

## Why this matters for a lender

Your USDC sits in an institutional MPC custody, not inside a smart contract. A bug in the Protocol Layer cannot drain Capital Layer dollars. A single compromised cosigner cannot mint Protocol Layer PLUSD or move Capital Layer USDC. A captured ADMIN Safe cannot move quickly enough to outrun GUARDIAN's veto. Recovery System is dormant by design, deterministic when engaged.

---

## Related

- [Yield engines](/how-it-works/yield-engines/) — how senior coupons and realised T-bill yield reach the sPLUSD vault.
- [Custody](/security/custody/) — the institutional custody model and the cosigner policy in detail.
- [Governance](/security/governance/) — the three Safes and their powers.
- [For lenders](/lenders/) — the lender-side walkthrough.
- [Potential risks](/risks/) — what can still go wrong.
