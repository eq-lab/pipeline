# User story: #1805 — Trustee + wallet-connect: data_room_id field and the 2-arg draw_loan (borrower_ref)

**Epic:** #1776
**Issue:** https://github.com/eq-lab/pipeline/issues/1805
**Status:** Initial

---

## Overview

The trustee console submits a loan with a data room ID and approves it on Stellar by sending the API-served `draw_loan` block to the deployed registry `draw_loan(metadata_uri, economics)`. Spec: `docs/frontend/trustee-flows.md#chain-first-approve-ordering-831` and `docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100`.

Persona: trustee (signs with the Stellar trustee wallet). Run on pipeline-test after the deploy, with the trustee console open at `/origination`. `$ID` is the data room ID entered in Story 1.

---

## Story 1 — Submit a loan with a data room ID

**Given** a signed-in trustee on `/origination/new` with a Stellar target

**When** the trustee fills the form, including "Data room ID" `DR-0001`, and submits

**Then:**

- The form has a required "Data room ID" field after Borrower, and has no "Mint to" field and no Collateral section ("Collateral valuation" is still there)
- The page returns to `/origination` and the new row is `InReview`
- On `/origination/<id>` the Deal Details "Borrower ref" row shows the shortened sha256 of `DR-0001` (`printf 'DR-0001' | shasum -a 256`, first 6 and last 4 characters) and the full hash in its tooltip
- There is no "Location" row and no separate data room ID row
- Opening Approve shows a `borrowerRef` line in the preview

---

## Story 2 — Approve draws the loan on Stellar testnet

**Given** the `InReview` submission from Story 1 and a connected trustee wallet

**When** the trustee clicks Approve and then "Mint loan", and signs

**Then:**

- The wallet signs one transaction; the simulation passes (no `UnexpectedSize` or `MismatchingParameterLen` error)
- The page flips to the Approved banner
- The loan appears in `/loans` and in the registry

---

## Story 3 — A legacy submission without a data room ID cannot be approved

**Given** an `InReview` submission created before #1792 (no `data_room_id`)

**When** the trustee opens `/origination/<id>`

**Then:**

- The page renders without errors, whether or not the old `to`, `initial_ccr` and `initial_location` keys exist
- The Borrower ref row reads "Data room ID missing"
- Approve is disabled and the line above the buttons reads "Data room ID missing — this submission can't be drawn on-chain. Request changes so it is resubmitted with a data room ID, or reject it."
- Reject and Request changes are enabled

---

## Story 4 — The form requires the data room ID

**Given** the form on `/origination/new` with every other required field filled

**When** the trustee leaves "Data room ID" empty, or enters only spaces, and submits

**Then:**

- The field shows "Required." and nothing is posted
- With `  $ID  ` (padded) the POST body carries the trimmed `data_room_id`

---

## Story 5 — An EVM-target submission keeps the Stellar-only reason

**Given** an `InReview` submission targeting the EVM chain

**When** the trustee opens its detail page

**Then:**

- Approve is disabled and the reason reads "Approve & draw runs on Stellar only …"
- The data-room reason is not shown instead of it
