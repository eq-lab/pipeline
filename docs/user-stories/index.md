# User-stories index

Story-based test cases for each implementation issue, grouped by epic. Each doc is
concrete enough for a QA agent to execute against the running app.

See [`docs/ISSUE_PROTOCOL.md` §6](../ISSUE_PROTOCOL.md) for conventions.

Styling-only stories (sizes, spacing, typography, colors) are not kept here — visual
fidelity is verified by the QA agent's Figma comparison, not by story execution.

---

## Epic #463 — Home page

| Issue                                                                                                                                                            | Doc                                                                                                       | Status                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [#247 RecentActivityCard connected state shows recent requests](https://github.com/eq-lab/pipeline/issues/247)                                                   | [247-recent-activity-connected.md](./epic-463/247-recent-activity-connected.md)                           | Migrated from `docs/STORIES.md` |
| [#250 Home Connect-Wallet section: wired Connect + Portfolio placeholder](https://github.com/eq-lab/pipeline/issues/250)                                         | [250-home-connect-portfolio-placeholder.md](./epic-463/250-home-connect-portfolio-placeholder.md)         | Migrated from `docs/STORIES.md` |
| [#372 Home: Recent activity "View All" button affordance](https://github.com/eq-lab/pipeline/issues/372)                                                         | [372-recent-activity-view-all.md](./epic-463/372-recent-activity-view-all.md)                             | Migrated from `docs/STORIES.md` |
| [#389 Home Portfolio chart: stacked-bars + hover tooltip](https://github.com/eq-lab/pipeline/issues/389)                                                         | [389-portfolio-stacked-bars-chart.md](./epic-463/389-portfolio-stacked-bars-chart.md)                     | Migrated from `docs/STORIES.md` |
| [#465 Mobile home base layout + wallet-not-connected state](https://github.com/eq-lab/pipeline/issues/465)                                                       | [465-mobile-home-base.md](./epic-463/465-mobile-home-base.md)                                             | Initial                         |
| [#466 Mobile home page balance states (0/0, has PLUSD, has sPLUSD)](https://github.com/eq-lab/pipeline/issues/466)                                               | [466-mobile-home-balance-states.md](./epic-463/466-mobile-home-balance-states.md)                         | Initial                         |
| [#476 StartHereCard Sell button dimmed style](https://github.com/eq-lab/pipeline/issues/476)                                                                     | [476-sell-button-dimmed.md](./epic-463/476-sell-button-dimmed.md)                                         | Initial                         |
| [#478 StakeCard copy fixes (APY p.a. + senior)](https://github.com/eq-lab/pipeline/issues/478)                                                                   | [478-stake-card-copy.md](./epic-463/478-stake-card-copy.md)                                               | Initial                         |
| [#508 Mobile home: Portfolio card period tabs render top-right; Figma places them left-aligned below the balance](https://github.com/eq-lab/pipeline/issues/508) | [508-mobile-portfolio-period-tabs-placement.md](./epic-463/508-mobile-portfolio-period-tabs-placement.md) | Initial                         |
| [#509 Mobile home StartHereCard (connected): missing '$X USDC' sub-line](https://github.com/eq-lab/pipeline/issues/509)                                          | [509-starthere-usdc-subline.md](./epic-463/509-starthere-usdc-subline.md)                                 | Initial                         |

---

## Epic #522 — Activity page

| Issue                                                                                                                                          | Doc                                                                                                     | Status  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| [#523 Mobile Activity page: with-data state (responsive layout + rows)](https://github.com/eq-lab/pipeline/issues/523) | [523-mobile-activity-with-data.md](./epic-522/523-mobile-activity-with-data.md) | Initial |
| [#524 Mobile Activity page: empty state](https://github.com/eq-lab/pipeline/issues/524) | [524-mobile-activity-empty-state.md](./epic-522/524-mobile-activity-empty-state.md) | Initial |
| [#530 Activity header icon: arrow-clock glyph not centered within its HeroIcon circle](https://github.com/eq-lab/pipeline/issues/530) | [530-activity-header-icon-centering.md](./epic-522/530-activity-header-icon-centering.md) | Initial |
| [#576 Mobile Activity header: arrow-clock hero circle hidden at mobile width](https://github.com/eq-lab/pipeline/issues/576) | [576-activity-mobile-hero-icon.md](./epic-522/576-activity-mobile-hero-icon.md) | Initial |

---

## Epic #531 — Stake/unstake page

| Issue                                                                                                                                                                               | Doc                                                                                                                         | Status  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| [#533 Stake/unstake page: missing wallet-disconnected state (desktop + mobile)](https://github.com/eq-lab/pipeline/issues/533) | [533-stake-wallet-disconnected-banner.md](./epic-531/533-stake-wallet-disconnected-banner.md) | Initial |
| [#534 Stake/unstake page: wrong sPLUSD icon — use the one from Figma](https://github.com/eq-lab/pipeline/issues/534) | [534-splusd-icon.md](./epic-531/534-splusd-icon.md)        | Initial |
| [#535 Stake/unstake page: PLUSD icon is blurry — replace base64 PNG with SVG](https://github.com/eq-lab/pipeline/issues/535) | [535-plusd-icon-quality.md](./epic-531/535-plusd-icon-quality.md) | Initial |
| [#540 Stake page: merge input and output/rates into one conversion card](https://github.com/eq-lab/pipeline/issues/540) | [540-stake-combined-conversion-card.md](./epic-531/540-stake-combined-conversion-card.md) | Initial |
| [#541 Stake page exchange-rate decimals fix — 1e12 inflation in rate and output preview](https://github.com/eq-lab/pipeline/issues/541) | [541-stake-exchange-rate-decimals.md](./epic-531/541-stake-exchange-rate-decimals.md) | Initial |
| [#542 Stake page: network fee row always renders "—"; Figma shows "~$1.20"](https://github.com/eq-lab/pipeline/issues/542) | [542-stake-network-fee-estimate.md](./epic-531/542-stake-network-fee-estimate.md) | Initial |

---

## Epic #556 — Connect page

| Issue                                                                                                                                           | Doc                                                                                             | Status  |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| [#558 Connect page: network tabs (EVM / Soroban) with styled wallet lists, desktop + mobile](https://github.com/eq-lab/pipeline/issues/558) | [558-connect-wallet-modal.md](./epic-556/558-connect-wallet-modal.md) | Initial |
| [#563 Connect Wallet modal: full-viewport two-pane layout](https://github.com/eq-lab/pipeline/issues/563) | [563-connect-modal-fullscreen.md](./epic-556/563-connect-modal-fullscreen.md) | Initial |
| [#564 Connect Wallet modal: right pane uses real wordmark and hero photo](https://github.com/eq-lab/pipeline/issues/564) | [564-connect-modal-hero-image.md](./epic-556/564-connect-modal-hero-image.md) | Initial |

---

## Epic #498 — Deposit/withdraw page

| Issue                                                                                                                                                                          | Doc                                                                                   | Status  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------- |
| [#501 Mobile /deposit: heading uses desktop treatment (centered bold + coin icon) instead of left-aligned mobile layout](https://github.com/eq-lab/pipeline/issues/501)        | [501-deposit-header-mobile.md](./epic-498/501-deposit-header-mobile.md)               | Initial |
| [#502 Deposit suggestion bar: Min chip reads "$1,000.00 (Min)" and chip row overflows on mobile](https://github.com/eq-lab/pipeline/issues/502)                                | [502-deposit-min-chip.md](./epic-498/502-deposit-min-chip.md)                         | Initial |
| [#503 Below-min deposit banner: serif title, wrapped Copy Address, wrong subtitle format](https://github.com/eq-lab/pipeline/issues/503)                                       | [503-below-min-banner.md](./epic-498/503-below-min-banner.md)                         | Initial |
| [#504 Below-min deposit state: USDC input card dimmed to 30% opacity; Figma keeps it fully active](https://github.com/eq-lab/pipeline/issues/504)                              | [504-below-min-input-card-opacity.md](./epic-498/504-below-min-input-card-opacity.md) | Initial |
| [#505 StepsCard mobile: step labels truncate with ellipsis and buttons are 48px tall; Figma wraps labels and uses 32px buttons](https://github.com/eq-lab/pipeline/issues/505) | [505-stepscard-mobile.md](./epic-498/505-stepscard-mobile.md)                         | Initial |
| [#507 Mobile /deposit: 16px page margins vs Figma 8px](https://github.com/eq-lab/pipeline/issues/507)                                                                          | [507-deposit-page-margins.md](./epic-498/507-deposit-page-margins.md)                 | Initial |
| [#520 Deposit/withdraw page: no wallet-disconnected state — shows disabled step card instead of banner](https://github.com/eq-lab/pipeline/issues/520)                          | [520-deposit-wallet-disconnected-banner.md](./epic-498/520-deposit-wallet-disconnected-banner.md) | Initial |
| [#549 [FE] [Stellar] Protocol contract foundation: addresses config, typed Soroban clients, SAC token support](https://github.com/eq-lab/pipeline/issues/549) | [549-stellar-protocol-contract-foundation.md](./epic-498/549-stellar-protocol-contract-foundation.md) | Initial |
