# User Stories: #1373 — LP Account profile and documents

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1373](https://github.com/eq-lab/pipeline/issues/1373)
Spec: [LP onboarding](../../product-specs/lp-onboarding.md)

Use an authenticated LP account and the live LP API on `/account`. Compare the Name and Country inputs with the Finish account setup modal. Compare the document states with the epic's Account Figma frames; `?state=` links under `/test?tab=auth` are development fixtures and must make no LP API calls.

## Story 1: Load the account and recover from read errors

Open `/account` after sign-in. While `GET /v1/lps/me` is pending, see a loading message and no fabricated profile or documents. On success, see the saved legal name, country, corporate email, filenames, and statuses after reload. On 404, see an empty profile with the authenticated email and an instruction to complete setup. For an old session with no email, see a sign-in instruction and no enabled creation action. On a 401 or network error, see an error and Retry; a failed read never appears as a new LP. Sign out during a pending read and verify the old response does not appear.

## Story 2: Edit a writable profile

Change Name on an existing LP, leave Country unchanged, and choose Save profile. The request sends the complete `legal_name`, `country`, and stored `contact_email` to `POST /v1/lps/me`, without a document upload. The saved value remains after reload and Save profile disables until another change. A blank Name cannot be saved; Country may be cleared. With a nonwritable LP, both fields and Save profile are disabled. A 409 refreshes the server state while leaving unsaved draft text visible.

## Story 3: Upload and delete persisted documents

Stage two valid files, save, and reload. Each filename and Provided/Verified/Rejected status comes from the server. A writable LP can upload more files and remove a Provided file by its server id. The row disappears only after successful deletion; failed deletion retains it, and 404/409 refresh the LP. A Verified file has no removal action, and a nonwritable LP has no document mutations. For a Rejected file, choose Re-upload, confirm the rejected document is deleted, then stage and save the corrected file.

## Story 4: Retry partial or uncertain uploads

Upload duplicate filenames with one success and one rejected per-file result. Only the confirmed success leaves the staged list; the rejected file remains with its reason and is the only file sent on retry. Repeat with an all-rejected HTTP 400 response and verify every ordered reason is shown. If the network fails after upload, the page reads back new document ids before enabling a retry. If read-back fails, Check uploads must succeed before retry. While Check uploads is pending, Upload, staged removal, and Save are disabled. If read-back finds a new document matching duplicate staged filenames, no ambiguous staged copy is silently removed or sent again. Choose Discard uncertain staged files, review the server list, and select any missing files again. An existing LP's unsaved Name or Country draft remains intact through uploads, deletion, and read-back.

## Story 5: Preserve account navigation and previews

The wallet card, Logout, and centered 480px column remain. The production route redirects an unauthenticated user. In development, all six `?state=` previews continue to show their fixture states without LP requests. On a production build, adding `?state=verified` cannot show synthetic documents.
