# User Stories — Issue #674: Stellar activity amounts formatted with wrong decimals

Parent epic: [#522 Activity page](https://github.com/eq-lab/pipeline/issues/522)
Issue: [#674](https://github.com/eq-lab/pipeline/issues/674)
Figma (desktop with data): node 1497-94912 | Figma (home recent activity): node 1497:95119

---

## Story 1 — Stellar Deposit/Withdraw: amount renders at correct scale (7 dp)

**As a** user with the Stellar chain active,
**I want** to see my deposit and withdrawal amounts formatted correctly (7 decimals),
**so that** the amounts on the Activity page and home Recent Activity match what I actually transacted.

### Acceptance criteria

- A 1 USDC Stellar deposit (raw: `10000000` at 7 dp) renders as `+1.00 USDC`, not `+10.00 USDC`.
- A 1,000 USDC Stellar deposit (raw: `10000000000` at 7 dp) renders as `+1,000.00 USDC`.
- The same amounts render correctly on both the `/transactions` page and the `RecentActivityCard` on the home dashboard.

### How to test

1. Open the app in a browser with a Stellar wallet connected.
2. Select the Stellar chain pill in the top bar.
3. Use the API or mock to seed a Deposit request with amount `10000000` (1 USDC at 7 dp) for the Stellar address.
4. Navigate to `/transactions` (Buy tab active by default).
5. Verify the amount displays as `+1.00 USDC`.
6. Navigate to the home dashboard and verify `RecentActivityCard` also shows `+1.00 USDC`.

---

## Story 2 — Stellar Stake/Unstake: assets and shares render at correct scale (7 dp)

**As a** user with the Stellar chain active,
**I want** to see my stake and unstake amounts formatted correctly (7 decimals),
**so that** the PLUSD and sPLUSD amounts are not zeroed out due to incorrect 18-decimal scaling.

### Acceptance criteria

- A 1 PLUSD Stellar stake (assets raw: `10000000` at 7 dp) renders as `−1.00 PLUSD`, not `−0.00 PLUSD`.
- A 0.99 sPLUSD share line (shares raw: `9900000` at 7 dp) renders as `+0.99 sPLUSD`, not `+0.00 sPLUSD`.
- The fail-loud `—` guard for missing `assets`/`shares` fields is preserved.
- The same amounts render correctly on both the `/transactions` page and the `RecentActivityCard`.

### How to test

1. Open the app in a browser with a Stellar wallet connected.
2. Select the Stellar chain pill.
3. Seed a Stake request with `assets: "10000000"` and `shares: "9900000"` for the Stellar address.
4. Navigate to `/transactions` and switch to the Stake tab.
5. Verify the row shows `−1.00 PLUSD` and `+0.99 sPLUSD`.
6. Navigate to the home dashboard and verify `RecentActivityCard` shows the same amounts.

---

## Story 3 — EVM amounts unchanged (regression guard)

**As a** user with the EVM chain active,
**I want** my deposit and stake amounts to continue rendering with EVM decimal scales (6 for USDC, 18 for PLUSD/sPLUSD),
**so that** the Stellar fix does not break the EVM experience.

### Acceptance criteria

- A 1,000 USDC EVM deposit (raw: `1000000000` at 6 dp) renders as `+1,000.00 USDC`.
- A 1,000 PLUSD EVM stake (raw: `1000000000000000000000` at 18 dp) renders as `−1,000.00 PLUSD`.
- No change to EVM amount display is visible.

### How to test

1. Open the app in a browser with an EVM wallet connected.
2. Select the EVM chain pill.
3. Navigate to `/transactions` (Buy tab).
4. Verify existing Deposit rows show the expected EVM-scaled amounts.
5. Switch to Stake tab and verify PLUSD/sPLUSD amounts are correct.
