# Issue #509: Mobile home StartHereCard (connected): missing the '$X USDC' sub-line under the PLUSD balance

Source: https://github.com/eq-lab/pipeline/issues/509

## Scope

Add the missing USDC-equivalent sub-line (the Figma `SubtitleCont` / `Description`
element, nodes `1984:6771` / `1984:6772`) beneath the formatted PLUSD balance in the
**connected** variant of `StartHereCard` (mobile States B & C).

In scope:
- Render a caption line reading `"<formatted-balance> USDC"` (e.g. `"$1,000.00 USDC"`)
  inside the connected-variant `<header>` of
  `packages/frontend/src/components/StartHereCard.tsx`, directly below the
  coin-icon + balance row.
- Style it with the existing caption + muted-ink token stack (identical to the
  StakeCard sub-line and the disconnected "Convert USDC 1:1" subtitle).
- Update the component JSDoc to describe the new sub-line.
- Add/adjust tests in `packages/frontend/src/routes/-index.test.tsx` (State B/C blocks)
  asserting the sub-line renders.

Out of scope:
- The disconnected / State A variant ("Start here / Get PLUSD / Convert USDC 1:1") —
  it already renders its own subtitle and is unchanged.
- The desktop grid `StartHereCard` (always disconnected variant per story #466,
  Story 4) — unchanged.
- Any change to balance fetching, PLUSD↔USDC conversion math, or the `index.tsx`
  data flow. The value displayed is the already-formatted PLUSD balance, which equals
  the USDC-equivalent at the protocol's 1:1 peg.

## Assumptions and Risks

- **1:1 peg assumption.** PLUSD is convertible to USDC 1:1 (confirmed by the existing
  disconnected subtitle "Convert USDC 1:1" and the Figma disconnected frame, which the
  Issue states shows the same sub-line as "$1,000.00 USDC"). Therefore the USDC sub-line
  value is the PLUSD balance value verbatim — no extra conversion hook or decimals math
  is needed. If the peg were ever non-1:1 this would need a real conversion; that is not
  the case today and is out of scope.
- **Value source.** `index.tsx` already passes `mobilePlusdBalance={plusdFormatted}`,
  where `plusdFormatted` is `useEvmToken(...).formattedBalance` — an `Intl` USD currency
  string like `"$1,000.00"` (includes the leading `$`). The sub-line is simply
  `` `${mobilePlusdBalance} USDC` ``. No new prop is required.
- **Fallback when balance is undefined/zero.** The balance `<h2>` already falls back to
  `"$0.00"` via `{mobilePlusdBalance ?? "$0.00"}`. The sub-line must use the same fallback
  so it never renders a bare `"undefined USDC"`. Low risk; handled in the step below.
- **Low risk overall** — additive, single-file component change plus tests. No
  architectural or dependency impact.

## Open Questions

- State C with zero PLUSD: Story #466 notes State C can activate with `PLUSD = 0`
  (enablement keyed on "has a position"). In that case the balance shows `$0.00` and the
  sub-line would read `"$0.00 USDC"`. The Issue and Figma frames only specify the
  non-zero State B caption ("$1,000.00 USDC"); they do not show what the sub-line should
  read when PLUSD is exactly zero. The plan renders `"$0.00 USDC"` for consistency with
  the balance line, but confirm whether the sub-line should instead be hidden when the
  PLUSD balance is zero.

## Implementation Steps

1. Edit `packages/frontend/src/components/StartHereCard.tsx`, connected-variant branch
   (`isConnectedVariant`, the `<header data-node-id="1497:94678">` block around lines
   163–205). After the balance row `<div className="flex items-center gap-1"> … </div>`
   (the coin icon + `<h2>` block, closing at line 204), add a caption `<p>` for the USDC
   sub-line:
   - Content: `{mobilePlusdBalance ?? "$0.00"} USDC`.
   - Class stack (mirror the StakeCard sub-line at `StakeCard.tsx` lines 213–225 and the
     disconnected subtitle at lines 254–266):
     ```
     "font-[family-name:var(--font-body)]",
     "text-[length:var(--text-pipeline-caption)]",
     "leading-[var(--text-pipeline-caption--line-height)]",
     "font-[var(--font-weight-regular)]",
     "text-[color:var(--color-pipeline-ink-muted)]",
     "m-0",
     ```
   - Add `data-node-id="1984:6772"` (the Figma `Description` node) and a
     `data-testid="plusd-in-usdc"` for stable test selection.
2. Confirm the connected-variant header gap still matches Figma. Currently the connected
   header uses `flex flex-col gap-1`; the Figma `SubtitleCont` sits as a 3rd child of the
   same `gap-4`-style stack. Keep `gap-1` (4px) unless visual verification against the
   frame shows the eyebrow→balance gap must differ from balance→sub-line; if a different
   gap is required between the balance row and the sub-line, wrap the balance row +
   sub-line so only the intended gap applies. Decide during Figma verification (step 1 of
   Test Strategy).
3. Update the `StartHereCard` JSDoc:
   - The connected-variant ASCII sketch / prose currently lists eyebrow + balance only;
     add the USDC sub-line.
   - The `mobilePlusdBalance` prop doc already says it is "Displayed as the balance value
     in the connected variant" — extend it to note it also drives the `"$X USDC"`
     sub-line caption.
4. Update tests in `packages/frontend/src/routes/-index.test.tsx`:
   - In the State B block (around line 596), add an assertion that the USDC sub-line is
     present, e.g. `screen.getAllByText(/\$1,000\.00 USDC/)` resolves to ≥1 element (the
     mobile block renders it; the desktop block uses the disconnected variant and will not).
   - In the State C block (around line 646), add the equivalent assertion for the
     connected variant's sub-line. Reuse the State C seeding already present in that block.
   - Optionally assert via the `data-testid="plusd-in-usdc"` selector for robustness.
5. Run lint/build and the frontend test suite (see Test Strategy).

## Test Strategy

1. **Figma verification (manual / ux phase).** Load `/` on a < 768px viewport with State B
   seeded per the story doc
   (`docs/user-stories/epic-463/466-mobile-home-balance-states.md`): set
   `pipeline.mock.wallet.isConnected=true`, the shared address, the
   `stakedPlusd.asset` PLUSD address `0xaaaa…0001`, its `.decimals=18`, and
   `balance.0xaaaa…0001 = 1000000000000000000000`. Confirm the white `StartHereCard`
   renders the eyebrow "PLUSD Balance", the coin icon + "$1,000.00" balance, AND the new
   "$1,000.00 USDC" caption beneath it — matching Figma node `1984:6772` on frame
   `1984:6501` (State B). Repeat the check against State A (`1988:7074`, disconnected
   variant unchanged) and State C (`1886:46777`) frames.
2. **Unit/route tests.** Add the State B and State C assertions described in
   Implementation step 4. Run:
   - `npx vitest run packages/frontend/src/routes/-index.test.tsx` (or the project's
     fast-test entry) and confirm green, including the existing
     "mobile StartHereCard shows 'PLUSD Balance' eyebrow (State B)" test.
3. **Regression.** Confirm the existing State A test still passes (the disconnected
   variant must NOT show a USDC sub-line beyond its "Convert USDC 1:1" subtitle) and the
   desktop Story 4 expectation (desktop grid card stays disconnected) is unaffected.
4. **Edge case.** Verify the sub-line falls back to "$0.00 USDC" when
   `mobilePlusdBalance` is undefined (mirrors the `$0.00` balance fallback) — pending the
   Open Question resolution on whether to hide it at zero.
5. **Lint.** Per `AGENTS.md`, after the TypeScript change run
   `npx tsx scripts/lint-docs.ts` and the project's TS lint/build to confirm no errors.

## Docs to Update

- No product-spec change required — this is a `fix/` that aligns the connected variant
  with the already-specified Figma design and the existing story doc. The behavior the
  story doc (`466-mobile-home-balance-states.md`) describes for the connected
  `StartHereCard` does not currently mention the USDC sub-line explicitly under Story 2/3
  Step 4; add a one-line bullet there ("a '$X USDC' caption appears below the balance")
  so the QA story matches the corrected implementation.
- `StartHereCard` JSDoc updated as in Implementation step 3 (in-code docs).
