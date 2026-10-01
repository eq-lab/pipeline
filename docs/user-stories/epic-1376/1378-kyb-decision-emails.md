# User stories — #1378 Backend: KYB decision emails to the LP

Epic: [#1376 — KYB review lifecycle](https://github.com/eq-lab/pipeline/issues/1376)
Issue: [#1378](https://github.com/eq-lab/pipeline/issues/1378)
Spec: [docs/product-specs/kyb-lp-verification.md#review-notifications](../../product-specs/kyb-lp-verification.md#review-notifications)

This issue is backend-only — no UI changes. The observable output is an email, so every
story below is run against a `pipeline-api` instance started with `EMAIL_DEV_LOG=true`,
which logs `to`, `subject` and `body` at `info` instead of calling SendGrid. "One email"
means exactly one such log line; "no email" means none.

Decisions are posted with `POST /v1/lps/{id}/kyb` by a token carrying the `trustee` role.
An LP reaches `UnderReview` through `POST /v1/lps/me/submit`; the preference is set with
`notify_on_review` on `POST /v1/lps/me` (#1377). Where a story needs an account state the
API cannot produce — a null `accounts.email`, an unverified address, a null
`reject_reason` — set it directly against the dev database.

---

## Story 1 — An LP that did not opt in hears nothing

**Setup:** An LP at `UnderReview` with `notify_on_review: false` (the default).

**Action:** Post each of `Passed`, `ChangesRequested` and `Failed` (resetting
`kyb_status` to `UnderReview` between them).

**Expected outcomes:**

- Every response is `200` with the updated LP.
- No email log line appears for any of the three.

---

## Story 2 — `ChangesRequested` carries the reason and every rejected document

**Setup:** An LP at `UnderReview` with `notify_on_review: true` and two documents
rejected through `POST /v1/lps/{id}/documents/{doc}/review` — one whose `reject_reason`
is left as recorded, one whose `reject_reason` is then set to `NULL` by hand.

**Action:** `POST /v1/lps/{id}/kyb` with `decision: "ChangesRequested"` and a reason.

**Expected outcomes:**

- The response is `200`.
- Exactly one email. Its body carries the decision's reason, both filenames, the recorded
  rejection reason, and — for the document whose reason is `NULL` — the words "no reason
  was recorded" rather than `None`.
- The two filenames appear oldest-first, in upload order, not in the newest-first order
  the document list is read in.

---

## Story 3 — A `Passed` decision carries the trustee's approval note, and reads well without one

**Setup:** An LP at `UnderReview` with `notify_on_review: true` and every document
`Verified`.

**Action:** Post `Passed` with a reason. Reset `kyb_status` to `UnderReview` and post
`Passed` again with no reason.

**Expected outcomes:**

- Both responses are `200`, one email each.
- The first body contains the reason, and the reason sits between the approval sentence
  and the closing line rather than after it.
- The second body contains no blank paragraph, no leading or trailing blank line, and
  still ends on the closing line — it must not read as truncated. This is the common
  case: a trustee approving a clean submission has nothing to add.

---

## Story 4 — A `Failed` decision says nothing about the account

**Setup:** An LP at `UnderReview` with `notify_on_review: true`.

**Action:** Post `Failed` with a reason.

**Expected outcomes:**

- The response is `200`, one email.
- The body carries the reason and states the decision is final.
- The body says **nothing** about the owning account — neither "account" nor "suspended"
  appears. `accounts.status` does read `Suspended` in the database after this request
  (#1274's behaviour), and that contrast is the point: nothing gates on that column until
  #1380 lands, so a message claiming the account is blocked would be true of the record
  and false of every behaviour the LP can observe.

---

## Story 5 — `ChangesRequested` with neither a reason nor a rejected document still says something

**Setup:** An LP at `UnderReview` with `notify_on_review: true` and no document in
`Rejected`.

**Action:** Post `ChangesRequested` with no `reason`.

**Expected outcomes:**

- The response is `200`, one email.
- The body is a single paragraph naming the entity and telling the owner to sign in,
  review the submission and send it back. It is not empty and carries no dangling
  heading.

---

## Story 6 — A decision survives an unreachable email provider

**Setup:** An LP at `UnderReview` with `notify_on_review: true`. Start the API with
`EMAIL_DEV_LOG` unset and `SENDGRID_BASE_URL` pointed at a closed port.

**Action:** Post any decision.

**Expected outcomes:**

- The response is still `200` with the updated LP — the verdict is committed before the
  send and a delivery failure is never propagated.
- `kyb_status` on `GET /v1/lps/{id}` reflects the decision.
- A `warn` line records that the decision email could not be sent.

---

## Story 7 — Reviewing one document notifies nobody

**Setup:** An LP at `UnderReview` with `notify_on_review: true` and at least one
`Provided` document. `review_document` requires `UnderReview`, so any other status makes
this story prove nothing — the request would be refused before reaching code that could
have mailed.

**Action:** `POST /v1/lps/{id}/documents/{doc}/review` with `Verified`, then with
`Rejected` and a reason on a second document.

**Expected outcomes:**

- Both responses are `200`.
- No email log line for either. Only the verdict on the LP notifies.

---

## Story 8 — The email goes to the account's verified address, not the LP's contact address

**Setup:** An LP with `notify_on_review: true` whose owning account has a **verified**
email that differs visibly from `lps.contact_email`.

**Action:** Post any decision.

**Expected outcomes:**

- One email, addressed to `accounts.email`.
- `lps.contact_email` appears nowhere in the log line. If it does, the handler never read
  the owning account.

---

## Story 9 — A wallet-registered owner falls back to the contact address

**Setup:** An LP with `notify_on_review: true` whose owning account has
`accounts.email IS NULL` — set it by hand if no wallet signup flow is convenient. This is
a real path: the column is nullable and a wallet-only account never registers an email.

**Action:** Post any decision.

**Expected outcomes:**

- One email, addressed to `lps.contact_email` — the only address Pipeline holds for that
  owner.

---

## Story 10 — An unverified account address is treated as no address

**Setup:** An LP with `notify_on_review: true` whose owning account has an email but
`email_verified_at IS NULL`.

**Action:** Post any decision.

**Expected outcomes:**

- One email, addressed to `lps.contact_email`, not to the unverified account address.

---

## Story 11 — A failed account read skips the send instead of retargeting it

**Setup:** An LP with `notify_on_review: true`. Make the account read fail — stop Postgres
between the verdict and the notification, or point the API at a database whose `accounts`
table has been renamed.

**Action:** Post any decision.

**Expected outcomes:**

- The response is still `200` and the verdict is recorded.
- A `warn` line says the owning account could not be read and the email was not sent.
- **No email is sent to `lps.contact_email`.** The fallback exists for an account that has
  no address, not for a database that did not answer; quietly retargeting a trustee's
  refusal reasons to an unverified address is the failure this recipient rule exists to
  prevent.
