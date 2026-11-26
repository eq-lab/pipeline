---
title: FAQs
order: 1
section: Start here
---

# FAQs

### What is Pipeline?

Pipeline is a permissioned commodity trade finance protocol. Lenders lend USDC and earn interest from loans that finance physical commodity trades. The loans are short, secured on the physical goods, repaid from the sale of the goods, and recorded on-chain.

- Each deal is underwritten on its own. There is no balance-sheet lending.
- The Originator of each deal lends a minimum of 5–20% of it alongside the pool.
- Pipeline is not a fund and not a yield aggregator.

### Where does the yield come from?

From the interest on commodity trade loans. Borrowers pay it monthly, while principal comes back from the sale of the goods. When interest is booked, it is minted net of fees as PLUSD into the staking vault.

No token emissions, no perpetual funding, no rehypothecation.

### What is the origin of the commodity trade flow?

Pipeline onboards Loan Originators: established lenders in commodity trade finance with their own underwriting and borrower networks. The Originator underwrites every deal it brings and lends in it alongside the pool.

### How can I start earning yield?

1. Connect a self-custodied wallet.
2. Submit a deposit request of at least 1,000 USDC. The USDC goes straight to the custody account.
3. The platform runs KYT on your address and the deposit. If the result is clean, it approves your address to hold PLUSD and signs a voucher. Claim with it, and PLUSD is minted to you 1:1.
4. Stake PLUSD in the PLUSD staking vault and receive sPLUSD.
5. Yield goes into the sPLUSD price. There is no claim step. Full walkthrough in [Quick start manual](/start-here/quick-start/).

### How is my capital protected?

Two layers protect lenders: the deal structure and the operating setup.

Deal structure:

- Every loan is full recourse to the borrower and secured on the goods and the buyer's payment. The security must rank first, confirmed by a local legal opinion.
- The advance ratio caps a loan at 80%, 75% or 65% of the value of the goods, by commodity class. The rest is the cushion.
- Collateral is marked to market daily. If the loan-to-value ratio (LTV) rises 5 points above the advance ratio, the borrower must restore it within 3 business days, in cash or by partial repayment. At 10 points above, the Risk Council may declare a default.
- The borrower puts its own equity into each trade, and the Originator lends at least 5–20% of the facility on the same terms as the pool, so it shares any loss.
- If a loan defaults, the Security Agent enforces the security and the goods are sold through pre-qualified liquidators. Recoveries repay sPLUSD holders.

Operating setup:

- Deposited USDC goes straight to a custody account. No smart contract holds lender USDC.
- Custody runs on MPC wallets with a 3-of-5 quorum. The Independent Trustee, a licensed trust company, holds a mandatory key and co-signs every payment out of Pipeline's accounts.
- An independent Security Agent holds the bills of lading, by way of pledge, and the other security papers on trust for all lenders. It records them in the on-chain security registry and co-signs the collection account.
- In an emergency, each core smart contract can be paused at once, and a hardware circuit breaker can cut the relayer's access to custody.
- All protocol actions are recorded on-chain and can be checked independently.

### What are PLUSD and sPLUSD?

PLUSD is the dollar token. 1 PLUSD is a claim on 1 USDC of the pool. It is minted 1:1 for USDC deposits and for USD bank wires. The protocol mints PLUSD only to addresses approved after KYT. It earns nothing on its own.

sPLUSD is a share in the staking vault that holds PLUSD. The sPLUSD price rises when loan interest net of fees is minted into the vault.

### How fast can I withdraw?

Pipeline keeps 10–15% of the pool in an on-chain liquidity buffer for instant exits.

- Unstake sPLUSD and request a withdrawal.
- Retail withdrawals are paid instantly from the buffer once the platform has screened the request.
- If the buffer runs short, requests are paid in order as it is topped up.
- Larger withdrawals are paid at the quarterly withdrawal windows.

The rest of the pool is lent in trades of up to 180 days, so larger exits follow the windows.

### How is risk managed?

All loans are screened against Pipeline's Credit Policy and require individual approval from the Risk Council.

Pipeline finances only trades that fit its risk mandate:

- Eligible commodities (a shelf life of at least 12 months, a standard grade, deep liquidity)
- Pre-approved jurisdictions and trade corridors
- Deal structures with first-ranking security over the collateral
- Trade parties passing the Credit Policy's risk score

Live loans are monitored daily:

- Independent inspections at loading, in transit (where needed), and discharge
- Weekly monitoring reports on stored goods
- CTRM vessel feeds
- Continuous AML and sanctions screening across all counterparties
- Live geopolitical monitoring across active trade corridors

The Risk Council reviews concentration weekly.

The asset class has a historic default rate below 0.3%.

### What legal structure underpins Pipeline?

Pipeline's legal structure is bankruptcy-remote, and no single person can approve a loan or move funds:

- No one owns it beneficially
- Every outflow of funds is supervised and co-signed by a licensed trustee
- An independent director approves each facility after the Risk Council
- The independent Security Agent holds the loans' security on trust for all lenders and co-signs the borrower's collection account

A charitable trust owns the lending vehicle that finances commodity trades. The lending vehicle wholly owns a funding vehicle, which borrows USDC from lenders, keeps the liquidity buffer, and lends the rest to the lending vehicle. Each trade loan sits under a master facility agreement, with the Originator lending alongside on the same terms.

### What jurisdictions can Pipeline serve?

Lenders: the protocol is available to entities and individuals from non-sanctioned jurisdictions, non-US. Wallets on OFAC or equivalent sanctions lists cannot be served.

Trades: Pipeline finances only in jurisdictions on the Credit Policy's list. Every counterparty, and every place the goods are loaded, stored, or discharged, must be on it. Sanctioned jurisdictions, jurisdictions without functioning warehouse-receipt law, and those in active armed conflict are excluded. No borrowers in Mainland PRC or other jurisdictions with capital controls, including Türkiye and Vietnam. No financing through the Red Sea, the Gulf of Aden, or the Black Sea.
