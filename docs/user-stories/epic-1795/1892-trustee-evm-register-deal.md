# User story: #1892 — Trustee registers the per-loan debt token on EVM

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1892
**Status:** Initial

---

## Overview

Drawing an EVM loan does not create its debt token. The Trustee registers it with one more signature, `AccessManager.execute(factory, registerDeal(loanId))`, the same control as on Stellar (#1766): "Register debt token" under the "Approved & drawn" banner right after Approve, and a "Debt token" card on every loan detail layout for an EVM loan that has none. The "Debt token" row of the Registry card shows the registered address. After registration the Disbursement card no longer asks to register the debt token first. The worker indexes the registration as a `DealRegistered` row (`cargo` null) and the DEBT token's transfers. Spec: `docs/frontend/trustee-flows.md#register-debt-token-1766` and `docs/references/backend.md#evm-dealtokenfactory-1485`.

All checks use the real API and Hoodi (chain 560048) on staging, no localStorage mocks. Open DevTools Network before starting.

**Prerequisites and live-testing risks:**

- `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` and `VITE_EVM_ACCESS_MANAGER_ADDRESS` must be set for the Trustee, and the factory must equal the worker's `CHAIN_560048_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS`. Without them the control reads "Debt token registration isn't configured for this environment."
- The connected EVM wallet needs `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` (`0x96ef…c04e4` holds it with delay 0). The copy says "Trustee role".
- The worker image with the BUG-39 fix must run before the first registration; an older image drops the DEBT-only `DealRegistered`.
- The Hoodi registry held no loans when this was written, so a loan must first be drawn from Origination (#1573).

---

## Story 1 — Register right after an EVM Approve

**Given** a Trustee approved a submission targeting Hoodi and the loan was drawn in this session

**When** the Approved & drawn banner appears

**Then:**

- A "Register debt token" button shows inside the banner, and it is enabled for a wallet whose role has no delay
- Clicking it asks for one wallet signature (`AccessManager.execute` on Hoodi) and the button shows the stage labels while it runs
- On success the block becomes "Debt token registered · 0x…" with the checksummed address
- No second transaction is requested and no trustline step appears

---

## Story 2 — Register from the loan detail

**Given** a performing, watchlist or matured EVM loan with no debt token

**When** the Trustee opens its loan detail

**Then:**

- A "Debt token" card with "Register debt token" shows, and the Registry card's "Debt token" row reads "—"
- After registering, the card disappears and the row shows the checksummed address

---

## Story 3 — An already registered EVM loan

**Given** an EVM loan whose debt token is registered

**Then:**

- The loan page shows no "Register debt token" card
- The "Debt token" row shows the address returned by `deal(id)`
- The deterministic `debtAddress(id)` is never used to decide registration

---

## Story 4 — Disburse unblocks

**Given** an Approved EVM loan whose Disbursement card says "Register this loan's debt token first."

**When** the Trustee registers the debt token

**Then:** the Disbursement card moves past that message without a page reload.

---

## Story 5 — A wallet without the role

**Given** a connected EVM wallet that does not hold `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`

**Then:** the button is disabled with "Only the Trustee role can register a loan's debt token." and no signature is requested.

---

## Story 6 — Contract errors read as plain copy

**Given** a registration the contract rejects (an already registered loan, or an unknown loan id)

**When** the simulation fails

**Then:**

- No signature is requested
- The error reads "This loan's debt token is already registered." or "The registry has no loan with this id."
- "View details" holds the decoded contract error name

---

## Story 7 — An unconfigured environment or another EVM chain

**Given** an environment without `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` or `VITE_EVM_ACCESS_MANAGER_ADDRESS`

**Then:** the card shows "Debt token registration isn't configured for this environment." and no button.

**Given** a loan on an EVM chain other than the configured one

**Then:** the card says the on-chain actions run on Stellar only and shows no button.

---

## Story 8 — No trustline or issuer step on EVM

**Given** an EVM loan being registered

**Then:** no trustline, `set_admin` or issuer prerequisite is shown or required; the `DealToken` is deployed by the factory in the same transaction.

---

## Story 9 — The registration is indexed

**Given** the registration block has been indexed by the worker

**Then:**

- The Audit Log shows "Deal tokens registered" for the EVM loan, with `debt` equal to the `deal(id)` address and `cargo` null
- After a Disburse, the first `syncDebt` mint appears as a `DealTokenTransfer` row for the DEBT token in `contract_logs` (not in the Audit Log, which excludes `DealTokenTransfer`)
