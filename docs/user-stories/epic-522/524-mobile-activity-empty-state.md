# User Stories — Issue #524: Mobile Activity page: empty state

Parent epic: [#522 Activity page](https://github.com/eq-lab/pipeline/issues/522)
Issue: [#524](https://github.com/eq-lab/pipeline/issues/524)
Figma (mobile empty): node 1993-9958 | Figma (desktop): node 1497-94912

---

## Story 1 — Empty state renders the illustration and caption on mobile

**As a** mobile user on the `/transactions` page with no activity,
**I want** to see the striped illustration and the "You will see all transactions here" caption,
**so that** I get clear feedback that the page is working and will show data when available.

### Acceptance criteria

- At a viewport width of 402 px the `ActivityEmptyIllustration` (240×240, muted tone) is visible and centred horizontally.
- The caption "You will see all transactions here" appears below the illustration, centred.
- The illustration is top-anchored below the tab bar (not vertically centred in a tall 400 px box).
- No "No activity yet" or "No {tab} activity yet" text is shown.

### How to test

1. Open `/transactions` at 402×874 viewport.
2. Disconnect the wallet (or use the `/test` Mocks tab to clear all requests).
3. Verify the illustration and caption render as described.

---

## Story 2 — Empty state appears for all three causes

**As a** user,
**I want** the same empty-state visual regardless of why there is no activity,
**so that** the page feels consistent.

### Acceptance criteria

- **Disconnected wallet**: empty state shows.
- **Wallet connected, zero requests from API**: empty state shows.
- **Tab filter yields zero rows** (e.g. only Buy rows exist; user is on Sell tab): empty state shows.
- In all three cases the visual is identical (same illustration + same caption).

### How to test

1. Disconnect wallet → verify empty state on `/transactions`.
2. Connect wallet with zero rows mock → verify empty state.
3. Connect wallet with only a Buy row, switch to Sell tab → verify empty state.

---

## Story 3 — Desktop empty-state centering is preserved

**As a** desktop user on the `/transactions` page with no activity,
**I want** the empty state to remain vertically centred in its container,
**so that** the desktop layout is unchanged.

### Acceptance criteria

- At a viewport width ≥ 768 px the empty-state wrapper carries `md:min-h-[400px]` and `md:justify-center`, vertically centring the illustration.
- The desktop Figma frame `1497-94912` is visually unchanged.

### How to test

1. Open `/transactions` at ≥ 768 px viewport with no activity.
2. Verify the illustration is vertically centred (not top-anchored).
