# User stories — #1274 Backend: KYB state machine — submit for review + trustee verdict endpoints

Epic: [#1376 — KYB review lifecycle](https://github.com/eq-lab/pipeline/issues/1376)
Issue: [#1274](https://github.com/eq-lab/pipeline/issues/1274)
Spec: [docs/product-specs/kyb-lp-verification.md#kyb-review-lifecycle](../../product-specs/kyb-lp-verification.md#kyb-review-lifecycle)

This issue is backend-only — no UI changes. Stories verify observable API behavior;
`POST /v1/lps/me/submit`, `POST /v1/lps/{id}/kyb`, and
`POST /v1/lps/{id}/documents/{doc}/review` are exercised with `curl` or an HTTP client
against a running `pipeline-api` instance, not a browser. `GET /v1/lps/me` (owner) and
`GET /v1/lps/{id}` (trustee) read back the result.

---

## Story 1 — An owner submits a complete set and the record freezes

**Setup:** Sign in as an account that has registered an LP at `NotStarted` with at least
one document uploaded (`Provided`, not `Rejected`).

**Action:** `POST /v1/lps/me/submit`.

**Expected outcomes:**

- The response is `200`, `kyb_status` is `UnderReview`, and `kyb_submitted_at` is set.
- `GET /v1/lps/me` now shows `writable: false` — the profile and unverified documents can
  no longer be edited (`POST /v1/lps/me`, document upload, and document delete all `409`).
- A second `POST /v1/lps/me/submit` on the same LP returns `409` naming the current status.

---

## Story 2 — A submit is refused while a rejected document remains, naming it

**Setup:** An LP at `NotStarted` with two documents: one `Provided`, one `Rejected`
(reviewed directly against the dev database, or via Story 6 of the document-review flow
once #1274 is live end to end).

**Action:** `POST /v1/lps/me/submit`.

**Expected outcomes:**

- The response is `409`, and its message names the id of the `Rejected` document.
- `kyb_status` is unchanged.
- After deleting the rejected document and retrying, the submit succeeds (`200`,
  `UnderReview`).

---

## Story 3 — A submit is refused for an LP with no documents

**Setup:** An LP at `NotStarted` with zero documents.

**Action:** `POST /v1/lps/me/submit`.

**Expected outcomes:**

- The response is `409`, with a message saying the LP has no documents to review.
- `kyb_status` stays `NotStarted`.

---

## Story 4 — A trustee passes an LP whose documents are all Verified

**Setup:** An LP at `UnderReview` (via Story 1) whose documents have each been verified
through `POST /v1/lps/{id}/documents/{doc}/review` (`decision: Verified`).

**Action:** `POST /v1/lps/{id}/kyb` with `{"decision": "Passed"}` (no `reason`).

**Expected outcomes:**

- The response is `200`, `kyb_status` is `Passed`, `kyb_decided_at` is set, and
  `kyb_decision_reason` is `null`.
- `GET /v1/lps/me` reflects the same: `writable: false`, `kyb_status: "Passed"`.
- `POST /v1/lps/me/link-address` still succeeds once (spec § Settlement Address) if the LP
  holds no address yet, then `409`s on a second attempt.

---

## Story 5 — A trustee passes an LP with an unverified document — refused

**Setup:** An LP at `UnderReview` with at least one document still `Provided` (not
`Verified`).

**Action:** `POST /v1/lps/{id}/kyb` with `{"decision": "Passed"}`.

**Expected outcomes:**

- The response is `409`, naming the id of the unverified document.
- `kyb_status` stays `UnderReview`.

---

## Story 6 — `ChangesRequested` reopens the record, and the owner resubmits

**Setup:** An LP at `UnderReview` (via Story 1).

**Action:** `POST /v1/lps/{id}/kyb` with
`{"decision": "ChangesRequested", "reason": "shareholder register is illegible"}`, then,
as the owner, `POST /v1/lps/me` with a corrected profile field, then
`POST /v1/lps/me/submit` again.

**Expected outcomes:**

- After the verdict: `200`, `kyb_status` is `ChangesRequested`, `kyb_decision_reason` is
  the given text, and `GET /v1/lps/me` shows `writable: true` again.
- The profile edit succeeds (`200`) — the record is genuinely reopened.
- The resubmit succeeds (`200`, back to `UnderReview`), and `kyb_submitted_at` moves
  forward to the new submission time.

---

## Story 7 — `Failed` freezes the LP terminally and suspends the account

**Setup:** An LP at `UnderReview` (via Story 1), owned by an account currently `Active`.

**Action:** `POST /v1/lps/{id}/kyb` with `{"decision": "Failed", "reason": "shell entity"}`.

**Expected outcomes:**

- The response is `200`, `kyb_status` is `Failed`, `kyb_decision_reason` is the given text.
- `GET /v1/lps/me` shows `writable: false`; every owner write (`POST /v1/lps/me`, document
  upload, document delete) returns `409`.
- `POST /v1/lps/me/link-address` returns `409` naming the KYB refusal, whether or not the
  LP already held an address.
- The owning account's row now has `status = 'Suspended'` (checked directly against the
  dev database — nothing in this issue enforces suspension at request time, see #1380).
- A further `POST /v1/lps/{id}/kyb` on the same LP returns `409` — `Failed` accepts no
  transition out.

---

## Story 8 — A document review is refused while the LP is not UnderReview

**Setup:** An LP at `NotStarted` with one `Provided` document.

**Action:** `POST /v1/lps/{id}/documents/{doc}/review` with `{"decision": "Verified"}`.

**Expected outcomes:**

- The response is `409`, naming that the LP is not under review.
- The document's `status` stays `Provided`.
- After submitting the LP for review (`UnderReview`), the identical request against the
  same document succeeds (`200`, `status` becomes `Verified`).
- Moving the LP back out of `UnderReview` (e.g. a trustee verdict on it) and then
  attempting to review one of its still-`Provided` documents again returns `409`.
