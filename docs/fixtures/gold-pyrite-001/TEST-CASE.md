# TEST CASE — PIPE-GPC-001, gold-pyrite concentrate, full lifecycle

An end-to-end integration test across every surface: Originator UI, Trustee dashboard, LP
app, Protocol dashboard. One loan, originated, funded, monitored through a price history,
repaid in three instalments, closed. Plus two alternate endings.

**Run time:** about 90 minutes manually.
**Test data:** [`deal.json`](./deal.json) — every input and expected value.
**Numbers:** all figures below come from `deal.json`. Appendix A shows how they are derived
if you need to check one.

Each step is: **who**, **where**, **what they do**, **what must happen**. If an expectation
does not match, record it and continue unless the step says STOP.

---

## 0. Setup

### 0.1 Accounts

| Role | Needs |
|---|---|
| Originator | Originator UI login, 2FA enrolled |
| Trustee | Trustee dashboard login, Trustee key, MPC device |
| Team member | MPC device (second mandatory cosigner) |
| Third cosigner | MPC device |
| LP | Whitelisted wallet, funded with test USDC |
| Risk Council | 3 of 5 Safe signers (branch B only) |

### 0.2 Seed state

| Item | Value | Why |
|---|---|---|
| LP deposits and stakes | **10,000,000 USDC** | gives a round vault so share-price movement is easy to read |
| sPLUSD starting share price | **1.000000** | baseline |
| Capital Wallet USDC | at least **5,200,000** | funds the senior tranche |
| Active loans | **none** | so every dashboard number below is attributable to this loan |
| Price feed | **replay mode**, fed from `deal.json > market_mark_series` | a live feed makes the run unrepeatable |
| Loans list | empty, next loan id **1** | |

### 0.3 Baseline readings — record these before starting

| Surface | Field | Expected |
|---|---|---|
| Protocol dashboard | TVL | 10,000,000 |
| Protocol dashboard | Outstanding in loans | 0 |
| Protocol dashboard | Deployment ratio | 0% |
| Protocol dashboard | Loan book yield | `null` (no active loans) |
| Protocol dashboard | Cumulative yield | 0 |
| LP app | sPLUSD balance | 10,000,000 |
| LP app | sPLUSD → PLUSD rate | 1.000000 |
| LP app | Yield earned | 0 |

### 0.4 The loan being originated

| | |
|---|---|
| Borrower | Minera Cerro Pyrita S.A.C. |
| Commodity | Gold-pyrite concentrate, 5,200 dmt |
| Corridor | Peru (Callao) → China (Fangchenggang) |
| Facility | 6,500,000 — senior 5,200,000, equity 1,300,000 |
| Rate | 17.50% APR |
| Term | 2026-08-17 → 2027-02-13, 180 days |
| Offtaker price | 13,372,557.24 |
| Opening CCR | 147.98% |

---

## TC-1 — Origination

### 1.1 Originator submits the request

**Who:** Originator · **Where:** Originator UI → New origination request

**Do:** fill the form from `deal.json > onchain_loan`, attach the 9 stage-1 documents
(Appendix B), sign with 2FA, submit.

```
Facility size      6,500,000
Senior tranche     5,200,000
Equity tranche     1,300,000
Offtaker price     13,372,557.24
Rate               1750 bps
Origination        2026-08-17
Maturity           2027-02-13
Location           Warehouse — "SGS bonded stockpile, Callao, Peru"
```

**Expect:**
- Submission succeeds, status **In Review**.
- Originator sees it in their own list.
- **Trustee dashboard → Origination → In Review** gains one row within a refresh.

### 1.2 Trustee reviews it

**Who:** Trustee · **Where:** Trustee dashboard → Origination → click the row

**Do:** read the page. Do not approve yet.

**Expect:**
- Loan terms card shows the seven values above.
- Deal details show commodity, corridor, English law / LCIA London, LC at sight.
- Documents list shows **9** documents — and **not** the assay, LC, insurance or TML, which
  do not exist on 17 August. If those appear, the stage model is wrong.
- Three mint checks all **green**:

| Check | Shown as |
|---|---|
| Tranches sum to facility | 5,200,000 + 1,300,000 = 6,500,000 |
| Offtaker price covers facility | 13,372,557.24 ≥ 6,500,000 |
| Maturity after origination | 2027-02-13 > 2026-08-17 |

- Originator signature valid.

### 1.3 Negative check — a bad request must not be mintable

**Who:** Trustee · **Where:** same screen

**Do:** have the Originator submit a second request identical except
`offtaker price = 6,400,000`. Open it.

**Expect:**
- Check 2 goes **red**.
- **Approve and mint is disabled.** If it is clickable, STOP — that is a blocker.

Reject this second request before continuing.

### 1.4 Trustee requests changes

**Who:** Trustee · **Where:** the real request

**Do:** click *Request changes*, comment "confirm the arsenic penalty basis is flat, not
escalating", submit.

**Expect:**
- Request moves to the **Changes Requested** tab.
- Originator sees the comment and can no longer edit in place.

### 1.5 Originator resubmits

**Who:** Originator

**Do:** resubmit unchanged with a note confirming the penalty basis.

**Expect:**
- A **new** request appears in In Review, linked to the previous one.
- The old row stays in Changes Requested. It is terminal.

### 1.6 Trustee approves and mints

**Who:** Trustee

**Do:** *Approve and mint* → review the transaction preview → *Send*.

**Expect:**
- Transaction confirms. **Loan id 1.**
- Origination row moves to **Approved**, showing the loan id and transaction hash.
- Redirect to the loan page.

**On the loan page:**

| Field | Expected |
|---|---|
| Status chip | **Disbursing** |
| Facility | 6,500,000 |
| Disbursed | **0** |
| Senior outstanding | 5,200,000 |
| Maturity | 2027-02-13 |
| CCR | **147.98%**, age 0 |
| Rate epochs | exactly **1**, source Genesis, 1750 bps |
| All seven ledger counters | **0** |

**Nothing has moved on the LP side yet.** Re-read the 0.3 baseline: TVL, outstanding,
deployment ratio and share price must all be unchanged. A loan record is not a disbursement.

---

## TC-2 — Funding

### 2.1 Trustee opens the disbursement

**Who:** Trustee · **Where:** loan page → *Track disbursement*

**Expect:** movement bar at step 1 *Pending*, amount **5,200,000**, MPC tracker 0 of 5,
policy 3-of-5, Trustee and Team flagged mandatory.

### 2.2 Negative check — the MPC policy must hold

**Do:** attempt to assemble 3 signatures that **exclude the Trustee**.

**Expect:** rejected by policy. If it settles, STOP.

### 2.3 Co-sign properly

**Who:** Trustee + Team + one more

**Do:** co-sign in the custodian app.

**Expect:** tracker reaches 3 of 5 with both mandatory signers present. Movement advances
through *Wallet to provider* → *At provider, converting* → *In Trust account*.

### 2.4 Mark the wire sent

**Who:** Trustee

**Do:** *Mark wire sent* → confirm the wire summary.

**Expect:**
- **No blockchain transaction.** This is an off-chain confirmation with an audit-log entry
  only. If a transaction is broadcast, record it.
- Movement reaches *Wired to borrower*.
- Status chip flips **Disbursing → Performing**.
- Loan page shows disbursed 5,200,000.

### 2.5 The money now shows up everywhere

**Who:** anyone · **Where:** Protocol dashboard, then LP app

| Surface | Field | Expected | Note |
|---|---|---|---|
| Protocol | Outstanding in loans | **6,500,000** | senior + equity, not just the 5,200,000 that left the wallet |
| Protocol | Deployment ratio | **65%** | 6,500,000 ÷ 10,000,000 |
| Protocol | Loan book yield | **17.50%** | only loan, so it is the book rate |
| Protocol | Current APY net to sPLUSD | still `null` | no repayments yet, so no net/gross ratio |
| Protocol | Cumulative yield | **0** | nothing minted |
| LP app | sPLUSD → PLUSD rate | **1.000000** | unchanged |
| LP app | Yield earned | **0** | unchanged |

**The LP sees capital deployed but no yield.** That is correct: yield only exists when a
repayment is minted. If the share price moved here, something is minting on the wrong
trigger.

---

## TC-3 — Price monitoring and the Watchlist round trip

Feed the eleven marks from `deal.json > market_mark_series` **in order**. After each, read
the CCR on the Trustee loans list and the loan page.

| # | Date | Feed gold | CCR | Band | What must happen |
|---|---|---|---|---|---|
| 3.1 | 2026-08-17 | 4,200.00 | 147.98% | green | nothing |
| 3.2 | 2026-09-01 | 4,165.00 | 146.57% | green | CCR updates on screen, **no on-chain write** |
| 3.3 | 2026-09-20 | 4,240.00 | 149.60% | green | nothing |
| 3.4 | 2026-10-05 | 3,980.00 | 139.09% | green | nothing |
| 3.5 | 2026-10-15 | **3,690.00** | **127.37%** | **amber** | **Watchlist notification** to Team, Originator, Trustee. Row appears in Needs Attention |
| 3.6 | 2026-10-28 | 4,180.00 | 147.18% | green | condition clears |

**Check at 3.2 specifically:** the CCR on screen changed but no `update_mutable`
transaction was broadcast. Writes happen on threshold crossings only. If every tick writes,
that is a cost bug.

**Exactly two threshold events across the whole series** — one down at 3.5, one recovery at
3.6. More than two means the detector is firing per tick instead of on transitions.

### 3.7 Trustee acts on the Watchlist

**Who:** Trustee · **Where:** Overview → Needs Attention → the CCR row → loan page →
*Update lifecycle*

**Do:** set status **Watchlist**, CCR **12737**, leave location alone, confirm, send.

**Expect:**
- Chip → **Watchlist**.
- CCR reads amber on the loans list.
- Loan still accepts repayments and mints. Watchlist is elevated risk, not a lock.

### 3.8 Trustee restores Performing

**Do:** *Update lifecycle* → status **Performing**, CCR **14718**.

**Expect:** chip → **Performing**, one transaction, instant, no timelock. **The way out must
be as easy to find as the way in** — if the tester has to hunt for it, log a UX bug.

---

## TC-4 — Shipment

### 4.1 Release lot A

**Who:** Trustee · **Where:** loan page → *Update lifecycle*

**Do:** location → **Vessel** / `IMO 9612345` / tracking URL. Append the stage-2 documents
and the v2 metadata pointer.

**Expect:**
- Location card shows the vessel and links out to tracking.
- Documents tab now lists **16**.
- Metadata pointer changed on chain.

### 4.2 Quantity decrements — but only on delivery

**Who:** Trustee / relayer

**Do:** mark lot A delivered to the smelter on 2026-11-02.

**Expect:**
- Valuation quantity drops **5,200 → 2,600 dmt**.
- CCR at the 2026-11-02 mark reads **150.61%** (2,600 dmt against 2,600,000 senior).

**Trap:** if quantity dropped when the lot *loaded* on 19 September, CCR would have halved
mid-voyage and fired a false margin call. Goods in transit are still collateral.

---

## TC-5 — Repayment 1 (lot A provisional)

### 5.1 Log the incoming wire

**Who:** Trustee · **Where:** loan page → *Log inbound wire*

**Do:** amount **6,081,752.77**, value date **2026-11-02**.

**Expect:** inbound movement created at *Received in Trust account*. A "wire received,
unrecorded" row appears in Needs Attention.

### 5.2 Record the repayment

**Who:** Trustee · **Where:** *Record repayment*

**Do:** confirm amount **6,081,752.77** and date **2026-11-02**. Do not override anything.

**Expect the screen to show exactly:**

| Line | Expected |
|---|---|
| Senior principal | **2,600,000.00** |
| Gross interest | 191,972.60 |
| Management fee | **10,969.86** |
| Performance fee | **18,100.27** |
| Net senior coupon → vault | **162,902.47** |
| OET allocation | **5,484.93** |
| Equity tranche | **0.00**, with the reason *senior principal still outstanding* |
| Originator residual, off-chain, greyed | **3,284,295.24** |

**The equity line must be visible showing zero with its reason.** A hidden or blank row is a
fail — zero here is a business rule, not missing data.

**Do:** *Confirm split* → send.

**Expect ledger counters after:**

```
Offtaker received      6,081,752.77
Senior principal        2,600,000.00
Senior interest           162,902.47
Management fee             10,969.86
Performance fee            18,100.27
OET allocation              5,484.93
Equity distributed              0.00
```

Status stays **Performing**. Senior outstanding now 2,600,000.

### 5.3 On-ramp and mint

**Who:** Trustee, then relayer

**Do:** *Instruct on-ramp* for the senior portion.

**Expect two mint legs:**

| Leg | Amount | Destination |
|---|---|---|
| Vault | **162,902.47** | sPLUSD vault |
| Treasury | **34,555.06** | Treasury wallet |

Each needs both the relayer signature and the custodian co-signature. Neither alone mints.

### 5.4 Negative check — the cap must bind

**Do:** attempt a vault mint of **200,000**.

**Expect:** rejected. It exceeds the recorded senior interest of 162,902.47. If it succeeds,
STOP — that is a minting bug.

### 5.5 The LP finally sees yield

**Where:** LP app, then Protocol dashboard

| Surface | Field | Expected |
|---|---|---|
| LP app | sPLUSD balance | 10,000,000 (unchanged — yield accretes to price, not units) |
| LP app | **sPLUSD → PLUSD rate** | **1.016290** |
| LP app | PLUSD value of holding | **10,162,902.47** |
| LP app | **Yield earned** | **162,902.47** |
| LP app | Transaction history | no new LP-initiated row; yield is not a transaction |
| Protocol | Cumulative yield | **162,902.47** |
| Protocol | Current APY net to sPLUSD | **14.85%** |
| Protocol | Outstanding in loans | **3,900,000** (6,500,000 − 2,600,000 principal repaid) |
| Protocol | Deployment ratio | **38.3%** |

**This is the money shot of the whole test.** A repayment landed and an LP who never touched
the loan sees their position grow. If the share price did not move, the mint did not reach
the vault.

---

## TC-6 — Repayment 2 (lot B provisional, and the equity return)

### 6.1 Repeat 4.1, 4.2, 5.1 for lot B

Ship on 2026-11-15, deliver 2026-12-22, wire **6,194,113.55** on **2026-12-28**. Quantity
drops 2,600 → 0.

Keep feeding the remaining marks as you go. All five stay green — no notification should
fire in this window.

| Date | Feed gold | Qty dmt | CCR | Band |
|---|---|---|---|---|
| 2026-11-02 | 4,265.00 | 2,600 | 150.61% | green |
| 2026-11-15 | 4,310.00 | 2,600 | **152.44%** | green |
| 2026-12-01 | 4,355.00 | 2,600 | **154.25%** | green |
| 2026-12-22 | 4,372.00 | 2,600 | **154.94%** | green |
| 2026-12-28 | 4,390.00 | 0 | 0 | n/a |

On the last mark the senior is retired and the collateral released, so **CCR reads 0, not
blank and not an error**.

### 6.2 Record it

**Expect the screen to show:**

| Line | Expected |
|---|---|
| Senior principal | **2,600,000.00** — retires the tranche |
| Gross interest | **69,808.22** |
| Management fee | 3,989.04 |
| Performance fee | 6,581.92 |
| Net senior coupon | **59,237.26** |
| OET allocation | 1,994.52 |
| **Equity tranche** | **1,300,000.00**, reason *senior principal cleared* |
| Originator residual | 2,222,310.81 |

**Check the interest base.** Gross interest is 69,808.22 because it accrues on the
**amortised** 2,600,000 for 56 days. If the screen shows **139,616** it used the original
5,200,000 — that is a real bug, log it.

**Expect counters after:**

```
Offtaker received     12,275,866.32
Senior principal       5,200,000.00   <- fully repaid
Senior interest          222,139.73
Management fee            14,958.90
Performance fee           24,682.19
OET allocation             7,479.45
Equity distributed     1,300,000.00   <- was 0
```

The equity counter moving from 0 to 1,300,000 in one step is the thing to watch. It must be
one of the seven counters on the ledger tab, not hidden.

### 6.3 Mint and read the LP side again

Vault **59,237.26**, treasury **12,565.48**.

| Surface | Field | Expected |
|---|---|---|
| LP app | sPLUSD → PLUSD rate | **1.022214** |
| LP app | Yield earned | **222,139.73** |
| Protocol | Cumulative yield | **222,139.73** |
| Protocol | Outstanding in loans | **1,300,000** (equity only) |

---

## TC-7 — Repayment 3 (final settlement, nothing to mint)

### 7.1 Record it

**Do:** wire **1,764,807.37**, value date **2027-02-05**.

**Expect every on-chain component to be zero:**

| Line | Expected |
|---|---|
| Senior principal | 0 — nothing outstanding |
| Coupon, fees, OET | 0 |
| Equity | 0 — *already returned in full* |
| Originator residual | **1,764,807.37** — the whole receipt |

Only *offtaker received* moves, to **14,040,673.69**.

### 7.2 The mint monitor must not spin

**Expect:** a **settled** tick, not a pending mint. No attestation built, no mint submitted,
retry absent rather than merely greyed out.

**⚠ This step fails today.** The waterfall endpoint rejects this payment with HTTP 400 —
see Appendix C, issue #963. Record the 400 and move on; it is a known finding, not a tester
error.

---

## TC-8 — Close

### 8.1 Open the close screen

**Expect three green checks:**

| Check | Expected | Why |
|---|---|---|
| Senior principal outstanding is zero | ✅ | 5,200,000 of 5,200,000 repaid |
| Nothing left to mint | ✅ | vault 222,139.73 minted = recorded; treasury 47,120.54 = recorded |
| Offtaker balance acknowledged | ✅ auto | received 14,040,673.69 ≥ contracted 13,372,557.24 |

**Read the third one carefully.** It went green because gold rose 5% over the quotational
period, not because the borrower did anything. If the UI labels this "overpaid" or shows a
negative outstanding balance, log it — see Appendix C.

### 8.2 Close

**Do:** reason **Repaid at maturity** → send.

**Expect:**
- Chip → **Closed / Repaid at maturity**.
- Every action button hidden; the page is read-only.
- Any further repayment or mint attempt **fails**.

### 8.3 Final readings

| Surface | Field | Expected |
|---|---|---|
| Protocol | Outstanding in loans | **0** |
| Protocol | Deployment ratio | **0%** |
| Protocol | Cumulative yield | **222,139.73** |
| LP app | sPLUSD → PLUSD rate | **1.022214** |
| LP app | Yield earned | **222,139.73** |
| Trustee | Loans → Closed tab | one row |

**LP arithmetic check:** 222,139.73 on 10,000,000 over 133 days is 6.1% annualised. That is
below the 8–12% target because a single 5.2M loan against a 10M pool is only 52% deployed
and the loan only ran 133 of its 180 days. The number should look modest — if it looks like
17.5%, something is crediting gross interest instead of the net coupon.

---

## TC-9 — Branch A: stress to default

Run from a **fresh copy of the state at the end of TC-2**. Do not continue from TC-8.

| # | Who | Do | Expect |
|---|---|---|---|
| 9.1 | tester | feed one tick, 2026-09-14, gold **2,900.00** | CCR **95.59%**. **Three** notifications in one tick: Watchlist, maintenance margin call, margin call. CCR reads red |
| 9.2 | Trustee | *Update lifecycle* → Watchlist, CCR 9559 | chip Watchlist. Mints still allowed |
| 9.3 | Originator | issue the margin call, let the cure period lapse | no top-up |
| 9.4 | Trustee | after 2027-02-13, mark the loan past due | **a confirm gate must appear** warning that recording and mints will lock, listing this loan's inbound wires. See Appendix C — no on-chain Matured status exists |
| 9.5 | Trustee | try *Record repayment* | button **hidden**. Any mint attempt fails naming the status |
| 9.6 | Trustee | *Escalate to council* → compose a default proposal | proposal saved. **No execute button anywhere.** If the Trustee can execute, STOP — that is a governance hole |
| 9.7 | Risk Council | 3 of 5 sign | timelock starts, 24h countdown, badge on the loan |
| 9.8 | Guardian | cancel the timelock | proposal → Cancelled, still listed for re-proposal, loan status unchanged |
| 9.9 | Risk Council | re-propose, sign, execute after 24h | status → **Default**. Ledger frozen. Recording never offered |
| 9.10 | Risk Council | close with a write-down, or re-term at 2400 bps | write-down close, or a new epoch appended with status unchanged |

---

## TC-10 — Branch B: rollover

Also from the end of TC-2, with the loan unpaid at maturity.

| # | Who | Do | Expect |
|---|---|---|---|
| 10.1 | Trustee | attempt a rollover **before** 2027-02-13 | **fails.** Terms change only after maturity |
| 10.2 | Trustee | after maturity, roll over: rate **1950**, maturity **2027-05-14** | screen shows the epoch table, days past maturity, and states that rolling mints nothing |
| 10.3 | Trustee | confirm | epoch **1** appended, source Rollover, effective from the **prior maturity** so accrual is continuous. Chip → Performing |
| 10.4 | tester | check the ceiling | rises by **250,027.40**. Genesis economics untouched. All seven counters carry over |

---

## Pass criteria

The run passes when all of these hold.

| # | Criterion |
|---|---|
| 1 | A bad origination request cannot be minted (1.3) |
| 2 | 3-of-5 without the Trustee cannot disburse (2.2) |
| 3 | Marking the wire sent broadcasts no transaction (2.4) |
| 4 | LP share price does not move on disbursement (2.5) |
| 5 | Exactly two CCR threshold events across eleven marks (TC-3) |
| 6 | A non-crossing tick writes nothing on chain (3.2) |
| 7 | Watchlist can be exited as easily as entered (3.8) |
| 8 | Quantity decrements on delivery, not on loading (4.2) |
| 9 | The equity line is visible at zero with its reason (5.2) |
| 10 | A mint above recorded interest is rejected (5.4) |
| 11 | LP share price moves to 1.016290 after the first mint (5.5) |
| 12 | Repayment 2 accrues interest on 2,600,000, not 5,200,000 (6.2) |
| 13 | Equity counter moves 0 → 1,300,000 exactly once (6.2) |
| 14 | A nothing-to-mint repayment settles without a pending mint (7.2) |
| 15 | Close requires all three checks green (8.1) |
| 16 | A closed loan refuses further recording and minting (8.2) |
| 17 | Final LP yield is 222,139.73 and share price 1.022214 (8.3) |
| 18 | The Trustee cannot execute a council proposal (9.6) |
| 19 | Rollover before maturity fails (10.1) |
| 20 | One metadata pointer written at mint and one per document stage (TC-1, 4.1) |

Criterion 14 is expected to fail today. See Appendix C.

---

## Appendix A — where the numbers come from

Only needed if a figure looks wrong and you want to check it by hand.

### Cargo

5,200 dmt at 8.00% moisture → `5,200 ÷ 0.92 = 5,652.1739 wmt`. Payables and charges are on
the dry tonne; freight and insurance on the wet tonne.

Assay: Au 28.50 g/dmt · Ag 42.00 · As 1.85% · Sb 0.14% · Pb 0.45% · Zn 2.60% · Hg 22 ppm ·
Bi 120 ppm · Cd 30 ppm.

Terms: Au payable 78% less 1.00 g/dmt · Ag payable 85% less 30.00 g/dmt · treatment charge
210.00/dmt · refining Au 6.00/oz, Ag 0.40/oz · haircut 40%.

### Penalties, per dry tonne

| Element | Assay | Threshold | Steps | Rate | USD/dmt |
|---|---|---|---|---|---|
| Arsenic | 1.85% | 0.20% | (1.85−0.20)÷0.10 = 16.5 | 5.00 | **82.50** |
| Antimony | 0.14% | 0.10% | (0.14−0.10)÷0.01 = 4.0 | 1.00 | **4.00** |
| Mercury | 22 ppm | 10 ppm | (22−10)÷5 = 2.4 | 1.00 | **2.40** |
| Zinc | 2.60% | 2.00% | (2.60−2.00)÷0.50 = 1.2 | 1.00 | **1.20** |
| Lead, bismuth, cadmium | | | below threshold | | 0.00 |
| | | | | **Total** | **90.10** |

### Collateral value at gold 4,200.00 / silver 50.00

```
Payable gold    28.50 × 0.78 − 1.00 = 21.230 g/dmt
                21.230 × 5,200 ÷ 31.1035 = 3,549.3112 oz
Payable silver  42.00 × 0.85 − 30.00 = 5.700 g/dmt
                5.700 × 5,200 ÷ 31.1035 = 952.9474 oz
```

| Line | Arithmetic | USD |
|---|---|---|
| Gross gold | 3,549.3112 × 4,200.00 | 14,907,106.92 |
| Gross silver | 952.9474 × 50.00 | 47,647.37 |
| **Gross payable** | | **14,954,754.29** |
| Treatment charge | 5,200 × 210.00 | (1,092,000.00) |
| Refining, gold | 3,549.3112 × 6.00 | (21,295.87) |
| Refining, silver | 952.9474 × 0.40 | (381.18) |
| Penalties | 5,200 × 90.10 | (468,520.00) |
| **Net smelter return** | | **13,372,557.24** |
| Freight | 5,652.1739 × 58.50 | (330,652.17) |
| Insurance | 14,954,754.29 × 0.09% | (13,459.28) |
| Superintendence | 5,200 × 0.50 | (2,600.00) |
| Marketing | 13,372,557.24 × 1.50% | (200,588.36) |
| **Mine-gate value** | | **12,825,257.43** |
| **Collateral value** | × (1 − 0.40) | **7,695,154.46** |

```
CCR = 7,695,154.46 ÷ 5,200,000 = 147.98%
```

The concentrate realises 65.67% of its contained metal value. That is normal for refractory
gold-pyrite, which clears 55–75%.

### Why CCR falls faster than gold

Treatment, refining, penalties and realisation costs are fixed dollars — they do not shrink
when gold falls. **A 1% fall in gold takes 1.144% off collateral value.** Hence the ladder:

| Level | Gold price | Move | CCR |
|---|---|---|---|
| Watchlist | 3,753.78 | −10.62% | 130% |
| Maintenance margin call | 3,505.66 | −16.53% | 120% |
| Margin call | 3,257.53 | −22.44% | 110% |
| Bare cover | 3,009.41 | −28.35% | 100% |

### Interest and fees

Simple interest, actual/365, on the **outstanding** senior balance.

```
P1  5,200,000 × 17.50% × 77 ÷ 365 = 191,972.60
P2  2,600,000 × 17.50% × 56 ÷ 365 =  69,808.22

P1 management  5,200,000 × 1.00% × 77 ÷ 365      =  10,969.86
P1 performance (191,972.60 − 10,969.86) × 10%    =  18,100.27
P1 net coupon  191,972.60 − 10,969.86 − 18,100.27 = 162,902.47
P1 OET         5,200,000 × 0.50% × 77 ÷ 365      =   5,484.93
```

### LP share price

```
after P1  (10,000,000 + 162,902.47) ÷ 10,000,000 = 1.016290
after P2  (10,000,000 + 222,139.73) ÷ 10,000,000 = 1.022214
```

### Two prices, never confuse them

**Contract price** decides what the offtaker pays. It fixes on a quotational-period average
— Lot A at 4,240.00 on 2026-09-20, Lot B at 4,310.00 on 2026-11-15, final at 4,387.50 — and
then never moves. **Market price** decides collateral value and therefore CCR, and never
fixes.

At the 15 October trough market gold was 3,690 while Lot A's contract price was already
locked at 4,240. CCR broke 130% on a receivable that had stopped moving. That gap is the
loan's actual risk and it is only visible if the two prices are kept apart.

Quotational-period pricing is standard for concentrate, not an invention of this fixture.

---

## Appendix B — documents

21 in total, in three stages. **Only 9 exist on origination day.**

### Stage 1 — attached to the origination request

| ID | Document |
|---|---|
| [D21](documents/stockpile-composite-certificate.md) | Stockpile composite certificate of analysis and weight — what the loan is valued on |
| [D02](documents/offtake-contract-extract.md) | Offtake contract extract — payable %, charges, penalties, QP, Incoterm |
| [D01](documents/facility-agreement-extract.md) | Facility agreement extract |
| [D15](documents/collateral-management-agreement.md) | Collateral management agreement |
| [D16](documents/warehouse-receipt.md) | Warehouse receipts and register |
| [D17](documents/assignment-of-receivable.md) | Deed of assignment, with the offtaker's acknowledgement |
| [D18](documents/security-agreement-pledge.md) | Security agreement and pledge |
| [D19](documents/kyb-sanctions-screening.md) | KYB and sanctions screening |
| [D14](documents/export-permit-declaration.md) | Mineral export permit |

### Stage 2 — attached before each cargo release (TC-4.1)

| ID | Document |
|---|---|
| [D13](documents/letter-of-credit.md) | Letter of credit, confirmed, at sight |
| [D03](documents/certificate-of-analysis-lot-a.md) | Certificate of analysis, lot A |
| [D04](documents/certificate-of-analysis-lot-b.md) | Certificate of analysis, lot B |
| [D05](documents/certificate-of-weight-moisture.md) | Certificate of weight and moisture |
| [D06](documents/tml-certificate.md) | IMSBC declaration and transportable moisture limit |
| [D07](documents/preshipment-inspection-report.md) | Pre-shipment inspection report |
| [D12](documents/marine-insurance-certificate.md) | Marine cargo insurance |

### Stage 3 — attached after shipment

| ID | Document |
|---|---|
| [D08](documents/bill-of-lading.md) | Bills of lading |
| [D09](documents/packing-list-lot-manifest.md) | Packing list and lot manifest |
| [D10](documents/provisional-commercial-invoice.md) | Commercial invoices |
| [D11](documents/certificate-of-origin.md) | Certificate of origin |
| [D20](documents/umpire-assay-protocol.md) | Umpire appointment and settlement assay |

Every document carries a MOCK banner. Companies, permits and account numbers are fictional.

**What goes on IPFS:** one file per stage — `metadata.v1.json` (9 documents),
`metadata.v2.json` (16), `metadata.v3.json` (21). Each lists titles and SHA-256 digests only.
**No document body is ever pinned** — 7 of the 21 carry personal data, bank details or
contract pricing, and IPFS is public and permanent.

---

## Appendix C — what will fail today, and why

Checked 29 July 2026 against the Soroban loan-registry and `eq-lab/pipeline @ 9c38744`.
These are open findings, not tester errors. Do not "fix" the test data to make them pass.

| Step | What happens | Issue |
|---|---|---|
| **TC-7.1** | The final settlement is **rejected with HTTP 400**. The endpoint refuses any payment above the contracted offtaker price, but a quotational-period deal legitimately settles above it when the metal rises | #963 |
| **TC-1.6, TC-3** | If the valuation record carries **both gold and silver**, CCR reads **193.62%** instead of 147.98% — silver is priced at the gold price. Run a gold-only variant (expect 147.45%) until fixed | #964 |
| **TC-5.2** | The waterfall endpoint pays **interest before principal**, so it returns senior principal of **5,200,000** at P1 — the whole tranche — not 2,600,000. The amortisation above is then a Trustee override | #968 |
| **TC-5.2** | Interest is computed as **compound**, not simple. Expect 179,952.67 at P1, not 191,972.60 — about 6% lower | #968 |
| **TC-6.2** | `equity_distributed` is an **uncapped residual**, so it will not stop at 1,300,000 | #968 |
| **TC-9.4** | There is **no Matured status on chain** — only four statuses exist. Past due is derived from the maturity date, so there is nothing to set | #969 |

Also: CCR is stored 1e6-scaled on chain (**1479800**) and in basis points in the API
(**14798**); the rate is **175000** on chain and **1750** in basis points; money is
7-decimal on Stellar. Do not hand-convert — an incorrect ÷1000 has already shipped once.
