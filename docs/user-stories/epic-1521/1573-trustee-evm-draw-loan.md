# User story: #1573 — Trustee: EVM draw_loan path so Approve works for EVM-targeted submissions

**Epic:** #1521 (follow-up of the EVM parity work in #1937)
**Issue:** https://github.com/eq-lab/pipeline/issues/1573
**Status:** Initial

---

## Overview

Approving an EVM-targeted submission draws the loan on the EVM LoanRegistry (`AccessManager.execute(registry, drawLoan(...))`) and only then records the DB review, the same chain-first ordering as the Stellar Approve (#831). Spec: [trustee-flows.md](../../frontend/trustee-flows.md#chain-first-approve-ordering-831).

Persona: Trustee on the Trustee console, signed in on the EVM chain (Hoodi) with a real EVM wallet (mock wallets cannot send EVM writes) that holds `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` with delay 0. The stage env carries `VITE_EVM_LOAN_REGISTRY_ADDRESS` and `VITE_EVM_ACCESS_MANAGER_ADDRESS`. No Figma is referenced; the UI is the #838 dialog, unchanged except the preview call name.

---

## Story 1 — Approve an EVM submission

**Given** an `InReview` submission whose target chain is Hoodi, with a complete served `draw_loan` block (money in 6-decimal base units)

**When** the trustee opens `/origination/<id>`, clicks Approve and then "Mint loan"

**Then:**

- Approve is enabled with no "Approve & draw runs on Stellar only" line, and the dialog preview reads `LoanRegistry.drawLoan(` with the served values
- The button reads "Registering on-chain…" while the call is simulated, "Waiting for wallet signature…" at the wallet prompt, then "Confirming…"
- One `AccessManager.execute(LoanRegistry, drawLoan(...))` transaction is signed on the Hoodi chain (the wallet is asked to switch network first when needed)
- Once confirmed, the review is recorded, the dialog closes, the footer shows the Approved banner and "View loan #N →" opens `/loans/<N>?chain=<hoodi>` with `N` read from the `LoanDrawn` event

---

## Story 2 — A failed simulate requests no signature

**Given** the same submission, but the registry would revert (for example the wallet lacks the role, the registry is paused, or the tranches do not add up)

**When** the trustee clicks "Mint loan"

**Then:**

- No wallet signature prompt appears
- The dialog shows "Could not verify the loan on-chain. No signature was requested — safe to retry.", and the details name the decoded error (for example `AccessManagerUnauthorizedCall`, `EnforcedPause`, `LoanRegistryInvalidTranches`)
- The submission stays `InReview` and no review call is sent

---

## Story 3 — A wallet rejection leaves the submission InReview

**Given** the same submission

**When** the trustee rejects the signature in the wallet

**Then:**

- The dialog shows "Signature cancelled. Click Approve again to retry."
- No review call is sent and the submission stays `InReview`
- Clicking "Mint loan" again starts a new simulate and signature

---

## Story 4 — Drawn but review failed: a re-click only records the review

**Given** the draw confirmed on-chain but the review request then failed (for example a network error)

**When** the trustee clicks "Mint loan" again in the same session

**Then:**

- The dialog warns that the loan was drawn on-chain and that retrying only records the review
- No second draw is sent; only the `Approved` review is posted, after which the Approved banner shows
- After a page reload the API serves the submission as `InReview` with its `loan_id` (the worker linked the `LoanDrawn` event), and Approve records the review only

---

## Story 5 — Other chains stay blocked, Stellar is unchanged

**Given** a submission targeting a chain that is neither Stellar nor the configured EVM chain, and a Stellar-targeted submission

**When** the trustee opens each submission

**Then:**

- The unknown chain shows "Approve & draw runs on Stellar only — drawing on Chain <id> …", Approve is disabled, and Reject and Request changes still work
- The Stellar submission still approves through the executor `draw_loan` path with the dialog preview `LoanRegistry.draw_loan(` and the unchanged stages (waiting for signature, submitting, confirming)
