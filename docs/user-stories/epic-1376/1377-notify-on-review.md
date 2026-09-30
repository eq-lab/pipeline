# User stories — #1377 Backend: notify_on_review flag on POST /v1/lps/me + narrowed write freeze

Epic: [#1376 — KYB review lifecycle](https://github.com/eq-lab/pipeline/issues/1376)
Issue: [#1377](https://github.com/eq-lab/pipeline/issues/1377)
Spec: [docs/product-specs/kyb-lp-verification.md#review-notifications](../../product-specs/kyb-lp-verification.md#review-notifications)

This issue is backend-only — no UI changes. Stories verify observable API behavior;
`POST /v1/lps/me` is exercised with `curl` or an HTTP client against a running
`pipeline-api` instance, not a browser. `GET /v1/lps/me` reads back the result.

A frozen LP is reached the same way #1274's stories reach one: `POST /v1/lps/me/submit`
moves it to `UnderReview`, or a direct `UPDATE lps SET kyb_status = …` against the dev
database for `Passed`/`Failed`/`ChangesRequested`.

---

## Story 1 — A new LP registers with the preference set, and it defaults off when omitted

**Setup:** An authenticated account with no LP yet.

**Action:** `POST /v1/lps/me` twice against two such accounts — one submitting
`notify_on_review: true`, the other omitting the field entirely.

**Expected outcomes:**

- Both responses are `201`.
- The LP submitted with `true` reads back `notify_on_review: true` on `GET /v1/lps/me`.
- The LP that omitted the field reads back `notify_on_review: false`.

---

## Story 2 — A writable LP's full profile edit leaves an omitted preference unchanged

**Setup:** An LP at `NotStarted` with `notify_on_review: true` already set (via Story 1).

**Action:** `POST /v1/lps/me` with a changed `legal_name` and `notify_on_review` omitted.

**Expected outcomes:**

- The response is `200`, `legal_name` reflects the edit.
- `notify_on_review` is still `true` — an omitted field on a writable LP must not fall
  back to `false` and silently opt the LP out.

---

## Story 3 — A frozen LP resubmitting its identical profile flips the preference alone

**Setup:** An LP frozen at `UnderReview` (or `Passed`/`ChangesRequested`/`Failed`), with
`notify_on_review: false` and a known stored profile.

**Action:** `POST /v1/lps/me` with `legal_name`, `country`, and `contact_email` set to
exactly the stored values, and `notify_on_review: true`.

**Expected outcomes:**

- The response is `200`.
- `notify_on_review` reads back `true`.
- `legal_name`, `country`, and `contact_email` are unchanged — in particular `updated_at`
  moving is expected (a write is a write), but no profile field moved.

---

## Story 4 — The `IS NOT DISTINCT FROM` case: a frozen LP with no stored country

**Setup:** An LP frozen at `UnderReview` with `country IS NULL` (never set, or cleared by
an earlier edit while writable).

**Action:** `POST /v1/lps/me` with the stored `legal_name`/`contact_email`, `country`
omitted, and `notify_on_review: true`.

**Expected outcomes:**

- The response is `200`, not `409`. This is the case the spec and the exec plan call out
  by name: comparing `country` with `=` instead of `IS NOT DISTINCT FROM` would read
  `NULL = NULL` as unknown and refuse every such LP on a pure preference toggle.
- `notify_on_review` reads back `true`; `country` stays `null`.

---

## Story 5 — A frozen LP with a genuinely different profile is refused, writing nothing

**Setup:** The LP from Story 3 or 4, still frozen.

**Action:** `POST /v1/lps/me` with one changed character in `legal_name`, the rest of the
profile unchanged, and `notify_on_review: true`.

**Expected outcomes:**

- The response is `409`, naming that the LP is frozen and its profile can no longer be
  changed.
- `GET /v1/lps/me` shows the stored `legal_name` unchanged and `notify_on_review`
  unchanged from before this request — the preference is refused along with the profile
  when the whole request is refused, exactly as the spec requires ("nothing written, the
  preference included").

---

## Story 6 — The preference toggle is not gated by `writable`

**Setup:** An LP frozen at `UnderReview`, `writable: false` on `GET /v1/lps/me`.

**Action:** `POST /v1/lps/me` with the stored profile verbatim and `notify_on_review`
flipped from its current value.

**Expected outcomes:**

- The response is `200` despite `writable: false` — the flag governs the profile and
  documents only, not this preference, confirming the client contract settled in the
  Issue's open-question resolution (no second `writable`-like field is needed).

---

## Story 7 — Uploading a document is still hard-frozen, independent of the preference

**Setup:** An LP frozen at `UnderReview`.

**Action:** `POST /v1/lps/me/documents` with one valid file.

**Expected outcomes:**

- The response is `409` — this issue's narrowing applies only to
  `upsert_by_owner_account_id`, never to `KybDocumentRepo::insert`/`delete`, so a document
  upload or delete on a frozen LP is refused exactly as before this issue.
