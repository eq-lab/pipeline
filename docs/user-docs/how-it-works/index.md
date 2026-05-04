---
title: How Pipeline works
order: 2
section: How Pipeline works
---

# How Pipeline works

Pipeline runs on two layers connected by a single bridge. The **Capital Layer** is off-chain and holds every USD and USDC deployed against a loan, in an institutional MPC custody. The **Protocol Layer** is on-chain and issues PLUSD and sPLUSD against that backing, records each loan, and runs Lender-facing business logic. The **Relayer** sits between the two — it watches the chain, co-signs yield mints, and funds withdrawals, but it never custodies USDC and cannot mint alone. External actors — the Trustee and the three governance Safes — interact with the layers from outside.

<div class="callout safety">
  <h4>Split-layer safety property</h4>
  <p><em>"A bug or exploit in on-chain code cannot drain investor capital unilaterally."</em></p>
</div>

{% include diagram.html src="d1-system-context.svg" caption="Pipeline system context — Capital Layer off-chain, Relayer in the middle, Protocol Layer on-chain. External actors operate from outside the layers." %}

---

## Capital Layer

Lender USDC and the USYC reserve sit in an **institutional custody** operated under BitGo's MPC TSS policy. The custody is configured with **five cosigner shares** held by independent parties — the **Trustee**, the **Pipeline Team (two shares)**, and **two reputable external counterparties** — under a **3-of-5 threshold** with a hard policy rule that no transfer signs without both Team and Trustee participating. BitGo is the software substrate; it holds no signing share and cannot freeze or seize funds. No protocol contract can spend from the custody.

### USD Account

A USD bank account in the Trustee's name. Offtaker payments for cargoes wire here; the Trustee identifies the wire, matches it to a loan, and on-ramps USD → USDC into the Capital Wallet via Circle Mint, Zodia, or a similar regulated provider. The USD account is the off-chain entry point for repayments.

### Capital Wallet

The MPC address holding all lender USDC plus the USYC (tokenised T-bill) position. Target USDC buffer is 15% (band 10–20%); the rest is held as USYC. USYC NAV drifts up daily as the underlying T-bills accrue, but that gain is **unrealised** until the Trustee instructs the wallet to sell USYC for USDC against the Hashnote redemption rail — only realised proceeds can feed a PLUSD yield mint.

### Treasury Wallet

A separate institutional-custody address that collects protocol fees (management, performance, OET) and the 30% Treasury share of realised T-bill yield. Same custody substrate, separate cosigner policy.

### Emergency disconnect

Custody policy carries a hardware circuit breaker that disconnects the Capital Wallet from the protocol contracts on alarm — pre-approved allowances are revoked, all standing transfer authorisations are frozen. The breaker is a custody-side action; it does not require a smart-contract upgrade or a governance vote, and BitGo cannot pull this lever.

---

## Relayer

The Relayer is the off-chain backend that bridges the two layers. It indexes on-chain events, co-signs yield attestations against repayments, funds withdrawal-queue entries from the Capital Wallet's pre-approved allowance, and maintains the whitelist. On the cash side, the Relayer holds **no MPC cosigner share** — it cannot move USDC. On the token side, it holds the `FUNDER` role on WithdrawalQueue and the `WHITELIST_ADMIN` role on WhitelistRegistry, and it is the first signer on yield attestations — but the **YieldMinter contract requires the Trustee's independent EIP-1271 co-signature** before any PLUSD mints. A fully compromised Relayer cannot mint deposit-leg PLUSD (deposits are atomic), cannot mint yield PLUSD alone, and cannot move USDC at all.

The Relayer is also where the **Mint** and **Redeem** flows physically execute: Mint into the Protocol Layer when a co-signed yield attestation lands, Redeem against the Capital Layer when a withdrawal-queue entry is funded.

---

## Protocol Layer

The Protocol Layer is a set of on-chain contracts. **Token architecture** sits at the top. **LoanRegistry** sits as the second-priority surface — the public audit trail of every loan. The **core protocol** runs the deposit, mint, withdraw, and access flows. A **Recovery System** holds the terminal wind-down state.

### Token architecture · PLUSD and sPLUSD

**PLUSD** is the dollar receipt — an ERC-20 minted 1:1 against USDC entering the Capital Wallet. Every PLUSD transfer is gated by the WhitelistRegistry. Two mint paths exist (`mintForDeposit` from DepositManager, `mintForYield` from YieldMinter) and the contract asserts a reserve invariant on every mint.

**sPLUSD** is the yield-bearing share — a standard ERC-4626 vault whose underlying asset is PLUSD. Any PLUSD holder can stake; there is no whitelist at the share level. The vault's `totalAssets()` rises when a yield mint lands in it, and share price moves on that event — and only that event.

### LoanRegistry · second-priority surface

A soulbound ERC-721. Every originated loan is one NFT carrying immutable origination data (borrower, commodity, corridor, facility size, tranche split, original offtaker price, senior coupon rate) plus mutable lifecycle state (status, current maturity, CCR, cumulative repayment split). LoanRegistry is the public audit trail of the book. **It holds no capital and is not a NAV source.** sPLUSD share price does not read from it.

### Core protocol

- **DepositManager** — atomic entry point for deposits. Pulls USDC from the lender to the Capital Wallet and mints PLUSD 1:1 in the same transaction. No off-chain signer in the critical path.
- **YieldMinter** — gates yield-leg mints. Verifies a Relayer ECDSA signature and a Trustee EIP-1271 signature on-chain before calling `PLUSD.mintForYield`. Replay-protected by a per-attestation `ref` guard. Destinations are hard-constrained to the sPLUSD vault or Treasury Wallet.
- **WithdrawalQueue** — strict FIFO exit queue. Lenders escrow PLUSD and receive a `queue_id`; the Relayer pulls USDC from the Capital Wallet via a pre-approved allowance; the lender claims, burning PLUSD and receiving USDC atomically.
- **WhitelistRegistry** — on-chain allowlist of KYC'd lender addresses with their Chainalysis `approvedAt` timestamps. Gates every PLUSD transfer and every deposit-side mint.
- **AccessManager** — the role hub. Every privileged call routes through this contract — instantly for GUARDIAN, through a timelock for ADMIN and RISK_COUNCIL.

### Recovery System · ShutdownController and RecoveryPool

A pair of contracts that together run the terminal wind-down. **ShutdownController** is a one-way switch — RISK_COUNCIL proposes shutdown at a fixed recovery rate, ADMIN executes after a 24-hour delay, and GUARDIAN can cancel during the window. Once active, all mint paths revert and the recovery rate is fixed; it can ratchet up only — never down — as recovery cash is repatriated. **RecoveryPool** holds the USDC that redeeming lenders pull against at the frozen rate. Together they constitute the protocol's terminal exit path.

---

## External actors

The Trustee, Team, Counterparties, and the three governance Safes interact with the protocol from outside the two layers. The Trustee co-signs every USDC movement and records loans on LoanRegistry. The Team and Counterparties hold the four remaining cosigner shares on the institutional custody. The three Safes — ADMIN, RISK_COUNCIL, GUARDIAN — hold every privileged role on the Protocol Layer and route their writes through AccessManager. See [Governance](/security/governance/) for the full split.

---

## Why this matters for a lender

Your USDC sits in an institutional MPC custody, not inside a smart contract. A bug in the Protocol Layer cannot drain Capital Layer dollars. A single compromised cosigner cannot mint Protocol Layer PLUSD or move Capital Layer USDC. Every sensitive action on either layer has at least two independent gates: the cosigner quorum on one side, AccessManager plus three-Safe governance on the other.

---

## Related

- [Yield engines](/how-it-works/yield-engines/) — how senior coupons and realised T-bill yield reach the sPLUSD vault.
- [Custody](/security/custody/) — the institutional custody model and the cosigner policy in detail.
- [Governance](/security/governance/) — the three Safes and their powers.
- [For lenders](/lenders/) — the lender-side walkthrough.
- [Potential risks](/risks/) — what can still go wrong.
