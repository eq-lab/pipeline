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

1. **DepositHeader icon size (fix 1).** [DONE] Added `xl` (72px) to `CoinIcon`'s `SIZE_MAP`; updated `DepositHeader` to use `size="xl"`. Updated doc comments in both files.
2. **DepositHeader bottom spacing (fix 2).** [DONE] Added `mb-8` to `DepositHeader` root `rootClasses`.
3. **Chip styling (fix 5).** [DONE] Changed radius to `--radius-pipeline-pill`; removed `border border-[var(--color-pipeline-line)]`; changed font to `--text-pipeline-caption` / `--font-weight-regular`; changed unselected color to `--color-pipeline-ink`.
4. **conversion-input-card radius (fix 4).** [DONE] Changed `rounded-[var(--radius-pipeline-card-lg)]` to `rounded-[var(--radius-pipeline-card)]`; updated doc comments in `ConversionCard.tsx`.
5. **token-input-row zero state + click-to-focus (fixes 3a, 3b).** [DONE] Added `useRef` + `handleRowClick` on `token-input-row`; added `justify-center`/`justify-start` switch on identity block inner div when sign is hidden/shown.
6. **token-amount-display padding + spacing (fix 6).** [DONE] Removed `px-2` from `cardClasses`; added `pb-8`; reconciled inline override in `ConversionCard.tsx` from `"16px 8px 0"` to `"16px 0 0"`.
7. **info-row-network-fee font (fix 7).** [DONE] Changed both `labelClasses` and `valueClasses` in `InfoRow.tsx` from `--text-pipeline-caption` to `--text-pipeline-body` (applies to all InfoRow instances per team resolution).
8. **conversion-output-card border (fix 8).** [DONE] Added `border-0` to `conversion-output-card` Card className.
9. **Update stories.** [SKIPPED — Storybook stories are out of scope for automated tests; visual verification is done by ux-tester via Figma comparison]
10. **Regression check on stake page.** [DONE] All 155 affected tests pass including `-stake.test.tsx`.

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
