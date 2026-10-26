# Issue #1621: Trustee: Update lifecycle silently resets a WatchList loan to Performing

Source: https://github.com/eq-lab/pipeline/issues/1621

## Scope

The **Update lifecycle** dialog (`UpdateLifecycleDialog` in
`packages/trustee/src/routes/loans.$id.tsx`) defaults its status selector from the display chip:
`detail.hero.status?.label === "Watchlist" ? "WatchList" : "Performing"` (~L1446). The backend
`display_status` (`packages/api/src/routes/loan_book.rs` L68-79) masks a raw `WatchList` loan as
`Disbursing` (off-ramp incomplete) or `Past Due` (rendered as the `Matured` chip), and the dialog is
offered in both of those variants. A trustee who only edits CCR/location therefore writes
`Performing` on-chain and silently takes the loan off the watchlist.

In scope (frontend only):

1. Derive the loan's **current on-chain lifecycle status** (`Performing` | `WatchList` | unknown)
   in `useLoanDetail` from the served `onchain_status`, and expose it as a new `lifecycleStatus`
   field on `UseLoanDetailResult`.
2. Default the dialog's selector to that status instead of the display chip.
3. When the current on-chain status cannot be established from served data, preselect **nothing**
   and keep **Confirm update** disabled until the trustee picks a status explicitly. A silent
   default is never written.
4. Tests and the `trustee-flows.md` wired-actions bullet.

How the raw status is obtained: backend #1649 (merged in #1654) serves `onchain_status` (`Approved |
Performing | WatchList | Default | Closed`) on `GET /v1/loan-book` entries and on
`GET …/financials`, with no display overrides. The trustee API types are hand-written
(`packages/trustee/src/api/useLoanBook.ts`, `useLoanFinancials.ts`), so the field is added there by
hand. The mapping:

| served `entry.onchain_status` | `lifecycleStatus` |
| :-- | :-- |
| `Performing` | `Performing` |
| `WatchList` | `WatchList` |
| `Approved` / `Default` / `Closed` / anything else / missing / no entry | `null` (unknown → explicit choice) |

The served display `status` and `watchlist_entered_at` play no part in the default.

"Require an explicit choice when it differs from the current status" (from the issue), decided
from the specs:
- When the default is the current on-chain status, the value can only differ through a deliberate
  user change. No spec asks for an extra confirmation on that change. `trustee-risk-watchlist.md`
  § Return to Performing says the Watchlist exit is "one button, instant", and design doc v3 S10
  puts a confirm gate only on choosing Past Due, which is not settable here
  (`trustee-risk-watchlist.md` § Past Due and `trustee-flows.md` § wired actions).
- So the explicit-choice requirement applies **only** to the *unknown current status* case
  (item 3: `Approved` / `Default` / `Closed` or a missing field). No additional confirm step is added for a deliberate change.

Out of scope:
- Any backend/API change (the raw status is already served by #1649).
- Disabling the selector on a Disbursing loan (design doc v3 S10: "On a Disbursing loan the
  selector is disabled"). `docs/frontend/trustee-flows.md` does not specify this and it is a
  separate behavior change. Note it as a possible follow-up, not part of this fix.
- Settable Past Due (v3 S10). It conflicts with `trustee-risk-watchlist.md`, the source of truth,
  which says Past Due is derived and not settable.
- Changing the dialog's other fields, its layout, or Figma styling.

## Assumptions and Risks

- **Assumption:** `onchain_status` is the raw snapshot status (#1649). Old-registry loans may read
  shifted per the backend's "Known limitation" in `loan-status-timeline.md`; that is a backend
  concern. `lifecycleStatusOf` is one pure function with a table-driven test and a spec pointer.
- **Risk (UX):** a loan whose on-chain status is `Approved`/`Default`/`Closed`, or a stale backend
  that does not serve the field, opens with no preselected status, so the trustee makes one extra
  click. This is deliberate: an extra click is better than an unintended on-chain write.
- **Risk:** the hero chip is still used for layout (`variant`). Only the selector default changes,
  so no layout regression is expected.
- The route test mocks `useLoanDetail` (`makeResult`), so adding a required field to
  `UseLoanDetailResult` needs `makeResult` updated or `tsc` fails.
- No dependency on other open issues or PRs. The branch `fix/1621-lifecycle-status-default` has
  main merged in at 84bd4d20 (includes #1654).

## Open Questions

Resolved by backend #1649 / #1654: the raw status is served as `onchain_status`, so the
`watchlist_entered_at` inference and the Disbursing/Past Due unknown fallback are dropped.

## Implementation Steps

1. `packages/trustee/src/api/useLoanBook.ts`, `useLoanFinancials.ts`: add `onchain_status: string`
   to `LoanBookEntry` and `LoanFinancialsResponse` (hand-written types); add it to the test fixtures.
   `packages/trustee/src/routes/-useLoanDetail.ts`
   - Add exported type `LifecycleStatus = "Performing" | "WatchList"`.
   - Add exported pure function
     `lifecycleStatusOf(entry: LoanBookEntry | undefined | null): LifecycleStatus | null` returning
     `entry.onchain_status` when it is `Performing` or `WatchList`, else `null`.
   - Add `lifecycleStatus: LifecycleStatus | null` to `UseLoanDetailResult`, and return
     `lifecycleStatus: lifecycleStatusOf(entry)` from `useLoanDetail`.
2. `packages/trustee/src/routes/loans.$id.tsx`
   - `UpdateLifecycleDialog`: change prop `currentStatus: string` to
     `currentStatus: LifecycleStatus | null` (import the type from `./-useLoanDetail`). Initialise
     and reset state with `currentStatus ?? ""` (both the `useState` initialiser and the `open`
     effect).
   - Selector: when `status === ""`, render a leading
     `<option value="" disabled>Select status</option>` so the select shows an empty choice.
     Keep the two existing options (`Performing` "Active", `WatchList` "Watchlist").
   - Validity: add `status !== ""` to `valid`, so **Confirm update** stays disabled until a
     status is chosen in the unknown case.
   - Remove the field-level JSDoc on `currentStatus` (comment-minimal rule), or update it to
     match if the lint baseline requires it. Do not add new narrative comments.
   - Route body (~L1444): replace the chip-derived expression with
     `currentStatus={detail.lifecycleStatus}`. Shorten or remove the narrative JSX comment above
     the dialog only if `lint-comments` flags it. Do not add new comments.
3. Run `npx tsx scripts/lint-comments.ts`. If `loans.$id.tsx` or `-useLoanDetail.ts` is listed in
   `scripts/lint-comments.baseline.json`, shrink their counts to match (AGENTS.md rule).
4. `docs/frontend/trustee-flows.md` § wired actions, **Update lifecycle** bullet: add the
   `onchain_status` selector-default rule and the unknown → explicit-choice rule. Reference #1621.
5. User-stories doc `docs/user-stories/epic-1521/1621-lifecycle-status-default.md`, linked from
   `docs/user-stories/index.md`.

## Test Strategy

- `packages/trustee/src/routes/-useLoanDetail.test.ts`: a table-driven `describe("lifecycleStatusOf (#1621)")`:
  `Performing` / `WatchList` on-chain with Performing, Past Due, Disbursing and Matured display
  statuses; `Default` / `Closed` / `Approved` / `Unknown` → `null`; `watchlist_entered_at` ignored;
  missing field, `undefined` and `null` entry → `null`.
- `packages/trustee/src/routes/-useLoanDetail-hook.test.ts`: `status: "Past Due"`,
  `onchain_status: "WatchList"` gives `lifecycleStatus === "WatchList"` and `variant === "matured"`.
- `packages/trustee/src/routes/-loans.$id.test.tsx`: add `lifecycleStatus: "Performing"` to
  `makeResult`. In `describe("Loan detail route — Update lifecycle (#872)")`, add:
  - **Acceptance 1:** `variant: "matured"`, hero chip `Matured`, `lifecycleStatus: "WatchList"`.
    Opening the dialog shows `update-lifecycle-status` with value `WatchList`. Same for
    `variant: "disbursing"`, hero chip `Disbursing`.
  - **Acceptance 2:** for the matured case, fill only CCR and location (do not touch the selector),
    then submit. `mockUpdateLifecycle.mutateAsync` is called with `status: "WatchList"`.
  - **Unknown:** `lifecycleStatus: null` (on-chain `Approved`/`Default`/`Closed` or missing). The selector value is `""`, and Submit is disabled even
    after CCR and location are filled. After choosing `Performing`, Submit is enabled and submits
    `status: "Performing"`.
  - The existing tests (open, error, explicit WatchList submit) still pass unchanged.
- Commands: `yarn workspace @pipeline/trustee test`, `yarn workspace @pipeline/trustee build`
  (tsc), `yarn workspace @pipeline/trustee lint`, `npx tsx scripts/lint-docs.ts`,
  `npx tsx scripts/lint-comments.ts`.
- Manual check (user-run; do not drive their browser): on staging, open a WatchList loan that
  shows as Past Due or Disbursing. Update lifecycle preselects Watchlist. A Past Due Performing
  loan opens with "Select status" and a disabled Confirm until a status is picked.

## Docs to Update

- `docs/frontend/trustee-flows.md` § wired actions, Update lifecycle bullet (step 4).
- User-stories doc and index row (step 5).
- No product-spec change: `trustee-risk-watchlist.md` already treats status as the on-chain value
  and Past Due as derived. This fix makes the UI follow it.
- If the follow-up is wanted, log "S10: disable selector on Disbursing (design doc v3)" in
  `docs/exec-plans/tech-debt-tracker.md` rather than doing it here.
