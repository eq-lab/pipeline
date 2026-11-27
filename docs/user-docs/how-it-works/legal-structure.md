---
title: Legal structure
order: 9
section: How Pipeline works
---

# Legal structure

Pipeline's legal structure rests on three principles.

## Design principles

### Bankruptcy remoteness

Lenders lend to a bankruptcy-remote funding vehicle. A charitable trust owns the lending vehicle, which wholly owns the funding vehicle, so no one owns the structure beneficially. Security sits with the Security Agent, on trust for all lenders. Title documents held by the Security Agent do not form part of its estate. The borrower's collection account carries no credit facility at its bank, and the bank waives set-off.

### Secured lending with full recourse

The lenders hold a claim on the borrower, with full recourse. The commodity is security for that claim. The lenders never take title to the goods: the borrower formally keeps title, while the lenders control the goods and hold the commercial claim on the offtaker until repayment.

Every facility requires first-ranking security, confirmed by a local legal opinion. Pipeline is named as financier in the purchase contract, by an addendum the seller acknowledges, in the collateral management agreement and in the notice of assignment to the offtaker. Bills of lading name the Security Agent as consignee, or are endorsed to it by way of pledge, for all lenders. Warehouse receipts and cargo insurance name it too.

### Lenders decide, agents execute

Grace, extensions, default, the call of the loan, enforcement and write-downs are lender decisions under the master facility agreement. The Majority Lenders take them. Changes to economics and release of security outside its release condition need the consent of all lenders. The Facility Agent and the Security Agent carry the decisions out and record them.

## Structure

- **Charitable trust**: owns the lending vehicle. The structure has no beneficial owner.
- **Lending vehicle**: lends pool capital in every facility under the master facility agreement, pari passu with the Originator. Bankruptcy remote. An independent director approves each facility after the Risk Council.
- **Funding vehicle**: wholly owned by the lending vehicle. Borrows USDC from lenders under limited-recourse loan agreements, keeps the liquidity buffer, and lends the rest to the lending vehicle.

Each facility is documented by a master facility agreement (MFA) and an agency deed, with security documents per jurisdiction.

- **Loan Originator**: lends in the facility pari passu with the lending vehicle and joins it by accession deed. Other lenders join the same way, or take over an existing share by transfer certificate.
- **Borrower**: owes the loan with full recourse. Grants security to the Security Agent. Opens a collection account charged to the Security Agent, which co-signs it.
- **Facility Agent**: Pipeline, appointed under the agency deed. Keeps the facility records, records drawdowns, repayments, payments, accessions and transfers, and applies receipts to the lenders by share, mostly through automated protocol functions.
- **Security Agent**: an independent security trustee appointed under the agency deed: the bills of lading by way of pledge, warehouse release rights, the assigned sale proceeds, loss-payee rights under the cargo insurance and any trade credit insurance, and a charge over the collection account. Enforces on Majority Lender instruction.
- **Inspector**: an independent inspector from Pipeline's panel, appointed and paid by the borrower under the facility agreement. Reports are addressed to the Security Agent and all lenders.

Each agent is liable only for gross negligence, wilful misconduct or fraud. The Majority Lenders may replace either agent. Recoveries are applied in this order: enforcement costs, principal to all lenders pro rata, interest pro rata, protocol fees accrued up to the default date, and any surplus to the borrower. A change to the collection account's mandate or a diverted payment is an event of default.

## Independent Trustee

The Independent Trustee is a licensed trust company. It:

- Holds a mandatory key on every custody account
- Co-signs every payment out of the lending vehicle's and the funding vehicle's accounts; inflows and withdrawals paid automatically from the on-chain buffer are exempt
- Approves every drawdown
- Signs drawdowns, lender wires out and USD/USDC conversions on-chain through the Trustee role
- Can freeze payments and have either vehicle's board replaced on a trigger event

The Trustee holds no security and does not underwrite or verify trades. Enforcement against borrowers belongs to the Security Agent.

## What is not part of the legal structure

The Loan Originator is not a Pipeline entity. It is a per-deal counterparty. It joins a facility as a lender by accession and lends pari passu with the lending vehicle.

## Legal counsel

A satisfactory local legal opinion on security perfection and enforcement, in the borrower and goods jurisdictions, is a condition precedent to each facility.

## Confidentiality

No counterparty name or document is published. Hashes are salted.

| Public on-chain | Salted hash only | Kept off-chain |
|---|---|---|
| Principal, rate, status, maturity dates, coverage | Borrower, supplier and buyer identity | Names, contracts, invoices, KYB and KYT files |
| Commodity, quantity, corridor and location by region | Vessel and warehouse identity; bills of lading, receipts, notices | Inspection reports and photographs |
| Inspected quantity, quality and variance | Inspection certificates, accession deeds, transfer certificates, consents, lender instructions, legal opinions | Credit memos and lenders' committee papers |
