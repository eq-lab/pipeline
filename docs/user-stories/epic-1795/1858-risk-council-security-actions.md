# User Stories: #1858 — Trustee Risk Council security actions (SecurityRegistry, scheduled 24 h)

Issue: [#1858](https://github.com/eq-lab/pipeline/issues/1858) (epic #1795)
Spec: [docs/frontend/trustee-flows.md](../../frontend/trustee-flows.md#risk-council-security-actions), [docs/product-specs/trustee-dashboard.md](../../product-specs/trustee-dashboard.md) §"Type 3", [docs/product-specs/loan-security-state.md](../../product-specs/loan-security-state.md)

Trustee app (`packages/trustee`), pages `/risk-council/security/{id}?chain=<stellar chain>` and `/risk-council/inspectors`, Stellar wallet connected. A Risk Council wallet calls the AccessManager: one `execute` when its `can_call` is immediate, otherwise `schedule`, then `execute` after the delay (24 h on test and prod). The target is the SecurityRegistry (`VITE_STELLAR_SECURITY_REGISTRY_ID`). Wallets that run these stories must be in the API trustee allow-list. There is no Safe, proposal, vote or timer. Served values are shown verbatim; the app computes nothing.

---

## Story 1: A Trustee-only wallet sees the security pages read-only

**Persona:** Trustee whose wallet has no Risk Council role (`can_call` returns `immediate: false, delay: 0`).

**Steps:**

1. Open the Risk Council hub and follow "Security" on a loan, then "Inspector panel".

**Expected outcomes:**

- The Security page shows the current terms, flagged records and open records; every action button is disabled and the chip reads "Risk Council only".
- The role lines read "Setting security terms belongs to the Risk Council.", "Settling an inspection flag belongs to the Risk Council.", "Releasing a record with the lenders' consent belongs to the Risk Council." and, on the panel page, "Setting the inspector panel belongs to the Risk Council."
- No wallet prompt appears.

---

## Story 2: A Risk Council wallet schedules security terms, reloads and finds the schedule

**Persona:** Risk Council member (delayed role), Stellar loan.

**Steps:**

1. Open `/risk-council/security/{id}`. With no terms the left card reads "No security terms are set for this loan."; with terms it shows them verbatim and the form is prefilled.
2. Fill the Set terms form: ratios and tolerances in %, default rate in %, cure, grace, attestation and inspection in days, price stale in hours, and a payment term. Watch the raw echoes ("= 7000 bps", "= 20000 (1e6 scale)", "= 604800 s").
3. Click "Schedule terms" and approve. Reload and re-enter the same values.

**Expected outcomes:**

- The button stays disabled until every field is valid and a payment term is chosen. A margin call ratio below the advance ratio shows "The margin call ratio must be at least the advance ratio." and keeps it disabled.
- Step 3 sends an AccessManager `schedule` of the SecurityRegistry's `set_terms` with the loan id and all 12 `Terms` fields (`margin_call_at` = 0).
- After the reload and re-entry the card reads "Scheduled. Executable from <UTC date-time>." and the button "Execute terms".

---

## Story 3: Executing the scheduled terms updates the served terms

**Persona:** The same wallet, after the ready time.

**Steps:**

1. Click "Execute terms" and approve. Wait for `refresh_pending` to clear.

**Expected outcomes:**

- The left card shows the new terms and the Security card on the loan detail shows the new advance and margin-call ratios.
- Executing before the ready time fails with "This operation is not ready yet…" and requests no signature.
- If the registry is paused, the card shows "The SecurityRegistry is paused. Executing is blocked until it resumes." and the execute button is disabled.

---

## Story 4: A flagged record is settled with a reason

**Persona:** Risk Council member (delayed role), a record with an inspection flag (`flagged_by` set).

**Steps:**

1. In "Flagged records" read the record's protection, lot and the flagging inspection (kind, inspector, quantity, grade, variances).
2. Pick an outcome (Accepted, TopUpRequired or Escalated) and read its effect text. Enter a reason; the sha256 hex of the trimmed reason appears.
3. Click "Schedule resolution" and approve; after the ready time click "Execute resolution".

**Expected outcomes:**

- Only records with a served flag are listed; with none the card reads "No flagged records."
- The button stays disabled until the reason is non-empty.
- The transaction is `resolve_flag` with the record id, the outcome as a unit variant and that hash. On the hub the row names the loan the page was opened for, not the record id alone.
- Resolving a record that has no flag fails with "This record has no flag to resolve."

---

## Story 5: A record is released with the lenders' consent

**Persona:** Risk Council member (delayed role), a loan with open records.

**Steps:**

1. In "Release with consent" pick an open record (none is preselected), enter the consent reference (the sha256 hex of its trimmed text appears) and click "Schedule release".
2. Read the confirm dialog, then confirm and approve. After the ready time click "Execute release" and confirm again.

**Expected outcomes:**

- Only records with `open` true are offered; with none the card reads "No open records."
- The dialog reads "Release record #{id}? This burns the record NFT and cannot be undone." Escape or a click on the backdrop cancels with no prompt.
- The transaction is `release_with_consent` with the record id and the hash. After the refetch the record is no longer open. After an executed release the record choice and consent text are cleared; the button stays disabled until a record is picked again.
- A record that is already released or enforced fails with "The record's current status does not allow this. It may already be released or enforced."

---

## Story 6: The inspector panel is edited and scheduled

**Persona:** Risk Council member (delayed role).

**Steps:**

1. Open `/risk-council/inspectors`. The current panel is read on chain.
2. Type a malformed address, then an address already on the panel, then a new valid `G…` address and click "Add". Mark one current inspector for removal.
3. Check the resulting list, then click "Schedule inspector panel" and approve. Reload and make the same edits.

**Expected outcomes:**

- A malformed address shows "Enter a valid Stellar address (G… or C…)." and a duplicate shows "This address is already on the panel."; "Add" stays disabled for both.
- The page notes "Applies to inspections entered from now on." and warns when the resulting panel is empty. With no edits it reads "No changes to the current panel." and the button is disabled.
- The transaction is `set_inspectors` with the full resulting list in order. After the reload and the same edits the card reads "Scheduled. Executable from …" and "Execute inspector panel"; after the execute the current list shows the new panel.

---

## Story 7: EVM loans and an unconfigured environment

**Persona:** Any Risk Council wallet.

**Steps:**

1. Open `/risk-council/security/{id}?chain=<EVM chain>` for an EVM loan.
2. On an environment without `VITE_STELLAR_SECURITY_REGISTRY_ID`, open a Stellar loan's Security page and the inspector panel page.

**Expected outcomes:**

- The EVM page renders read-only; every action card is disabled and prints "On-chain actions run on Stellar only…".
- The unconfigured environment shows "On-chain SecurityRegistry actions are not configured for this environment." and never crashes.

---

## Story 8: The hub and the loan detail link to the new pages

**Persona:** Risk Council member.

**Steps:**

1. Schedule a release (Story 5) and the inspector panel (Story 6), then open the hub.
2. Open a loan's detail page.

**Expected outcomes:**

- Every listed loan that is not `Closed` has a "Security" link; the header has an "Inspector panel" link.
- The Scheduled operations table lists the release with "record #{id} · consent hash {prefix}…" under that loan's name and the panel change as "{n} inspectors" under "All loans". The footnote says security operations appear only when scheduled from this console in this session.
- The loan detail Security card links to "Security actions", or "Set security terms" when the loan has no terms.
