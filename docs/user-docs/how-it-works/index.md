---
title: How Pipeline works
order: 2
section: How Pipeline works
---

# How Pipeline works

Pipeline runs on two separate rails. The **cash rail** holds real USDC at a regulated custodian. The **token rail** is a set of on-chain contracts that issue receipts and run Lender-facing business logic. Rules link the two rails, not shared control. No contract can spend custodian funds. No custodian signer can mint tokens without multi-party approval.

<div class="callout safety">
  <h4>Split-rail safety property</h4>
  <p><em>"A bug or exploit in on-chain code cannot drain investor capital unilaterally."</em></p>
</div>

{% include diagram.html src="d1-system-context.svg" caption="Pipeline system context — cash rail off-chain, token rail on-chain, governance by three Safes." %}

The diagram shows the off-chain cash rail on the left with five boxes (Custodian, Capital Wallet, Treasury Wallet, Relayer, Trustee). The on-chain token rail sits on the right — AccessManager at the top, then eight protocol contracts arranged in a grid. Three Gnosis Safes (ADMIN, RISK_COUNCIL, GUARDIAN) govern from the bottom. The Relayer and the Trustee appear in the cash-rail column because that is where they operate — Relayer co-signs yield attestations and funds withdrawals; the Trustee is a Capital Wallet cosigner. Both also hold specific on-chain roles described below.

---

## The cash rail

The cash rail is where USDC actually sits. A single on-chain address — the Capital Wallet — holds every lender dollar and every dollar deployed to an active loan. The address is held at a regulated third-party custodian (Bitgo), moved only by a fixed set of MPC (multi-party computation) cosigners. **No smart contract in the system can spend from the Capital Wallet.** The cash rail is the protocol's treasury, governed by custodian policy and three independent signers.

### Custodian

A regulated third-party that holds the Capital Wallet and the Treasury Wallet. The custodian operates the MPC signing infrastructure for both wallets and runs an EIP-1271 signer contract on chain. That on-chain signer co-signs every token mint after the custodian has independently verified the underlying USDC inflow against its own records. A compromise of any single other actor — Relayer, Trustee, or Team — cannot uncontrollably mint tokens without the custodian's signature.

### Capital Wallet

The address holding all lender USDC plus the USYC (tokenised T-bill) position. Target USDC buffer 15% (band 10–20%); the rest is held as USYC. USYC NAV drifts up daily, but that gain is **unrealised** until the Trustee instructs the custodian to sell USYC for USDC — only realised proceeds can feed a PLUSD yield mint. Three independent cosigners share control of the wallet: **Trustee**, **Team**, and **Relayer**. Routine lender withdrawals are auto-signed by the Relayer within tight custodian-policy caps. Loan disbursements, USYC sales, and anything above the auto-sign envelope require Trustee and Team cosignature.

### Treasury Wallet

A separate custodied address that collects protocol fees (management, performance, OET) and the 30% Treasury share of realised T-bill yield. Different MPC cosigner set from the Capital Wallet.

### Relayer

The off-chain backend that indexes on-chain events, signs yield attestations, funds withdrawal-queue entries, and maintains the whitelist. It holds two on-chain roles: `FUNDER` on WithdrawalQueue and `WHITELIST_ADMIN` on WhitelistRegistry. The Relayer also signs yield attestations with its `relayerYieldAttestor` key, but it does not hold the `YIELD_MINTER` role itself — that role is held by the YieldMinter contract, which verifies the Relayer signature alongside the custodian's EIP-1271 co-signature before any yield PLUSD mints. Relayer also acts as one of the three Capital Wallet cosigners, but **Relayer never custodies USDC itself**. A fully compromised Relayer cannot mint deposit-leg PLUSD (deposits are atomic), cannot mint yield PLUSD alone (custodian co-signature required), and cannot move USDC alone (Trustee or Team cosign required for any out-of-envelope payout).

### Trustee

An independent Swiss-based trusted entity. On the cash rail it is one of the three MPC cosigners on the Capital Wallet. On the token rail it holds the `TRUSTEE` role on LoanRegistry — the Trustee mints loan NFTs, records repayment splits, and closes loans at maturity. The Trustee cannot move USDC alone (Relayer cosign is required) and cannot mint PLUSD. LoanRegistry writes are pure accounting, they do not feed sPLUSD share price.

---

## The token rail

The token rail is a set of on-chain contracts. Ten in total: an **AccessManager** role hub and nine protocol contracts that issue IOUs and track behaviour. Rules link the rails, not shared control. No contract can spend custodian funds. No custodian signer can mint tokens alone.

The **AccessManager** is the central authority contract. Every privileged call — a role grant, an unpause, an upgrade, an emergency revocation — routes through this smart contract, either instantly for GUARDIAN or through a timelock for ADMIN and RISK_COUNCIL.

### AccessManager

The role hub, deployed fresh from OpenZeppelin v5.x with no custom code. Every protocol contract asks AccessManager whether a given caller is authorised for a given selector. AccessManager also schedules timelocked actions — 48-hour delay on most ADMIN changes, 24-hour on RISK_COUNCIL actions, 14 days on changes to the delay setting itself.

### DepositManager

The atomic entry point for deposits. A whitelisted lender calls `deposit(amount)`; the contract pulls USDC to the Capital Wallet and mints PLUSD 1:1 in the **same transaction**. No off-chain signer gates the deposit path — the on-chain USDC movement is itself the attestation. DepositManager holds the `DEPOSITOR` role on PLUSD. Four economic caps bound supply: `maxPerWindow` ($10M per 24h), `maxPerLPPerWindow`, `maxTotalSupply`, and `freshnessWindow` (the 90-day Chainalysis freshness gate on deposits). 

### PLUSD

An ERC-20 receipt token minted 1:1 against deposited USDC. Currently every transfer is gated by the WhitelistRegistry. Minimum logic, standard token contract interfaces. This contract tracks three cumulative counters (deposits, yield mints, burns) and asserts a reserve invariant on every mint path. Two mint functions exist: `mintForDeposit` (DEPOSITOR role, held by DepositManager) and `mintForYield` (YIELD_MINTER role, held by YieldMinter). PLUSD itself does no signature verification — that lives one layer up.

### YieldMinter

A dedicated contract for yield-leg mints. `YieldMinter.yieldMint(attestation, relayerSig, custodianSig)` is the public entry point — anyone can call it, but the call only succeeds if both signatures verify on-chain. Verifies the Relayer ECDSA signature against the configured `relayerYieldAttestor`, the custodian's EIP-1271 signature against `custodianYieldAttestor`, the attestation `ref` is unused (replay protection), the destination is the sPLUSD vault or Treasury Wallet, and the amount is non-zero. On success, calls `PLUSD.mintForYield`. Holds the `YIELD_MINTER` role on PLUSD; pause is GUARDIAN-instant, attestor rotation is 48h ADMIN-timelocked.

### sPLUSD

A standard ERC-4626 yield vault where the asset is PLUSD. Any PLUSD holder can stake; there is no whitelist at the vault level. The vault's `totalAssets()` rises when a yield mint lands in it, and share price moves on that event — and only that event. Redeeming sPLUSD returns PLUSD; the return transfer is gated by the PLUSD whitelist.

### WithdrawalQueue

A strict FIFO exit queue. Lenders call `requestWithdrawal(amount)` to escrow PLUSD and receive a `queue_id`. Relayer then calls `fundRequest(queueId)` to pull USDC from the Capital Wallet to the queue via a pre-approved allowance. The lender calls `claim(queueId)` — PLUSD burns and USDC transfers to the lender atomically in a single transaction. Funding caps at $5M per transaction and $10M per rolling 24 hours; above-envelope requests route to manual Trustee + Team co-sign.

### WhitelistRegistry

The on-chain allowlist. Maintains the set of KYC'd lender addresses with their Chainalysis `approvedAt` timestamps. PLUSD calls `isAllowed` on every transfer. 
DepositManager calls `isAllowedForMint` (which also checks the 90-day freshness window). A freshness expiry blocks new deposits from that lender until re-screening.

### LoanRegistry

A soulbound ERC-721. Every originated loan facility is represented by one NFT carrying immutable origination data (borrower, commodity, corridor, facility size, senior/equity tranche split, original offtaker price, senior coupon rate) plus mutable lifecycle state (status, current maturity, CCR, cumulative repayment split). **LoanRegistry holds no capital and is not a NAV source.** sPLUSD share price does not read from it. Its purpose is public transparency and audit trail, not accounting.

### ShutdownController

A one-way terminal switch for protocol wind-down. RISK_COUNCIL proposes shutdown at a fixed recovery rate; ADMIN executes after a 24-hour AccessManager delay; GUARDIAN can cancel during the window. Once active, all mint paths revert; lenders exit via pull-based redemption at the frozen rate. The rate can ratchet up only — never down — as recovery cash is repatriated.

### RecoveryPool

A USDC escrow used only after shutdown. Holds the cash that redeeming lenders pull against at the frozen recovery rate. ADMIN can deposit additional USDC into it over time as recovery progresses.

---

## Governance

Three Gnosis Safes hold every privileged role across the protocol. The three Safes have **distinct signer sets** as an operational requirement.

### ADMIN · 3-of-5 Safe

Owns role grants and re-grants, unpauses, upgrades, and parameter changes. Every ADMIN action is scheduled through AccessManager with a 48-hour delay; GUARDIAN can cancel during that window. A 14-day meta-timelock gates the delay setting itself — this blocks the "collapse the delay then exploit" attack pattern.

### RISK_COUNCIL · 3-of-5 Safe

Owns credit and wind-down decisions: `setDefault` on LoanRegistry, `proposeShutdown` on ShutdownController, and `adjustRecoveryRateUp`. Each selector is gated by a 24-hour AccessManager delay, GUARDIAN-cancelable. RISK_COUNCIL has no upgrade authority and no role-grant authority.

### GUARDIAN · 2-of-5 Safe

Defensive only. Can pause any pausable contract, cancel any pending ADMIN scheduled action, and revoke named holders of operational roles (`YIELD_MINTER`, `FUNDER`, `WHITELIST_ADMIN`, `TRUSTEE`) one at a time through `AccessManager.revokeRole`. Every GUARDIAN action is instant. GUARDIAN **cannot** grant roles, unpause, upgrade, or move funds. A compromised GUARDIAN can grief but cannot escalate.

---

## Why this matters for a lender

Your USDC sits at a regulated custodian, not inside a smart contract. A bug in the token rail cannot drain cash-rail dollars. A compromised custodian signer cannot mint token-rail PLUSD. Every sensitive action on either rail has at least two independent gates: custodian cosigners on one side, AccessManager plus three-Safe governance on the other.

---

## Related

- [Yield engines](/how-it-works/yield-engines/) — how the two engines deliver yield to the sPLUSD vault.
- [Supply safeguards](/security/supply-safeguards/) — the four structural safeguards that stop PLUSD from being minted against nothing.
- [Custody](/security/custody/) — the custodian relationship and the MPC cosigner policy in detail.
- [For lenders](/lenders/) — the lender-side walkthrough.
- [Risks](/risks/) — what can still go wrong, in seven named categories.
