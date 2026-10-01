# User Stories: #1396 — Account setup review confirmation

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1396](https://github.com/eq-lab/pipeline/issues/1396)
Spec: [KYB: LP entity verification](../../product-specs/kyb-lp-verification.md)

Use an authenticated email account and the live LP API. Compare the confirmation with the
existing Account-in-review preview at `/test?tab=auth` and Figma nodes `6486:81745` and
`6486:81764`.

## Story 1: Successful setup opens the confirmation

Open Finish account setup for a missing or empty LP, enter Name, stage a valid file, and Submit.
After the profile and all files save successfully, setup closes and Your account is under review
opens. A valid profile-only Submit on an existing writable LP also opens it. Saving setup does
not call the submit-for-review endpoint or change backend KYB status.

## Story 2: Failed and partial saves stay in setup

Fail the profile save, reject every upload, accept only one of two files, and interrupt the upload
connection. In each case setup stays open with its existing recovery UI. Retry failed files;
only a fully successful Submit opens the confirmation. Persisted successful files are not resent.

## Story 3: Notify me changes only its appearance

Press Notify me. It switches to the green We’ll notify you state with a check icon, without an
API request or stored preference. The confirmation remains open; pressing the button again does
nothing.

## Story 4: Closing and changing sessions

Press Go to app, then repeat using the close button or Escape. Each closes the confirmation
while retaining the authenticated session, and setup does not immediately reopen. Sign out while
the confirmation is open and sign in to another account; the prior confirmation and notified
state are gone. Reloading does not restore the confirmation. The development preview stays
independent of the production setup flow.
