# Issue #595: Styling fixes for deposit/withdraw page

Source: https://github.com/eq-lab/pipeline/issues/595

## Scope

Apply eight styling/behaviour corrections to the deposit/withdraw page, which is composed from shared `packages/ui` components. Each fix targets an element by its `data-testid`:

1. **`deposit-header` > img** — coin icon size 72×72px (currently `lg` = 40px).
2. **`deposit-header`** — bottom spacing 32px (currently the gap to the next element is the page-level `gap-6` = 24px on `<main>`).
3. **`token-input-row`**
   - 3a. When the input value is `0`, suppress the `−` sign prefix shown under USDC and vertically center the USDC identity (icon + labels).
   - 3b. Clicking anywhere on the row focuses the numeric `<input>`.
4. **`conversion-input-card`** — border radius 4px (currently `--radius-pipeline-card-lg` = 16px).
5. **`token-input-chips`** — fix the chip font (Inter Regular 400, 12px/caption), fix color (primary ink), remove the border, and use the pill radius. Per Figma node 1498-99888.
6. **`token-amount-display`** — remove left/right padding (currently `px-2`); bottom spacing 32px.
7. **`info-row-network-fee`** — fix font styling to body (16px/22px), per Figma node 1498-99897.
8. **`conversion-output-card`** — remove the border (the white `Card` variant's border).

These edits land in shared components (`DepositHeader`, `TokenInput`, `ConversionCard`, `TokenAmountDisplay`, `InfoRow`, `QuickAmountChip`, possibly `CoinIcon`). The same components render on the **stake page** (`packages/frontend/src/routes/stake.tsx`) and in Storybook, so those must not regress.

Out of scope: backend, business logic, the conversion math, the `StepsCard`, and any change to the deposit/withdraw flow behaviour beyond click-to-focus.

## Affected files

- `packages/ui/src/components/DepositHeader/DepositHeader.tsx` (fixes 1, 2)
- `packages/ui/src/components/CoinIcon/CoinIcon.tsx` (fix 1 — see Open Questions)
- `packages/ui/src/components/TokenInput/TokenInput.tsx` (fixes 3a, 3b, 5)
- `packages/ui/src/components/QuickAmountChip/QuickAmountChip.tsx` (fix 5)
- `packages/ui/src/components/ConversionCard/ConversionCard.tsx` (fixes 3a sign, 4, 8)
- `packages/ui/src/components/TokenAmountDisplay/TokenAmountDisplay.tsx` (fix 6)
- `packages/ui/src/components/InfoRow/InfoRow.tsx` (fix 7 — see Open Questions)
- Stories + tests for the above components.

## Assumptions and Risks

- **Shared-component blast radius.** `TokenInput`, `TokenAmountDisplay`, `InfoRow` and `QuickAmountChip` are used on both deposit (`deposit.tsx`) and stake (`stake.tsx`) routes and in Storybook. Chip-font (fix 5) and InfoRow-font (fix 7) changes will visibly affect the stake page too. Per the issue note this is expected ("verify those don't regress"), but the coder must confirm stake still matches its own Figma.
- **CoinIcon size cap.** `CoinIcon` currently supports max `lg` = 40px (`SIZE_MAP`). Fix 1 needs 72px. Adding a size only used by DepositHeader, vs. a one-off override, is a design-system decision — see Open Questions.
- **InfoRow has no per-row font variant.** Fix 7 names only `info-row-network-fee`, but `InfoRow` styles both the "Exchange rate" and "Network fee" rows identically (caption today). Changing InfoRow's font to body will also change Exchange rate. See Open Questions.
- **Fix 4 reverts an intentional earlier decision.** `conversion-input-card` was deliberately set to `--radius-pipeline-card-lg` (16px) per Figma node 1498:100136. Fix 4 overrides that to 4px. Coder should update the now-stale code comments in `ConversionCard.tsx` (lines 43, 118-126) so they don't contradict the new value.
- **Token usage.** Project rule: no raw hex/sizes outside token references where a token exists. 4px = `--radius-pipeline-card`/`--radius-pipeline-button`; pill = `--radius-pipeline-pill`; 32px spacing has no dedicated token (existing code uses Tailwind `gap-8`/`pb-8` = 32px, which is acceptable). 72px has no token — a bracketed `72px` (or new CoinIcon size) is unavoidable.

## Open Questions

- Fix 1 (72px icon): Should `CoinIcon` gain a new size token (e.g. `xl` = 72px) reused across the system, or should `DepositHeader` apply a one-off 72px override to the existing icon? Adding a system size is cleaner but touches the shared `SIZE_MAP`; a one-off keeps the change local. Which does the team prefer?
- Fix 7 (`info-row-network-fee` font): `InfoRow` renders Exchange rate and Network fee with identical styling and has no per-row variant. Should the body-font change apply to **all** `InfoRow` instances (simplest; also changes Exchange rate on deposit and stake), or only to the Network fee row (requires a new prop/variant on the shared component)? Figma node 1498-99897 shows both rows at body size (16px/22px), which suggests applying it to all rows — please confirm.
- Fix 3a center-on-zero: when the sign prefix is hidden at value `0`, does "center the USDC label/identity vertically" mean changing the row's `items-start` on the right input wrapper to `items-center`, or vertically centering the left identity block only? Confirm the intended target so the coder edits the correct flex container.

## Implementation Steps

1. **DepositHeader icon size (fix 1).** In `DepositHeader.tsx`, render the PLUSD `CoinIcon` at 72px. Per the resolution of Open Question 1, either add an `xl` (72px) entry to `CoinIcon`'s `SIZE_MAP` and use `size="xl"`, or override width/height to 72px on the existing icon. Keep `hidden md:block` and `aria-hidden`.
2. **DepositHeader bottom spacing (fix 2).** Ensure 32px below the header. The header gap to the conversion card is currently the `<main>` `gap-6` (24px) in `deposit.tsx`. Add a 32px bottom margin (`mb-8`) to the `DepositHeader` root, or adjust spacing at the call site — prefer the component root so Storybook reflects it. Confirm it does not double up with the parent `gap-6`.
3. **Chip styling (fix 5).** In `QuickAmountChip.tsx`: change radius from `--radius-pipeline-button` to `--radius-pipeline-pill`; remove the `border border-[var(--color-pipeline-line)]`; change font size from `--text-pipeline-body` (16px) to `--text-pipeline-caption` (12px) with matching line-height; change weight from `--font-weight-emphasized` (600) to `--font-weight-regular` (400); change unselected text color from `--color-pipeline-ink-muted` to `--color-pipeline-ink` (primary). Verify the `token-input-chips` container in `TokenInput.tsx` needs no additional change beyond the chips themselves.
4. **conversion-input-card radius (fix 4).** In `ConversionCard.tsx` line 129, change `rounded-[var(--radius-pipeline-card-lg)]` to `rounded-[var(--radius-pipeline-card)]` (4px). Update the stale doc comments (lines 43, 118-126) describing 16px.
5. **token-input-row zero state + click-to-focus (fixes 3a, 3b).**
   - 3a: The sign prefix is already gated by `showSign = signPrefix !== undefined && !!value && value !== "0"` in `TokenInput.tsx`, so at value `0` the `−` is already suppressed. Verify this renders correctly in the deposit flow and adjust the right-side wrapper's vertical alignment (`items-start` → `items-center` or as resolved in Open Question 3) so the USDC identity is centered when no sign shows.
   - 3b: On the `token-input-row` div, add an `onClick` that focuses the inner `<input>` (via a `useRef` to the input, or `e.currentTarget.querySelector('input')?.focus()`). Guard against the input being `disabled`. Ensure clicking a chip does not also trigger focus oddly (chips are in a sibling row, so unaffected).
6. **token-amount-display padding + spacing (fix 6).** In `TokenAmountDisplay.tsx`, remove horizontal padding (`px-2` in `cardClasses`). Add 32px bottom spacing. NOTE: in `ConversionCard.tsx` the output `TokenAmountDisplay` already receives an inline `style={{ padding: "16px 8px 0" }}` (lines 170-175) overriding `cardClasses` padding — the coder must reconcile both the component default AND this inline override so the rendered deposit page has no left/right padding and 32px below. Confirm Storybook (standalone TokenAmountDisplay) also reflects no L/R padding.
7. **info-row-network-fee font (fix 7).** Per Open Question 2 resolution: change `InfoRow.tsx` value (and likely label) font from caption (12px/16px) to body (16px/22px), matching Figma node 1498-99897. If scoped to Network fee only, add a variant/prop instead.
8. **conversion-output-card border (fix 8).** In `ConversionCard.tsx`, the output card is `<Card variant="white" data-testid="conversion-output-card">`. Remove its border — either via a `className` override (e.g. `border-0`/`border-none`) on this instance, or confirm the white `Card` variant border and strip it locally without affecting other `Card` usages.
9. **Update stories.** Update/extend the `.stories.tsx` for each changed component so Storybook shows the corrected visuals (zero-state for TokenInput, pill chips, 72px header icon, etc.).
10. **Regression check on stake page.** Open `stake.tsx` rendered output and confirm the shared-component changes (chips, InfoRow font, TokenInput/TokenAmountDisplay) look correct there too.

## Test Strategy

- **Unit/component tests** (Vitest + Testing Library) for the affected components:
  - `TokenInput`: clicking `token-input-row` focuses the input; clicking when `disabled` does not focus; sign prefix is absent when `value="0"` and present for non-zero negative.
  - `QuickAmountChip`/`token-input-chips`: assert no border class and the corrected font/color classes (or snapshot).
  - `TokenAmountDisplay`: assert no horizontal padding class.
  - `InfoRow`: assert the body-size font classes on the value (and the `info-row-network-fee` derived testid still resolves).
- **Existing tests** to keep green: `packages/frontend/src/routes/-deposit.test.tsx`, `-stake.test.tsx`, and `packages/frontend/src/components/ConversionCard.test.tsx` — update any assertions that pin old class values (radius, chip font, padding).
- **Visual verification** against Figma nodes 1498-99888 (chips) and 1498-99897 (Network fee row), plus the deposit page header (72px icon, 32px spacing) and zero-state row centering. Use the design references already linked in the issue.
- Run `npx tsx scripts/lint-docs.ts` after TS changes per AGENTS.md; run the package lint/typecheck/build for `packages/ui` and `packages/frontend`.

## Docs to Update

- No product-spec change — this is pure styling/behaviour correction with no new user- or agent-facing capability. The exec plan alone is sufficient.
- Update in-code doc comments in `ConversionCard.tsx` (input-card radius), `DepositHeader.tsx`, and `CoinIcon.tsx` (if a new size is added) so they match the new values.
