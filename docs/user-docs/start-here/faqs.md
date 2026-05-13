---
title: FAQs
order: 1
section: Start here
---

# FAQs

### What is Pipeline?

Pipeline is a decentralized commodity trade finance protocol. Lenders deposit USDC and earn from senior lending to finance commodity trades — high yield, short duration, secured by physical cargo, self-liquidating, tracked on a public on-chain registry. 

- Deal-by-deal underwriting, not balance-sheet financing.
- Up to 30% first-loss equity on every facility.
- Not a fund, not a yield aggregator.

### Where does the yield come from?

Two sources.

- Senior coupons on commodity trade loans, paid by offtakers when cargo is delivered.
- Realised T-bill yield on non-deployed USDC reserves held as USYC.

No token emissions, no perpetual funding, no rehypothecation.

### What is the origin of the commodity trade flow?

Pipeline onboards Loan Originators — established lenders in commodity trade finance with their own underwriting and borrower networks. Pipeline does not originate directly. Each Originator contributes an equity tranche on every deal. Inaugural Originator: Open Mineral AG (Mubadala-backed, ex-Glencore principals).

### How can I start earning yield?

1. Connect a self-custodied wallet (e.g., MetaMask or Rabby).
2. Call `DepositManager.deposit(amount)` with at least $1,000 USDC. Funds park in the Intake Wallet.
3. KYT screening runs off-chain. On a clean result, call `claim(depositId, attestation, signature)` to enrol on the whitelist and mint PLUSD 1:1 in the same transaction.
4. Stake PLUSD into the PLUSD staking vault and receive sPLUSD.
5. Yield accrues to sPLUSD — no claim step. Full walkthrough in [Quick start manual](/start-here/quick-start/).

### How is my senior capital protected?

Two independent layers protect the senior tranche: economic cushion in the deal structure and architectural safeguards in the operational stack.

**Credit protection (deal structure):**

- **LTV haircut.** An 80% average advance rate provides 20% overcollateralization.
- **Equity tranche.** Subordinated capital absorbs first loss (up to 30% of each facility).
- **Pro-rata terminal mode.** If the cushion is breached, senior holders receive an identical recovery rate.

**Operational protection (technical architecture):**

- **Institutional custody (BitGo).** No smart contract holds lender USDC principal.
- **Split-rail architecture.** Hardware circuit breaker cuts custody in any emergency or smart contract bug.
- **On-chain transparency.** All protocol actions are recorded on-chain and independently verifiable.

### What are PLUSD and sPLUSD?

**PLUSD is the dollar receipt** — an ERC-20 token, minted 1:1 against deposited USDC, freely transferable, no yield.

**sPLUSD is the yield-bearing share** of an ERC-4626 vault for PLUSD staking. sPLUSD price rises as the vault accrues senior coupons from commodity trades and T-bill yield mints in.

### How fast can I withdraw?

Unstake any time — no lock-up. Submit a withdrawal request, claim USDC yourself once the queue is funded. Routine sizes settle same-day. Large requests may wait for the Trustee to top up the Withdrawal Queue Wallet from reserves.

### How is risk managed?

All loans pass the protocol's Credit Policy gates before approval. Pipeline finances only:

- Eligible commodities (non-perishable, high commoditisation, deep liquidity)
- Pre-approved trading corridors
- Deal structures with ultimate collateral control
- Trade parties meeting strict compliance, financial and operational standards

Live loans are narrowly monitored — independent inspections at every trade milestone, independent collateral managers, independent price oracles, CTRM vessel feeds, sanctions screening across all counterparties.

Risk committee reviews concentration weekly and approves every facility.

Asset-class default rate is below 0.3%.

### What legal structure underpins Pipeline?

A **purpose trust** sits at the centre of the structure, governed by a trust deed that recognises on-chain protocol actions as legally binding. Each financed trade is held in its own sub-trust, isolating its collateral from every other trade.

A **fiduciary trustee** is the regulated party authorised to move capital, acting only on authenticated on-chain instructions consistent with the trust deed. Two operating entities sit alongside the trust:

- **The Trust Company (Cayman)** — the regulated trustee managing funds and legal title to collateral on behalf of their beneficiaries.
- **Trade Company (Cayman SPC)** — the operating counterparty that structures each physical trade in a bankruptcy-remote cell and posts collateral into the sub-trusts.

This separation means the entity doing the trades is distinct from the entity holding the collateral, and neither can unilaterally access senior capital.

### What jurisdictions can Pipeline serve?

On the lender side, the protocol is available for whitelisted entities and individuals from non-sanctioned jurisdictions, non-US. Wallets on OFAC or equivalent sanctions lists cannot be served.

On the borrower side, Pipeline tiers loan jurisdictions by enforcement reliability and prohibits lending to sanctioned jurisdictions (OFAC/EU/UN/UK), those without functioning warehouse receipt law, with USD-blocking capital controls (except carve-outs, currently Mainland PRC), or in active armed conflict.
