# User story: #1885 — LP: settlement bank account, capture in KYB / Account and masked view

**Epic:** #1795
**Issue:** https://github.com/eq-lab/pipeline/issues/1885
**Status:** Initial

---

## Overview

A lender may add the USD bank account that bank withdrawals are wired to, on the Account page and in "Finish account setup". The app shows only the served masked summary (holder, bank, last four), sends the account only on the save that carries it, and shows field errors inline. The block is built without a Figma frame (decision on #1885). Spec: `docs/frontend/account-page.md#settlement-bank-account-1885` and `docs/product-specs/kyb-lp-verification.md#settlement-bank-account`. The Bank tab destination and gating are #1917.

All checks use the real API on staging, no localStorage mocks. Open DevTools Network before starting.

---

## Story 1 — A NotStarted lender adds an account on the Account page

**Given** a signed-in lender whose KYB is `NotStarted` with no bank account
**When** they open `/account`, click **Add**, fill holder, bank, IBAN and SWIFT/BIC, and click **Save profile**
**Then** one `POST /v1/lps/me` carries `settlement_bank_account`, the form closes, and the row shows the holder with `{bank} · ending {last4}` exactly as the response served it.

## Story 2 — An invalid IBAN shows an inline error

**Given** the Add form is open
**When** the lender enters an invalid IBAN and clicks **Save profile**
**Then** the IBAN input shows `Enter a valid IBAN.`, no generic alert appears, the entered values stay, and the 400 response body does not contain the IBAN value.

## Story 3 — Add during Finish account setup

**Given** a new lender with the "Finish account setup" modal open
**When** they add a bank account, stage a document and click **Submit**
**Then** the `POST /v1/lps/me` before the upload carries the account; a field 400 stops before any upload and keeps the staged file.

## Story 4 — Frozen statuses are read-only

**Given** KYB is `UnderReview`, `Passed` or `Failed`
**Then** the section has no Add / Replace button and no inputs. `UnderReview` shows `Locked while your account is under review.`; `Passed` shows `To add a bank account, contact support.` (none stored) or `To change it, contact support.`; `Failed` shows no caption.

## Story 5 — ChangesRequested replaces the account

**Given** KYB is `ChangesRequested` with an account stored
**When** the lender clicks **Replace**
**Then** seven empty inputs appear with `Replacing {bank} · ending {last4}. Enter the full account again.` and the masked row above; saving shows the new masked summary.

## Story 6 — Other saves leave the account unchanged

**When** the lender clicks **Notify me** on the in-review modal, or saves a profile change with the form closed or blank
**Then** the `POST /v1/lps/me` body has no `settlement_bank_account` key and the masked row is unchanged.
