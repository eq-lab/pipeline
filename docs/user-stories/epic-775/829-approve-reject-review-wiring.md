# User Stories: #829 — Trustee Origination: wire Approve/Reject submission review (reject-reason dialog + auth)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#829](https://github.com/eq-lab/pipeline/issues/829)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

Makes the Approve and Reject controls on the Origination details page
(`/origination/:id`, introduced read-only by #821 and made status-conditional by #823)
functional, wiring both to the existing DB-only endpoint
`POST /v1/loan-book/submissions/{id}/review`:

- **Approve** fires the mutation immediately with `{ decision: "Approved" }` — no reason.
- **Reject** opens a small dialog with a single reason field (min 5 characters after
  trimming whitespace), Submit + Cancel.
- Both buttons disable while the request is in flight; a mapped, user-facing error
  renders on failure — `409` ("already reviewed, refresh"), `403` ("not authorized"),
  `401` (session expired), and a generic fallback for anything else.
- On success, the submissions list is invalidated so the page's status chip and the #823
  status-conditional footer flip to the Approved/Rejected banner without a manual
  refresh — including when the page was reached via a table row click (router-state
  navigation), not just a direct URL.

**Explicitly out of scope:** any on-chain / Stellar / Soroban / `draw_loan` mint call.
Approving here is a **pure database status flip** — nothing is minted on-chain. The
on-chain mint (trustee-wallet-signed `draw_loan`) is tracked separately as the blocked
issue **#831**. Until #831 ships, the Approved banner/pill intentionally read
**"Approved · `<date>`"**, NOT "Approved & minted" (a copy correction to #823's original
text — see that issue's story doc for the copy note). "Request changes" has no backend
endpoint and stays inert/disabled, unchanged by this issue. The `/origination` table's
"Review" control is unchanged — it still navigates to the details page (from #823), it
does not become an inline approve/reject.

---

## Story 1: Approving an InReview submission flips it to the Approved banner

**Persona:** Trustee operator approving a reviewed submission.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`,
`http://localhost:5174`), signed in with a session holding the `trustee` role, and
`GET /v1/loan-book/submissions` returns at least one `InReview` submission.

**Steps:**

1. Navigate to `http://localhost:5174/origination/<id>` for an InReview submission (via a
   table row click or a direct URL).
2. Click "Approve".

**Expected outcomes:**

- While the request is in flight, both "Reject" and "Approve" are disabled (Approve shows
  a submitting/pending indication); no double-submit is possible.
- On success, the "Request changes" / "Reject" / "Approve" buttons disappear and a green
  banner renders instead, reading "Approved · `<date>`" (NOT "Approved & minted").
- The status chip near the heading also updates to "Approved".
- No page refresh was needed to see the flip, whether arrived at via a row click (router
  state) or a direct URL.

---

## Story 2: Rejecting requires a reason of at least 5 characters

**Persona:** Trustee operator rejecting a submission with a documented reason.

**Pre-conditions:** Same as Story 1, arrived at an InReview submission's details page.

**Steps:**

1. Click "Reject".
2. In the dialog that opens, type fewer than 5 non-whitespace characters (e.g. "Hi").
3. Observe the Submit control.
4. Clear the field and type only spaces.
5. Type a reason of 5 or more characters after trimming (e.g. "Missing export permit").
6. Click Submit.

**Expected outcomes:**

- Step 2: an inline validation message appears and Submit is disabled — clicking it (if
  attempted) does nothing.
- Step 4: Submit remains disabled for whitespace-only input; no empty/whitespace reason
  is ever submittable.
- Step 5: Submit becomes enabled once the trimmed length reaches 5 characters.
- Step 6: the dialog closes, the request-review mutation fires with the trimmed reason,
  and on success the details page shows a red banner reading "Rejected · `<date>` —
  Missing export permit" in place of the action buttons.

---

## Story 3: Cancel and Escape close the reject dialog without submitting

**Persona:** Trustee operator who opens the reject dialog but changes their mind.

**Pre-conditions:** Same as Story 1, arrived at an InReview submission's details page.

**Steps:**

1. Click "Reject" to open the dialog.
2. Type a valid reason (5+ trimmed characters).
3. Click "Cancel".
4. Reopen the dialog, type a valid reason again, then press the Escape key.

**Expected outcomes:**

- Step 3: the dialog closes; no request is sent; the submission remains InReview with the
  original action buttons still shown.
- Step 4: pressing Escape also closes the dialog without submitting, identical to Cancel.
- Reopening the dialog after either close starts with an empty reason field (no leftover
  text from the previous attempt).

---

## Story 4: An already-reviewed submission shows a clear "already reviewed" error

**Persona:** Trustee operator who has the details page open in two tabs, or refreshes
after another trustee already decided the submission.

**Pre-conditions:** A submission that is `InReview` when the page loads, but has already
transitioned to `Approved` or `Rejected` server-side by the time the review request is
sent (e.g. reviewed in another tab/session first).

**Steps:**

1. Open the details page for the submission before it is reviewed elsewhere.
2. In another tab (or via the API directly), review the same submission first.
3. Back in the first tab, click "Approve" (or "Reject" with a valid reason).

**Expected outcomes:**

- The request fails with a `409 Conflict`.
- An inline error message renders near the buttons (or inside the reject dialog, if that
  was the path taken) reading to the effect of: "This submission has already been
  reviewed. Refresh to see the latest status."
- The action buttons are not stuck in a permanent pending state — they return to their
  normal (enabled) appearance after the error, so the operator can refresh and retry.

---

## Story 5: A session without the trustee role sees a clear "not authorized" error

**Persona:** An authenticated user whose session lacks the `trustee` role attempting to
review a submission.

**Pre-conditions:** A valid but non-trustee session (or a mocked `403` response from the
review endpoint) and an InReview submission's details page.

**Steps:**

1. Click "Approve" (or complete and submit the reject dialog).

**Expected outcomes:**

- The request fails with a `403 Forbidden`.
- An inline error message renders reading to the effect of: "You are not authorized to
  review submissions."
- The submission's status is unchanged (still InReview, action buttons still shown).

---

## Story 6: Approve never sends a reason; Reject always sends the trimmed reason

**Persona:** N/A — this is a contract-correctness story, most directly verified by the
unit tests (`-useReviewSubmission.test.tsx`) but restated here as a behavioral story.

**Pre-conditions:** Network inspection available (browser DevTools Network tab) on the
details page for an InReview submission.

**Steps:**

1. Click "Approve" and inspect the outgoing `POST .../review` request body.
2. On a fresh InReview submission, click "Reject", type "  Missing export permit  "
   (with leading/trailing spaces), click Submit, and inspect the outgoing request body.

**Expected outcomes:**

- Step 1: the request body is exactly `{"decision":"Approved"}` — no `reason` key at all
  (sending one would `400`).
- Step 2: the request body is `{"decision":"Rejected","reason":"Missing export permit"}`
  — the reason is trimmed before sending, not the raw padded string.
