# Issue #1100: Loan submission UI — /origination/new form with Import-from-JSON

Source: https://github.com/eq-lab/pipeline/issues/1100

## Scope

A "Submit a loan" action on `/origination` opens a new full-page route `/origination/new`
rendering a form that covers the complete `SubmitLoanRequest` contract of
`POST /v1/loan-book/loan` (`packages/api/src/routes/loan_book.rs`), plus an **Import from
JSON** dialog that autofills the form from a pasted payload and warns about missing fields.
No Figma exists for this screen (product decision on the issue) — it reuses the trustee
app's existing visual language: the Record Coupon/Repayment field-box pattern, the
`-RejectReasonDialog.tsx` dialog pattern, `InlineError` for failures.

In scope:

1. **`src/api/useSubmitLoan.ts`** — TS mirror of the request contract
   (`SubmitLoanInput` with `economics`, `initial_location`, `collateral_valuation`,
   `fee_schedule`, `documents[]`) + a React Query mutation posting via `apiFetch`
   (which already injects the session bearer, #791). Invalidates `loan-submissions`
   on success.
2. **`src/routes/-origination-new.ts`** — presenter (FRONTEND.md rule 2):
   - Form state for every field; documents as dynamic name/uri rows.
   - `parseSubmissionJson(text)` (exported, pure): JSON → `{ values, missingFields }`
     or a parse error. Missing = required leaf paths absent (dotted, e.g.
     `collateral_valuation.haircut_pct`); present fields autofill regardless.
     Accepts a single JSON object only — arrays/wrapped forms error (resolved
     open question: fixture files can be unwrapped by hand; predictability wins).
   - `buildSubmitLoanInput(form)` (exported, pure): form state → request payload,
     coercing numeric fields (`*_bps`, dates, `initial_ccr`); returns field-level
     validation errors for non-numeric input. Amount strings are sent **verbatim**
     (×1e6 convention, no client-side rescaling).
   - Submit wiring: pending/error via `toUserError`; on success navigate to
     `/origination` (the invalidated list refetches and shows the new submission).
3. **`src/routes/-ImportJsonDialog.tsx`** — modal dialog with a plain `<textarea>`,
   Cancel/Import actions, inline parse error (mirrors `-RejectReasonDialog.tsx`).
4. **`src/routes/origination.new.tsx`** — the page: back link, "Submit a loan"
   heading, standing warning banner ("`metadata_uri` must be unique per
   submission"), grouped field sections (Loan & metadata / Documents / Economics /
   Initial location / Collateral valuation / Fee schedule), Import from JSON button
   + dialog, missing-fields warning after import, Submit with stage label,
   `InlineError` on API rejection.
5. **`src/routes/origination.index.tsx`** — "Submit a loan" button (Link →
   `/origination/new`) beside the page heading.
6. **Tests** — pure: `parseSubmissionJson` (example payload from the issue warns
   exactly `collateral_valuation.*` + `fee_schedule.*`; malformed JSON; array
   rejection; partial autofill), `buildSubmitLoanInput` (verbatim amounts, numeric
   coercion, validation errors). Page: form renders all sections + banner; dialog
   opens, pastes, autofills, warns; submit posts the built payload and navigates;
   API error surfaces via `InlineError`; index page shows the button.
7. **Spec** — `docs/frontend/trustee-flows.md`: new "Submit a loan
   (`/origination/new`, #1100)" section.

Out of scope:

- Any backend change; the endpoint and its validation are used as-is.
- Client-side re-validation of backend invariants (facility = senior + equity, CCR
  minimum, date ordering) beyond numeric-shape checks — the API's rejection surfaces
  inline instead (never duplicate the validator).
- Draft persistence, file upload, IPFS pinning — the form takes URIs as text.
- Accepting wrapped/array JSON payloads (resolved: single object only).

## Decisions (from the issue)

- Placement: Origination section, `/origination/new`, "Submit a loan" entry action.
- No Figma — app-native styling.
- Import from JSON opens a dialog with a plain textarea.
- `metadata_uri` uniqueness: standing warning banner + inline API rejection.
- Auth: the logged-in session's bearer via `apiFetch`; the route sits behind the
  app's existing auth gate like every other trustee route.

## Risks

- The request TS mirror drifting from `SubmitLoanRequest` — mitigated by keeping the
  type in one file (`useSubmitLoan.ts`) with the Rust source referenced.
- `senior_interest_rate_bps` etc. accept any digits client-side; out-of-range values
  are the backend's call (its error renders inline).
