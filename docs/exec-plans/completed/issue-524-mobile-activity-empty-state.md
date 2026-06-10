# Issue #524: [FE] Mobile Activity page: empty state

Source: https://github.com/eq-lab/pipeline/issues/524

## Scope

Adapt the Activity page (`/transactions`) **empty state** to the mobile breakpoint per the mobile Figma frame `1993-9958` (402×874). The empty state is the centred striped `ActivityEmptyIllustration` plus the caption "You will see all transactions here", rendered whenever the visible row count is zero (wallet disconnected, API returned zero rows, or the active tab filter yields zero).

The empty-state markup already exists in `packages/frontend/src/routes/transactions.tsx` (the `shouldRenderEmpty` block, lines 103–112) and was built for desktop frame `1497-94912`. This task confirms/adjusts that block for the mobile frame and ensures its sizing/spacing works inside the mobile page shell.

**Critical dependency on #523.** The shared mobile chrome that this frame depends on — the responsive `ActivityHeader` (left-aligned "Activity", icon hidden on mobile) and the 8px (`px-2`) mobile side margins on the `<main>` wrapper in `transactions.tsx` — is delivered by sibling issue #523, not here. #523 is currently **planned but PARKED** awaiting human input (see Open Questions / Assumptions). This task must **not** re-plan or re-implement the header or the page-margin change; it consumes them.

### In scope

- Verify the existing `EmptyState` + `ActivityEmptyIllustration` block renders correctly at the 386px mobile content width and matches frame `1993-9958` (illustration centred, 240×240; caption centred beneath).
- Adjust **only** the empty-state container's sizing/spacing if it does not match the mobile frame (e.g. the `min-h-[400px]` vertical centering wrapper, the gap between illustration and caption, illustration `width`). Any change stays token/utility-driven (no raw pixels beyond Tailwind utilities already in use).
- Add/extend a mobile-width regression assertion for the empty state in `-transactions.test.tsx`.

### Out of scope

- **`ActivityHeader` responsiveness and the `px-2` page margins** — owned by #523. Do not touch `ActivityHeader.tsx` or the `<main>` className here.
- **The "All" tab** — intentionally absent (deliberately removed; see the comment in `transactions.tsx` and #257). The mobile frame shows a leading "All" tab; ignore it. Tabs stay Buy / Sell / Stake / Unstake, default Buy.
- The global app top bar (logo + menu, Figma node `1993:9970`) — existing shell, not this page.
- Any data-fetching / `shouldRenderEmpty` logic change — the single-consistent-visual behaviour (disconnected, wallet-empty, tab-empty all show the same empty state) is already implemented and must be preserved.
- Row visuals and the with-data layout — sibling #523.

## Assumptions and Risks

- **Assumption:** the empty-state visual itself needs little or no code change. The desktop route already renders `EmptyState` with `ActivityEmptyIllustration tone="muted" width={240}` and the exact caption, centred via `flex min-h-[400px] flex-col items-center justify-center`. The Figma mobile `Placeholder` (node `1993:10104`) is 386 wide × 284 tall with a 240×240 `IMG` centred (x=73 = (386−240)/2) and the caption text below it. A 240px illustration fits inside the 386px mobile content box, so the existing block should already match. The coder must verify visually and only adjust if there is a concrete mismatch.
- **Risk — sequencing.** Until #523 merges, the mobile header is still centred-with-icon and there are no `px-2` margins, so the page will not match the mobile frame even though the empty block is correct. **This task should be implemented on top of #523** (rebase onto / branch after #523's branch `feat/523-mobile-activity-with-data`, or implement after #523 merges to `main`). If implemented in parallel, the coder must be aware the header/margins will look wrong locally and that those parts belong to #523. Recommended: the manager sequences #524 after #523 is unparked and merged.
- **Risk — heading weight open question (inherited from #523).** #523 has an unresolved question about whether the "Activity" heading should switch from Besley Bold (700) to Regular (400). That heading is shared chrome rendered above the empty state too, so whatever weight #523 lands applies here automatically — **#524 introduces no separate decision and must not re-litigate it.** The empty frame `1993-9958` shows the same lighter serif weight as the with-data frame, consistent with #523's recommendation; no additional input is needed from #524's side. (See Open Questions.)
- **Risk — vertical placement.** In the Figma frame the illustration starts directly under the tabs (Placeholder y=120 within the Section, i.e. ~24px below the 36px tab bar) rather than being vertically centred in the remaining viewport. The current desktop block uses `min-h-[400px] ... justify-center`, which centres within a 400px box. The coder should compare against the frame; if the mobile frame wants the illustration anchored near the top (just below the tabs) rather than vertically centred, adjust the wrapper (e.g. drop/relax `min-h-[400px]` or change `justify-center` to top alignment) — but keep desktop frame `1497-94912` unchanged (gate any change behind a responsive utility if it would alter desktop).
- **Assumption:** `EmptyState` and `ActivityEmptyIllustration` are `@pipeline/ui` primitives reused by `RecentActivityCard` (dashboard). Any change to those shared components would regress the dashboard, so prefer changing only the **call site** wrapper in `transactions.tsx`; do not edit the shared components unless a mobile defect is intrinsic to them (it should not be — they are size-agnostic).

## Open Questions

_None._ — The only genuine uncertainty (heading font weight) is already owned by #523's Open Question and resolves the same way for this shared heading; #524 adds no new decision. The illustration/caption block is already implemented and token-clean. Remaining choices (exact vertical anchoring of the illustration) are concrete visual-match adjustments the coder makes against frame `1993-9958`, not decisions requiring human input. Note for the manager: this task is **dependency-gated on #523** (sequence after it), which is a scheduling fact, not an open question.

## Implementation Steps

1. **Sequence after #523.** Branch `feat/524-mobile-activity-empty-state` should be created from #523's branch (or from `main` once #523 is merged) so the responsive `ActivityHeader` and `px-2` page margins are present. Do not duplicate those changes.

2. **Verify the empty-state block against the mobile frame** — `packages/frontend/src/routes/transactions.tsx`, lines 103–112 (the `shouldRenderEmpty` block):
   - Run the app at 402×874 and reach the empty state via the `/test` Mocks tab (clear mocks / disconnected wallet, or pick a tab with no matching rows). See `packages/frontend/src/routes/test/-scenarios.ts` for available scenarios.
   - Compare against Figma frame `1993-9958` (Placeholder node `1993:10104`): 240×240 striped illustration centred horizontally in the 386px content box, muted tone, caption "You will see all transactions here" centred beneath.

3. **Adjust the empty-state wrapper only if there is a concrete mismatch:**
   - Vertical placement — if the frame anchors the illustration just below the tabs rather than centring it in a 400px box, relax the wrapper centering (e.g. replace `min-h-[400px] ... justify-center` with top-aligned spacing). Use responsive utilities so the desktop frame `1497-94912` is unchanged if the desktop treatment differs.
   - Illustration width — keep `width={240}` (matches the Figma `IMG` slot at both breakpoints) unless the frame shows otherwise.
   - Gap between illustration and caption — `EmptyState` currently enforces no gap (illustration intrinsic height drives spacing). Match the frame; if a gap is needed, add it at the call site, not by editing the shared `EmptyState`.
   - Keep all values token/Tailwind-utility driven; add no raw colors, font names, or one-off pixel literals beyond standard Tailwind spacing utilities.

4. **Update the block comment** in `transactions.tsx` (the leading JSDoc and/or the inline comment on the empty-state block) to note the empty state is verified against the mobile frame `1993-9958` in addition to the existing desktop frame `1497-94912`. Do not duplicate #523's header/margin comments.

5. **No logic changes.** `shouldRenderEmpty`, tab filtering, `TABS`, and the `useRequests` wiring stay exactly as-is. The single-consistent-empty-visual behaviour (disconnected / wallet-empty / tab-empty) is preserved.

## Test Strategy

The empty state is CSS/layout-driven, so the primary verification is visual against Figma; unit tests guard structure and the no-regression contract. The existing `-transactions.test.tsx` already covers the three empty-state causes (wallet-empty rows, disconnected, tab-empty) asserting the caption renders — those must continue to pass unchanged.

1. **Preserve existing empty-state tests** — `packages/frontend/src/routes/-transactions.test.tsx` scenarios 4/5/6 (wallet-level empty, disconnected, tab-level empty) and the "No activity yet"/"No Sell activity yet" negative assertions must all still pass.
2. **Add a mobile-layout regression assertion** for the empty state, if the wrapper className changes in Step 3 — assert the empty-state container carries the expected responsive class(es) (e.g. the chosen vertical-anchor utility) so the mobile treatment is regression-guarded. If Step 3 makes no className change, no new unit test is required and this is documented in the PR.
3. **Run the suites:** the frontend unit suite (vitest) for `-transactions.test.tsx`, plus `npx tsx scripts/lint-docs.ts` for docs. Fix all lint before handoff.
4. **Figma visual verification (manual, by the coder), at 402×874, against frame `1993-9958`:**
   - Left-aligned "Activity" heading, no icon (inherited from #523).
   - Tabs Buy / Sell / Stake / Unstake, **no "All"**, Buy active by default.
   - 8px side margins (inherited from #523).
   - Striped illustration centred (240×240, muted), caption "You will see all transactions here" centred beneath, positioned per the frame.
   - Reach the empty state via every cause: disconnected wallet, wallet-empty (zero rows), and a tab filter that yields zero rows — confirm the same single visual in all three.
   - Confirm the desktop empty view at `1497-94912` is visually unchanged.

## Docs to Update

- No product-spec change: `docs/product-specs/dashboards.md` describes the LP transaction history at the behaviour level (the "Transaction history" bullet); this task is a pure responsive-layout adaptation of an existing empty state with no behaviour change.
- Update the block comment in `transactions.tsx` to cite the mobile empty frame `1993-9958` (covered in Implementation Step 4).
- `docs/FRONTEND.md` / `docs/frontend/index.md`: only touch if they enumerate per-page responsive status; otherwise no change (coder to check; not expected).
