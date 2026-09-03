# Letters of Credit — Prior Art

> No implementation details in this doc — a survey of existing platforms and standards. See [overview.md](./overview.md) for LC concepts, [index.md](./index.md) for what's planned next.

Two distinct categories of prior art exist here, and the split matters: one tried to digitize the LC process itself (issuance, document exchange, payment), the other narrowed to just making the underlying trade document legally valid in electronic form. Their survival rates differ accordingly — see the takeaway at the end.

## LC Implementations

Platforms that ran the LC (or broader trade-finance) workflow itself, typically as a bank consortium on a permissioned ledger.

### Contour (formerly Voltron)

Started 2017 as a Corda-based prototype ("Voltron"), reached full production in October 2020 backed by ~21 major banks (ANZ, BNP Paribas, HSBC, Standard Chartered, and others). Focused specifically on the LC lifecycle — trials cut average processing time from ~10 days to under 24 hours. Never converted pilot activity into sustained volume (reportedly 60–70 transactions/month near the end); bank shareholders pulled funding and it shut down permanently on November 30, 2023. Acquired by XDC Ventures in October 2025 for a stablecoin-focused relaunch attempt, currently in early regulatory testing.

- [Contour to shut down as bank shareholders pull funding — GTR](https://www.gtreview.com/news/top-stories/exclusive-contour-to-shut-down-as-bank-shareholders-pull-funding/)
- [Blockchain trade finance network Contour to shutter — Ledger Insights](https://www.ledgerinsights.com/contour-blockchain-trade-finance-network-shutter/)
- [XDC Network Acquires Contour to Expand Stablecoins and Tokenization in Trade Finance — CoinDesk](https://www.coindesk.com/business/2025/10/22/xdc-network-acquires-contour-to-expand-stablecoins-and-tokenization-in-trade-finance)
- [XDC Ventures to "re-energise" Contour after Xalts sale — GTR](https://www.gtreview.com/news/digital-trade/xdc-ventures-to-re-energise-contour-after-xalts-sale/)

### we.trade

Founded 2017 by 12 banks (Deutsche Bank, HSBC, Santander, UniCredit, Rabobank, and others), built on Hyperledger Fabric, commercially launched 2019; IBM joined in 2020 with a 7% stake. Scoped broader than Contour — general SME trade finance, not just LCs. Never generated enough revenue, burned through a €5.5M raise in 2021, and its shareholders couldn't agree on further funding. Filed for insolvency and appointed PwC as liquidator in May 2022.

- [IBM-backed blockchain platform we.trade "shutting down" — Tech Monitor](https://www.techmonitor.ai/emerging-technology/ibm-backed-blockchain-platform-we-trade-shutting-down/)
- [Bank-backed blockchain consortium we.trade files for insolvency — Finextra](https://www.finextra.com/newsarticle/40408/bank-backed-blockchain-consortium-wetrade-files-for-insolvency)

### Komgo

Founded by 15 institutions in September 2018 (ABN AMRO, BNP Paribas, Citi, ING, Shell, SGS, Societe Generale, and others), built on JPMorgan's Quorum (permissioned, Enterprise Ethereum Alliance-standard). Narrower focus than the others — commodity trade finance specifically (oil, metals). Still operating: acquired GlobalTrade Corporation in December 2022 (~120 large corporate customers, 11,000 subsidiaries) and reports over $700M financed through the network, with a claimed 99.58% cut in LC issuance time. It is a fully permissioned, private consortium chain — no public block explorer or published contract addresses exist, by design: only authorized network participants can read chain state at all. That's a deliberate design fork worth naming: public-chain-with-selective-privacy versus fully-permissioned-private-consortium. Every LC-implementation platform in this list chose the latter.

- [komgo: Blockchain Case Study for Commodity Trade Finance — ConsenSys](https://consensys.io/blockchain-use-cases/finance/komgo)
- [Blockchain trade finance network Komgo acquires GTC — Ledger Insights](https://www.ledgerinsights.com/komgo-gtc-trade-finance-blockchain/)
- [Industry players and banks join forces to launch blockchain platform — Societe Generale PR](https://www.societegenerale.com/sites/default/files/18082-komgo-pr-va-190918.pdf)

### Marco Polo Network (TradeIX)

A joint venture between fintech TradeIX and R3, founded 2017, running on Corda, at one point 30+ bank members (Commerzbank, BNY Mellon, SMBC). Missed its original 2019 production target, then a revised 2020 target too. Posted $85M in cumulative losses by 2021; a $12M rescue deal with Bank of America fell through. Entered insolvency in 2022 with €5.2M in debt.

- [Marco Polo Network runs insolvent with €5.2m debts — Trade Finance Global](https://www.tradefinanceglobal.com/posts/marco-polo-network-runs-insolvent/)
- [Blockchain trade finance network Marco Polo is insolvent — Ledger Insights](https://www.ledgerinsights.com/marco-polo-blockchain-trade-finance-insolvency/)

## Document Standards

Standards for making an electronic trade document (a bill of lading, in particular) legally equivalent to its paper original — narrower in scope than a full LC platform, focused on interoperability and legal enforceability of the underlying document rather than running the payment workflow.

### TradeTrust

A Singapore government initiative (IMDA-backed). Not a payment network — an open standard connecting governments and businesses to a public blockchain used as a tamper-evident registry, so an electronic document stays unique and verifiable across parties and platforms. Actively expanding in 2026: a Maersk/DBS pilot completed the first TradeTrust-based international shipment, COFCO adopted it via AEOTradeChain, and it's being integrated into a Malaysia-Singapore trade corridor with automated customs pre-validation.

- [TradeTrust Newsletter June 2026](https://www.tradetrust.io/happenings-and-resources/tradetrust-newsletter-june-2026/)
- [Singapore and India kick off interoperable eBLs for Trade Finance — MTI](https://www.mti.gov.sg/Newsroom/Press-Releases/2023/08/Singapore-and-India-kick-off-an-era-of-interoperable-electronic-Bills-of-Lading-for-Trade-Finance)

### MLETR (UNCITRAL Model Law on Electronic Transferable Records)

Not a blockchain — a 2017 UN model law, and the legal scaffolding TradeTrust depends on. It gives countries a template for making electronic records (bills of lading, promissory notes, LC-related documents) legally equivalent to paper negotiable instruments; without it, an "electronic bill of lading" is just data, not a legally transferable title document. Bahrain was the first country to enact it. Singapore adopted it into law in 2021, which is what made the TradeTrust pilots legally meaningful rather than just technically functional. The UK passed an MLETR-aligned Electronic Trade Documents Act; other jurisdictions (Thailand, Belize, and others) are mid-process. Adoption is still far from universal.

- [MLETR: An overview of UNCITRAL's Model Law — ICC Academy](https://academy.iccwbo.org/digital-trade/article/mletr-an-overview-of-uncitrals-model-law-on-electronic-transferable-records/)
- [Bahrain enacts the UNCITRAL Model Law on Electronic Transferable Records — UNCITRAL](https://uncitral.un.org/en/news/bahrain-enacts-uncitral-model-law-electronic-transferable-records)

## Takeaway

Every full-stack LC-implementation platform in this list except Komgo failed commercially, despite each one demonstrably cutting LC processing time by 90%+ in trials — the tech worked, the business model (a bank-owned joint venture that needs its own shareholders to keep funding it past the pilot phase) didn't. Komgo's apparent edge was staying narrow (commodities specifically) and tightly coupled to existing bank/corporate relationships rather than trying to disintermediate them. The document-standard layer (TradeTrust, backed by MLETR) survived by staying narrower still — solving document authenticity/legal-equivalence only, with a government sponsor rather than needing to be commercially self-funding. See [overview.md](./overview.md#relevance-to-pipeline) for how this bears on Pipeline's own approach.
