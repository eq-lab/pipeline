# Issue #563: Connect Wallet modal: make it fullscreen (full-viewport two-pane layout)

Source: https://github.com/eq-lab/pipeline/issues/563

## Scope

UX-review bug under epic #556 (Connect page), child of #558. Today `ConnectWalletModal.tsx`
renders as a centered ~800×600 rounded card floating on a semi-transparent scrim. The Figma
design (node `2858-57637`, frame 1728×916) is a **full-viewport, two-equal-pane layout**:

- Left pane (≈50% / 864px, full viewport height): light background `#f8f7f6`
  (= `--color-pipeline-paper`), vertically-centered "Connect Wallet" heading + tab control +
  wallet list.
- Right pane (≈50% / 864px, full viewport height): full-bleed image area.
- Close (×) at the very top-right of the viewport.
- No rounded card, no centered floating box, no surrounding scrim/backdrop.

**In scope**

- Convert the modal panel from a centered 800×600 rounded card on a scrim into a
  full-viewport overlay: panel fills the screen (`inset-0`, full width/height), 32px radius
  removed, scrim/centering treatment removed, two panes become two equal full-height columns.
- Keep it a dismissable **modal overlay** (per the #558 human decision to keep it a modal, not
  a `/connect` route), rendered via `createPortal` into `document.body` as today.
- Preserve close (×) and Escape dismissal, focus trap, and body-scroll lock.
- Mobile: full-viewport single column (left pane only), right image pane stays hidden below
  `lg` (it already is, via `RightImagePanel`'s `hidden ... lg:flex`).

**Out of scope**

- The right-pane hero photo (currently a gradient placeholder) — tracked separately in **#564**.
  Do NOT change the image asset here; only its container sizing changes as a consequence of the
  pane becoming full-height.
- Tab set, wallet catalogue, per-wallet connect logic, "Show More" — all unchanged from #558.
- Any new route. Modal-only, per #558.

## Assumptions and Risks

- **Token reuse**: `--color-pipeline-paper` is already `#f8f7f6` (`packages/ui/src/styles/theme.css`
  L75/138), matching the Figma left-pane background — no new color needed.
- **Backdrop dismissal**: today an outer scrim div (`data-testid="connect-wallet-modal-scrim"`)
  handles click-to-dismiss. A true full-viewport modal has no visible scrim margin, so there is
  no empty backdrop region left to click. Click-to-dismiss-on-backdrop effectively goes away;
  dismissal is via × and Escape only. This matches the Figma (no scrim) and is called out in
  Open Questions. The existing test `"scrim click calls onDismiss"` in
  `ConnectWalletModal.test.tsx` (L310) will need updating/removal accordingly.
- **Test coupling**: `ConnectWalletModal.test.tsx` (21 tests) and `TopBar.test.tsx` reference
  the modal. Layout-class assertions and the scrim test may break; coder must update them.
- The change is small and confined to the JSX of the outer overlay container and the two pane
  wrappers (roughly L523–L545 plus the left pane wrapper L549 and `RightImagePanel` L352). No
  hook/connection logic changes.
- Risk: vertical centering of left-pane content on very short viewports — keep the left pane
  scrollable (`overflow-y-auto`) so content is reachable when the viewport is shorter than the
  content.

## Open Questions

- **Backdrop/scrim dismissal**: A full-viewport modal removes the visible scrim, so click-outside
  dismissal no longer has a target. Plan assumes dismissal is via × and Escape only (matches
  Figma's no-scrim design). Confirm this is acceptable, or whether the empty right/left area
  should also dismiss on click. _Recommended: × + Escape only._
- Mobile behaviour, modal-vs-route, and × + Escape are all resolved per the issue body and the
  #558 human decisions (mobile = fullscreen single column with the picture pane dropped; remains
  a dismissable modal overlay; × + Escape dismiss retained). No open question on those.

## Implementation Steps

All changes in `packages/frontend/src/components/ConnectWalletModal.tsx`.

1. **Outer overlay container** (currently L525–530): change from a centered, scrim-colored
   flex container to a full-viewport surface.
   - Replace `flex items-center justify-center` + `style={{ backgroundColor: "rgba(56,55,53,0.6)" }}`
     with a plain `fixed inset-0 z-[9999] flex` (no scrim background; the panel itself fills it).
   - Decide on the scrim element: either drop the wrapper entirely and make the panel the direct
     portal child, or keep a transparent wrapper. Removing the `onClick={handleScrimClick}` /
     `data-testid="connect-wallet-modal-scrim"` backdrop-dismiss is expected (see Open Questions);
     remove the now-unused `handleScrimClick` callback.

2. **Modal panel** (currently L532–546): make it fill the viewport.
   - Remove `w-full max-w-[calc(100vw-32px)] lg:max-w-[800px]`, `max-h-[90vh] lg:max-h-[600px]`,
     and `rounded-[32px]`.
   - Use `h-full w-full` (panel fills the `inset-0` overlay). Keep `relative flex overflow-hidden`
     and `bg-[var(--color-pipeline-paper)]`. Keep `role="dialog" aria-modal="true"` and
     `aria-labelledby`.
   - Keep `data-testid="connect-wallet-modal"`.

3. **Left pane wrapper** (currently L549): ensure it is one equal half on desktop and full width
   on mobile, full height, with vertically-centered content.
   - `flex flex-1 flex-col items-center justify-center overflow-y-auto` (full-height column, content
     centered, scroll fallback). On `lg`, the right pane takes the other half so `flex-1` yields the
     two equal panes. Keep inner `max-w-[400px]` content column and existing padding.

4. **Right image pane** (`RightImagePanel`, L349–415): already `hidden h-full flex-1 ... lg:flex`.
   Confirm it remains `flex-1 h-full` so it forms the second equal pane at full viewport height.
   Do NOT touch the placeholder gradient/photo (that is #564).

5. **Close (×) button** (L626–640): keep top-right; it is already `absolute right-4 top-4` on the
   panel, which now equals the top-right of the viewport. Optionally nudge offset to match Figma
   spacing if visibly off after the layout change.

6. Run lint/format and the frontend test suite; fix fallout (see Test Strategy).

## Test Strategy

- Update `packages/frontend/src/components/ConnectWalletModal.test.tsx`:
  - Remove or rewrite the `"scrim click calls onDismiss"` test (L310) since backdrop-click
    dismissal is removed; keep/verify the Escape and × dismissal tests.
  - Update any assertions tied to the old card sizing/scrim classes; assert the panel renders
    full-viewport (e.g. presence of `inset-0`/`h-full w-full` on the container, no
    `max-w-[800px]`/`rounded-[32px]`). Prefer behavioral assertions over class-string matching
    where possible.
  - Keep coverage for: tab switching, wallet rows, Show More threshold, focus trap, body-scroll
    lock, Escape, × dismiss.
- Update `packages/frontend/src/components/TopBar.test.tsx` if it asserts on removed scrim/testid.
- Run the fast frontend suite (`/test-fast`) and `npx tsx scripts/lint-docs.ts`.
- **Figma verification**: with the dev server running, open the modal and visually compare against
  Figma node `2858-57637` at desktop (1728-wide → two equal full-height panes, no card/scrim, ×
  top-right) and at a mobile width (single full-viewport column, no right pane). Capture screenshots
  for the PR.

## Docs to Update

- The header docblock in `ConnectWalletModal.tsx` (L1–25) currently says "two-column layout
  (desktop)"; update wording to "full-viewport two-pane layout" so the source comment matches.
- No product-spec change required: this is a pure visual/layout fix (`fix/`), no behavior change.
- If the scrim-dismiss behavior is removed, note nothing in known-bugs/tech-debt; it is an
  intended design change.
