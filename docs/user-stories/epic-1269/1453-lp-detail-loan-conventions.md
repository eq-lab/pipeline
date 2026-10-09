# User Stories: #1453 — LP counterparty detail on the Loan-detail conventions

Epic: [#1269 — Trustee LP Counterparties](https://github.com/eq-lab/pipeline/issues/1269)
Issue: [#1453](https://github.com/eq-lab/pipeline/issues/1453)
Spec: [Trustee flows](../../frontend/trustee-flows.md)

Frontend, restyle only — no new data, no new endpoint, no behaviour change. Exercise Trustee →
LP Counterparties → an LP's detail page (`/lp-counterparties/{id}`) against a live API, with
`/loans/{id}` open in a second tab as the reference. The epic has **no Figma**: the shipped Loan
detail page is the acceptance reference.

## Story 1: The LP detail page reads as the Loan detail page

**Persona:** Trustee operator moving between a loan and an LP in one session.

**Pre-conditions:** Signed in; at least one registered LP.

**Steps:**

1. Open `/loans/{id}` for any loan and note the page shell, hero and card treatment.
2. Open `/lp-counterparties` and click a row.
3. Compare the two pages side by side.

**Expected outcomes:**

- Both pages use the same content width and gutter — the LP page is no longer wider or more
  tightly gutted than the loan page.
- The LP hero is the loan hero: a back link reading `‹ LP Counterparties` above the LP's legal
  name in the display face at the same size as the loan title, with the status chip and the muted
  meta line on the row beneath it. There is no button floated next to the heading any more.
- The status chip is the loan chip — a 4px-radius bordered chip, not the old rounded pill.
- Every card is the loan card: 1px hairline border, 4px radius, surface background, and a
  display-face card title at the same size as "Price & collateral" on the loan page.

## Story 2: The hero meta line prints only served values

**Persona:** Trustee operator checking when an LP entered review.

**Pre-conditions:** Two LPs — one that has been submitted and decided, one registered but never
submitted.

**Steps:**

1. Open the decided LP's detail page and read the line next to the status chip.
2. Open the never-submitted LP's detail page and read the same line.

**Expected outcomes:**

- The decided LP shows `<jurisdiction> · Registered <date> · Submitted <date> · Decided <date>`,
  with each date in the `18 Jun 2026` form.
- The never-submitted LP shows only the clauses that exist — the `Submitted` and `Decided` clauses
  are **absent entirely**. No `—` ever appears inside the meta line, and no date is invented.
- An LP with no `country` drops the leading jurisdiction clause rather than printing `—`.

## Story 3: An LP under review wears the brand chip, on both the list and the detail page

**Persona:** Trustee operator triaging the queue.

**Pre-conditions:** At least one LP whose `kyb_status` is `UnderReview`, and one that is
`ChangesRequested`.

**Steps:**

1. Open `/lp-counterparties` and look at the Account Status column.
2. Click into the `UnderReview` LP.

**Expected outcomes:**

- The `UnderReview` row's "KYB Pending" reads in the brand blue, not amber — it is the trustee's
  move now. The `ChangesRequested` row stays amber, "Approved" stays green, "Rejected" stays red
  and "New" stays grey.
- The detail page's chip carries the same label and the same brand colour as the row just clicked.

## Story 4: The profile card is a key/value list

**Persona:** Trustee operator reading an LP's registration record.

**Pre-conditions:** One LP with a settlement address and a decision reason, one with neither.

**Steps:**

1. Open the first LP's detail page and read the **LP profile** card.
2. Open the second LP's detail page and read the same card.

**Expected outcomes:**

- Seven rows, in order: Jurisdiction, Contact email, First registration date, Submitted for
  review, Latest decision date, Settlement address, Latest decision reason — each a muted label on
  the left and the value right-aligned, separated by hairline rules, with no rule under the last
  row. It is no longer a multi-column grid.
- Absent values render `—`.
- A decision reason written over several lines keeps its line breaks.

## Story 5: Documents keep their content and gain the loan Documents treatment

**Persona:** Trustee operator reviewing an LP's KYB pack.

**Pre-conditions:** An `UnderReview` LP with at least one `Provided` document, one previously
rejected document, and one LP with no documents at all.

**Steps:**

1. Open the LP detail page and read the **KYB documents** card.
2. Click **Refresh** in the card's title row.
3. Click **Download** on a document.
4. Open the LP with no documents.

**Expected outcomes:**

- Each document row is prefixed by the same blue-tinted 32px document tile the loan Documents
  card uses, then the filename, the `<bytes> bytes · <content type> · <status>` line beneath it,
  and the `Uploaded … · Reviewed … · Reviewer …` line below that. A rejected document still shows
  `Rejection reason: …` in red.
- **Refresh** now lives on the card's title row, not beside the page heading, and is a
  loan-style secondary button. Clicking it refetches and the download links keep working.
- **Download** is still a real link that opens the presigned URL in a new tab. When no URL is
  served the row shows "Download unavailable. Refresh to retry." instead.
- The empty LP shows "No documents submitted." and still offers Refresh.

## Story 6: Review actions behave exactly as before

**Persona:** Trustee operator completing a KYB review.

**Pre-conditions:** An `UnderReview` LP with one `Provided` document; a `Passed` LP.

**Steps:**

1. On the `UnderReview` LP, read the **KYB decision** card.
2. Click **Verify document**, confirm in the dialog, and watch the card.
3. Click **Confirm KYB passed** and submit.
4. Open the `Passed` LP and read the same card.

**Expected outcomes:**

- While any document is unverified, the card shows "Verify every submitted document before
  confirming KYB passed." and offers only **Reject account** and **Request changes**.
- Verifying the last document makes **Confirm KYB passed** appear — rendered in brand blue, the
  same primary the loan page uses. Every other action (Reject account, Request changes, Verify
  document, Reject document, Refresh, Retry) is the white, hairline-bordered secondary button, and
  all of them are 40px tall with a 4px radius.
- Each dialog opens with the same title, the same reason field and the same consequence copy as
  before; rejecting a document still requires a nonblank reason; submitting still writes through
  the review endpoint and refreshes the record.
- The `Passed` LP shows only "Review actions are available only while the LP is UnderReview." —
  no buttons.

## Story 7: Bank deposits keep working under the new table typography

**Persona:** Trustee operator recording and minting a wire.

**Pre-conditions:** An LP with at least one recorded, unminted deposit; a connected Stellar
wallet.

**Steps:**

1. Read the **Bank deposits** card.
2. Click **Record deposit**, then cancel.
3. Click **Mint PLUSD** on an unminted row.

**Expected outcomes:**

- The card is now a loan-style card with a display-face "Bank deposits" title; the table headers
  are muted and unbolded, body cells sit at the loan body size, rows are separated by hairline
  rules, and the Amount column stays right-aligned with tabular figures. The table still scrolls
  horizontally on a narrow window rather than squashing.
- **Record deposit** is the brand-blue primary; Cancel and **Mint PLUSD** are the bordered
  secondary. The dialog's fields, validation copy and the `409` duplicate-reference message are
  unchanged.
- Minting still walks `Awaiting signature… → Submitting… → Confirming… → Waiting for the indexer`,
  and a disabled **Mint PLUSD** still shows its reason both as a hover title and as the hint line
  under the button. See [#1449](./1449-trustee-mint-bank-deposit.md) for the full mint matrix —
  none of it changed here.

## Story 8: The loan detail page is untouched

**Persona:** Trustee operator who uses the loan pages daily.

**Pre-conditions:** Signed in.

**Steps:**

1. Open `/loans/{id}` for a performing loan, a watchlist loan and a matured loan.

**Expected outcomes:**

- Nothing has changed: hero, chip, lifecycle stepper, summary tiles, Price & collateral, Registry,
  Documents, Other actions and every dialog render exactly as before this issue. The shared
  primitives were extracted out of this page, not redesigned.

## Story 9: Long values and a bad id degrade gracefully

**Persona:** Trustee operator pasting a URL.

**Pre-conditions:** An LP with a long legal name.

**Steps:**

1. Open that LP's detail page and narrow the window.
2. Navigate to `/lp-counterparties/abc`.
3. Navigate to the id of an LP that does not exist.

**Expected outcomes:**

- The long legal name wraps inside the page shell; it never overflows the content width or forces
  horizontal page scroll. Long settlement addresses and emails wrap inside their profile rows.
- `/lp-counterparties/abc` shows "This LP identifier is invalid." under the hero.
- A missing LP shows the mapped error inside a card with a **Retry** button that refetches.
