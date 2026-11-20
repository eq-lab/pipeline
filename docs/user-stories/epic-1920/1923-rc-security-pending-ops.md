# User Stories: #1923 — Trustee: Risk Council security page lists pending operations and executes them with the scheduled args

Issue: [#1923](https://github.com/eq-lab/pipeline/issues/1923) (epic #1920)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#risk-council-pending-operations), [docs/product-specs/loan-security-state.md](../../product-specs/loan-security-state.md#pending-operations)

Trustee app (`packages/trustee`), page `/risk-council/security/{id}?chain=<stellar chain>`, Stellar wallet connected. The "Scheduled operations" card is the first card of the right column, above Set terms, and lists the loan's pending SecurityRegistry operations served by `GET /v1/loan-book/{id}/security` (`pending_operations`, #1922). It needs the worker's AccessManager indexer key (#1921) and the AccessManager id `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`. The delay is 24 h on test and prod; a scheduled operation expires 7 days after its ready time. Wallets that run these stories must be in the API trustee allow-list. Execute needs a wallet signature and testnet writes, so the stories run in the epic QA pass.

---

## Story 1: Reloading after scheduling `set_terms` shows the waiting row and the Set terms notice

**Persona:** Risk Council member (delayed role), Stellar loan.

**Steps:**

1. On the Security page fill the Set terms form and click "Schedule terms", then approve.
2. Right away, and again after a reload, look at the right column.

**Expected outcomes:**

- Right after the schedule a row "Set terms" appears in "Scheduled operations" with "Scheduled from this console. The list catches up within a minute." and "Waiting · executable from <UTC date-time>".
- After a reload (and once the indexer has the operation, within about a minute) the same row is listed without that note, with the same state line and no duplicate.
- The row shows the scheduled values in the form's units (ratios and tolerances in %, durations in d / h / s, default rate in %, payment term label) and "Scheduled by <short address> · this wallet".
- Set terms shows "A terms change is already scheduled — see above. Scheduling again creates a second operation with a new 24 h wait." The inputs and the button stay enabled.

---

## Story 2: The scheduling wallet executes the operation with no retyping

**Persona:** Risk Council member who scheduled `set_terms`.

**Steps:**

1. After the ready time (the state line reads "Ready · expires <UTC date-time>", up to 30 s after the flip), click "Execute" on the row and approve.

**Expected outcomes:**

- The button is enabled only for this ready row. The wallet prompt appears after a short on-chain check; nothing was typed in the form.
- The transaction is an AccessManager `execute` of `set_terms` with the scheduled arguments, and the loan's terms change on chain.
- The row stays as "Executed" with "Submitted · <tx hash>" and a disabled button, and disappears once the API stops serving it (within a minute or two). The current terms card shows the new terms and the Set terms notice goes away.
- Scheduling the same terms again later shows a normal waiting row, not an executed one.
- The form's "No longer scheduled" line does not appear.

---

## Story 3: Another wallet sees the row read-only

**Persona:** another Risk Council wallet, or a Trustee-only wallet, opening the page while a row is pending.

**Steps:**

1. Open the Security page with a different Stellar wallet connected (or none).

**Expected outcomes:**

- The row is listed with the scheduler's short address and no "this wallet" suffix.
- "Execute" is disabled and the row reads "Only the scheduling wallet (<short address>) can execute this."
- No wallet prompt appears.

---

## Story 4: An expired row says so and cannot be executed

**Persona:** Risk Council member, a `set_terms` operation not executed within 7 days of its ready time.

**Steps:**

1. Open the Security page.

**Expected outcomes:**

- The row reads "Expired — schedule it again" and "Execute" is disabled.
- The Set terms notice is not shown for an expired operation.
- Scheduling the terms again creates a new operation with its own waiting row.

---

## Story 5: A paused registry blocks Execute

**Persona:** Risk Council member, SecurityRegistry paused.

**Steps:**

1. Open the Security page while a row is `ready`.

**Expected outcomes:**

- The row's "Execute" is disabled and shows "The SecurityRegistry is paused. Executing is blocked until it resumes."
- Scheduling stays possible; once the registry resumes, "Execute" becomes enabled without a reload (30 s poll).

---

## Story 6: A cancelled operation that is still listed sends nothing

**Persona:** Risk Council member; the Guardian or the Admin cancelled the operation, and the indexer has not yet dropped the row.

**Steps:**

1. Click "Execute" on the stale ready row.

**Expected outcomes:**

- The row shows "No longer scheduled — cancelled by the Guardian or the Admin, or executed from another session." and no wallet prompt appears.
- Nothing was sent to the network.
- If the on-chain check finds an operation id that differs from the row's, the row shows "The served arguments do not match this operation on chain. Reload the page." instead, with no prompt.
- A row whose `target` is not the configured SecurityRegistry is disabled with "This operation targets another SecurityRegistry (<short address>) than this console is configured for."

---

## Story 7: Resolve-flag and release rows show their arguments and release asks for confirmation

**Persona:** Risk Council member with a scheduled `resolve_flag` and a scheduled `release_with_consent` on the loan.

**Steps:**

1. Open the Security page and read both rows.
2. When the release row is ready, click its "Execute".

**Expected outcomes:**

- The first row reads "Resolve flag · record #N" with the Outcome and the Reason hash shortened to 10 hex characters and "…". The second reads "Release with consent · record #N" with the shortened Consent hash.
- Clicking "Execute" on the release row opens "Release record #N? This burns the record NFT and cannot be undone." with Cancel and Execute; Escape and the backdrop cancel with nothing sent.
- Executing a resolve-flag row has no confirmation dialog.
- A release row whose arguments cannot be decoded (raw "Arguments" JSON) still asks for confirmation ("Release this record? ..." when the record number is unknown); nothing is sent before Confirm.
- Operations of the loan on other contracts (for example a LoanRegistry `set_default`) are listed too, with a link to the page that owns them instead of Execute ([1924](./1924-rc-hub-pending-ops.md)).
- With no pending operation the card reads "No scheduled operations found."
