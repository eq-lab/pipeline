# User Stories: #1271 — Trustee LP review

Epic: [#1269 — Trustee LP Counterparties](https://github.com/eq-lab/pipeline/issues/1269)
Issue: [#1271](https://github.com/eq-lab/pipeline/issues/1271)
Spec: [LP entity verification](../../product-specs/kyb-lp-verification.md)

Use a trustee session and live API. Follow the shipped Loan detail and Origination dialog
patterns; this epic has no Figma. Bank information remains `—` and no bank actions are added.

## Story 1: Live list and directly linked detail

Open LP Counterparties and follow a row, then load the detail URL directly. The profile shows
served legal name, country, email, settlement address, registration/submission/decision dates,
status, and latest decision reason. ChangesRequested appears as Changes requested in both
list and detail. Flat file rows show filenames, bytes, content type, status, reviewer/date,
and rejection reason. Download opens the real presigned link. Refresh obtains fresh links;
a missing URL displays unavailable download feedback. An empty document list is explicit.

## Story 2: Review only Provided files under review

For an UnderReview LP, verify one Provided document through confirmation. Reject another,
first with an empty reason (blocked), then with a nonblank reason. Verified and Rejected
rows have no further review actions. Responses refresh rows immediately. Document review
leaves the LP's KYB status unchanged. Repeat with NotStarted, ChangesRequested, Passed,
and Failed LPs: review actions are unavailable.

## Story 3: LP verdicts reflect their consequences

For an UnderReview LP with an unverified file, Confirm KYB passed is unavailable. Verify
every document; approval becomes available and confirmation sends Passed. Request changes
accepts an optional reason and reopens the record; the detail and listing update. Reject
account requires confirmation explaining permanent refusal, frozen LP, and account
suspension. Cancel makes no request. Confirm sends Failed. All three LP verdicts accept an
empty reason and reject reasons longer than 2,000 characters.

## Story 4: Failure and stale-state recovery

Exercise invalid id, loading, 404, 403, network failure, expired session, and 409 after another
trustee reviews the same file or LP. Useful errors appear with diagnostic details and retry;
401 clears the session. A conflict refreshes list/detail and stale actions become unavailable.
Failed writes retain the reason. Duplicate clicks cannot issue overlapping writes, and a
pending write cannot be dismissed. Navigate to a different LP or change sessions while a
request is pending: prior dialogs and completions do not modify the new account view.

## Story 5: Accessible review dialogs

Open a dialog using the keyboard. Focus moves into it, Tab stays within it, and Escape or
Cancel closes it and restores focus. Required reason and validation messages have accessible
labels. During submission controls are disabled and feedback remains visible.
