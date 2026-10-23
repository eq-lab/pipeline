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
   in `useLoanDetail` from served fields only, and expose it as a new `lifecycleStatus` field on
   `UseLoanDetailResult`.
2. Default the dialog's selector to that status instead of the display chip.
3. When the current on-chain status cannot be established from served data, preselect **nothing**
   and keep **Confirm update** disabled until the trustee picks a status explicitly. A silent
   default is never written.
4. Tests and the `trustee-flows.md` wired-actions bullet.

How the raw status is obtained (no backend change): neither `GET /v1/loan-book` (`entry.status`)
nor `GET …/financials` (`status`) serves the raw snapshot status. Both pass through
`display_status`. The one served field that tracks the raw status is `watchlist_entered_at` (and
`days_on_watchlist`). `loan_book.rs` ~L1452 sets it **only** when the raw snapshot status is
`WatchList` (`(s.status == "WatchList").then(...)`), and leaves it `null` otherwise. The mapping:

| served `entry.status` | `watchlist_entered_at` | `lifecycleStatus` |
| :-- | :-- | :-- |
| `Performing` | any | `Performing` |
| `WatchList` / `Watchlist` | any | `WatchList` |
| `Disbursing` / `Past Due` / `Matured` | non-null | `WatchList` |
| `Disbursing` / `Past Due` / `Matured` | null | `null` (unknown → explicit choice) |
| `Default` / `Closed` / anything else / no entry | any | `null` |

When the masked status (`Disbursing`/`Past Due`) has a null `watchlist_entered_at`, the raw status
is almost always `Performing`. The backend documents one rare exception: a WatchList loan with no
indexed transition event also has a null `watchlist_entered_at`. That exception is the same bug
class as this issue, so the plan treats this case as unknown and requires an explicit choice
rather than assuming `Performing`. If a backend raw-status field is added later (see Open
Questions), `lifecycleStatusOf` switches to it and the unknown case disappears.

"Require an explicit choice when it differs from the current status" (from the issue), decided
from the specs:
- When the default is the current on-chain status, the value can only differ through a deliberate
  user change. No spec asks for an extra confirmation on that change. `trustee-risk-watchlist.md`
  § Return to Performing says the Watchlist exit is "one button, instant", and design doc v3 S10
  puts a confirm gate only on choosing Past Due, which is not settable here
  (`trustee-risk-watchlist.md` § Past Due and `trustee-flows.md` § wired actions).
- So the explicit-choice requirement applies **only** to the *unknown current status* case
  (item 3). No additional confirm step is added for a deliberate change.

Out of scope:
- Any backend/API change, such as serving the raw snapshot status. See Open Questions.
- Disabling the selector on a Disbursing loan (design doc v3 S10: "On a Disbursing loan the
  selector is disabled"). `docs/frontend/trustee-flows.md` does not specify this and it is a
  separate behavior change. Note it as a possible follow-up, not part of this fix.
- Settable Past Due (v3 S10). It conflicts with `trustee-risk-watchlist.md`, the source of truth,
  which says Past Due is derived and not settable.
- Changing the dialog's other fields, its layout, or Figma styling.

## Assumptions and Risks

- **Assumption:** `watchlist_entered_at != null` ⇔ the raw snapshot status is `WatchList` (when the
  transition event is indexed). This holds per the code at `loan_book.rs` ~L1449-1453 and the field
  doc on `LoanBookEntry.watchlist_entered_at`. If the backend later changes that field's semantics
  (for example, to keep it after the loan leaves WatchList), the mapping breaks silently. Mitigation:
  `lifecycleStatusOf` is one pure function with a table-driven test and a spec pointer, so a
  backend change has one place to update.
- **Risk (UX):** every `Past Due`/`Disbursing` loan that is raw `Performing` and has no
  `watchlist_entered_at` opens with no preselected status, so the trustee makes one extra click.
  This is deliberate: an extra click is better than an unintended on-chain write. If the human
  prefers `Performing` as the default there, it is a one-line change (see Open Questions).
- **Risk:** the hero chip is still used for layout (`variant`). Only the selector default changes,
  so no layout regression is expected.
- The route test mocks `useLoanDetail` (`makeResult`), so adding a required field to
  `UseLoanDetailResult` needs `makeResult` updated or `tsc` fails.
- No dependency on other open issues or PRs. The branch `fix/1621-lifecycle-status-default` is
  based on main at e74b5a2b.

## Open Questions

- Source of the current on-chain status: is it acceptable to infer it from the served
  `watchlist_entered_at` (frontend-only, the planned approach), or should a backend issue be filed
  to serve the raw snapshot status (for example, an `onchain_status` field on `LoanBookEntry` and
  `…/financials`) so the frontend reads it directly and the "unknown → explicit choice" fallback
  is never hit? This plan can go ahead as written. A backend field would only replace the body of
  `lifecycleStatusOf`.
- For a `Past Due`/`Disbursing` loan with null `watchlist_entered_at` (almost always raw
  `Performing`), should the selector stay empty and require an explicit choice (planned, the
  safest option), or preselect `Performing`?

## Implementation Steps

1. `packages/trustee/src/routes/-useLoanDetail.ts`
   - Add exported type `LifecycleStatus = "Performing" | "WatchList"`.
   - Add exported pure function
     `lifecycleStatusOf(entry: LoanBookEntry | undefined | null): LifecycleStatus | null`. It
     implements the mapping table in **Scope** exactly: `Performing` → `Performing`;
     `WatchList`/`Watchlist` → `WatchList`; `Disbursing`/`Past Due`/`Matured` →
     `entry.watchlist_entered_at != null ? "WatchList" : null`; everything else → `null`. No
     comments beyond what the file header allows. Put the substance in the spec (step 4).
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
   selector-default rule. The selector defaults to the loan's current on-chain status, never the
   display chip (Disbursing/Past Due mask a WatchList loan). Document the `lifecycleStatusOf`
   mapping (raw WatchList detected via the served `watchlist_entered_at` while the display status
   is masked), and the rule that an undeterminable status preselects nothing and blocks Confirm
   until the trustee chooses. Reference #1621.

## Test Strategy

- `packages/trustee/src/routes/-useLoanDetail.test.ts`: a table-driven `describe("lifecycleStatusOf (#1621)")`
  covering every row of the Scope table:
  `Performing` → `Performing`; `WatchList` and `Watchlist` → `WatchList`; `Past Due` + non-null
  `watchlist_entered_at` → `WatchList`; `Disbursing` + non-null → `WatchList`; `Matured` + non-null
  → `WatchList`; `Past Due`/`Disbursing` + null → `null`; `Default`/`Closed` → `null`;
  `undefined` entry → `null`. Plus one case that `Performing` with a stray non-null
  `watchlist_entered_at` stays `Performing` (the served status wins when it is not masked).
- `packages/trustee/src/routes/-useLoanDetail-hook.test.ts`: one hook-level case. A loan-book
  entry `status: "Past Due"`, `watchlist_entered_at: <ts>` gives `result.lifecycleStatus === "WatchList"`
  and `variant === "matured"`.
- `packages/trustee/src/routes/-loans.$id.test.tsx`: add `lifecycleStatus: "Performing"` to
  `makeResult`. In `describe("Loan detail route — Update lifecycle (#872)")`, add:
  - **Acceptance 1:** `variant: "matured"`, hero chip `Matured`, `lifecycleStatus: "WatchList"`.
    Opening the dialog shows `update-lifecycle-status` with value `WatchList`. Same for
    `variant: "disbursing"`, hero chip `Disbursing`.
  - **Acceptance 2:** for the matured case, fill only CCR and location (do not touch the selector),
    then submit. `mockUpdateLifecycle.mutateAsync` is called with `status: "WatchList"`.
  - **Unknown:** `lifecycleStatus: null`. The selector value is `""`, and Submit is disabled even
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
- No product-spec change: `trustee-risk-watchlist.md` already treats status as the on-chain value
  and Past Due as derived. This fix makes the UI follow it.
- If the follow-up is wanted, log "S10: disable selector on Disbursing (design doc v3)" in
  `docs/exec-plans/tech-debt-tracker.md` rather than doing it here.
