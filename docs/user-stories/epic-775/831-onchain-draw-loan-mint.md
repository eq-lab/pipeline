# User Stories: #831 — Trustee: on-chain `draw_loan` mint on approval (Option B — trustee wallet-signed)

Epic: [#775 — Trustee Admin Panel (separate app, same repo)](https://github.com/eq-lab/pipeline/issues/775)
Issue: [#831](https://github.com/eq-lab/pipeline/issues/831)
Spec: [#453 — Trustee Dashboard Technical Assignment](https://github.com/eq-lab/pipeline/issues/453) ([docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md))

Builds on #829 (DB-only Approve/Reject wiring). Approve now performs a real, **trustee-wallet-signed** on-chain `draw_loan` mint — invoking `execute(target, "draw_loan", args, caller)` on the executor/access-control contract — **before** the existing `POST /v1/loan-book/submissions/{id}/review {decision:"Approved"}` call ever fires:

1. **Mint (chain-first):** build the `execute` call → `simulateTransaction` (the "verify the loan" step — a bad encoding or invalid loan fails here, before any signature is requested) → the connected trustee wallet signs → submit → poll to a terminal status.
2. **Finalize:** only once the mint confirms does the app call the existing DB review endpoint.

A wallet rejection or any on-chain failure (simulate/send/poll) makes **no** review call — the submission stays `InReview`, retryable, with a mapped inline error. **Idempotency guard:** if a prior Approve click already minted successfully but the review call then failed, re-clicking Approve skips the mint (no second on-chain transaction) and retries only the review call. Reject is unchanged — a pure DB status flip, no on-chain step.

**Explicitly out of scope:** any backend/contract change (the executor + `draw_loan` are consumed as already deployed); mainnet rollout (testnet contract IDs only — mainnet IDs are supplied later via ArgoCD); backend `loan_drawn`-event auto-reconciliation (a tracked follow-up — this issue's frontend idempotency guard is the accepted bound for the in-session case; a hard page reload between mint-success and finalize-failure is an accepted residual gap).

---

## Story 1: Approving an InReview submission mints on-chain, then finalizes the review

**Persona:** Trustee operator approving a reviewed submission, with a Stellar wallet connected and `VITE_STELLAR_LOAN_REGISTRY_ID` / `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID` configured for testnet.

**Pre-conditions:** Trustee dev server running (`yarn workspace @pipeline/trustee dev`, `http://localhost:5174`), signed in with a session holding the `trustee` role, a Stellar wallet connected, and `GET /v1/loan-book/submissions` returns at least one `InReview` submission.

**Steps:**

1. Navigate to `http://localhost:5174/origination/<id>` for an InReview submission.
2. Click "Approve".
3. Approve the signature request in the connected wallet.

**Expected outcomes:**

- The Approve button's label swaps through progress stages while both Approve and Reject stay disabled: "Waiting for wallet signature…" → "Submitting on-chain…" → "Confirming…" → "Finalizing approval…".
- Once the on-chain transaction confirms, the review call fires automatically — no second click needed.
- On success, the action buttons are replaced by a green banner reading "Approved & minted · `<date>`".
- The status chip near the heading updates to "Approved"; the compact `/origination` table pill for the same row stays the shorter "Approved · `<date>`" (no "& minted" there — deliberately kept short).

---

## Story 2: Rejecting the wallet's signature request leaves the submission InReview, retryable

**Persona:** Trustee operator who clicks Approve but declines the wallet's signature prompt (e.g. wrong loan, changed their mind).

**Pre-conditions:** Same as Story 1.

**Steps:**

1. Click "Approve".
2. When the wallet prompts for a signature, reject/cancel it.

**Expected outcomes:**

- No `POST .../review` request is ever sent — the submission's status is untouched (still `InReview`).
- An inline error renders reading to the effect of "Signature cancelled. Click Approve again to retry."
- Approve and Reject both return to their normal enabled state; clicking Approve again restarts the flow from the mint step (build → simulate → sign again).

---

## Story 3: An invalid loan encoding fails the pre-submit simulation without ever requesting a signature

**Persona:** N/A — a defensive/contract-correctness story, most directly verified by `loanRegistry.test.ts`'s simulation-error case, restated here as a behavioral story.

**Pre-conditions:** A submission whose `loan_data` the executor/registry contract would reject (e.g. malformed field, wrong scale) — reproducible by pointing `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID` at a contract that rejects the built call, or by mocking a `simulateTransaction` error in a test harness.

**Steps:**

1. Click "Approve" on the affected submission.

**Expected outcomes:**

- The wallet is never prompted for a signature — the `simulateTransaction` step ("verify the loan") fails first.
- An inline error renders reading to the effect of "Could not verify the loan on-chain (...). No signature was requested — safe to retry."
- The submission stays `InReview`; no review call is made.

---

## Story 4: A mint that succeeds but whose review call then fails does not re-mint on retry

**Persona:** Trustee operator whose on-chain mint confirms, but the subsequent `POST .../review` call fails (e.g. transient network error, session expiring mid-flow).

**Pre-conditions:** Same as Story 1, with the review endpoint made to fail on the first attempt after a successful mint (e.g. via a mocked 5xx, or killing network connectivity right after the mint tx confirms).

**Steps:**

1. Click "Approve" and let the on-chain mint complete (wallet signs, tx confirms).
2. Observe the review call fail.
3. Click "Approve" again (without reloading the page).

**Expected outcomes:**

- Step 2: an inline error renders distinctly from a mint failure — to the effect of "The loan minted on-chain successfully, but marking it Approved failed (...). This is a known limitation — contact support rather than retrying (Approve would attempt another on-chain mint)." The submission stays `InReview`.
- Step 3: re-clicking Approve does **not** prompt the wallet again and does **not** submit a second on-chain transaction — it goes straight to retrying the review call. On success, the green "Approved & minted" banner renders.
- **Accepted residual (not a defect):** if the page is hard-reloaded between the mint succeeding and the review call failing, this in-session guard is lost — a subsequent Approve would attempt another on-chain mint. There is no backend reconciliation to close this gap yet.

---

## Story 5: An already-Approved submission's Approve control is a no-op safeguard

**Persona:** N/A — a defensive story guarding a stale render or race (e.g. two trustee tabs open on the same submission), most directly verified by `-useOriginationReview.test.ts`.

**Pre-conditions:** A submission that is already `Approved` (e.g. approved in another tab) while a stale render of the details page still shows the InReview action buttons.

**Steps:**

1. Trigger `approve()` against an already-`Approved` submission (e.g. via a delayed click after another tab already approved it).

**Expected outcomes:**

- No on-chain transaction is attempted and no review call is made — the function returns immediately.
- In practice this submission's real UI already shows the Approved banner (not the action buttons) once the list refetches, so this guards a narrow race rather than a reachable everyday click.

---

## Story 6: Reject remains a pure DB status flip, unaffected by the on-chain mint

**Persona:** Trustee operator rejecting a submission.

**Pre-conditions:** Same as Story 1, arrived at an InReview submission's details page.

**Steps:**

1. Click "Reject", enter a valid reason (5+ trimmed characters), click Submit.

**Expected outcomes:**

- No wallet signature is ever requested and no on-chain transaction is sent for Reject — it is exactly the #829 behavior (`POST .../review {decision:"Rejected", reason}`).
- On success, the red "Rejected · `<date>` — `<reason>`" banner renders in place of the action buttons.

---

## Story 7: On-chain minting is unconfigured or the wallet is disconnected

**Persona:** Trustee operator on an environment where the loan-registry/executor contract IDs are not yet configured (e.g. a fresh testnet deploy before ops sets the `VITE_STELLAR_LOAN_REGISTRY_ID` / `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID` env vars), or whose Stellar wallet has disconnected.

**Steps:**

1. Click "Approve" while the registry/executor IDs are empty, or while no Stellar wallet is connected.

**Expected outcomes:**

- No RPC call is attempted.
- An inline error renders reading to the effect of "On-chain minting isn't configured for this environment." (unconfigured case) or "Connect your trustee wallet to approve on-chain." (disconnected case).
- The submission stays `InReview`, retryable once the environment/connection issue is resolved.
