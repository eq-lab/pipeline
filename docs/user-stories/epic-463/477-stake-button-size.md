# User Stories: #477 — StakeCard circular Stake button size on mobile

Epic: [#463 — Home page](https://github.com/eq-lab/pipeline/issues/463)
Issue: [#477](https://github.com/eq-lab/pipeline/issues/477)

Breakpoint: `md` (768px). Below 768px is mobile; 768px and above is desktop.

Figma references:
- Mobile frame: `1989-8292` (402px viewport)
- Stake button node: `2113:9115` — 88×88px, bottom-right of StakeCard

---

## Story 1 — Stake button is 88px on mobile (disconnected)

**Given** the app is viewed at a mobile viewport (< 768px, e.g. 402px wide)
**And** the wallet is disconnected
**When** the home page renders
**Then** the circular "Stake" button inside StakeCard measures 88×88px
**And** the button remains anchored at the bottom-right of the card

### Verification steps

1. Open the app at a 402px viewport width (use browser DevTools device emulation).
2. On the home page, locate the StakeCard (right column of the Balances + Stake row).
3. Inspect the circular navy "Stake" button.
4. Confirm computed width = 88px and computed height = 88px.
5. Confirm the button is visually at the bottom-right corner of the card.

---

## Story 2 — Stake button is 88px on mobile (State A: connected, zero balance)

**Given** the wallet is connected with zero PLUSD and zero sPLUSD (State A)
**And** the viewport is < 768px
**When** the home page renders
**Then** the circular "Nothing to Stake" button measures 88×88px
**And** the button is in its disabled state

### Verification steps

1. Seed State A via localStorage:
   ```js
   localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
   localStorage.setItem("pipeline.mock.wallet.address", "0x1234000000000000000000000000000000000001");
   localStorage.setItem("pipeline.mock.wallet.contract.erc20.balance.0xaaaa000000000000000000000000000000000001", "0");
   localStorage.setItem("pipeline.mock.wallet.contract.erc20.balance.0xbbbb000000000000000000000000000000000001", "0");
   ```
2. At 402px viewport, inspect the circular "Nothing to Stake" button.
3. Confirm computed width = 88px and height = 88px.
4. Confirm the button has `disabled` attribute set.

---

## Story 3 — Stake button is 88px on mobile (State B: has PLUSD)

**Given** the wallet is connected with a non-zero PLUSD balance (State B)
**And** the viewport is < 768px
**When** the home page renders
**Then** the circular "Stake" button measures 88×88px and is enabled

### Verification steps

1. Seed State B (non-zero PLUSD, zero sPLUSD) and reload at 402px viewport.
2. Inspect the circular "Stake" button — confirm 88×88px.
3. Confirm the button is enabled (no `disabled` attribute).

---

## Story 4 — Stake More button is 88px on mobile (State C: has sPLUSD)

**Given** the wallet is connected with a non-zero sPLUSD balance (State C)
**And** the viewport is < 768px
**When** the home page renders
**Then** the circular "Stake More" button measures 88×88px

### Verification steps

1. Seed State C and reload at 402px viewport.
2. Locate the "Stake More" circular button inside the StakeCard.
3. Confirm computed width = 88px and height = 88px.

---

## Story 5 — Stake button remains 128px on desktop

**Given** the app is viewed at a desktop viewport (>= 768px)
**When** the home page renders
**Then** the circular "Stake" button measures 128×128px (desktop spec unchanged)

### Verification steps

1. Open the app at a 1280px viewport width.
2. Locate the StakeCard in the 7-column desktop grid.
3. Inspect the circular "Stake" button.
4. Confirm computed width = 128px and height = 128px.
