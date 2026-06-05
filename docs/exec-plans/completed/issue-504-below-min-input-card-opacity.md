# Issue #504: Below-min deposit state: USDC input card dimmed to 30% opacity; Figma keeps it fully active

Source: https://github.com/eq-lab/pipeline/issues/504

## Scope

In the deposit below-minimum state (`hasBalance === false`, mock scenario
`connected-below-min`), the USDC input card (`ConversionCard` top section) is
rendered at 30% opacity, making the whole input look disabled. Both the mobile
(Figma node 1993:8706) and desktop (Figma node 1825-10214) below-min frames show
this input card at full opacity (active input, normal token icon/labels, white
suggestion chips); only the steps card is replaced by the add-funds banner.

In scope:

- Remove the dim/disabled (`opacity-30`) treatment applied to the deposit input
  card when the user's balance is below the minimum deposit.
- Confirm the change does not regress the *other* legitimate faded state (the
  approved/step-2-live fade) which must remain at 30% opacity.

Out of scope:

- The add-funds banner styling/content (title font, subtitle formatting, button
  wrapping) — that is sibling issue #503 (trivial-frontend, already in review).
- Network fee USD conversion (#506).
- Any change to whether the chips/input are interactive in the below-min state
  (see Open Questions) — this plan only addresses the visual opacity unless the
  design clarification says otherwise.

## Assumptions and Risks

- **Root cause (confirmed by reading code):** In
  `packages/frontend/src/routes/deposit.tsx`, `isDepositInputFaded` (lines
  426–431) is true when `hasBalance === false`. That value flows into
  `isInputFaded` (line 439), which sets `input.className` to
  `"opacity-30 transition-opacity"` on the `ConversionCard` (lines 761–763 for
  deposit; 788–790 for withdraw). The `ConversionCard` forwards that className to
  its outer wrapper, dimming the whole top input card. Removing `hasBalance ===
  false` from the `isDepositInputFaded` predicate fixes the bug.
- The second clause of `isDepositInputFaded` (the approved/step-2-live fade:
  `isConnected && !depositNeedsApproval && amountBig > 0n &&
  !depositRequestIsConfirmed`) is a *separate, intentional* fade and must be
  preserved. Risk: an over-broad edit removes that fade too. Mitigation: edit
  only the `hasBalance === false ||` disjunct.
- **Shared-file overlap with #503:** Both #504 and #503 edit
  `routes/deposit.tsx`. #503 touches the banner JSX (lines ~831–855); #504 touches
  the `isDepositInputFaded` derivation (lines 426–431). Different regions, low
  collision risk, but if #503 merges first the coder should rebase before editing.
- The input's functional `disabled` state (line 760: `!isConnected || !isReady ||
  isAmountLocked`) is independent of the opacity fade and is **not** affected by
  this change — below-min balance does not set `disabled`, so the input was
  already technically interactive; only the visual opacity was wrong.

## Open Questions

- Figma shows the below-min input card at full opacity with active styling. Are
  the four quick-amount chips and the numeric input meant to be **interactive**
  in this state (i.e. a user with sub-min balance can still type / pick a chip),
  or just visually full-opacity but inert? The current code already leaves them
  interactive (no `disabled` from the below-min branch), which matches "full
  opacity / active." Confirm this is the intended behavior before the coder
  assumes it. If the design wants them inert-but-bright, that is a separate
  follow-up (not covered here).

## Implementation Steps

1. In `packages/frontend/src/routes/deposit.tsx`, change the
   `isDepositInputFaded` derivation (currently lines 426–431) to drop the
   `hasBalance === false ||` disjunct so the below-min state no longer fades the
   input card. Resulting predicate keeps only the approved/step-2-live fade:

   ```ts
   const isDepositInputFaded =
     isConnected &&
     !depositNeedsApproval &&
     amountBig > 0n &&
     !depositRequestIsConfirmed;
   ```

   Update the adjacent comment (line 425 `// Faded state (deposit-only: approved
   step 2 live)`) if needed — it already describes the remaining behavior
   accurately, so likely no change.

2. No change needed in `ConversionCard.tsx` or `TokenInput.tsx` — they correctly
   forward whatever className the route passes; the fix is purely at the
   call-site derivation.

3. Run lint (`npx tsx scripts/lint-docs.ts` for docs; standard TS/ESLint for the
   package) and the frontend unit tests.

## Test Strategy

- **New unit test** in `packages/frontend/src/routes/-deposit.test.tsx`, added to
  the existing `describe("Deposit page — insufficient balance banner", ...)`
  block (around line 573, which already seeds `balance: BALANCE_500_RAW`
  below-min). Assert the input card is NOT dimmed: the USDC input's enclosing
  card wrapper className must NOT contain `opacity-30`. Mirror the existing
  StepRow opacity assertion pattern at lines ~1026–1035 (find the element via
  `getByRole("textbox", { name: /USDC amount/i })`, then walk up to the
  `ConversionCard` input wrapper and assert `className` does not include
  `opacity-30`). If walking the DOM is brittle, the coder may add a stable
  `data-testid` to the deposit `input` props object (TokenInput spreads `...rest`
  onto its root) and target that — but prefer the role-query walk-up first.
- **Regression test (preserve the good fade):** add or confirm a test for the
  approved/step-2-live state (connected, sufficient allowance, amount entered,
  request not yet confirmed) where the input card SHOULD still carry
  `opacity-30`. This guards against an over-broad edit.
- Run the full frontend unit suite to confirm no existing insufficient-balance
  or minDeposit-gating tests regress.
- **Figma verification (frontend flow, no ux-tester unless manager opts in):**
  visually confirm `http://localhost:3000/deposit` in the `connected-below-min`
  mock scenario at viewport 402×874 renders the USDC input card at full opacity,
  matching Figma node 1993:8706 (mobile) and node 1825-10214 (desktop).

## Docs to Update

_None_ — this is a pure visual `fix/` with no change to user- or agent-facing
product behavior. No product-spec or design-doc update required.
