# User Stories: #1404 — Submit LP for KYB review

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1404](https://github.com/eq-lab/pipeline/issues/1404)
Spec: [LP entity verification](../../product-specs/kyb-lp-verification.md)

## Story 1: Setup submits after files save

Use a verified email account with no LP. Enter profile data and upload valid documents through
Finish account setup. Submit saves the profile, uploads every file, then POSTs /v1/lps/me/submit
without a body. Adopt the server UnderReview response before opening the review confirmation.
Reload: the account is frozen and the trustee can review it. Preview remains local. Partial or
failed uploads stay staged and never call submit. Rejected persisted files block submission
with correction feedback.

## Story 2: Uploads are retained when submission fails

Let all files upload, then fail the submission. Persisted rows remain and Submit for review
retries without uploading again. The button stays available even though the staged list is empty
and profile fields are unchanged. If the response is lost after committing UnderReview, the
follow-up GET opens the confirmation and no second POST is sent. If the GET also fails, writes
stay blocked until Check submission status succeeds. A read showing Passed, Failed, or
ChangesRequested adopts that verdict and does not show an under-review confirmation.

## Story 3: Existing Account documents can enter review

Visit Account with a NotStarted LP and saved Provided documents. Without selecting another file,
press Submit for review. Only the submit endpoint is called; UnderReview freezes editing and
shows Verifying account. With staged files, document Save uploads them and then submits only
after every result succeeds. Partial or uncertain uploads do not submit automatically. Successful
uploads followed by submission failure remain persisted for submit-only retry.

## Story 4: Profile Save and correction remain explicit

Edit Name or Country on an existing LP. Upload and Submit for review are blocked with a save
profile first hint. Profile Save only upserts JSON. Save drafts, then submit or upload documents.
For ChangesRequested, rejected documents must be deleted and replaced before submission. Empty
sets, rejected files, InProgress, UnderReview, Passed, and Failed cannot submit. A Failed account
shows declined feedback rather than a Verifying account banner.

## Story 5: Recovery respects the current session

Change sessions while saving, uploading, submitting, or checking status. Old responses and
errors cannot alter the new session, and follow-up requests stop when the captured token no
longer matches. While submission status is unknown, profile inputs, upload, deletion, staged
removal, and submission remain locked. On Account, terminal or correction verdicts discovered
by a status check are adopted without blindly issuing another submit request.
