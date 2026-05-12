---
title: Legal structure
order: 9
section: How Pipeline works
---

# Legal structure

Pipeline's legal structure is designed around three principles. Each operates as a constraint on every other element of the architecture.

## Design principles

### Bankruptcy remoteness

Each financed trade is held in its own sub-trust. Collateral pledged to one trade cannot be reached by creditors of another trade, of the operating entity, or of Pipeline itself. A loss event in one sub-trust is structurally contained.

### On-chain instructions as binding legal authority

The trust deed recognises authenticated on-chain protocol actions as binding instructions. The fiduciary trustee acts on those instructions as a matter of legal obligation, not discretion — closing the gap between protocol logic and legal effect.

### Regulated fiduciary as operator

Capital movements are executed by a regulated trustee acting under the trust deed and applicable fiduciary duty, not by the Pipeline team. The operating counterparty that structures trades is a different entity from the one holding collateral; neither can unilaterally access senior capital.

## Structure

A purpose trust sits at the centre, governed by a trust deed that recognises on-chain protocol actions as legally binding. Each financed trade is held in its own sub-trust, isolating its collateral from every other trade.

Two operating entities sit alongside the trust:

- **The Trust Company (Cayman)** — the regulated trustee managing funds and legal title to collateral on behalf of their beneficiaries.
- **Trade Company (Cayman SPC)** — the operating counterparty that structures each physical trade in a bankruptcy-remote cell and posts collateral into the sub-trusts.

This separation means the entity doing the trades is distinct from the entity holding the collateral.

## Trustee role

"Trustee" across these docs refers to actions performed by The Trust Company under the trust deed. The Trustee:

- Manages legal title to pledged collateral (indirectly, through the sub-trust structure)
- Executes capital movements under authenticated on-chain instructions consistent with the trust deed
- Co-signs every yield mint alongside the Relayer (neither can mint alone)
- Manages the USD bank account that receives offtaker wires and instructs USD/USDC conversion
- Enforces collateral on default through the sub-trust mechanic

The Trustee acts under fiduciary duty to beneficiaries, not under instruction from the Pipeline team. Where on-chain instructions conflict with the trust deed, the Trustee declines to act.

## What is not part of the legal structure

The Loan Originator and the Payment Agent are operational counterparties, not entities in the Pipeline legal structure. The Originator is a per-deal third party that contributes the equity tranche and stands as merchant of record on the underlying trade. The Payment Agent operates the fiat bridge (USDC/USD via Circle Mint) under contract.

## Legal counsel

Reed Smith LLP — facility templates, English law, LCIA arbitration, and structuring counsel for the Trade Company. Carey Olsen — Cayman offshore counsel covering the purpose trust, the trust deed, The Trust Company, and the sub-trust framework.
