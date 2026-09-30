# User Stories: #1371 — LP account setup and documents

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1371](https://github.com/eq-lab/pipeline/issues/1371)
Spec: [KYB: LP entity verification](../../product-specs/kyb-lp-verification.md)

Use a live LP API, a verified email account, and an authenticated frontend session. The `/test?tab=auth` trigger is a visual preview and does not make LP API requests. Compare its empty and uploaded states with the epic's Figma nodes `6701:96852` and `6701:96881`; compare the production profile card's shared inputs with sign-in and create-account.

## Story 1: A missing or empty LP is prompted after authentication

Sign in to a verified email account with no LP, then reload. After each completed LP lookup, the Finish account setup modal opens. Close it with X. The account stays signed in and the modal stays closed until another sign-in or reload. Repeat with an LP whose `documents` is empty. During a pending lookup, or after a 401, network error, or server error, the modal does not open. With at least one persisted document, it does not open.

## Story 2: Profile and files are saved in order

Enter Name and optional Country; stage a PDF, JPEG, or PNG of at most 10MB. Remove one staged file with its X and stage it again. Submit. The JSON profile request contains `legal_name`, `country`, and the authenticated `contact_email`; the multipart request follows it with file parts only. The files appear by server filename after confirmation and remain after reload. Submit does not claim a KYB review transition. An empty Name prevents Submit. A new LP without a staged file cannot Submit.

## Story 3: Existing profile data survives an edit

With an existing writable LP and no documents, inspect prefilled Name and Country, edit Name, and upload a file. The profile request retains the LP's original `contact_email` and Country. Change Name or Country again with no staged file and submit; only the JSON profile request occurs. Edit both fields without submitting, then delete a persisted document and let the LP prop refresh; the drafts remain. Opening a different LP identity initializes the fields from that LP. With a nonwritable LP, profile fields, upload, Submit, and deletion are disabled. A Verified document has no remove action even if the LP is otherwise writable.

## Story 4: Partial upload and recovery

Stage two files with the same filename and arrange for one to be accepted and one to be rejected. After a 207 response, one persisted row appears and only the failed staged file remains with an error. Retry and verify the successful file is not sent again. Arrange for both duplicate-name files to be rejected with HTTP 400; both per-file reasons appear in request order and both files remain staged. If the connection fails after upload, the UI checks the server before retrying; if that check also fails, it blocks retry until Check uploads succeeds.

## Story 5: Persisted deletion and error handling

Remove a persisted Provided or Rejected document by its X. It disappears only after a 204 response and stays gone after reload. A failed deletion leaves the row visible; 404 and 409 reconcile with a fresh LP read. Exercise invalid file, expired session, missing LP, frozen LP, oversize batch, and network failures, and verify the modal shows a useful error while retaining any unconfirmed staged files.
