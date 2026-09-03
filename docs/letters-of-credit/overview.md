# Letters of Credit — Overview

> No implementation details in this doc — concept only. See [index.md](./index.md) for what's planned next.

A letter of credit (LC) is a bank instrument that lets a buyer and seller who don't trust each other complete a cross-border trade. It solves a specific problem: the seller doesn't want to ship goods before being paid, and the buyer doesn't want to pay before receiving goods, and neither has a reason to trust the other's word alone. An LC resolves this by substituting a bank's creditworthiness for the buyer's.

## The actors

- **Applicant (A)** — the buyer/importer, who wants to import goods and requests the LC.
- **Issuing Bank** — the Applicant's bank. It issues the LC and is the one actually on the hook to pay.
- **Beneficiary (B)** — the seller/exporter, who gets paid once terms are met.
- **Advising / Confirming Bank** — typically the Beneficiary's bank. It relays the LC to B and, if it *confirms* the LC, adds its own payment guarantee on top of the Issuing Bank's (relevant when the Issuing Bank is in a less-trusted jurisdiction).

## The mechanism, step by step

1. A and B agree on trade terms, specifying an LC as the payment method.
2. A applies to the Issuing Bank for an LC issued in B's favor.
3. The Issuing Bank issues the LC — a written, conditional undertaking: *"If B presents document set D by date X, we pay amount P."*
4. The Advising Bank receives and advises the LC to B.
5. B ships the goods and assembles document set D — typically a bill of lading, commercial invoice, packing list, and insurance/inspection certificates, exactly as specified by the LC.
6. B presents D to the Advising Bank, which forwards it to the Issuing Bank.
7. The Issuing Bank checks D **against the LC's stated terms only** — this is the "strict compliance" doctrine. The bank is not verifying that the goods themselves match the paperwork; it's verifying that the paperwork matches the LC.
8. If D matches → the Issuing Bank pays P to B, and goods ownership transfers to A.

The key simplification worth internalizing: the payment trigger is a discrete, paper-based check ("does D match the agreed spec"), not a continuous or physical verification that the goods actually arrived in good condition. Any dispute about the underlying goods is a separate matter between A and B — it doesn't affect whether the bank pays.

## Governing rules

LCs are standardized globally by **UCP 600** (the ICC's Uniform Customs and Practice for Documentary Credits), which is why an LC issued by one bank is understood the same way by any other bank, in any country, without a bespoke bilateral agreement.

## Why banks charge a high commission for this

The fee is a mix of real risk-pricing and pure trust/operational premium — worth separating because they compress differently if any part of this moves on-chain:

- **Credit risk (the largest piece).** The Issuing Bank commits to pay B even if A later can't reimburse it. That's the Issuing Bank extending A unsecured (or partially secured) credit, which sits on its balance sheet and consumes regulatory capital for the whole exposure window (often 30–180 days).
- **Confirmation risk.** An added layer of the same credit-risk premium when a confirming bank stands behind a less-trusted issuing bank.
- **Operational / compliance cost.** Manual document review under UCP 600, KYC/AML on both parties, correspondent banking relationships, staff specialized in trade-document checking. This is friction cost, not risk-pricing.
- **Trust-resolution premium.** Some of the fee is simply "we're the credible intermediary and there's no cheaper substitute" — a scarcity rent that competition can compress.

## The Applicant-side collateral spectrum

Separate from the LC itself (the Issuing Bank's guarantee *to B*) is the Issuing Bank's relationship *with A* — how much of the LC's value A has to post upfront determines how much risk the Issuing Bank is actually taking:

- **Fully cash-collateralized** — A deposits 100% of the LC value with the Issuing Bank upfront. The Issuing Bank takes ~zero credit risk; it's acting mostly as an escrow agent and document-checker.
- **Partially secured** — A posts partial margin/collateral, the Issuing Bank extends the rest as credit against A's standing relationship.
- **Fully unsecured** — A has enough credit standing that no collateral is posted at all; the Issuing Bank is taking pure counterparty risk, same as an unsecured loan.

This is a dial, not a binary, and it's the main driver of what a given LC actually costs.

## How an LC relates to a loan

An LC and a loan are adjacent but distinct layers of the same trade:

- **The LC** is a *conditional payment guarantee*: "if B presents document set D, someone pays P." By default it doesn't require anyone to lend money — if A fully collateralizes it, no credit is extended anywhere in the process.
- **A loan** enters only when someone advances money early against that guarantee, on either side of the trade:
  - **Applicant-side credit** — the Issuing Bank lets A post less than 100% collateral to get the LC issued; A is borrowing against its relationship with the Issuing Bank.
  - **Beneficiary-side credit ("LC discounting" / trade receivable financing)** — B doesn't want to wait out the Issuing Bank's payment window, so B sells or discounts the LC-backed receivable for cash today. Someone advances B money now against the LC's future payout as collateral.

These compose independently: an LC can exist with no lending at all (fully collateralized Applicant, Beneficiary waits for payout), or serve as the collateral basis for one or two loans layered on top.

## Relevance to Pipeline

Pipeline's own working model for this isn't "discount an LC a real-world bank already issued" — it's **Pipeline acting as the Issuing Bank itself**. LPs' deposited capital is the pool that backs the guarantee, the same way it backs today's commodity loans; the Applicant is a borrower in the same sense a loan originator is today; the LC's document-match event becomes the trigger that controls when and to whom pooled capital is disbursed (the Beneficiary — a third party who may not otherwise be a Pipeline depositor at all). Pipeline's [glossary](../user-docs/references/glossary.md) framing of financing "the seller's working capital against the underlying trade" describes today's loan product, not this one — this is a distinct product line where Pipeline is the credit-issuing party, not a downstream financier of someone else's LC.

## Open questions (not yet decided)

- Who attests that presented documents actually match the LC's terms — a bank, an originator, an oracle, some multi-party scheme?
- Legal enforceability: does an on-chain record carry the same legal weight as a traditional LC in the relevant jurisdictions (frameworks like MLETR address this off-chain)?
- **Credit model — explicitly undecided, pending a management call, not to be assumed in any design work**: does the Applicant need to fully collateralize before Pipeline issues the LC (a payment-router/escrow posture, no LP capital at risk), or does Pipeline actually underwrite Applicant default risk the way it does for today's commodity loans (LP capital at risk, CCR-gated), or something in between? This determines almost the entire contract and risk shape, so nothing downstream should be built as if one answer is already chosen.
- If real protocol capital gets disbursed to a Beneficiary who isn't a Pipeline LP, does that recipient need the same KYT/whitelist screening `deposits.md` and `WhitelistRegistry` already require for LP-side flows?
- How much of the document-handling process stays off-chain versus becomes on-chain / verifiable?
