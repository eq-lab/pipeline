# User Stories: #1667 — Trustee: hide target-chain options the API does not serve

Epic: [#1521 — LoanBook API: multi-chain](https://github.com/eq-lab/pipeline/issues/1521) (frontend follow-up)
Issue: [#1667](https://github.com/eq-lab/pipeline/issues/1667)
Spec: [docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100](../../frontend/trustee-flows.md#submit-a-loan-originationnew-1100)

Trustee app (`packages/trustee`), signed in. The API's `GET /v1/chains` (#1608) is the source of
truth for which chains are offered; the app's env (`VITE_STELLAR_CHAIN_ID`, `VITE_EVM_CHAIN_ID`)
supplies the labels.

---

## Story 1: An unserved chain is not offered

**Persona:** Trustee submitting a loan or browsing the loan book.

**Steps:**

1. Run against an API whose `CHAINS` does not include the app's EVM chain (e.g. Stellar only).
2. Open `/origination/new` and open the "Target chain" select.
3. Open `/loans` and open the "Chain" filter.

**Expected outcomes:**

- "Target chain" lists only Stellar; the EVM chain is absent.
- The chain filter lists "All chains" and "Stellar" only.

---

## Story 2: Target chain defaults to the API's default

**Persona:** Trustee submitting a loan.

**Steps:**

1. Run against an API serving both chains with `default_chain_id` set to the EVM chain.
2. Open `/origination/new`.

**Expected outcomes:**

- "Target chain" is preselected to the EVM chain.
- Submitting a complete form posts to `POST /v1/loan-book/loan?chain_id=<EVM id>`.

---

## Story 3: The list is unavailable

**Persona:** Trustee with `GET /v1/chains` failing.

**Steps:**

1. In DevTools, block the `/v1/chains` request and reload.
2. Open `/origination/new` and `/loans`.

**Expected outcomes:**

- Both surfaces show the env-configured chains (Stellar and the EVM chain), Stellar selected by default.
- The form can still be submitted.

---

## Story 4: The select waits for the list

**Persona:** Trustee on a slow connection.

**Steps:**

1. In DevTools, throttle the network and open `/origination/new`.

**Expected outcomes:**

- "Target chain" is disabled with no options until `/v1/chains` answers, then enables with the served options.
- The loans chain filter is disabled with only "All chains" until then.
