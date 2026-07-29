> **MOCK DOCUMENT — TEST FIXTURE ONLY.** Not a real assay exchange record.
> Deal ref PIPE-GPC-001. Document ID D20.

# Assay Exchange Record, Umpire Appointment and Settlement Assay

**Contract** OM-BJY-2026-0417 · clause 11
**Parcel** 5,200.000 dmt, Lots A and B, treated as one settlement parcel under clause 11.6

## 1. Splitting limits (clause 11.5)

| Element | Splitting limit |
|---|---|
| Gold | 0.50 g/dmt |
| Silver | 3.0 g/dmt |
| Arsenic | 0.10% |
| Moisture | 0.30 percentage points |

Within the limit, settlement is the arithmetic mean of the two party results. Outside the
limit, the umpire sample is assayed and settlement is the mean of the umpire result and
whichever party result is closer to it.

## 2. Assay exchange

**Exchanged simultaneously on 14 December 2026**, within the 45-day window from the Lot A
discharge date of 28 October 2026.

| Element | Seller (Alfred H Knight) | Buyer (Beihai Jinyuan lab) | Difference | Limit | Within limit? |
|---|---|---|---|---|---|
| Gold, g/dmt | 28.50 | **27.86** | **0.64** | 0.50 | **NO — umpire** |
| Silver, g/dmt | 42.00 | 40.90 | 1.10 | 3.0 | Yes |
| Arsenic, % | 1.85 | 1.89 | 0.04 | 0.10 | Yes |
| Antimony, % | 0.14 | 0.14 | 0.00 | — | Yes |
| Zinc, % | 2.60 | 2.58 | 0.02 | — | Yes |
| Mercury, ppm | 22 | 23 | 1 | — | Yes |
| Lead, % | 0.45 | 0.44 | 0.01 | — | Yes |
| Moisture, % | 8.00 | 8.12 | 0.12 | 0.30 | Yes |

Gold fell outside the splitting limit. This is the expected failure mode for a
coarse-gold-bearing concentrate: the nugget effect inflates sampling variance well beyond
what base-metal splitting limits assume.

## 3. Umpire appointment

| Item | Detail |
|---|---|
| **Umpire appointed** | **Alex Stewart International**, Lima laboratory |
| Appointment date | 16 December 2026 |
| Basis | Panel rotation at clause 11.7. **Alfred H Knight excluded** — it carried out the sampling and may not act as umpire |
| Sample | Sealed umpire split AHK seal 771-A-U, transferred under chain of custody UMP-CoC-2026-0044 |
| Method | Fire assay with gravimetric finish, plus screen assay on the +106 µm fraction, in duplicate |
| Reserve sample | Retained by Alfred H Knight to 18 December 2026 (Lot A) and 13 February 2027 (Lot B) |

## 4. Umpire result

| Element | Umpire result |
|---|---|
| **Gold** | **28.42 g/dmt** |

## 5. Settlement determination — gold

| Step | Value |
|---|---|
| Umpire | 28.42 g/dmt |
| Seller | 28.50 g/dmt — distance from umpire **0.08** |
| Buyer | 27.86 g/dmt — distance from umpire **0.56** |
| **Closer party** | **Seller** |
| **Settlement gold** | mean of umpire and Seller = (28.42 + 28.50) / 2 = **28.46 g/dmt** |

**Rounded to the contractual reporting precision of 0.05 g/dmt: 28.50 g/dmt.**

Umpire fees of USD 3,400 are borne by the **Buyer**, whose result was further from the
umpire.

## 6. Settlement assay adopted

| Element | Settlement value | Derivation |
|---|---|---|
| **Gold** | **28.50 g/dmt** | umpire determination, section 5 |
| **Silver** | **42.00 g/dmt** | mean of 42.00 and 40.90 = 41.45, rounded to reporting precision of 0.5 g/dmt |
| **Arsenic** | **1.85%** | mean of 1.85 and 1.89 = 1.87, rounded to reporting precision of 0.05% |
| **Antimony** | **0.14%** | agreed |
| **Zinc** | **2.60%** | mean, rounded |
| **Mercury** | **22 ppm** | mean, rounded |
| **Lead** | **0.45%** | mean, rounded |
| **Bismuth** | **120 ppm** | agreed |
| **Cadmium** | **30 ppm** | agreed |
| **Moisture** | **8.00%** | mean 8.06, rounded to reporting precision of 0.10 pp, load-port weight final |

**This settlement assay is final and binding under clause 11.5 and is the assay applied in
the final settlement invoice (document D10) and in the collateral valuation.**

## 7. Valuation-record status transitions

| Date | `assay_status` | Trigger |
|---|---|---|
| 18 Sep 2026 | `Provisional` | Seller's CoA issued, D03 |
| 14 Dec 2026 | `UmpirePending` | Gold outside the splitting limit at exchange |
| 22 Dec 2026 | `Final` | Umpire result received and settlement determined |

## 8. Lender's note

Umpire referral on gold is the base case, not an exception, for a coarse-gold concentrate.
The valuation record must carry an `assay_status` and the collateral value must be capable of
being marked at the **less favourable** of the two party assays while the status is
`UmpirePending`. Marking at the Buyer's 27.86 g/dmt instead of 28.50 g/dmt for the parcel cuts
payable gold from 3,549.3112 oz to 3,465.8530 oz and collateral value from USD 7,695,154.46
to USD 7,488,479.91, a fall of **2.69%**, moving CCR from **147.98% to 144.01%**. That is
still inside the 130% watchlist band, so on this deal the dispute is not a threshold event.
On a thinner deal it would be, which is why `assay_status` belongs in the valuation record.
