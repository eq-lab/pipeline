# PIPE-GPC-001 — Cerro Pyrita gold-pyrite concentrate

A complete mock loan for testing the protocol end to end. Every number below is shown with
the arithmetic that produced it, so it can be checked with a calculator.

**Contents of this folder**

| File | What it is |
|---|---|
| `DEAL.md` | This document |
| `deal.json` | The fixture. Every input and every expected value |
| `metadata.v1.json` / `v2` / `v3` | The only objects that get pinned to IPFS |
| `documents/` | 21 mock trade, security and compliance documents |

---

## 1. The deal

| | |
|---|---|
| Commodity | Refractory gold-pyrite flotation concentrate |
| Quantity | 5,200 dry metric tonnes, shipped in two lots of 2,600 |
| Corridor | Peru (Callao) → China (Fangchenggang), CFR Incoterms 2020 |
| Borrower | Minera Cerro Pyrita S.A.C. |
| Originator | Open Mineral AG |
| Offtaker | Beihai Jinyuan Smelting Co., Ltd |
| Governing law | English law, LCIA London |
| Payment protection | Irrevocable documentary LC at sight, confirmed |
| **Facility** | **USD 6,500,000** |
| Senior tranche | 5,200,000 (80%) — Pipeline lenders |
| Equity tranche | 1,300,000 (20%) — Originator, first loss |
| Senior coupon | 17.50% per annum, simple, actual/365 |
| Term | 180 days, 2026-08-17 → 2027-02-13 |
| Offtaker price | 13,372,557.24 |
| **CCR at origination** | **147.98%** |
| Advance rate | 50.68% of mine-gate value |

The facility is roughly half the cargo's value. That is deliberate and it is what makes the
CCR work — see §9.

**Prices used are synthetic.** Gold at 4,200.00/oz and silver at 50.00/oz were chosen for
clean arithmetic. Research context puts gold around 3,986–4,073/oz at end-June 2026, so
4,200 is in the neighbourhood but it is not a quote.

---

## 2. Cargo and terms

**Assay** (dry basis, from the stockpile certificate, document D21):

| Au | Ag | As | Sb | Pb | Zn | Hg | Bi | Cd | Moisture | −74 µm |
|---|---|---|---|---|---|---|---|---|---|---|
| 28.50 g/dmt | 42.00 g/dmt | 1.85% | 0.14% | 0.45% | 2.60% | 22 ppm | 120 ppm | 30 ppm | 8.00% | 82.0% |

**Offtake commercial terms** (document D02):

| Term | Value |
|---|---|
| Gold payable | 78.0%, less 1.00 g/dmt minimum deduction |
| Silver payable | 85.0%, less 30.00 g/dmt minimum deduction |
| Treatment charge | USD 210.00 per dmt |
| Refining charge | Gold USD 6.00/oz · Silver USD 0.40/oz |
| Penalties | Flat, pro rata, per dmt (table below) |
| Quotational period | 2 MAMA — second calendar month after month of arrival |
| Pricing reference | LBMA Gold Price PM, averaged over the QP |
| Provisional payment | 90% against documents |
| Haircut | 40% |

**Weight conversion.** Payables and charges are on the dry tonne; freight and insurance on
the wet tonne.

```
wmt = 5,200.000 ÷ (1 − 0.08)  =  5,652.1739 wmt
```

---

## 3. The collateral maths, line by line

### 3.1 Penalties

Charged per dmt for each step above the threshold. Three elements sit below their threshold
and contribute nothing.

| Element | Assay | Threshold | Steps over | Rate | USD/dmt |
|---|---|---|---|---|---|
| Arsenic | 1.85% | 0.20% | (1.85 − 0.20) ÷ 0.10 = 16.5 | 5.00 | **82.50** |
| Antimony | 0.14% | 0.10% | (0.14 − 0.10) ÷ 0.01 = 4.0 | 1.00 | **4.00** |
| Mercury | 22 ppm | 10 ppm | (22 − 10) ÷ 5 = 2.4 | 1.00 | **2.40** |
| Zinc | 2.60% | 2.00% | (2.60 − 2.00) ÷ 0.50 = 1.2 | 1.00 | **1.20** |
| Lead | 0.45% | 1.00% | below threshold | 1.00 | 0.00 |
| Bismuth | 120 ppm | 300 ppm | below threshold | 1.00 | 0.00 |
| Cadmium | 30 ppm | 50 ppm | below threshold | 1.00 | 0.00 |
| | | | | **Total** | **90.10** |

### 3.2 Payable metal

```
Gold payable grade   = 28.50 × 0.78 − 1.00           =     21.230 g/dmt
Gold payable ounces  = 21.230 × 5,200 ÷ 31.1035      =  3,549.3112 oz

Silver payable grade = 42.00 × 0.85 − 30.00          =      5.700 g/dmt
Silver payable ounces= 5.700 × 5,200 ÷ 31.1035       =    952.9474 oz
```

For comparison, contained metal is 4,764.7371 oz gold and 7,021.7178 oz silver — worth
20,362,981.66. The concentrate is worth far less than that, which is the whole point.

### 3.3 Net Smelter Return

| Line | Arithmetic | USD |
|---|---|---|
| Gross payable gold | 3,549.3112 × 4,200.00 | 14,907,106.92 |
| Gross payable silver | 952.9474 × 50.00 | 47,647.37 |
| **Gross payable value** | | **14,954,754.29** |
| Treatment charge | 5,200 × 210.00 | (1,092,000.00) |
| Refining charge, gold | 3,549.3112 × 6.00 | (21,295.87) |
| Refining charge, silver | 952.9474 × 0.40 | (381.18) |
| Penalties | 5,200 × 90.10 | (468,520.00) |
| **NET SMELTER RETURN** | | **13,372,557.24** |

NSR is **65.67%** of contained metal value (13,372,557.24 ÷ 20,362,981.66) — inside the
55–75% band that refractory gold-pyrite realises.

### 3.4 Realisation costs and collateral value

| Line | Arithmetic | USD |
|---|---|---|
| Ocean freight, CFR | 5,652.1739 × 58.50 | 330,652.17 |
| Marine insurance | 14,954,754.29 × 0.09% | 13,459.28 |
| Superintendence | 5,200 × 0.50 | 2,600.00 |
| Marketing | 13,372,557.24 × 1.50% | 200,588.36 |
| **Realisation costs** | | **547,299.81** |
| **Mine-gate value** | 13,372,557.24 − 547,299.81 | **12,825,257.43** |
| **Collateral value** | 12,825,257.43 × (1 − 0.40) | **7,695,154.46** |

### 3.5 CCR

```
CCR = 7,695,154.46 ÷ 5,200,000  =  147.98%
```

---

## 4. Why collateral falls faster than gold

The treatment charge, refining charges, penalties and realisation costs are fixed dollars.
They do not shrink when gold falls, so collateral value is geared: **a 1% fall in gold takes
1.144% off collateral value.**

Gold price at which CCR touches each monitoring level, holding quantity and senior constant:

| Level | Gold price | Move from mark | Collateral value | CCR |
|---|---|---|---|---|
| Origination | 4,200.00 | — | 7,695,154.46 | 147.98% |
| Watchlist | **3,753.78** | −10.62% | 6,759,999.48 | 130.00% |
| Maintenance margin call | **3,505.66** | −16.53% | 6,240,007.88 | 120.00% |
| Margin call | **3,257.53** | −22.44% | 5,719,995.32 | 110.00% |
| Fully covered only | **3,009.41** | −28.35% | 5,200,003.71 | 100.00% |

---

## 5. Two prices, not one

This is the part most likely to be got wrong.

| | Contract price | Market price |
|---|---|---|
| Decides | every dollar the offtaker pays | live collateral value, so CCR |
| Source | LBMA Gold PM, offtake clause 10.1 | Chainlink XAU/USD read off-chain |
| Mechanism | quotational-period average | continuous spot, 15-minute polling |
| Fixes | once, then never moves | never fixes |
| Feeds | `originalOfftakerPrice`, `offtakerAmount` | `ccr`, watchlist, margin calls |

**Quotational-period pricing is standard practice, not an invention of this fixture.** AusIMM
Monograph 20's worked example uses 2 MAMA with an 85–90% provisional payment; the SEC-filed
Global Gold / Mego gold-concentrate contract prices the same way; Fastmarkets reports QPs
lengthening to M+4/M+5 as gold rose.

Contract prices fix on: Lot A at **4,240.00** on 2026-09-20 · Lot B at **4,310.00** on
2026-11-15 · QP-final blended at **4,387.50**.

### The market marks to replay

Eleven ticks. Exactly two threshold events should fire across the whole series.

| Date | Market gold | Qty dmt | Senior out | CCR | Band | Event |
|---|---|---|---|---|---|---|
| 2026-08-17 | 4,200.00 | 5,200 | 5,200,000 | 147.98% | green | origination |
| 2026-09-01 | 4,165.00 | 5,200 | 5,200,000 | 146.57% | green | routine tick, no on-chain write |
| 2026-09-20 | 4,240.00 | 5,200 | 5,200,000 | 149.60% | green | Lot A contract price fixes at 4,240 |
| 2026-10-05 | 3,980.00 | 5,200 | 5,200,000 | 139.09% | green | sell-off begins |
| 2026-10-15 | **3,690.00** | 5,200 | 5,200,000 | **127.37%** | **amber** | **Watchlist fires** |
| 2026-10-28 | 4,180.00 | 5,200 | 5,200,000 | 147.18% | green | **recovers**, restore to Performing |
| 2026-11-02 | 4,265.00 | 2,600 | 2,600,000 | 150.61% | green | P1 settles at the contract 4,240 |
| 2026-11-15 | 4,310.00 | 2,600 | 2,600,000 | 152.44% | green | Lot B contract price fixes |
| 2026-12-01 | 4,355.00 | 2,600 | 2,600,000 | 154.25% | green | routine tick |
| 2026-12-22 | 4,372.00 | 2,600 | 2,600,000 | 154.94% | green | Lot B arrives |
| 2026-12-28 | 4,390.00 | 0 | 0 | 0 | n/a | P2 settles. Senior retired |

The 15 October trough is the point of the whole series: market gold was 3,690 while the Lot A
contract price was already locked at 4,240. **CCR broke 130% on a receivable that had stopped
moving.** The recovery on 28 October tests the Watchlist exit, which is the step most likely
to be missing.

When senior outstanding reaches zero the system returns **CCR = 0**, not null.

---

## 6. Repayments

Three receipts, because the parcel ships as two lots with a 90% provisional payment each,
plus one QP-final settlement.

| | P1 Lot A provisional | P2 Lot B provisional | P3 QP-final |
|---|---|---|---|
| Value date | 2026-11-02 (day 77) | 2026-12-28 (day 133) | 2027-02-05 (day 172) |
| Offtaker pays | 6,081,752.77 | 6,194,113.55 | 1,764,807.37 |
| Senior principal | 2,600,000.00 | 2,600,000.00 | 0 |
| Gross interest | 191,972.60 | 69,808.22 | 0 |
| Management fee | 10,969.86 | 3,989.04 | 0 |
| Performance fee | 18,100.27 | 6,581.92 | 0 |
| Net senior coupon → vault | 162,902.47 | 59,237.26 | 0 |
| OET allocation | 5,484.93 | 1,994.52 | 0 |
| **Equity tranche** | **0** | **1,300,000.00** | **0** |
| Originator residual, off-chain | 3,284,295.24 | 2,222,310.81 | 1,764,807.37 |
| Senior outstanding after | 2,600,000.00 | 0 | 0 |

**Check the interest.** P1 accrues on the full tranche for 77 days:

```
5,200,000 × 17.50% × 77 ÷ 365  =  191,972.60
```

P2 accrues on the **amortised** balance for the next 56 days:

```
2,600,000 × 17.50% × 56 ÷ 365  =   69,808.22
```

If a screen shows 139,616 for P2 it used the original tranche instead of the outstanding
balance.

**Check the fees.** Management 1.00%/yr, OET 0.50%/yr, both on senior deployed; performance
is 10% of gross interest after the management fee.

```
P1 management  = 5,200,000 × 1.00% × 77 ÷ 365   =  10,969.86
P1 performance = (191,972.60 − 10,969.86) × 10% =  18,100.27
P1 net coupon  = 191,972.60 − 10,969.86 − 18,100.27 = 162,902.47
P1 OET         = 5,200,000 × 0.50% × 77 ÷ 365   =   5,484.93
```

**Equity sits last.** It receives nothing until senior principal reaches zero: blocked at P1,
paid in full at P2 the moment the last senior dollar clears, nothing left at P3. Each payment
carries a short reason string so a zero reads as a rule rather than missing data.

**P3 is a nothing-to-mint payment on purpose.** All six components are zero and only the
cumulative offtaker-received counter moves. It tests the settled-with-nothing-to-mint path.

### Counters at the end

| Counter | Value |
|---|---|
| Offtaker received total | 14,040,673.69 |
| Senior principal repaid | 5,200,000.00 |
| Senior interest recorded | 222,139.73 |
| Management fee | 14,958.90 |
| Performance fee | 24,682.19 |
| OET allocation | 7,479.45 |
| Equity distributed | 1,300,000.00 |
| Vault PLUSD minted | 222,139.73 |
| Treasury PLUSD minted | 47,120.54 |

---

## 7. The documents

21 documents in three stages. **Only 9 exist on origination day.** The rest are conditions to
each cargo release, or arise after shipment.

### Stage 1 — conditions precedent to drawdown (17 August)

| ID | Document | Why it is here | Confidential |
|---|---|---|---|
| [D21](documents/stockpile-composite-certificate.md) | **Stockpile Composite Certificate of Analysis and Weight** | the assay and weight the loan is valued on | no |
| [D02](documents/offtake-contract-extract.md) | Offtake contract extract | the only source of payable %, TC, RC, penalties, QP, Incoterm | **yes** |
| [D01](documents/facility-agreement-extract.md) | Facility Agreement extract | CCR definition, thresholds, amortisation, order of payments | **yes** |
| [D15](documents/collateral-management-agreement.md) | Collateral Management Agreement | SGS holds the goods, releases only on Trustee instruction | no |
| [D16](documents/warehouse-receipt.md) | Warehouse receipts and register | attornment, plus the anti-double-pledge audit trail | no |
| [D17](documents/assignment-of-receivable.md) | Deed of Assignment + Notice and Acknowledgement | routes the cash into a controlled account | **yes** |
| [D18](documents/security-agreement-pledge.md) | Security Agreement / pledge | the whole security map and its perfection steps | **yes** |
| [D19](documents/kyb-sanctions-screening.md) | KYB and sanctions screening | nine parties, two vessels, jurisdiction assessment | **yes** |
| [D14](documents/export-permit-declaration.md) | Mineral export permit, MINEM | licence to export, drawn down by volume | no |

D21 and D02 together are the complete valuation input set.

### Stage 2 — conditions to each release from the CMA stockpile

| ID | Document | Confidential |
|---|---|---|
| [D13](documents/letter-of-credit.md) | Letter of Credit, MT700, confirmed, at sight | **yes** |
| [D03](documents/certificate-of-analysis-lot-a.md) | Certificate of Analysis, Lot A, load port | no |
| [D04](documents/certificate-of-analysis-lot-b.md) | Certificate of Analysis, Lot B, load port | no |
| [D05](documents/certificate-of-weight-moisture.md) | Certificate of Weight and Moisture, draft survey | no |
| [D06](documents/tml-certificate.md) | IMSBC declaration and TML certificate | no |
| [D07](documents/preshipment-inspection-report.md) | Pre-shipment inspection and superintendence report | no |
| [D12](documents/marine-insurance-certificate.md) | Marine cargo insurance, ICC (A), 110% | no |

### Stage 3 — after shipment, gates nothing

| ID | Document | Confidential |
|---|---|---|
| [D08](documents/bill-of-lading.md) | Bills of Lading, negotiable, 3/3, blank endorsed | no |
| [D09](documents/packing-list-lot-manifest.md) | Packing list and lot manifest | no |
| [D10](documents/provisional-commercial-invoice.md) | Commercial invoices, provisional and final | **yes** |
| [D11](documents/certificate-of-origin.md) | Certificate of Origin | no |
| [D20](documents/umpire-assay-protocol.md) | Umpire appointment and settlement assay | no |

Every document carries a MOCK DOCUMENT banner. All companies, permits, account numbers and
certificate references are fictional. Where a real firm name appears — SGS, Alfred H Knight,
LBMA — it is a role placeholder, the same convention the existing user docs use.

**D20 is worth reading.** The gold assay falls outside the contractual splitting limit and
goes to an umpire, which is the base case for coarse gold, not an exception. Marking at the
buyer's assay instead of the settlement assay moves CCR from 147.98% to 144.01%.

---

## 8. What goes on IPFS

**One file. It contains hashes, not documents.**

The valuation spec already allows this: IPFS holds the assay and offtake extract *"or their
hashes"*, and is *"descriptive evidence only"*. It is also necessary — 7 of the 21 documents
carry UBO names, bank account numbers or contract pricing, and IPFS is public and permanent.
A wrong pin cannot be undone.

Because the metadata pointer is appendable, it is pinned three times over the loan's life:

| Version | Pinned when | Documents listed |
|---|---|---|
| `metadata.v1.json` | at loan creation | 9 |
| `metadata.v2.json` | at first cargo release | 16 |
| `metadata.v3.json` | after settlement | 21 |

Each entry carries `body_on_ipfs: false`. The bodies stay in the private store and go to
auditors on request.

---

## 9. Walkthrough

What the Trustee does, sees, enters, and should get back.

**Origination.** Originator submits the signed request. Trustee opens it and should see the
9 stage-1 documents — **not** the assay or LC, which do not exist yet — and three green mint
checks: tranches sum to the facility, offtaker price covers the facility, maturity after
origination. Approving mints the loan. It lands as **Disbursing** with CCR 147.98%, one
genesis rate epoch, and all seven counters at zero.

**Disbursement.** 5,200,000 leaves the Capital Wallet under 3-of-5, Team and Trustee
mandatory. Trustee marks the wire sent — this is an off-chain confirmation with an audit-log
entry and no transaction. Chip flips to **Performing**.

**Monitoring.** Replay the eleven marks. Ticks that do not cross a threshold must not write
on-chain. On 15 October CCR hits 127.37% and Watchlist fires; the Trustee flags it. On
28 October it recovers and the Trustee restores Performing — one transaction, instantly, no
timelock.

**Shipment.** Lot A releases from the CMA against the stage-2 documents. Trustee updates the
location to the vessel and appends the v2 metadata pointer. Quantity drops 5,200 → 2,600
**when the lot is delivered to the smelter, not when it loads** — goods in transit are still
collateral.

**Repayment 1.** Trustee logs the inbound wire, then records the split. The screen should
show the table in §6 exactly, including the equity line at zero with its reason. Two mint
legs follow: 162,902.47 to the vault, 34,555.06 to the treasury.

**Repayment 2.** Same flow. Senior principal reaches zero, so the equity tranche is returned
in full — 1,300,000 — and the equity counter moves for the first time. Mint legs 59,237.26
and 12,565.48.

**Repayment 3.** Every component zero. Nothing to mint. Only the offtaker-received counter
moves, to 14,040,673.69.

**Close.** Three checks: senior principal is zero, nothing left to mint, offtaker balance
acknowledged. The third goes green automatically because receipts exceeded the contracted
price — see §10, that is not the borrower doing anything right. Reason is *Repaid at
maturity*. All actions then hidden; further recording or minting must fail.

**Stress branch.** Gold to 2,900 gives CCR 95.59% and fires all three notifications in one
tick. Trustee flags Watchlist, margin call goes unanswered, loan passes maturity unpaid, and
escalation goes to the Risk Council under a 24-hour timelock. The Trustee can compose the
proposal but must not be able to execute it.

**Rollover branch.** Attempting a rollover before maturity must fail. After maturity, a new
90-day term at 19.50% appends a second epoch starting at the **prior** maturity so accrual is
continuous, and raises the interest ceiling by 250,027.40 without minting anything.

---

## 10. Where this fixture and the built system disagree

Checked on 29 July 2026 against the Soroban `loan-registry` contract and the backend at
`eq-lab/pipeline @ 9c38744`. There is no Solidity LoanRegistry in the repo; the live chain is
Soroban. **This fixture follows the written specs. The code does not, in six places.**

| # | What | Consequence |
|---|---|---|
| 1 | **The final settlement is rejected.** The waterfall endpoint refuses any amount above `offtaker price − already received`, on the reasoning that the offtaker can never legitimately pay more than the contracted price | That reasoning is false for QP pricing. Gold rose over the quotational period, receipts came in 5.00% over contract, so P3 (1,764,807.37 against 1,096,690.92 remaining) is rejected. **Every rising-price concentrate deal hits this** |
| 2 | **One price is applied to every metal.** Silver gets priced at gold's 4,200 | CCR reads **193.62%** instead of 147.98% — 45.64 points too high, in the direction that hides risk. Run a gold-only variant first: expect **147.45%** |
| 3 | **Three scales are live at once.** Soroban stores CCR and rate on a 1e6 scale; the API uses basis points; money is 7-decimal on Stellar, 6 in the specs | CCR is `1479800` on chain and `14798` in the API. Rate is `175000` on chain and `1750` in bps. This has already caused a shipped bug — an erroneous ÷1000 correction on CCR |
| 4 | **Waterfall order is reversed.** The code pays interest before principal | The endpoint returns senior principal of 5,200,000 at P1, retiring the whole tranche. The 2,600,000 amortisation above is a Trustee override and will be flagged as a deviation |
| 5 | **Interest compounds.** The endpoint uses compound growth; both specs and the on-chain ceiling are simple | 77-day gross interest is 179,952.67, not 191,972.60 — about 6% lower. Deliberate, and documented in the code as a departure |
| 6 | **Equity is uncapped.** The code makes it the final residual sink | Cumulative equity ends around 8.5M against a 1.3M tranche, so "equity distributed equals the equity tranche" is not a valid check against the code |

Smaller ones, all verified in source:

- The contract has **four** statuses — Performing, WatchList, Default, Closed. There is no
  Matured. "Past Due" is derived server-side from the maturity timestamp.
- On-chain interest has **no maturity cap** — it keeps accruing past maturity. The API does
  cap it. Contract and API disagree, and the spec's guarantee that a loan cannot accrue
  beyond its contracted term is not implemented.
- Recording a payment **appends a rate epoch** each time, so after three payments there are
  four epochs, not one.
- Payable grade is **not floored at zero**, so a metal below its minimum deduction subtracts
  value. Silver at 35 g/dmt would take 175,542.95 off the NSR.
- Penalty thresholds for mercury, bismuth and cadmium must be stored in **percent**. Storing
  them in ppm makes those penalties silently evaluate to zero.
- Loan creation has two invariants the specs do not mention: opening CCR at or above 100%,
  and an origination date not in the future.
- The loan token is **soulbound** — every transfer and approval path reverts.

---

## 11. Decisions still open

1. **Should equity be capped at the tranche, or absorb the whole residual?** The code does
   the latter, which matches "equity is paid last" but makes the counter meaningless as a
   check. This fixture caps it.
2. **Waterfall order.** Interest first, as built, or principal first, as specified. One of
   the two is wrong and it changes every repayment on the platform.
3. **Simple or compound interest.** Four to six percent apart over these tenors.
4. **The Helios reference example** in the v3 dashboard assignment assumes the facility funds
   the whole cargo. Under any real haircut that pins CCR near 80% and cannot be fixed by
   resizing, because both sides of the ratio scale together. It should be corrected before
   more screens are built against it.
5. **`originalOfftakerPrice` is a fixed field for a price that is not knowable at mint.**
   Consider a flag distinguishing fixed-price from quotational-period deals, so the
   outstanding-balance line and the close checklist stop reading a price move as borrower
   behaviour.
