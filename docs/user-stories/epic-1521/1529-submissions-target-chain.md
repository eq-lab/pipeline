# User story: #1529 — LoanBook API: submissions carry a target chain

**Epic:** #1521 — LoanBook API — multi-chain
**Issue:** https://github.com/eq-lab/pipeline/issues/1529
**Status:** Initial

---

## Overview

Backend-only. A loan submission records the chain it is meant to be drawn on (`target_chain_id`). The Trustee form change is #1536, so there is no Figma reference. Stories 1 to 3 are API checks against the dev stack; story 4 is verified by the unit tests in `packages/shared/tests/submitted_loan_repo.rs` and `packages/shared/tests/migrations.rs`.

---

## Story 1 — Submit with a required target chain

**Given** an originator token and `CHAINS=560048,99000001`, `DEFAULT_CHAIN_ID=99000001`

**When** the originator posts a valid payload to `POST /v1/loan-book/loan?chain_id=99000001`, then again with `?chain_id=560048`

**Then:**

- Both return `201 { id }`
- No `chain_id` returns 400 `chain_id is required` and stores nothing (#1610)
- `GET /v1/loan-book/submissions` shows `target_chain_id` 99000001 for the first and 560048 for the second
- `chain_id` and `loan_id` are `null` on both (not drawn yet)
- `?chain_id=5` or `?chain_id=abc` returns 400 and stores nothing

## Story 2 — List filtered by target chain

**Given** submissions targeting 560048 and 99000001 exist, plus an older one whose target chain is no longer in `CHAINS`

**When** a trustee calls `GET /v1/loan-book/submissions` with no `chain_id`, then with `?chain_id=560048`

**Then:**

- Without `chain_id`, every submission is returned, including the one on the removed chain
- With `chain_id=560048`, only submissions targeting 560048 are returned
- `?chain_id=5` (well-formed, not in `CHAINS`) returns 200 with an empty list; `?chain_id=abc` returns 400

## Story 3 — Resubmit keeps the target chain

**Given** a `ChangesRequested` submission targeting 560048

**When** the originator resubmits it via `POST /v1/loan-book/submissions/{id}/resubmit`

**Then:**

- The submission is `InReview` again and `target_chain_id` is still 560048

## Story 4 — Draw links only on the target chain

**Given** an open submission targeting 560048 with `metadata_uri` X

**When** the indexer sees `LoanDrawn` with `metadata_uri` X, first on chain 99000001, then on chain 560048

**Then:**

- The draw on 99000001 leaves the submission unlinked and logs a `warn`
- The draw on 560048 links it (`chain_id` 560048, `loan_id` set)
- A second submission cannot be linked to an already linked `(chain_id, loan_id)`; the indexer logs a `warn` and keeps going

## Story 5 — Migration backfill

**Given** a database with existing submissions, some drawn and some not

**When** the API or the worker starts with `DEFAULT_CHAIN_ID` set

**Then:**

- Drawn rows get `target_chain_id` equal to their `chain_id`; undrawn rows get `DEFAULT_CHAIN_ID`
- If one `(chain_id, loan_id)` is linked to two submissions, startup stops and lists the offending pairs
- If undrawn rows exist and `DEFAULT_CHAIN_ID` is unset, startup stops with an error naming `DEFAULT_CHAIN_ID`
