# Issue #261: /transactions: show full empty state on per-tab empty results, not just text

Source: https://github.com/eq-lab/pipeline/issues/261

## Scope

Collapse the two distinct empty-state branches added in #257 into a single branch on `/transactions`. After this change, the page renders the full `EmptyState` (`ActivityEmptyIllustration` + caption `"You will see all transactions here"`) for **any** case where `filtered.length === 0` — whether that's because the wallet is disconnected, the API returned zero rows wallet-wide, or the active tab simply has no matching rows.

This is a **deliberate reversal** of part of #257: the per-tab muted text branch (`"No {tab} activity yet"`) is removed. Document the reversal in code comments and in the PR description so the split is not re-introduced.

Files in scope:

- `packages/frontend/src/routes/transactions.tsx` — collapse `shouldRenderWalletEmpty` + `shouldRenderTabEmpty` into a single `shouldRenderEmpty` (or inline check); drop the muted-text JSX block; update the leading JSDoc.
- `packages/frontend/src/routes/-transactions.test.tsx` — update the tab-level-empty describe to assert the illustration + caption render; keep wallet-level-empty and disconnected assertions intact; update the file's top-of-file scenario list comment.

Out of scope:

- Caption-text-per-tab variants (e.g. `"You will see all Sell activity here"`). The single neutral caption is sufficient.
- Adding a CTA in the empty state.
- Changes to `RecentActivityCard`, the loading branch, or the error/Retry branch.
- Changes to the `/test` Mocks tab — the existing scenarios already drive `/transactions` through the API mock and don't depend on the tab-level branch text.

## Assumptions and Risks

- The implementation pattern is fully specified by the Issue body — including the exact JSX snippet to land. No new design or product decision is required.
- The `min-h-[400px]` flex-centered wrapper already used for the wallet-level branch is the correct container for the unified empty state (it produced a PASS in TC-257-1, per `docs/QUALITY_SCORE.md`).
- The existing tab-level-empty tests currently assert `"No Sell activity yet"` is present and the illustration caption is **absent** — both assertions must flip in this patch (caption present, "No ... activity yet" absent). Forgetting to delete the negative caption assertion would silently keep the old expectation green if the branch text were ever re-added.
- The disconnected-wallet and zero-rows tests assert the caption renders; they remain correct without modification once the single empty branch is in place.
- Risk: a stray `activeTabLabel` computation can be left behind and trip an unused-variable lint after the text branch is removed. The plan calls it out so the coder removes the now-unused local.
- Risk: an outdated inline comment in `transactions.tsx` (the JSDoc that documents "two distinct empty cases") would mislead future readers if not rewritten in the same patch.
- No dependency on unmerged work. #257 is merged and archived in `docs/exec-plans/completed/issue-257-transactions-empty-state.md`.

## Open Questions

_None_

## Implementation Steps

1. **Update `packages/frontend/src/routes/transactions.tsx`:**
   - Replace the two boolean computations:
     ```ts
     const shouldRenderWalletEmpty =
       !isLoading && !error && (!isConnected || data?.requests.length === 0);
     const shouldRenderTabEmpty =
       !!data && data.requests.length > 0 && filtered.length === 0;
     const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label ?? "";
     ```
     with a single computation:
     ```ts
     const shouldRenderEmpty =
       !isLoading && !error && (!isConnected || filtered.length === 0);
     ```
     This collapses all three "no rows visible right now" cases (disconnected, wallet-wide empty, tab-filter empty) into one branch. `activeTabLabel` becomes unused — delete the local.
   - Remove the per-tab muted-text JSX block (the `{shouldRenderTabEmpty && (...)}` block — currently lines 121–125 — that renders `No {activeTabLabel} activity yet`).
   - Rename the surviving `{shouldRenderWalletEmpty && (...)}` block to use `shouldRenderEmpty`. Keep the `min-h-[400px] flex-col items-center justify-center` wrapper and the `EmptyState` props verbatim:
     ```tsx
     {shouldRenderEmpty && (
       <div className="flex min-h-[400px] flex-col items-center justify-center">
         <EmptyState
           illustration={<ActivityEmptyIllustration tone="muted" width={240} />}
           caption="You will see all transactions here"
         />
       </div>
     )}
     ```
   - Update the file's leading JSDoc block (currently the "Empty-state behaviour (two distinct cases)" paragraph at lines 26–33). Rewrite to a single paragraph: "Empty-state behaviour: the full `EmptyState` illustration + caption renders whenever the visible row count is zero — whether the wallet is disconnected, the API returned zero rows, or the active tab filter yields zero rows. The intent is a single consistent visual rather than a different treatment per cause (a deliberate reversal of part of #257)."
   - Leave the loading branch, the error/Retry branch, and the `filtered.length > 0` mapping branch untouched.

2. **Update `packages/frontend/src/routes/-transactions.test.tsx`:**
   - Update the top-of-file scenario list comment (lines 11–23) so item 6 reads: `Tab-level empty (API has rows but active tab yields zero) → illustration + caption render, "No {tab} activity yet" absent.` (i.e. flip from "muted text line" to "illustration").
   - In the `describe("Transactions page — tab-level empty state", ...)` block (currently lines 234–281):
     - Keep the same fixture (one Deposit row) and the same tab-click flow.
     - Replace the assertion `expect(screen.getByText("No Sell activity yet")).toBeInTheDocument();` with `expect(screen.getByText("You will see all transactions here")).toBeInTheDocument();`.
     - Replace the assertion `expect(screen.queryByText("You will see all transactions here")).not.toBeInTheDocument();` with `expect(screen.queryByText(/No Sell activity yet/i)).not.toBeInTheDocument();` (so the stale per-tab text is provably gone).
     - Rename the `it(...)` titles to reflect the new behaviour, e.g. `"renders the illustration + caption when Sell tab has no rows"` and `"does not render the stale 'No Sell activity yet' text"`.
   - The `describe("Transactions page — wallet-level empty state (zero rows)", ...)` and `describe("Transactions page — disconnected wallet (no data)", ...)` blocks already assert the caption renders — leave them as-is.
   - No new mocks needed; `vi.mock("@/wallet", ...)` and `vi.mock("@/api", ...)` are already wired.

3. **Validate (per `AGENTS.md`):**
   - `yarn workspace @pipeline/frontend test -- -t transactions` — all transactions describes green.
   - `yarn lint` / `npx tsx scripts/lint-docs.ts` clean.
   - `yarn build` (frontend) — TypeScript clean; confirms the removed `activeTabLabel` local is not referenced elsewhere.

4. **ux-tester pass (Figma-driven):**
   - Figma reference: [1993:9144](https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-9144&m=dev).
   - Activate a mock that puts one Deposit row in `/v1/requests` (e.g. existing "Historical deposits/withdrawals" scenario on `/test`), navigate to `/transactions`, click each empty tab (Sell, Stake, Unstake), and confirm the striped-clock illustration + `"You will see all transactions here"` caption renders identically to the disconnected and zero-rows cases.
   - Re-confirm the previously-PASS scenarios from #257 (disconnected → empty; connected + zero rows → empty) still render correctly.

## Test Strategy

Vitest changes in `-transactions.test.tsx`:

- **Tab-level empty (new behaviour):** mock one Deposit row, click the Sell tab, assert `"You will see all transactions here"` is in the document AND `/No Sell activity yet/i` is **not** in the document. This is the load-bearing assertion for this Issue.
- **Wallet-level empty (zero rows) — regression:** already covered; no change. Still asserts the caption renders.
- **Wallet-level empty (disconnected) — regression:** already covered; no change. Still asserts the caption renders.
- **Default Buy tab / tab switching / formatting / loading / error — regression:** already covered; no change expected. These should all stay green because the only branch removed is the per-tab muted-text one, which they don't touch.

Edge cases worth explicit assertions:

- After switching to an empty tab, the wrapper container still applies `min-h-[400px]` (already implicit in the unified branch — covered by the existing wallet-empty test's reliance on the same wrapper).
- The illustration is decorative; assert on the caption text rather than the SVG (consistent with #257's approach).

Manual / ux-tester pass: scripted above under step 4. The acceptance criterion is "same striped-clock illustration on Sell/Stake/Unstake tabs as on the disconnected page, against Figma 1993:9144".

## Docs to Update

- `docs/exec-plans/active/issue-261-transactions-tab-empty-illustration.md` — this plan.
- `docs/STORIES.md` — extend the `/transactions` story bank to cover the new "per-tab empty renders illustration" case (a small addition to TC-257-* or a new TC-261-1). ux-tester will draft and land this entry as part of the manual pass.
- `docs/QUALITY_SCORE.md` — append a `### 2026-05-18 — Issue #261` entry recording the PASS/FAIL of the per-tab-empty illustration case. ux-tester writes this entry.
- `docs/product-specs/` — no update required. The Issue is a visual-polish reversal of a previous design decision and does not change documented product behaviour. The `/transactions` empty state's product intent (a single illustration-driven empty surface) is consistent with `RecentActivityCard` and already implied by the design language.
- No update to `docs/design-docs/`. The Figma reference (1993:9144) is unchanged — only the conditions under which we render it broaden.
- No new entries in `docs/exec-plans/known-bugs.md` or `docs/exec-plans/tech-debt-tracker.md` are anticipated. If the coder finds latent issues during implementation (e.g. an unrelated render glitch), log them per the standard `AGENTS.md` rules instead of fixing inline.
