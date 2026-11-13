# Issue #1913 — Originator amends and resubmits a submission after Request changes

## Story

As an Originator whose submission the Trustee sent back with "Request changes", I need to amend the submission and resubmit it from the Trustee app, so the Trustee can review the corrected version without me creating a new loan.

## Test cases

### The detail page offers Make changes and resubmit for a Changes-requested submission

1. Open `/origination/<submission id>` for a submission whose status is `ChangesRequested`.
2. Confirm the orange "Changes requested · <date> — <reason>" banner is shown.
3. Confirm a "Make changes and resubmit" button sits under the banner and no Approve / Reject / Request changes buttons are shown.
4. Open a detail page for an `InReview`, `Approved` or `Rejected` submission and confirm there is no "Make changes and resubmit" button.
5. Click "Make changes and resubmit" and confirm the URL is `/origination/<submission id>/edit`.

### The edit form is prefilled and the target chain is fixed

1. On `/origination/<submission id>/edit`, confirm the heading "Amend and resubmit" and the orange "Changes requested · <date> — <reason>" banner showing the Trustee's reason.
2. Confirm every field shows the value stored on the submission (metadata URI, originator, economics, collateral valuation, fee schedule), USDC amounts exactly as stored, and the submission's documents are listed as editable Name / URI rows.
3. Confirm the Target chain select is disabled, lists only the submission's chain, and shows "Fixed at submission. To target another chain, submit a new loan."
4. Confirm the banner "You can keep this submission's metadata_uri. A new one must not be used by another open submission." is shown.
5. For an older submission stored without some required fields, confirm a warning lists the missing fields and submitting is blocked with "Required." on them until they are filled.

### A successful resubmit returns the submission to review

1. Change one field (for example the commodity) and click "Resubmit for review".
2. In the Network tab confirm `POST /v1/loan-book/submissions/<id>/resubmit` returns `200` with no `chain_id` query.
3. Confirm the app lands on `/origination/<submission id>` showing "Awaiting your review" with the Approve / Reject / Request changes buttons and the amended value.
4. Open `/origination` and confirm the row is no longer "Changes requested" and, on the Overview, the submission no longer reads "changes requested" in Needs Attention.

### Validation and API errors render inline

1. Clear a required field and click "Resubmit for review"; confirm "Required." under the field, the summary "Some fields need attention before submitting." and no request in the Network tab.
2. Submit as a session without the originator role; confirm "Only the originator can resubmit this loan." inline, the form intact and no navigation.
3. Submit with a `metadata_uri` already used by another open submission; confirm "This metadata URI is already used by another open submission. Use a unique one." inline.
4. Confirm the raw response is available behind "View details" for each error.

### A direct visit to the edit URL for a non-Changes-requested submission is refused

1. Open `/origination/<submission id>/edit` for an `InReview` (or `Approved` / `Rejected`) submission.
2. Confirm the panel "This submission isn't awaiting changes." with a link back to `/origination/<submission id>` and no form.
3. Open `/origination/<unknown id>/edit` and confirm "Submission not found." with a link back to Origination.
