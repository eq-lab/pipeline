# Letters of Credit — SWIFT Standards

> No implementation details in this doc — message formats only. See [overview.md](./overview.md) for LC concepts and [prior-art.md](./prior-art.md) for existing platforms.

A letter of credit isn't a free-form document — banks issue and manage it almost entirely through standardized electronic messages defined by SWIFT's **Category 7** (Documentary Credits and Guarantees). Every field has a fixed tag under the ISO 15022 standard, which is why an LC issued by any bank can be parsed unambiguously by any other bank. This doc details the two messages most relevant to understanding what data an LC actually carries — **MT700** (issuance) and **MT707** (amendment) — and lists the rest of the family for context.

The worked examples below use a single fictional deal for continuity: a Brazilian coffee exporter (Beneficiary) shipping to a German roastery (Applicant), using the Applicant (A) / Beneficiary (B) terminology from [overview.md](./overview.md).

## MT700 — Issue of a Documentary Credit

Sent by the Issuing Bank to the Advising Bank. This message *is* the LC — every commercial term the Beneficiary relies on lives in one of these fields.

| Tag | Field name | Status |
|---|---|---|
| `27` | Sequence of total | Mandatory |
| `40A` | Form of documentary credit | Mandatory |
| `20` | Documentary credit number | Mandatory |
| `23` | Reference to pre-advice | Optional |
| `31C` | Date of issue | Optional |
| `40E` | Applicable rules | Mandatory |
| `31D` | Date and place of expiry | Mandatory |
| `51a` | Applicant bank | Optional |
| `50` | Applicant | Mandatory |
| `59` | Beneficiary | Mandatory |
| `32B` | Currency code, amount | Mandatory |
| `39A` / `39B` / `39C` | Amount tolerance / maximum / additional amounts covered | Conditional/Optional |
| `41a` | Available with ... by ... | Mandatory |
| `42C` / `42a` / `42M` / `42P` | Drafts at ... / Drawee / mixed or deferred payment details | Conditional |
| `43P` / `43T` | Partial shipments / transshipment | Optional |
| `44A` / `44E` / `44F` / `44B` | Place of receipt / port of loading / port of discharge / place of delivery | Optional |
| `44C` / `44D` | Latest date of shipment / shipment period | Conditional |
| `45A` | Description of goods and/or services | Optional |
| `46A` | Documents required | Optional |
| `47A` | Additional conditions | Optional |
| `71B` | Charges | Optional |
| `48` | Period for presentation | Optional |
| `49` | Confirmation instructions | Mandatory |
| `53a` | Reimbursing bank | Optional |
| `78` | Instructions to the paying/accepting/negotiating bank | Optional |
| `57a` | 'Advise through' bank | Optional |
| `72` | Sender to receiver information | Optional |

Note `46A` (documents required) and `45A`/`47A` are marked "Optional" only in the strict SWIFT-field sense — in practice every real LC populates them, since without them there's nothing for the Issuing Bank to check documents against.

### Worked example (illustrative, not a real transaction)

```
:27:1/1
:40A:IRREVOCABLE
:20:LC-FRA-2026-04471
:31C:260902
:40E:UCP LATEST VERSION
:31D:261115SANTOS, BRAZIL
:50:ROSTSTUBE KAFFEE GMBH
FRANKFURT, GERMANY
:59:FAZENDA BELA VISTA EXPORTADORA LTDA
SANTOS, BRAZIL
:32B:USD185000,
:39A:05/05
:41D:ANY BANK IN BRAZIL
BY NEGOTIATION
:42C:SIGHT
:42A:DEUTSCHE HANDELSBANK AG, FRANKFURT
:43P:NOT ALLOWED
:43T:ALLOWED
:44E:SANTOS, BRAZIL
:44F:HAMBURG, GERMANY
:44C:261101
:45A:1,000 BAGS (60KG EACH) GREEN ARABICA COFFEE, GRADE 2,
FOB SANTOS PER CONTRACT NO. 2026-0817
:46A:+SIGNED COMMERCIAL INVOICE IN TRIPLICATE
+FULL SET CLEAN ON BOARD OCEAN BILLS OF LADING TO ORDER OF
DEUTSCHE HANDELSBANK AG, FREIGHT PREPAID, NOTIFY APPLICANT
+PACKING LIST IN DUPLICATE
+CERTIFICATE OF ORIGIN ISSUED BY BRAZILIAN CHAMBER OF COMMERCE
+PHYTOSANITARY CERTIFICATE
+INSURANCE CERTIFICATE FOR 110 PCT CIF VALUE, ICC(A)
:47A:ALL DOCUMENTS IN ENGLISH. THIRD PARTY DOCUMENTS ACCEPTABLE
EXCEPT DRAFT AND INVOICE
:71B:ALL BANKING CHARGES OUTSIDE GERMANY FOR BENEFICIARY'S ACCOUNT
:48:21 DAYS AFTER SHIPMENT DATE, WITHIN LC VALIDITY
:49:WITHOUT
:78:UPON RECEIPT OF COMPLYING DOCUMENTS, REIMBURSE YOURSELVES
BY DEBITING OUR ACCOUNT WITH YOU
```

If `45A`/`46A`/`47A` run longer than the field's line limit, the overflow spills into a follow-up **MT701** message (a pure continuation — see "Other messages" below), not a new LC.

## MT707 — Amendment to a Documentary Credit

Trade deals change constantly after issuance — shipment slips, amounts need adjusting, a document requirement gets tweaked. MT707 carries exactly that: a delta against an already-issued MT700, referenced by its original credit number. Under UCP 600, an amendment only becomes binding once the Beneficiary (and any confirming bank) accepts it — it isn't unilateral.

| Tag | Field name | Status |
|---|---|---|
| `20` | Sender's reference | Mandatory |
| `21` | Receiver's reference (the original LC number) | Mandatory |
| `23` | Issuing bank's reference | Optional |
| `52a` | Issuing bank | Optional |
| `31C` | Date of issue (of the original credit) | Optional |
| `30` | Date of amendment | Optional |
| `26E` | Number of amendment | Optional |
| `59` | Beneficiary (as of before this amendment) | Mandatory |
| `31E` | New date of expiry | Conditional |
| `32B` | Increase of documentary credit amount | Conditional |
| `33B` | Decrease of documentary credit amount | Conditional |
| `34B` | New documentary credit amount after amendment | Conditional |
| `39A` / `39B` / `39C` | Amount tolerance / maximum / additional amounts covered | Conditional |
| `44A` / `44E` / `44F` / `44B` | Place/port fields being amended | Conditional |
| `44C` / `44D` | New latest date of shipment / shipment period | Conditional |
| `79` | Narrative | Conditional |
| `72` | Sender to receiver information | Conditional |

### Worked example, continuing the same deal

The coffee shipment above hits a production delay at origin. The Applicant and Beneficiary agree to push the shipment date back and add a small amount to cover extra freight:

```
:20:LC-FRA-2026-04471-A1
:21:LC-FRA-2026-04471
:30:261020
:26E:1
:59:FAZENDA BELA VISTA EXPORTADORA LTDA
SANTOS, BRAZIL
:31E:261215SANTOS, BRAZIL
:32B:USD9250,
:34B:USD194250,
:44C:261130
:79:DUE TO A PRODUCTION DELAY AT ORIGIN, THE LATEST SHIPMENT DATE
AND CREDIT VALIDITY ARE EXTENDED BY 29 DAYS. CREDIT AMOUNT
INCREASED BY USD 9,250.00 TO COVER ADDITIONAL FREIGHT. ALL OTHER
TERMS AND CONDITIONS OF THE ORIGINAL CREDIT REMAIN UNCHANGED.
```

Everything not mentioned in the MT707 — the goods description, the document checklist, the port pair — carries forward unchanged from the original MT700. Only the delta is transmitted.

## Other Category 7 messages

| Message | Name | Purpose |
|---|---|---|
| `MT701` / `MT708` | Continuation | Overflow pages for MT700 / MT707 when a field exceeds its length limit — not a separate concept |
| `MT710` / `MT711` | Advice of a third bank's documentary credit | Relays an LC (and its overflow) through a second advising bank in the chain |
| `MT720` / `MT721` | Transfer of a documentary credit | Lets a Beneficiary who is a trading middleman transfer all or part of a *transferable* LC to their own supplier as second beneficiary |
| `MT730` | Acknowledgement | Plain receipt confirmation between banks, no commercial content |
| `MT734` / `MT750` | Advice of refusal / discrepancy | Issuing or nominated bank notifies that presented documents don't comply |
| `MT740` / `MT742` | Authorization to reimburse / reimbursement claim | The Issuing Bank's advance instruction to a reimbursing bank, and the nominated bank's claim against it, for moving the actual payment |
| `MT754` | Advice of payment/acceptance/negotiation | Nominated bank confirms to the Issuing Bank that a complying presentation was honored |
| `MT760`–`MT769` | Standby LC / guarantee family | A related but distinct instrument: pays if the Applicant *fails* to perform, the inverse trigger from a commercial LC |
| `MT799` | Free format message | Unstructured bank-to-bank message, e.g. pre-advice; the least structurally constrained message in the category |

`MT799` and `MT760` are the two message types most abused in "bank instrument monetization" fraud schemes, precisely because they carry the weakest structural guarantees in the category — `MT799` is free text, and `MT760` backs a guarantee rather than a document-triggered payment. `MT700`, `MT707`, `MT734`, and `MT742` all have rigid, SWIFT-validated field grammars that are far harder to forge convincingly.
