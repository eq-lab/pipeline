# Issue #473: Mobile home: card headings render one type-scale step larger than Figma

Source: https://github.com/eq-lab/pipeline/issues/473

## Scope

On the mobile home layout (below the Tailwind `md` breakpoint, 402px viewport), every home card heading renders one type-scale step larger than the mobile Figma spec because the components hardcode the **desktop** type tokens with no mobile step-down. Confirmed against Figma frame `1989:8292` (disconnected mobile):

| Card heading | Figma mobile | App renders today | Token used today |
|---|---|---|---|
| `ConnectWalletPromoCard` "Connect Wallet" (`1989:9176`) | 20px / 28px | 28px / 36px | `--text-pipeline-heading-m` (28/36) |
| `StartHereCard` "Get PLUSD" (`1989:9017`) | 18px / 28px | 20px / 28px | `--text-pipeline-heading-s` (20/28) |
| `StakeCard` "Earn X.XX%" (`1989:9039`) | 18px / 28px | 20px / 28px | `--text-pipeline-heading-s` (20/28) |
| `EarnedCard` "Coming soon" (`1989:9030`) | 18px / 28px | 20px / 28px | `--text-pipeline-heading-s` (20/28) |

Note the Figma mobile values were read from the design context: "Connect Wallet" maps to the `heading-m` variable which is **20** at mobile (the desktop frame uses 28), and the three smaller headings use a raw **18px** with 28px line-height (NOT an existing token — there is no `heading-xs` token in `theme.css`).

**In scope:** add a mobile (below `md`) type step-down for the four home card headings so they match the Figma mobile sizes while preserving the existing desktop sizes (28/36 and 20/28). The same component instances render in both the mobile `md:hidden` block and the desktop `hidden md:block` block of `packages/frontend/src/routes/index.tsx`, so a responsive utility on the heading element is the cleanest approach and will not regress desktop.

**Also in scope (same headings, connected mobile states):** the connected-variant headings that reuse `--text-pipeline-heading-s` and render in the mobile block must get the same step-down so the fix is consistent across States A/B/C:
- `StartHereCard` connected "PLUSD Balance" value (`<h2>`, line ~179-191)
- `StakeCard` State C "Staked PLUSD" shares value (line ~188-200)
- `EarnedCard` State C / "Nothing yet" value (`stateValueClasses` and `valueClasses`)
The coder should verify each against the connected mobile Figma frames (`1988:7074`, `1984:6501`, `1886:46777`) and apply 18/28 on mobile where the desktop value is 20/28. If any connected-state heading is intentionally a different size in Figma, follow Figma and note it.

**Out of scope:** desktop type scale (unchanged); card padding/height (tracked separately in #474); button sizes (#475-#477); copy (#478); any non-heading typography (eyebrow/body/caption sizes are already correct per the Figma read).

## Assumptions and Risks

- **Token vs raw-value decision is unresolved** — see Open Questions. FRONTEND.md rule: "components must not inline raw hex codes … typography values are consumed through Tailwind utilities". The mobile 18px size has no token today. The plan assumes a new token pair is added rather than inlining a raw `text-[18px]`, but this needs confirmation (Open Questions Q1).
- The four cards each render their heading via a hand-assembled class-array on a `<p>`/`<h2>`. The fix touches every one of those class arrays; risk of missing a connected-state variant. Mitigation: the in-scope checklist above enumerates every heading element.
- Tailwind v4 arbitrary `md:` variants must compose with the existing `text-[length:var(--…)]` / `leading-[var(--…)]` utilities. Risk: ordering/specificity. Mitigation: base = mobile size, `md:` = desktop size, which is the natural cascade and matches the existing `min-h-[256px] md:min-h-[274px]` pattern already used in the route.
- Existing unit test `packages/frontend/src/routes/-index.test.tsx` asserts heading presence by accessible name only (not font-size), so it should not break. jsdom does not resolve CSS custom properties or media queries, so a font-size assertion in jsdom would be unreliable — verification of the actual pixel sizes belongs in the browser (Figma/DevTools), not the unit test.

## Open Questions

- **Q1 (blocking design-token decision):** The mobile spec needs a **20/28** size for the `heading-m` slot and an **18/28** size for the `heading-s` slot. Neither mobile size exists as a token. Preferred approach: extend `packages/ui/src/styles/theme.css` with responsive heading tokens (e.g. add `--text-pipeline-heading-s-mobile: 18px` + line-height, and reuse `--text-pipeline-heading-s` (20px) as the mobile value for the `heading-m` slot, since mobile heading-m == desktop heading-s == 20/28). Should the coder (a) add new explicit mobile token(s), or (b) inline raw `text-[18px]/leading-[28px]` in the four components with a `md:` step-up to the existing tokens? Option (b) is faster but violates the "no raw font sizes" guidance in FRONTEND.md for the 18px value. Recommend (a). Needs human confirmation before implementation.
- **Q2:** For the mobile `heading-m` slot ("Connect Wallet" → 20/28), it exactly equals the existing `--text-pipeline-heading-s` token (20/28). Is it acceptable to reuse `heading-s` as the mobile size for that one heading, or does the design system want a dedicated `heading-m-mobile` alias for semantic clarity? (Reuse is simpler and visually identical.)

## Implementation Steps

The exact mechanism depends on the Q1/Q2 answers. Two variants below — the coder picks per the human's answer.

### Preferred (tokenized) variant — pending Q1/Q2 = "add tokens"

1. In `packages/ui/src/styles/theme.css`, add a mobile heading token to the `@theme` block (and mirror it in the documented token list lower in the file, lines ~177-186):
   - `--text-pipeline-heading-s-mobile: 18px;` and `--text-pipeline-heading-s-mobile--line-height: 28px;` (new — the 18px small-heading size).
   - For the `heading-m` mobile size (20/28), reuse the existing `--text-pipeline-heading-s` (20/28); no new token needed unless Q2 says otherwise.
2. `packages/frontend/src/components/ConnectWalletPromoCard.tsx` — the `<h2>` "Connect Wallet" class array (lines ~134-147): make the size responsive. Base (mobile) = `heading-s` (20/28); `md:` = `heading-m` (28/36). Concretely replace the single `text-[length:var(--text-pipeline-heading-m)]` + `leading-[var(--text-pipeline-heading-m--line-height)]` with the mobile pair as base and `md:text-[length:var(--text-pipeline-heading-m)] md:leading-[var(--text-pipeline-heading-m--line-height)]`.
3. `packages/frontend/src/components/StartHereCard.tsx` — apply the same base/`md:` pattern to BOTH `<h2>` heading elements (disconnected "Get PLUSD" at lines ~221-234 and connected "PLUSD Balance" value at lines ~179-191): base (mobile) = `heading-s-mobile` (18/28); `md:` = `heading-s` (20/28).
4. `packages/frontend/src/components/StakeCard.tsx` — apply the same base/`md:` pattern to the "Earn X.XX%" `<p>` (lines ~285-297) and the State C "Staked PLUSD" shares `<p>` (lines ~188-200).
5. `packages/frontend/src/components/EarnedCard.tsx` — update the module-level `valueClasses` (lines ~82-89) and the State C `stateValueClasses` branch (lines ~129-138) to use base = `heading-s-mobile` (18/28), `md:` = `heading-s` (20/28). Because these are shared class constants used by every state, the step-down applies uniformly.
6. Confirm the route at `packages/frontend/src/routes/index.tsx` needs no change — the responsive utility on each component handles both blocks. Do NOT add per-block overrides.

### Fallback (raw-value) variant — only if Q1 = "inline raw values"

Same component edits as steps 2-5, but instead of a token use `text-[18px] leading-[28px]` (and `text-[20px]` for the Connect Wallet base) at the mobile base with `md:` restoring the existing token utilities. If this path is taken, add a tech-debt entry per AGENTS.md noting the inlined raw font sizes and the missing `heading-s-mobile` token.

### Common closing steps

7. Run `npx tsx scripts/lint-docs.ts` (required after any TypeScript/docs change per AGENTS.md).
8. Run the frontend unit tests (see Test Strategy) and the type-check.

## Test Strategy

- **Unit:** existing `packages/frontend/src/routes/-index.test.tsx` heading-by-name assertions must still pass (no accessible-name change). Do not add jsdom font-size assertions — jsdom does not evaluate CSS variables or media queries, so such a test would be meaningless or flaky. Run `yarn workspace @pipeline/frontend test` (and `yarn workspace @pipeline/ui` build/type-check if the token file changed).
- **Type-check / lint:** `tsc` across the touched packages and `npx tsx scripts/lint-docs.ts`.
- **Figma-driven visual verification (primary):** run the app, set the viewport to 402px mobile, wallet disconnected, and compare computed styles against Figma frame `1989:8292`:
  - `ConnectWalletPromoCard` h2 computed `font-size: 20px; line-height: 28px`.
  - `StartHereCard` "Get PLUSD", `StakeCard` "Earn …", `EarnedCard` "Coming soon" computed `font-size: 18px; line-height: 28px`.
  - Then resize to ≥768px (`md`) and confirm desktop sizes are restored: Connect Wallet 28/36, the three smaller headings 20/28.
  - Repeat for the connected mobile frames (`1988:7074` empty, `1984:6501` plusd, `1886:46777` splusd) to confirm the connected-state headings (PLUSD Balance value, Staked PLUSD shares, Earned value) match Figma at mobile.
- Confirm card heights shrink toward the Figma silhouette as a side effect (e.g. Connect card moves from 274px toward 256px), but treat exact height as #474's concern, not a pass/fail gate here.

## Docs to Update

- `docs/FRONTEND.md` — Typography section: if a new `--text-pipeline-heading-s-mobile` token (or any mobile heading token) is added, document it in the token-group list. Add a one-line note under "Responsive behavior" that home card headings step down one scale step below `md` to match the mobile Figma type scale.
- `packages/ui/src/styles/theme.css` — the documented token list (lines ~177-186) must be kept in sync if a token is added (same commit).
- No product-spec change required — this is a pure visual `fix/`, no user- or agent-facing behavior change.
- If the fallback raw-value path is taken, add an entry to `docs/exec-plans/tech-debt-tracker.md`.
