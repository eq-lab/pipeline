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

| Issue                                                                                                                                 | Doc                                                                                       | Status  |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------- |
| [#523 Mobile Activity page: with-data state (responsive layout + rows)](https://github.com/eq-lab/pipeline/issues/523)                | [523-mobile-activity-with-data.md](./epic-522/523-mobile-activity-with-data.md)           | Initial |
| [#524 Mobile Activity page: empty state](https://github.com/eq-lab/pipeline/issues/524)                                               | [524-mobile-activity-empty-state.md](./epic-522/524-mobile-activity-empty-state.md)       | Initial |
| [#530 Activity header icon: arrow-clock glyph not centered within its HeroIcon circle](https://github.com/eq-lab/pipeline/issues/530) | [530-activity-header-icon-centering.md](./epic-522/530-activity-header-icon-centering.md) | Initial |
| [#576 Mobile Activity header: arrow-clock hero circle hidden at mobile width](https://github.com/eq-lab/pipeline/issues/576)          | [576-activity-mobile-hero-icon.md](./epic-522/576-activity-mobile-hero-icon.md)           | Initial |
| [#644 Activity page + home: chain-aware empty state (Stellar/EVM gating)](https://github.com/eq-lab/pipeline/issues/644)              | [644-activity-active-chain-gating.md](./epic-522/644-activity-active-chain-gating.md)     | Initial |

---

## Epic #531 — Stake/unstake page

| Issue                                                                                                                                   | Doc                                                                                           | Status  |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------- |
| [#533 Stake/unstake page: missing wallet-disconnected state (desktop + mobile)](https://github.com/eq-lab/pipeline/issues/533)          | [533-stake-wallet-disconnected-banner.md](./epic-531/533-stake-wallet-disconnected-banner.md) | Initial |
| [#534 Stake/unstake page: wrong sPLUSD icon — use the one from Figma](https://github.com/eq-lab/pipeline/issues/534)                    | [534-splusd-icon.md](./epic-531/534-splusd-icon.md)                                           | Initial |
| [#535 Stake/unstake page: PLUSD icon is blurry — replace base64 PNG with SVG](https://github.com/eq-lab/pipeline/issues/535)            | [535-plusd-icon-quality.md](./epic-531/535-plusd-icon-quality.md)                             | Initial |
| [#540 Stake page: merge input and output/rates into one conversion card](https://github.com/eq-lab/pipeline/issues/540)                 | [540-stake-combined-conversion-card.md](./epic-531/540-stake-combined-conversion-card.md)     | Initial |
| [#541 Stake page exchange-rate decimals fix — 1e12 inflation in rate and output preview](https://github.com/eq-lab/pipeline/issues/541) | [541-stake-exchange-rate-decimals.md](./epic-531/541-stake-exchange-rate-decimals.md)         | Initial |
| [#542 Stake page: network fee row always renders "—"; Figma shows "~$1.20"](https://github.com/eq-lab/pipeline/issues/542)              | [542-stake-network-fee-estimate.md](./epic-531/542-stake-network-fee-estimate.md)             | Initial |
| [#610 Stake header icon differs from Figma](https://github.com/eq-lab/pipeline/issues/610)                                              | [610-stake-header-icon.md](./epic-531/610-stake-header-icon.md)                               | Initial |
| [#611 Stake header heading renders bold; Figma uses regular weight](https://github.com/eq-lab/pipeline/issues/611)                      | [611-stake-header-font-weight.md](./epic-531/611-stake-header-font-weight.md)                 | Initial |
| [#612 Stake header bottom spacing too small vs deposit page](https://github.com/eq-lab/pipeline/issues/612)                             | [612-stake-header-bottom-spacing.md](./epic-531/612-stake-header-bottom-spacing.md)           | Initial |
| [#613 Stake input section: gap between tabs and input should be 2px](https://github.com/eq-lab/pipeline/issues/613)                     | [613-stake-input-gap.md](./epic-531/613-stake-input-gap.md)                                   | Initial |
| [#614 Token input chips use pill radius; Figma uses 4px (shared with deposit)](https://github.com/eq-lab/pipeline/issues/614)           | [614-token-input-chip-radius.md](./epic-531/614-token-input-chip-radius.md)                   | Initial |
| [#615 token-amount-display has stray border and asymmetric padding](https://github.com/eq-lab/pipeline/issues/615)                      | [615-stake-output-no-nested-border.md](./epic-531/615-stake-output-no-nested-border.md)       | Initial |
| [#633 [FE] [Stellar] Stake/unstake flow: deposit → redeem vault hooks](https://github.com/eq-lab/pipeline/issues/633)                   | [633-stellar-stake-unstake-hooks.md](./epic-531/633-stellar-stake-unstake-hooks.md)           | Initial |
| [#634 [FE] [Stellar] Stake page: chain-aware wiring (steps, trustline, XLM fee, all states)](https://github.com/eq-lab/pipeline/issues/634) | [634-stellar-stake-chain-aware-wiring.md](./epic-531/634-stellar-stake-chain-aware-wiring.md) | Initial |

---

## Epic #556 — Connect page

| Issue                                                                                                                                       | Doc                                                                           | Status  |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| [#558 Connect page: network tabs (EVM / Soroban) with styled wallet lists, desktop + mobile](https://github.com/eq-lab/pipeline/issues/558) | [558-connect-wallet-modal.md](./epic-556/558-connect-wallet-modal.md)         | Initial |
| [#563 Connect Wallet modal: full-viewport two-pane layout](https://github.com/eq-lab/pipeline/issues/563)                                   | [563-connect-modal-fullscreen.md](./epic-556/563-connect-modal-fullscreen.md) | Initial |
| [#564 Connect Wallet modal: right pane uses real wordmark and hero photo](https://github.com/eq-lab/pipeline/issues/564)                    | [564-connect-modal-hero-image.md](./epic-556/564-connect-modal-hero-image.md) | Initial |
| [#579 Connect hero asset fix: text-free photo and white wordmark](https://github.com/eq-lab/pipeline/issues/579)                            | [579-connect-hero-asset.md](./epic-556/579-connect-hero-asset.md)             | Initial |
| [#572 Connect Wallet modal: heading + right-pane headline render at 16px (missing heading-l token)](https://github.com/eq-lab/pipeline/issues/572) | [572-heading-l-token.md](./epic-556/572-heading-l-token.md)                   | Initial |
| [#575 Connect Wallet modal: right-pane headline anchored to bottom instead of top under the logo](https://github.com/eq-lab/pipeline/issues/575) | [575-right-pane-headline-top.md](./epic-556/575-right-pane-headline-top.md)   | Initial |
| [#580 Connect modal right pane: overlay headline size and position](https://github.com/eq-lab/pipeline/issues/580)                          | [580-connect-modal-headline.md](./epic-556/580-connect-modal-headline.md)     | Initial |
| [#638 Connect Wallet modal: every "Connect Wallet" button opens the same modal](https://github.com/eq-lab/pipeline/issues/638)              | [638-connect-wallet-modal-everywhere.md](./epic-556/638-connect-wallet-modal-everywhere.md) | Initial |
| [#639 Connect Wallet modal: 'Before you continue' gate should precede the modal](https://github.com/eq-lab/pipeline/issues/639)              | [639-wallet-gate-before-modal.md](./epic-556/639-wallet-gate-before-modal.md)               | Initial |
| [#573 Connect Wallet modal: content jumps vertically when switching EVM/Soroban tabs](https://github.com/eq-lab/pipeline/issues/573)         | [573-connect-modal-tab-jump.md](./epic-556/573-connect-modal-tab-jump.md)                   | Initial |

---

## Epic #498 — Deposit/withdraw page

| Issue                                                                                                                                                                          | Doc                                                                                                   | Status  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------- |
| [#501 Mobile /deposit: heading uses desktop treatment (centered bold + coin icon) instead of left-aligned mobile layout](https://github.com/eq-lab/pipeline/issues/501)        | [501-deposit-header-mobile.md](./epic-498/501-deposit-header-mobile.md)                               | Initial |
| [#502 Deposit suggestion bar: Min chip reads "$1,000.00 (Min)" and chip row overflows on mobile](https://github.com/eq-lab/pipeline/issues/502)                                | [502-deposit-min-chip.md](./epic-498/502-deposit-min-chip.md)                                         | Initial |
| [#503 Below-min deposit banner: serif title, wrapped Copy Address, wrong subtitle format](https://github.com/eq-lab/pipeline/issues/503)                                       | [503-below-min-banner.md](./epic-498/503-below-min-banner.md)                                         | Initial |
| [#504 Below-min deposit state: USDC input card dimmed to 30% opacity; Figma keeps it fully active](https://github.com/eq-lab/pipeline/issues/504)                              | [504-below-min-input-card-opacity.md](./epic-498/504-below-min-input-card-opacity.md)                 | Initial |
| [#505 StepsCard mobile: step labels truncate with ellipsis and buttons are 48px tall; Figma wraps labels and uses 32px buttons](https://github.com/eq-lab/pipeline/issues/505) | [505-stepscard-mobile.md](./epic-498/505-stepscard-mobile.md)                                         | Initial |
| [#507 Mobile /deposit: 16px page margins vs Figma 8px](https://github.com/eq-lab/pipeline/issues/507)                                                                          | [507-deposit-page-margins.md](./epic-498/507-deposit-page-margins.md)                                 | Initial |
| [#520 Deposit/withdraw page: no wallet-disconnected state — shows disabled step card instead of banner](https://github.com/eq-lab/pipeline/issues/520)                         | [520-deposit-wallet-disconnected-banner.md](./epic-498/520-deposit-wallet-disconnected-banner.md)     | Initial |
| [#549 [FE] [Stellar] Protocol contract foundation: addresses config, typed Soroban clients, SAC token support](https://github.com/eq-lab/pipeline/issues/549)                  | [549-stellar-protocol-contract-foundation.md](./epic-498/549-stellar-protocol-contract-foundation.md) | Initial |
| [#550 [FE] [Stellar] Deposit flow: request_deposit → voucher → claim_request hooks](https://github.com/eq-lab/pipeline/issues/550)                                             | [550-stellar-deposit-hooks.md](./epic-498/550-stellar-deposit-hooks.md)                               | Initial |
| [#551 [FE] [Stellar] Withdraw flow: request_withdrawal → voucher → claim_request hooks](https://github.com/eq-lab/pipeline/issues/551)                                         | [551-stellar-withdraw-hooks.md](./epic-498/551-stellar-withdraw-hooks.md)                             | Initial |
| [#552 [FE] [Stellar] Deposit/withdraw page: chain-aware wiring (steps, trustline, XLM fee, all states)](https://github.com/eq-lab/pipeline/issues/552)                         | [552-stellar-deposit-withdraw-wiring.md](./epic-498/552-stellar-deposit-withdraw-wiring.md)           | Initial |
| [#595 Styling fixes for deposit/withdraw page](https://github.com/eq-lab/pipeline/issues/595)                                                                                  | [595-styling-fixes-deposit-withdraw.md](./epic-498/595-styling-fixes-deposit-withdraw.md)             | Initial |
| [#598 [FE] Set Stellar deposit minimum to 1 USDC](https://github.com/eq-lab/pipeline/issues/598)                                                                               | [598-stellar-min-deposit-one.md](./epic-498/598-stellar-min-deposit-one.md)                           | Initial |
| [#604 [FE] [Stellar] Show PLUSD + USDC trustline status with per-asset 'Enable' button](https://github.com/eq-lab/pipeline/issues/604)                                         | [604-stellar-trustline-dual-enable.md](./epic-498/604-stellar-trustline-dual-enable.md)               | Initial |
| [#606 Fix connect-wallet banner background color to #F8FCE9](https://github.com/eq-lab/pipeline/issues/606)                                                                    | [606-connect-wallet-banner-background.md](./epic-498/606-connect-wallet-banner-background.md)         | Initial |
| [#607 Add card shadow to connect-wallet banner](https://github.com/eq-lab/pipeline/issues/607)                                                                                 | [607-connect-wallet-banner-shadow.md](./epic-498/607-connect-wallet-banner-shadow.md)                 | Initial |
| [#608 Match connect-wallet-banner Connect button to Figma (compact size, 8px radius)](https://github.com/eq-lab/pipeline/issues/608)                                           | [608-banner-connect-button-compact.md](./epic-498/608-banner-connect-button-compact.md)               | Initial |
| [#631 Persist selected chain (EVM/Stellar) globally across page reloads](https://github.com/eq-lab/pipeline/issues/631)                                                        | [631-persist-selected-chain.md](./epic-498/631-persist-selected-chain.md)                             | Initial |
| [#636 Stellar deposit: Claim button shows pending state while /voucher is pending (should be Deposit)](https://github.com/eq-lab/pipeline/issues/636)                          | [636-stellar-claim-button-pending-state.md](./epic-498/636-stellar-claim-button-pending-state.md)     | Initial |
| [#640 Deposit: token-input-chips stay clickable when wallet is not connected](https://github.com/eq-lab/pipeline/issues/640)                                                    | [640-token-input-chips-disabled.md](./epic-498/640-token-input-chips-disabled.md)                     | Initial |
| [#641 [FE] Set Stellar deposit minimum to 1,000 USDC (reverses #598)](https://github.com/eq-lab/pipeline/issues/641)                                                           | [641-stellar-deposit-min-1000.md](./epic-498/641-stellar-deposit-min-1000.md)                         | Initial |
| [#656 Deposit/withdraw: hide bottom actions block while chain data / API are loading](https://github.com/eq-lab/pipeline/issues/656)                                            | [656-hide-bottom-block-while-data-pending.md](./epic-498/656-hide-bottom-block-while-data-pending.md) | Initial |
| [#658 [FE] [Stellar] Deposit: show 'Add USDC trustline' banner when USDC trustline missing](https://github.com/eq-lab/pipeline/issues/658)                                     | [658-stellar-usdc-trustline-banner.md](./epic-498/658-stellar-usdc-trustline-banner.md)               | Initial |
