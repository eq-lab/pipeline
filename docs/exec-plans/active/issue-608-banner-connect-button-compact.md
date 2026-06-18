# Issue #608: Match connect-wallet-banner Connect button to Figma (compact size, 8px radius)

Source: https://github.com/eq-lab/pipeline/issues/608

## Scope

Make the "Connect" button inside the yellow "Connect your wallet first" banner render
as the compact dark button shown in Figma, on both `/deposit` and `/stake`.

In scope:

- The banner Connect button in `packages/frontend/src/routes/deposit.tsx` (testid `connect-wallet-banner-action`).
- The banner Connect button in `packages/frontend/src/routes/stake.tsx` (testid `stake-connect-button`).
- A compact-height treatment for the `primary-dark` button so it matches Figma node `1994-7226`.

Out of scope:

- The header "Connect Wallet" button (`TopBar.tsx`) and the `ConnectWalletPromoCard.tsx`
  CTA — both intentionally use the full 48px `primary-dark` button. Do not change them.
- The StepRow action button (already compacted to 32px via its own override).
- Any change to the radius token value (see "Key correction" — radius is already correct).

## Key correction to the Issue's stated deltas

The Issue body claims the Figma button needs an **8px corner radius (radius/radius-s)** and
that the app renders 4px, treating radius as a bug. This is not correct, and the coder must
not change the radius:

- The authoritative Figma variable resolves `radius/radius-s` = **4** (confirmed via
  `get_variable_defs` on node `1994-7226`).
- The `8px` figure in the Issue came from the unreliable literal fallback in the Figma
  code-export string (`rounded-[var(--radius/radius-s,8px)]`). The fallback is a default
  baked into the export tool, not the resolved token value.
- The app's `--radius-pipeline-button` is already **4px** (`packages/ui/src/styles/theme.css`),
  which matches the resolved Figma token. So the radius is already correct; the only genuine
  visual delta is **height** (and, secondarily, horizontal padding).

Authoritative Figma button geometry (node `I1994:7226;...;8902:3623`):

- Height: `min-h-[32px] max-h-[32px]` → exactly **32px** (vs app 48px).
- Horizontal padding: `px-[var(--size-6,6px)]` = **6px** on the button box, plus the inner
  label `px-[var(--size-4,4px)]` = 4px (vs the app Button's inner span `px-2` = 8px).
- Background `fill-test/primary` = `#262524` = `--color-pipeline-cta`; label white
  (`--color-pipeline-on-dark`). Same colours as the current `primary-dark` — no colour change.
- Radius `radius/radius-s` = 4px = `--radius-pipeline-button` — no change.

Net: the fix is a **height reduction to 32px** (and optional padding tightening), nothing else.

## Assumptions and Risks

- Assumes the established StepRow pattern (`className="!h-8 ..."` to override the `h-12` baked
  into the `primary-dark` variant in Tailwind v4) is the accepted way to compact this button.
  See `packages/ui/src/components/StepRow/StepRow.tsx` lines ~170–178 for precedent.
- Risk: if a coder "fixes" the radius to 8px per the Issue text, it will diverge from the
  design token and the rest of the UI. The Key correction section above must be respected.
- Risk: Tailwind v4 utility specificity — the variant string sets `h-12`; the override must use
  the `!` important modifier (`!h-8`) exactly as StepRow does, or the height will not change.
- Low risk: no existing test asserts the banner button height or radius, so this is purely
  additive on the test side.
- The banner code comments reference different Figma nodes per page (`deposit.tsx` → `1994-6885`,
  `stake.tsx` → `1994-7280`) while the reporter linked `1994-7226`. All three are the same
  horizontal yellow banner component instance; the button geometry (32px / 4px radius / dark
  fill) is identical across them. See Open Questions for canonical-node confirmation.

## Open Questions

- API shape (design decision, not blocking for the visual outcome): should the coder
  (a) apply a banner-scoped className override (`!h-8` + tighter padding) mirroring the
  StepRow precedent — no Button API change — or (b) introduce a reusable `size` prop /
  `compact` variant on `Button` so the 32px treatment is a first-class, shared option? The
  Issue's "Suggested fix scope" explicitly says to "confirm the intended button sizing with
  design before implementing" and suspects this needs more than a className tweak. Recommended
  default if no design response: option (a), the className override, since it matches the
  existing StepRow precedent and touches no shared component contract — but confirm with design.
- Canonical Figma node for this banner button: the reporter linked `1994-7226`; the code
  comments cite `1994-6885` (deposit) and `1994-7280` (stake). Confirm which node design wants
  recorded in the code comments so all three references can be reconciled to one.

## Implementation Steps

1. [x] Decided approach per Open Questions: **option (b)** — `size` prop on `Button`
   (design directed this in issue comment).

2. ~~If option (a) — className override (default)~~ (not chosen)

3. [x] **Option (b) — Button `size` prop implemented:**
   - Extended `packages/ui/src/components/Button/Button.tsx`: added `ButtonSize` type
     (`"default" | "compact"`), `size?: ButtonSize` prop. `compact` applies `!h-8 !min-w-8 !px-1.5`
     override plus tighter inner-label padding (`px-1`) for rectangular variants. Sets
     `data-size` attribute. Radius and colours unchanged.
   - Updated JSDoc block and Storybook story in
     `packages/ui/src/components/Button/Button.stories.tsx` (new `PrimaryDarkCompact` story).
   - Applied `size="compact"` to both banner buttons in `deposit.tsx` and `stake.tsx`.
   - StepRow migration noted as tech-debt (not addressed here — see tech-debt-tracker).
   - Exported `ButtonSize` from `packages/ui/src/components/Button/index.ts`.

4. [x] Reconciled Figma node comments to canonical `1994-7226` in both `deposit.tsx` and
   `stake.tsx` (inline comment + file-level docblock).

## Test Strategy

- Unit/component tests (Vitest + Testing Library) in
  `packages/frontend/src/routes/-deposit.test.tsx` and
  `packages/frontend/src/routes/-stake.test.tsx`:
  - In the existing "wallet-not-connected banner" cases, extend the assertion to check the
    Connect button carries the compact-height class. Query by testid
    (`connect-wallet-banner-action` / `stake-connect-button`) and assert `!h-8` is present on
    the rendered `className` (and, if option (b), assert `data-variant="primary-dark"` plus the
    compact size). Class-based assertions are appropriate here because jsdom does not compute
    layout; do not assert pixel heights.
  - If option (b): add a Vitest test in `packages/ui` (or rely on the Storybook story plus a
    snapshot/class assertion) verifying `Button` with `size="compact"` emits `h-8` and retains
    `rounded-[var(--radius-pipeline-button)]` (radius unchanged).
- Run `yarn workspace @pipeline/frontend test` (and `@pipeline/ui` if Button changes) plus the
  repo lint (`npx tsx scripts/lint-docs.ts`) and build before handing back.
- Figma verification: the manager's frontend flow runs ux-tester against the epic later, but
  the coder should visually confirm at `http://localhost:3333/deposit?direction=deposit` and
  `http://localhost:3333/stake` (wallet disconnected) that the banner button is ~32px tall with
  a 4px radius and dark fill, matching Figma node `1994-7226`
  (https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1994-7226&m=dev).

## Docs to Update

- None required. This is a pure visual `fix/` with no behavior, product, or architecture change.
  If option (b) introduces a `size` prop on the shared Button, add a one-line note to the
  component description in `docs/FRONTEND.md` ("Component library / design system" section) and
  the Button Storybook docs; otherwise no docs change.
