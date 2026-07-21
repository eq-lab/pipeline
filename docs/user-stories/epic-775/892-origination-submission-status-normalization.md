# Issue #892 — Origination normalizes merged submission statuses

## Story

As a Trustee reviewing the Origination queue, I need the Origination page to show whether a request is still awaiting review, approved, or rejected, even after the backend starts returning the resulting loan's lifecycle status for approved submissions.

## Test cases

### Lifecycle status appears as approved in the Origination table

1. Load `/origination` with a submission from `/v1/loan-book/submissions` whose raw `status` is a loan lifecycle value such as `Performing`, `WatchList`, `Past Due`, `Default`, or `Closed`.
2. Find that submission's row.
3. Confirm the status cell shows the green `Approved · <updated date>` pill.
4. Confirm the row still opens `/origination/<submission id>` when clicked.

### Lifecycle status appears as approved on the Origination detail page

1. Open `/origination/<submission id>` for a submission whose raw `status` is a loan lifecycle value.
2. Confirm the status chip reads `Approved`.
3. Confirm the footer shows the approved banner, not the Approve/Reject action buttons.

### Needs Attention remains review-only

1. Load the Trustee Overview with no raw `InReview` submissions and at least one submission whose raw `status` is a lifecycle value.
2. Confirm the Origination group does not show that lifecycle-status submission as actionable review work.
