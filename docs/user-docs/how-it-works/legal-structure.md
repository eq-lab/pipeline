---
title: Legal structure
order: 9
section: How Pipeline works
---

# Legal structure

Pipeline's legal structure rests on three principles.

## Design principles

### Bankruptcy remoteness

The initial lender is a bankruptcy-remote lending vehicle. Security sits with the Security Agent, on trust for all lenders. Title documents held by the Security Agent do not form part of its estate. The collection account carries no credit facility at the borrower's bank, so the bank has no right of set-off.

### Secured lending with full recourse

The lender holds a claim on the borrower, with full recourse. The commodity is security for that claim. The lender never takes title to the goods. Bills of lading are endorsed to the Security Agent by way of pledge. Every facility requires first-ranking security, confirmed by a local legal opinion.

### Lenders decide, agents execute

Grace, extensions, default, the call of the loan, enforcement and write-downs are lender decisions under the master facility agreement. The Majority Lenders take them. Changes to economics and release of security outside its release condition need the consent of all lenders. The facility agent and the Security Agent carry the decisions out and record them.

## Structure

Each facility is documented by a master facility agreement (MFA) and an agency deed, with security documents per jurisdiction.

- **Lending vehicle**: the initial lender under the MFA. Bankruptcy remote. Holds the senior share of the facility.
- **Loan Originator and other lenders**: join a facility by accession deed, or take over an existing share by transfer certificate.
- **Borrower**: owes the loan with full recourse. Grants security to the Security Agent. Pays into a collection account co-signed by the Security Agent.
- **Facility agent**: appointed under the agency deed. Keeps the loan register, records drawdowns, repayments, payments, accessions and transfers, and applies the priority of payments.
- **Security Agent**: an independent security trustee appointed under the agency deed. Holds the bills of lading by way of pledge, warehouse release rights, assigned receivables and loss-payee rights on cargo and trade credit insurance. Holds the security on trust for all lenders, by the facility's priority of payments. Enforces on Majority Lender instruction.
- **Inspection companies**: appointed by the lending vehicle. Certificates are addressed to the Security Agent and all lenders.

Each agent is liable only for gross negligence, wilful misconduct or fraud. The Majority Lenders may replace either agent. Enforcement proceeds are applied by the priority of payments: agent costs, then lenders, then surplus to the borrower. A change to the collection account's signing mandate without notice to the Security Agent is an event of default.

## Trustee role

"Trustee" across these docs refers to Pipeline's Trustee, which runs the lending vehicle and its operations. The Trustee:

- Runs the lending vehicle as lender under the MFA
- Records loans, disbursements, lender wires out and USD/USDC conversions on-chain through the Trustee role
- Manages the USD bank account that receives offtaker wires and handles USD/USDC conversion
- Appoints the inspection companies for the lending vehicle and enters inspection results through its inspection operators

While Pipeline is the only lender, the Risk Council acts for the Majority Lenders.

## What is not part of the legal structure

The Loan Originator is not a Pipeline entity. It is a per-deal counterparty. It joins a facility as a lender by accession, contributes the equity tranche and stands as merchant of record on the underlying trade.

## Legal counsel

A satisfactory local legal opinion on security perfection and enforcement, in the borrower and goods jurisdictions, is a condition precedent to each facility.

## Confidentiality

No counterparty name or document is published. Hashes are salted.

| Public on-chain | Salted hash only | Kept off-chain |
|---|---|---|
| Principal, rate, status, maturity dates, coverage | Borrower, supplier and buyer identity | Names, contracts, invoices, KYB and KYT files |
| Commodity, quantity, corridor and location by region | Vessel and warehouse identity; bills of lading, receipts, notices | Inspection reports and photographs |
| Inspected quantity, quality and variance | Inspection certificates, accession deeds, transfer certificates, consents, lender instructions, legal opinions | Credit memos and lenders' committee papers |
