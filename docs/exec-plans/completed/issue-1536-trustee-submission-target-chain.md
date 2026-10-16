# Issue #1536: Trustee: loan submission form selects the target chain

**Status: implemented (2026-10-16)** — every step and the Test Strategy are complete; trustee
lint/build/test (70 files, 1019 tests) and `lint-docs` green. See PR #1561.

Source: https://github.com/eq-lab/pipeline/issues/1536

Frontend follow-up of epic #1521 (backend-only, merged: #1542 chain foundation, #1550 submissions
target chain, #1551 loan book across chains, #1552 per-loan `chain_id`). Unblocked 2026-10-16.
Branch: `feat/1536-trustee-submission-target-chain`.

Backend contract (`docs/product-specs/api-authorization-loan-submission.md`, `api-authorization.md`):
`POST /v1/loan-book/loan?chain_id=<id>` — optional, defaults to `DEFAULT_CHAIN_ID`, not in `CHAINS` →
`400`. `GET /v1/loan-book/submissions` — `chain_id` omitted = every target chain; each item carries
`target_chain_id` plus the nullable drawn `chain_id` / `loan_id`. The indexer links a drawn loan to a
submission only when the draw chain equals `target_chain_id`.

No Figma: the submission form has none (product decision on #1100) and the target-chain column /
row has none either — both derive from the shipped field-box and table patterns.

## Scope

In scope (`packages/trustee`):

- A target-chain `<select>` on `/origination/new`, defaulting to Stellar, sent as the `chain_id`
  query of the POST. Options are this deployment's two configured chains from env:
  `ENV.STELLAR_CHAIN_ID` (label "Stellar") and `ENV.EVM_CHAIN_ID` (label from
  `evmChainInfo(id).name` in `@pipeline/wallet-connect` — "Hoodi" on staging, "Ethereum" on prod).
- `useLoanSubmissions` stops pinning `chain_id` to Stellar: the Origination table lists submissions
  for every target chain, with a new "Chain" column; the detail page gains a "Target chain" row.
- Approve safety gate: `Approve` runs the trustee-wallet Stellar `draw_loan` before the review call
  (#831). For a submission whose target is not the Stellar chain the button is disabled with an
  explanatory line, and `approve()` is a no-op; Reject / Request changes stay available.
- Docs, user stories, tests.

Out of scope:

- Drawing an EVM-targeted loan from the Trustee app (no EVM `draw_loan` path exists; logged as tech
  debt). The LP-facing loan book across chains is #1537. Backend changes: none.
- A chains endpoint: the API exposes no `GET /v1/chains`; the trustee already derives both chains
  from env (`TrusteeSessionProvider`, `main.tsx`), so the selector does the same.

## Assumptions and Risks

- **Two chains per deployment.** `CHAINS` on staging is `99000001,560048` and the trustee env carries
  exactly those two ids. If `CHAINS` and the env drift, the API answers `400` for the unknown id and
  the form surfaces it inline via `InlineError` — no silent fallback.
- **Default stays Stellar**, so a trustee who ignores the selector gets today's behaviour, and the
  default matches the only chain the Approve flow can draw on.
- **The `to` address is chain-specific** (G… on Stellar, 0x… on EVM). The label becomes "Mint to
  (address on the target chain)"; no client-side address-format validation is added (the API
  validates `draw_loan` inputs and the form's validation split is shape-only by design).
- **JSON import** may carry `target_chain_id` (the submissions API's field name); when present and
  equal to a configured option it sets the selector, otherwise the selector is left as is and the
  field is never listed as "missing" (it always has a value).
- **Listing every chain changes the row set** on `/origination` (previously Stellar-only). The
  Deployment-monitor panel in the LP app already did the same in #1550.
- **Mutation variable shape changes**: `useSubmitLoan().mutateAsync({ chainId, input })` instead of
  the bare body — the one caller is the form page; its tests update.
- Approve gate is defensive, not a product flow: nothing in the backend stops a `review` call
  without a draw, so the guard lives in the hook as well as the button.

## Open Questions

_None_ — the one judgment call (gate Approve on non-Stellar targets rather than let the Stellar draw
run against an EVM-targeted submission) is recorded above and in the Issue comment.

## Implementation Steps

### 1. `packages/trustee/src/lib/targetChains.ts` (new)

`TARGET_CHAINS: ReadonlyArray<{ id: number; label: string }>` = `[{ ENV.STELLAR_CHAIN_ID, "Stellar" },
{ ENV.EVM_CHAIN_ID, evmChainInfo(ENV.EVM_CHAIN_ID).name }]`, `DEFAULT_TARGET_CHAIN_ID =
ENV.STELLAR_CHAIN_ID`, `targetChainLabel(id: number | null | undefined): string` → the option label,
or `Chain <id>` for an unconfigured id, or `—` for null/undefined. Test: `-targetChains.test.ts`.

### 2. `packages/trustee/src/api/useSubmitLoan.ts`

`SubmitLoanVariables { chainId: number; input: SubmitLoanInput }`; `postLoan` posts to
`/v1/loan-book/loan?chain_id=${chainId}`. New `-useSubmitLoan.test.tsx` asserts the URL and body.

### 3. `packages/trustee/src/api/useLoanSubmissions.ts`

`SubmissionView` += `target_chain_id: number`, `chain_id: number | null`, `loan_id: string | null`.
Drop the `chain_id` query; `queryKey` `["loan-submissions", status ?? "all"]`. Tests updated (no
`chain_id=` in the URL).

### 4. `packages/trustee/src/routes/-origination-new.ts` + `origination.new.tsx`

- `FieldDef` += `options?: ReadonlyArray<{ value: string; label: string }>`; `FieldInput` renders a
  `<select>` (same field box, `FIELD_INPUT_CLASS`) when `options` is set.
- New first field of "Loan & metadata": `{ path: "target_chain_id", label: "Target chain",
  required: true, options: TARGET_CHAINS.map(...) }`; `emptyFormValues()` seeds it with
  `String(DEFAULT_TARGET_CHAIN_ID)`. `to` label → "Mint to (address on the target chain)".
- `parseSubmissionJson`: a numeric `target_chain_id` matching an option sets the value; it is never a
  missing field. `buildSubmitLoanInput` returns `{ ok: true, chainId, input }` and omits
  `target_chain_id` from the body; `buildForSubmit()` returns `SubmitLoanVariables | null`.
- `onSubmit` passes the variables through unchanged.

### 5. `packages/trustee/src/routes/-useOriginationTable.ts` + `origination.index.tsx`

`OriginationTableRow` += `chain: string` (`targetChainLabel(submission.target_chain_id)`). Column
"Chain" inserted after Originator: `COLUMN_HEADERS` and `GRID_TEMPLATE_COLUMNS` gain a `90px` track
(Originator shrinks to `minmax(0,1fr)` so the tracks still sum to 100%).

### 6. `packages/trustee/src/routes/-origination-detail.ts` + `origination.$id.tsx` + `-useOriginationReview.ts`

- `DealDetailsDisplay` += `targetChain: string`; a "Target chain" `TermRow` first in Deal details.
- `UseOriginationReviewResult` += `canApprove: boolean` (`submission.target_chain_id ===
  ENV.STELLAR_CHAIN_ID`); `approve()` returns early when false.
- `ActionButtons` takes `approveBlockedReason?: string`; when set, Approve is `disabled` and a muted
  line reads "Approve & draw runs on Stellar only — drawing on `<chain>` from the Trustee app is not
  supported yet. Reject or request changes instead." (`data-testid`
  `origination-detail-approve-blocked`).

### 7. Docs

See **Docs to Update**.

## Test Strategy

- `-targetChains.test.ts`: options, default, label fallbacks.
- `-useSubmitLoan.test.tsx`: `POST /v1/loan-book/loan?chain_id=560048` with the JSON body and bearer.
- `-useLoanSubmissions.test.tsx`: URL has no `chain_id`; `status` still appended; `target_chain_id`
  parsed through.
- `-origination-new.test.ts`: builder emits `{ chainId, input }` with no `target_chain_id` in the body;
  default chain; JSON `target_chain_id` sets / ignores correctly and is never "missing".
- `-origination-new-page.test.tsx`: the selector renders with Stellar selected; choosing the EVM option
  changes `chainId` in the submitted variables; existing payload assertions move to `.input`.
- `-useOriginationTable.test.ts` / `-origination.index.test.tsx`: chain label per row, "Chain" header.
- `-origination-detail.test.ts`: `targetChain` mapped; `-useOriginationReview.test.ts`: `canApprove`
  false for an EVM target and `approve()` neither draws nor reviews; `-origination-detail-page.test.tsx`:
  disabled Approve + the blocked line for an EVM target, Reject still enabled.
- Gate: `yarn workspace @pipeline/trustee lint`, `build`, `test`; `npx tsx scripts/lint-docs.ts`.

## Docs to Update

- `docs/frontend/trustee-flows.md`: "Data layer (`useLoanSubmissions`)", "Origination table",
  "Submit a loan", "Origination detail", "Chain-first Approve ordering" (the gate).
- `docs/product-specs/api-authorization-loan-submission.md`: the sentence "Loans drawn on Hoodi (test)
  stay unlinked until #1536 sends the target chain".
- `docs/exec-plans/tech-debt-tracker.md`: new TD — no EVM `draw_loan` from the Trustee app; Approve
  is gated to Stellar targets.
- `docs/user-stories/epic-1521/1536-trustee-submission-target-chain.md` + index row.
