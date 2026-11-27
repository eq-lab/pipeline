---
title: Legal
order: 37
section: Reference
---

# Legal

This page gathers the compliance and legal framing for Pipeline. Nothing on this page is legal advice. Consult your own counsel before participating.

## Eligibility

Pipeline serves entities and individuals from non-sanctioned jurisdictions, outside the US. Every lender address and every USDC deposit are screened (KYT, Know Your Transaction) before PLUSD is minted. Lenders who wire USD pass KYC (Know Your Customer) or KYB (Know Your Business). Originators pass KYB, KYT, AML and sanctions checks. Borrowers and every other party to a deal pass KYB, AML and sanctions checks.

## Cannot serve

- Wallets on OFAC or equivalent sanctions lists
- Lenders from the US or from sanctioned jurisdictions
- Legal entities or individuals failing KYT or wallet screening, or KYC or KYB where it applies

## Terms of use

The terms of use govern wallet onboarding, compliance obligations, eligibility, dispute resolution, and governing law for the offering.

*Terms of use, pending publication.* The full Terms of Use will be published here. Lenders must accept the terms before their first deposit.

## Privacy policy

Pipeline collects KYC, KYB and KYT screening data through its compliance vendors. It does not sell or share this data with third parties outside of vendor workflows required for screening.

*Privacy policy, pending publication.* The full Privacy Policy will be published here.

## Not financial advice

Information on this site is not investment, legal, or tax advice. Yield figures are illustrative unless explicitly stated otherwise. Do your own due diligence and talk to a qualified advisor before committing capital. Past default rates and historic returns in commodity trade finance are not guarantees of future Pipeline performance.

## Regulatory framework

Each facility is a secured loan to a borrower under a master facility agreement (MFA) and an agency deed.

- Lenders lend USDC to a bankruptcy-remote funding vehicle, which lends to the lending vehicle. A charitable trust owns the lending vehicle, so neither vehicle has a beneficial owner.
- The lending vehicle lends in each facility pari passu with the Loan Originator. The Originator and other lenders join a facility by accession, or take over a share by transfer certificate.
- Pipeline, as Facility Agent, administers the facility: drawdowns, repayments, payments, accessions and transfer certificates.
- The Independent Trustee, a licensed trust company, co-signs every payment out of both vehicles' accounts, except withdrawals paid automatically from the buffer, and approves every drawdown.
- The Security Agent, an independent security trustee, holds the security on trust for all lenders by the priority of payments. It is independent of Pipeline and of every Originator.
- Bills of lading are endorsed to the Security Agent by way of pledge. The lender never takes title to the goods.
- The Security Agent co-signs the borrower's collection account.
- A facility is funded only where the lenders' security ranks first. A local legal opinion confirms it.
- An independent inspector, appointed and paid by the borrower from Pipeline's panel, checks the goods.
- The borrower carries full recourse. The goods are security for the loan.
- Lender decisions are taken by the Majority Lenders. Changes to economics need all lenders.

Lender access is permissioned by KYT and sanctions screening, with KYC or KYB for bank wires. Where the regulatory regime in a target jurisdiction evolves, Pipeline's eligibility list and structural architecture are updated accordingly. The protocol does not represent that it is registered, authorised, or licensed under securities, banking, or commodities regulation in any specific jurisdiction beyond what is published in the eligibility list.

## Privacy and data

No counterparty name or document is published. Hashes are salted.

| Public on-chain | Salted hash only | Kept off-chain |
|---|---|---|
| Principal, rate, status, maturity dates, coverage | Borrower, supplier and buyer identity | Names, contracts, invoices, KYB and KYT files |
| Commodity, quantity, corridor and location by region | Vessel and warehouse identity; bills of lading, receipts, notices | Inspection reports and photographs |
| Inspected quantity, quality and variance | Inspection certificates, accession deeds, transfer certificates, consents, lender instructions, legal opinions | Credit memos and lenders' committee papers |

Counterparty data collected through the screening providers is held subject to the published privacy policy. Wallet-screening data is used for sanctions and AML compliance. Neither is shared beyond regulatory necessity and the operational requirements of approving addresses to hold PLUSD.

## Counsel of record

Each facility has a satisfactory local legal opinion on security perfection and enforcement in the borrower's and the goods' jurisdictions. The opinion is a condition precedent to funding. Its salted hash sits in the security record.
