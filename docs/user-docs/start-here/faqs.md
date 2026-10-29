---
title: FAQs
order: 1
section: Start here
---

# FAQs

### What is Pipeline?

Pipeline is a permissioned commodity trade finance protocol. Lenders deposit USDC or wire USD and earn from senior loans that finance commodity trades. The loans are short, secured by physical goods, repaid from the sale of the goods and recorded in a public on-chain loan registry.

- Each deal is underwritten on its own. There is no balance-sheet lending.
- The Originator funds a first-loss equity tranche of up to 30% of each facility.
- Pipeline is not a fund and not a yield aggregator.

### Where does the yield come from?

From the senior interest on commodity trade loans. Borrowers pay it from the sale of the goods. When a repayment is booked, the interest net of fees is minted as PLUSD into the staking vault.

No token emissions, no perpetual funding, no rehypothecation.

### What is the origin of the commodity trade flow?

Pipeline onboards Loan Originators: established lenders in commodity trade finance with their own underwriting and borrower networks. Pipeline does not originate directly. Each Originator funds an equity tranche on every deal.

### How can I start earning yield?

1. Pass KYB and connect a self-custodied wallet.
2. Submit a deposit request of at least 1,000 USDC. The USDC goes straight to the custody account.
3. The platform runs KYT on your address and the deposit. On a clean result it approves your address to hold PLUSD and signs a voucher. Claim with it, and PLUSD is minted to you 1:1.
4. Stake PLUSD in the staking vault and receive sPLUSD.
5. Yield goes into the sPLUSD price. There is no claim step. Full walkthrough in [Quick start manual](/start-here/quick-start/).

### How is my senior capital protected?

Two layers protect the senior tranche: the deal structure and the operating setup.

Deal structure:

- Each loan has an advance ratio, 80% by default. The loan is at most 80% of the value of the security. The rest is the cushion.
- The loan-to-value ratio (LTV) is the outstanding amount plus accrued interest, divided by the value of the security. When LTV rises above the margin-call ratio, 85% by default, a margin call opens. The borrower brings LTV back to 80% with cash or goods within the cure period.
- The Originator's equity tranche takes the first loss, up to 30% of each facility.
- If a loan defaults, its share of the pool moves into a separate pocket owned by the sPLUSD holders on the default date. Recoveries go to that pocket and are paid to those holders pro rata.

Operating setup:

- Deposited USDC goes straight to a custody account. No smart contract holds lender USDC.
- An independent Security Agent holds the bills of lading, by way of pledge, and the other security papers on trust for all lenders. It records them in the on-chain security registry and co-signs the collection account.
- Each core smart contract can be paused at once in an emergency.
- All protocol actions are recorded on-chain and can be checked independently.

### What are PLUSD and sPLUSD?

PLUSD is the dollar token. 1 PLUSD is a claim on 1 USD of the pool. It is minted 1:1 for USDC deposits and for USD bank wires. Only approved addresses can hold it. It earns nothing on its own.

sPLUSD is a share in the staking vault that holds PLUSD. The sPLUSD price rises when loan interest net of fees is minted into the vault.

### How fast can I withdraw?

Unstake any time. There is no lock-up. Put your PLUSD in the withdrawal queue. The queue pays in order. You claim your USDC once the custody account holds enough USDC to cover your place in the queue and the platform has signed a voucher for your request. Large requests may wait until the Trustee moves more cash into the custody account.

### How is risk managed?

All loans pass the protocol's Credit Policy gates before approval. Pipeline finances only:

- Eligible commodities (non-perishable, high commoditisation, deep liquidity)
- Pre-approved trading corridors
- Deal structures where, every day the money is out, the Security Agent holds first-ranking security over the goods or a bank's promise to pay
- Trade parties meeting strict compliance, financial and operational standards

Live loans are monitored. Independent inspectors count the goods at each trade milestone. The platform feeds market prices on-chain. A stale price blocks a margin call until a fresh price arrives. Every counterparty passes KYB and KYT and is screened for sanctions.

The Risk Council rules on defaults, write-downs, cures and changes to loan terms. It acts for the Majority Lenders while Pipeline is the only lender.

Asset-class default rate is below 0.3%.

### What legal structure underpins Pipeline?

Each facility runs under a master facility agreement (MFA) and an agency deed, with security documents per jurisdiction. A bankruptcy-remote lending vehicle is the initial lender. Pipeline's Trustee runs the lending vehicle and its operations. The Trustee records each loan, its disbursements and its closing in the loan registry.

- The facility agent administers the facility: drawdowns, repayments, payments and the priority of payments.
- The Security Agent, an independent security trustee, holds the security on trust for all lenders by the priority of payments. It co-signs the collection account.
- The Loan Originator and other lenders join a facility by accession, or take over a share by transfer certificate.
- The Majority Lenders decide grace, extensions, default, the call of the loan and enforcement. Changes to economics need all lenders. While Pipeline is the only lender, the Risk Council acts for the Majority Lenders.
- The borrower is liable in full. The lender never takes title to the goods. Bills of lading are held by way of pledge.
- A local legal opinion confirms the security ranks first before a facility is funded.

### What jurisdictions can Pipeline serve?

On the lender side, the protocol is available for approved entities and individuals from non-sanctioned jurisdictions, non-US. Addresses on OFAC or equivalent sanctions lists cannot be served.

On the borrower side, Pipeline tiers loan jurisdictions by enforcement reliability and prohibits lending to sanctioned jurisdictions (OFAC/EU/UN/UK), those without functioning warehouse receipt law, with USD-blocking capital controls (except carve-outs, currently Mainland PRC), or in active armed conflict.
