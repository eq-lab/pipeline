# User Stories: #1401 — Remove Account setup description

Epic: [#1247 — KYB login flow](https://github.com/eq-lab/pipeline/issues/1247)
Issue: [#1401](https://github.com/eq-lab/pipeline/issues/1401)
Spec: [KYB: LP entity verification](../../product-specs/kyb-lp-verification.md)

## Story 1: A new account shows the form without extra setup copy

Sign in to an email account with no LP, dismiss Finish account setup, and visit `/account`.
The Account heading, profile fields, and document controls remain visible. The sentence
“Complete your company profile and upload documents to set up your account.” is absent.
Enter Name and Country, save the profile, and upload documents using the existing controls.

## Story 2: Account status messages remain available

Visit the Account page while loading, after a request failure, and with a frozen LP. Existing
loading, error, and read-only status messages remain visible in their respective states.
