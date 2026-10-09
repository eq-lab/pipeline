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

## Story 4: The profile splits into LP profile and KYB review

**Persona:** Trustee operator reading an LP's registration record.

**Pre-conditions:** One LP with a linked wallet and a decision reason, one with neither.

**Steps:**

1. Open the first LP's detail page and read the two cards under the hero.
2. Narrow the window below 900px.
3. Open the second LP's detail page and read the same cards.

**Expected outcomes:**

- Two cards sit **side by side** under the hero: **LP profile** (Legal name, Jurisdiction, Contact
  email, Registered, Linked wallet) and **KYB review** (Status, Submitted for review, Latest
  decision date, Reviewer, Latest decision reason). Each row is a muted label on the left and the
  value right-aligned, separated by hairline rules, with no rule under the last row.
- The KYB review card's Status row repeats the hero chip — same label, same colour.
- Below ~900px the two cards stack into one column; nothing is clipped and the page never scrolls
  sideways.
- Absent values render `—`. A decision reason written over several lines keeps its line breaks.
- **Reviewer always reads `—`.** The API never returns the deciding operator, so the row states
  that the value is absent rather than inventing one from the documents' reviewer.

## Story 5: Addresses are truncated, and one click reveals and copies them

**Persona:** Trustee operator pasting an LP's wallet into an explorer.

**Pre-conditions:** An LP with a linked Stellar wallet, at least one reviewed document, and at
least one recorded bank deposit.

**Steps:**

1. Open the LP detail page and read the **Linked wallet** row.
2. Click the wallet value.
3. Paste into any text field.
4. Click the wallet value again.
5. Read the reviewer on a reviewed document.

**Expected outcomes:**

- The wallet renders as a small chip showing `…` plus the **last five** characters (e.g.
  `…CQXS4`), not the full 56-character key. Hovering shows the full value as a tooltip.
- Clicking it expands the chip to the full key in place and copies that key to the clipboard; a
  muted **Copied** appears next to it and fades after about a second and a half.
- The pasted value is the complete key, character for character.
- Clicking again collapses the chip back to `…CQXS4`.
- The linked wallet and the document reviewer key use the same chip, and no row is stretched by a
  long key any more. The Bank deposits **Recorded by** cell is the table variant — see Story 8.
- If the browser blocks clipboard access the value still expands and no "Copied" is shown — the
  page never claims a copy that did not happen.

## Story 6: Documents keep their content and gain compact icon controls

**Persona:** Trustee operator reviewing an LP's KYB pack.

**Pre-conditions:** An `UnderReview` LP with at least one `Provided` document, one previously
rejected document, and one LP with no documents at all.

**Steps:**

1. Open the LP detail page and read the **KYB documents** card.
2. Click the refresh icon in the card's title row.
3. Click the download icon on a document.
4. Open the LP with no documents.

**Expected outcomes:**

- Each document row is prefixed by the same blue-tinted 32px document tile the loan Documents card
  uses, then the filename, the `<bytes> bytes · <content type> · <status>` line beneath it, and the
  `Uploaded … · Reviewed … · Reviewer …` line below that. A rejected document still shows
  `Rejection reason: …` in red.
- **Refresh is now a 40×40 icon button** on the card's title row — a circular-arrow glyph with no
  label text, announced as "Refresh documents". Clicking it refetches and the download links keep
  working.
- **Download is now an icon button** — a down-arrow glyph announced as "Download <filename>" — and
  is still a real link that opens the presigned URL in a new tab. When no URL is served the row
  shows "Download unavailable. Refresh to retry." instead.
- **Verify and Reject are 32px icon-plus-text buttons** beside the download icon, green and red in
  the band colours: a tick glyph before "Verify", a cross glyph before "Reject", each glyph the
  same colour as its label. They are announced as "Verify <filename>" and "Reject <filename>" —
  the glyph itself is decorative and is not read out. They appear only for a `Provided` document
  while the LP is UnderReview, and each still opens the same dialog as before.
- The empty LP shows "No documents submitted." and still offers the refresh icon.

## Story 7: The verdicts live on the documents title row, and behave exactly as before

**Persona:** Trustee operator completing a KYB review.

**Pre-conditions:** An `UnderReview` LP with one `Provided` document; a `Passed` LP.

**Steps:**

1. On the `UnderReview` LP, look at the **KYB documents** title row.
2. Click **Verify** on the document, confirm in the dialog, and watch the title row.
3. Click **Confirm KYB passed** and submit.
4. Open the `Passed` LP and read the same row.

**Expected outcomes:**

- There is **no separate KYB decision card** any more. The verdicts sit on the KYB documents title
  row, left of the refresh icon: **Reject account**, **Request changes**, and — once every document
  is verified — **Confirm KYB passed**.
- They are compact, band-coloured buttons, not solid primaries: Confirm reads positive green,
  Request changes attention amber, Reject account negative red, each a tinted fill with a matching
  border and label.
- While any document is unverified, **Confirm KYB passed** is absent and the line "Verify every
  submitted document before confirming KYB passed." shows under the title row.
- Each dialog opens with the same title, the same reason field and the same consequence copy as
  before; rejecting a document still requires a nonblank reason; submitting still writes through
  the review endpoint and refreshes the record.
- The `Passed` LP shows only "Review actions are available only while the LP is UnderReview." in
  that row — no verdict buttons, and no Verify/Reject buttons on the documents.

## Story 8: Bank deposits read as an even five-column table

**Persona:** Trustee operator recording and minting a wire.

**Pre-conditions:** An LP with at least one recorded, unminted deposit and one minted deposit; a
connected Stellar wallet.

**Steps:**

1. Read the **Bank deposits** card.
2. Click the **Recorded by** value on any row, then paste into a text field.
3. Click **Record deposit**, then cancel.
4. Click **Mint PLUSD** on the unminted row.
5. Narrow the window.

**Expected outcomes:**

- The card is a loan-style card with a display-face "Bank deposits" title; the table headers are
  muted and unbolded, body cells sit at the loan body size, and rows are separated by hairline
  rules.
- The table has **five columns of even, fixed proportions** — Received, Amount, Payment reference,
  Recorded by, PLUSD. Received no longer takes a disproportionate share and Amount is no longer
  squeezed against Payment reference; the proportions hold as the window widens.
- **Amount** is right-aligned with tabular figures and is formatted exactly like a loan amount on
  the Loans table — `$1.25M`, `$30.00K` — not as a long `$30,000.00` string.
- **Recorded by** is plain text, not a chip: `…` plus the last five characters, with the full key
  as a hover tooltip. Clicking it copies the full key — the paste is the complete key, character
  for character — and a short **Address copied** toast appears in the bottom-right corner. The
  cell itself does not expand and no inline "Copied" appears, so the row never reflows. If the
  browser blocks clipboard access, no toast appears.
- **PLUSD is the last column and carries the state and the action together** — there is no
  separate Action column any more. A minted deposit shows a green **Minted** chip and no button.
  An unminted one shows a compact **Mint PLUSD** button — a real solid brand-blue button from the
  design system at the 32px row scale, not a tinted chip and not the old large bordered secondary.
  A disabled one is visibly dimmed.
- **Record deposit** is the brand-blue primary and Cancel is the bordered secondary. The dialog's
  fields, validation copy and the `409` duplicate-reference message are unchanged.
- Minting still walks `Awaiting signature… → Submitting… → Confirming…` on the button itself, then
  shows an amber **Pending** chip with `Waiting for the indexer` under it until the served flag
  flips. A disabled **Mint PLUSD** still shows its reason both as a hover title and as the hint
  line under the button. See [#1449](./1449-trustee-mint-bank-deposit.md) for the full mint matrix
  — none of that behaviour changed here.
- On a narrow window the table scrolls horizontally rather than squashing.

## Story 9: The loan detail page is untouched

**Persona:** Trustee operator who uses the loan pages daily.

**Pre-conditions:** Signed in.

**Steps:**

1. Open `/loans/{id}` for a performing loan, a watchlist loan and a matured loan.

**Expected outcomes:**

- Nothing has changed: hero, chip, lifecycle stepper, summary tiles, Price & collateral, Registry,
  Documents, Other actions and every dialog render exactly as before this issue. The shared
  primitives were extracted out of this page, not redesigned.

## Story 10: Long values and a bad id degrade gracefully

**Persona:** Trustee operator pasting a URL.

**Pre-conditions:** An LP with a long legal name.

**Steps:**

1. Open that LP's detail page and narrow the window.
2. Navigate to `/lp-counterparties/abc`.
3. Navigate to the id of an LP that does not exist.

**Expected outcomes:**

- The long legal name wraps inside the page shell; it never overflows the content width or forces
  horizontal page scroll. Long emails wrap inside their profile rows, and long addresses are the
  truncated chip from Story 5 — neither widens its card.
- `/lp-counterparties/abc` shows "This LP identifier is invalid." under the hero.
- A missing LP shows the mapped error inside a card with a **Retry** button that refetches.
