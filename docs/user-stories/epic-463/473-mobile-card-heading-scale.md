# User stories — #473 Mobile home: card headings render one type-scale step larger than Figma

**Issue:** https://github.com/eq-lab/pipeline/issues/473
**Epic:** #463 Home page
**App URL:** http://localhost:5173/ (402px mobile viewport)
**Figma:** https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1989-8292&m=dev

---

## Story 1 — ConnectWalletPromoCard heading steps down on mobile

**As a** mobile visitor (below 768px),
**I want** the "Connect Wallet" card heading to render at 20px/28px,
**so that** it matches the Figma mobile spec (node 1989:9176) instead of the desktop 28px/36px.

### Acceptance criteria

- [ ] At 402px viewport, `ConnectWalletPromoCard` h2 computed style: `font-size: 20px`, `line-height: 28px`.
- [ ] At 768px and above, the same h2 restores desktop size: `font-size: 28px`, `line-height: 36px`.
- [ ] No raw font-size values in the component — heading sizes resolve through `--text-pipeline-heading-m-mobile` and `--text-pipeline-heading-m` tokens.

---

## Story 2 — StartHereCard headings step down on mobile (disconnected and connected)

**As a** mobile visitor (below 768px),
**I want** the "Get PLUSD" and "PLUSD Balance" card headings to render at 18px/28px,
**so that** they match the Figma mobile spec (nodes 1989:9017 and 1984:6501).

### Acceptance criteria

- [ ] At 402px viewport, `StartHereCard` disconnected "Get PLUSD" h2: `font-size: 18px`, `line-height: 28px`.
- [ ] At 402px viewport, `StartHereCard` connected "PLUSD Balance" value h2: `font-size: 18px`, `line-height: 28px`.
- [ ] At 768px and above, both headings restore desktop size: `font-size: 20px`, `line-height: 28px`.
- [ ] No raw font-size values — heading sizes resolve through `--text-pipeline-heading-s-mobile` and `--text-pipeline-heading-s` tokens.

---

## Story 3 — StakeCard headings step down on mobile (all states)

**As a** mobile visitor (below 768px),
**I want** the "Earn X.XX%" APY line and the "Staked PLUSD" shares value to render at 18px/28px,
**so that** they match the Figma mobile spec (nodes 1989:9039 and 1886:46777).

### Acceptance criteria

- [ ] At 402px viewport, `StakeCard` disconnected/State-A/B "Earn …" p: `font-size: 18px`, `line-height: 28px`.
- [ ] At 402px viewport, `StakeCard` State-C "Staked PLUSD" shares p: `font-size: 18px`, `line-height: 28px`.
- [ ] At 768px and above, both elements restore desktop size: `font-size: 20px`, `line-height: 28px`.
- [ ] No raw font-size values — heading sizes resolve through `--text-pipeline-heading-s-mobile` and `--text-pipeline-heading-s` tokens.

---

## Story 4 — EarnedCard value steps down on mobile (all states)

**As a** mobile visitor (below 768px),
**I want** the "Coming soon", "Nothing yet", and "—" earned value to render at 18px/28px,
**so that** it matches the Figma mobile spec (node 1989:9030) alongside the sibling cards.

### Acceptance criteria

- [ ] At 402px viewport, `EarnedCard` value p (all three text variants): `font-size: 18px`, `line-height: 28px`.
- [ ] At 768px and above, the value restores desktop size: `font-size: 20px`, `line-height: 28px`.
- [ ] No raw font-size values — heading sizes resolve through `--text-pipeline-heading-s-mobile` and `--text-pipeline-heading-s` tokens.

---

## Story 5 — Desktop heading sizes are unchanged

**As a** desktop user (768px and above),
**I want** all four card headings to remain at their existing desktop sizes,
**so that** the desktop layout is not regressed by the mobile fix.

### Acceptance criteria

- [ ] At 768px+ viewport, `ConnectWalletPromoCard` h2: 28px/36px.
- [ ] At 768px+ viewport, `StartHereCard` heading: 20px/28px.
- [ ] At 768px+ viewport, `StakeCard` APY line: 20px/28px.
- [ ] At 768px+ viewport, `EarnedCard` value: 20px/28px.

---

## Story 6 — New mobile tokens are available in the design system

**As a** frontend developer,
**I want** `--text-pipeline-heading-m-mobile` (20px/28px) and `--text-pipeline-heading-s-mobile` (18px/28px) to be declared in `theme.css`,
**so that** components can reference them as typed design-system tokens rather than raw values.

### Acceptance criteria

- [ ] `packages/ui/src/styles/theme.css` declares `--text-pipeline-heading-m-mobile: 20px` and `--text-pipeline-heading-m-mobile--line-height: 28px` in both `:root` and `@theme`.
- [ ] `packages/ui/src/styles/theme.css` declares `--text-pipeline-heading-s-mobile: 18px` and `--text-pipeline-heading-s-mobile--line-height: 28px` in both `:root` and `@theme`.
- [ ] `docs/FRONTEND.md` documents the responsive behavior and the two new tokens.
