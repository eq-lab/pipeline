# E2E release run — 2026-11-18

The full run of the [e2e harness](../e2e.md) for the epic's release (#1971): both chains, every journey, the three browser passes.

```
E2E 2026-11-18-a — commit 58f7102e, contracts stellar 7646cef / evm 3b74e98, exit 0

Passed: 54 required, 2 optional
❌ stellar.known-bugs.lps-openapi-query — payment_details is in "path" (issue #1990, BUG-37)
❌ stellar.known-bugs.assay-decimal-bound — HTTP 404: validation accepted it and the request reached the loan lookup (issue #1991, BUG-32)
❌ stellar.loan-book.ltv-bps — API ltv_bps null (price_stale null) vs chain 8889–8889 bps (issue #1998)
❌ evm.lp.voucher-deadline — the API returned deadline null (deposit), null (withdrawal) (issue #1798)
Seen in the browser: see "Browser passes" below
Not checked: the Stellar LP app deposit and withdrawal (BUG-39)
```

Every failing check is optional and has an issue. The run used `checks.json` before this change, so the result below shows the first three as `"pending"`; `checks.json` now carries #1990, #1991 and #1998. No entry is left `pending`.

## Commands and durations

On a warm machine (contracts caches built, images pulled), one stack, tag `2026-11-18-a`:

| Phase | Command | Duration |
|-------|---------|----------|
| up | `scripts/e2e/up.sh --tag 2026-11-18-a --reclaim` (both chains) | 448 s |
| run | `npx tsx scripts/e2e/run.ts --tag 2026-11-18-a` | 87 s (90 s wall with `tsx` start) |
| check | `npx tsx scripts/e2e/check.ts --tag 2026-11-18-a --json` | 0 s (rounded; exit `0`) |
| total | up + run + check | 535 s ≈ 9 min, within the 30 min limit |

`scripts/e2e/down.sh --tag 2026-11-18-a` ran after the browser passes: `stack 2026-11-18-a down`.

## Result

`check.ts --json`, one check per line:

```json
{
  "schemaVersion": 1,
  "tag": "2026-11-18-a",
  "commit": "58f7102ed7441f9669df1ac6ea29064f6e200c6f",
  "contracts": { "stellar": "7646cef", "evm": "3b74e98" },
  "startedAt": "2026-11-18T02:10:04.056Z",
  "finishedAt": "2026-11-18T02:11:44.743Z",
  "durations": { "up": 448, "run": 87, "check": 0 },
  "ok": true,
  "checks": [
    { "id": "stellar.lp.onboarding", "ok": true, "optional": false, "title": "LP signs up by email + OTP, links its wallet by challenge, passes Sumsub and is whitelisted on PLUSD" },
    { "id": "stellar.lp.operators", "ok": true, "optional": false, "title": "Trustee, originator and team rows in auth_users; the trustee signs in by wallet challenge" },
    { "id": "stellar.lp.deposit-voucher", "ok": true, "optional": false, "title": "Deposit request → the API serves a voucher for it with a deadline within 24 h" },
    { "id": "stellar.lp.deposit-claim", "ok": true, "optional": false, "title": "Claiming the voucher mints the deposit in PLUSD" },
    { "id": "stellar.lp.stake", "ok": true, "optional": false, "title": "Staking PLUSD mints sPLUSD shares" },
    { "id": "stellar.lp.unstake", "ok": true, "optional": false, "title": "Redeeming sPLUSD returns PLUSD" },
    { "id": "stellar.lp.withdrawal-too-early", "ok": true, "optional": false, "title": "Claiming an unfunded withdrawal fails with TooEarly (#2)" },
    { "id": "stellar.lp.withdrawal-claim", "ok": true, "optional": false, "title": "Once funded, the withdrawal claim pays USDC at the queue rate and burns the PLUSD" },
    { "id": "stellar.reconcile.tvl", "ok": true, "optional": false, "title": "Dashboard TVL equals deposits requested minus withdrawals paid on chain" },
    { "id": "stellar.reconcile.plusd-supply", "ok": true, "optional": false, "title": "PLUSD supply on chain equals the API TVL less unclaimed deposits" },
    { "id": "stellar.reconcile.positions", "ok": true, "optional": false, "title": "API positions and request statuses match the chain (sPLUSD shares, claimed requests)" },
    { "id": "stellar.reconcile.withdrawal-queue", "ok": true, "optional": false, "title": "Withdrawal queue totals and rate in the API match the contract" },
    { "id": "stellar.reconcile.financial-position", "ok": true, "optional": false, "title": "/v1/financial-position secured loans outstanding equals the loan registry's outstanding total" },
    { "id": "stellar.known-bugs.lps-openapi-query", "ok": false, "optional": true, "title": "OpenAPI documents GET /v1/lps payment_details as a query parameter (BUG-37)", "details": "payment_details is in \"path\"", "issue": "pending", "finding": "BUG-37 (known-bugs.md): GET /v1/lps OpenAPI documents payment_details as a required path parameter" },
    { "id": "stellar.known-bugs.assay-decimal-bound", "ok": false, "optional": true, "title": "An assay grade with an unbounded exponent (1e1000) is refused with 400 (BUG-32)", "details": "HTTP 404: validation accepted it and the request reached the loan lookup", "issue": "pending", "finding": "BUG-32 (known-bugs.md): assay validation accepts unbounded decimal exponents" },
    { "id": "stellar.loan.submission", "ok": true, "optional": false, "title": "The originator submits through the API, the trustee approves, and the API serves the draw_loan args in contract units" },
    { "id": "stellar.loan.documents", "ok": true, "optional": false, "title": "Loan documents stored in MinIO are served unchanged through the IPFS stub and listed in the loan book" },
    { "id": "stellar.loan.draw", "ok": true, "optional": false, "title": "draw_loan through the AccessManager mints the loan as Approved with the submitted economics, and the API links the submission" },
    { "id": "stellar.loan.disburse", "ok": true, "optional": false, "title": "The loan's debt token is registered; the Cash reporter's record_wire_in books the cash; disburse draws the senior tranche and the loan turns Performing" },
    { "id": "stellar.loan.collateral", "ok": true, "optional": false, "title": "A perfected warehouse pledge marked at the static price values the collateral on the security registry, with the receipt's hash" },
    { "id": "stellar.loan.margin-call", "ok": true, "optional": false, "title": "Marking the collateral down past the margin-call ratio opens a margin call on chain" },
    { "id": "stellar.loan.repay", "ok": true, "optional": false, "title": "repay through the minter books principal and accrued interest, clears the outstanding and mints the interest to sPLUSD" },
    { "id": "stellar.loan.close", "ok": true, "optional": false, "title": "close_loan with EarlyRepayment closes the repaid loan" },
    { "id": "stellar.loan-book.entry", "ok": true, "optional": false, "title": "/v1/loan-book principal, senior and rate of the loan match the loan registry" },
    { "id": "stellar.loan-book.collateral", "ok": true, "optional": false, "title": "/v1/loan-book values the collateral at the static price × quantity, less the haircut" },
    { "id": "stellar.loan-book.ltv-range", "ok": true, "optional": true, "title": "Loan-book LTV is within 0–200% and equals principal / collateral (#765)", "details": "LTV 0.4000 (40.00%): principal 1000.000000 / collateral 2500.000000 = 0.4000", "issue": 765 },
    { "id": "stellar.loan-book.margin-call", "ok": true, "optional": false, "title": "/v1/loan-book margin_call_open matches the security registry's open margin call" },
    { "id": "stellar.loan-book.ltv-bps", "ok": false, "optional": true, "title": "/v1/loan-book ltv_bps equals the security registry's LTV (debt / collateral value, rounded up)", "details": "API ltv_bps null (price_stale null) vs chain 8889–8889 bps", "issue": "pending", "finding": "GET /v1/loan-book ltv_bps (and price_stale) stay null on Stellar: the worker's security valuation reads SecurityRegistry coverage_detail, which the e2e stack's pinned contracts (7646cef) do not have" },
    { "id": "stellar.loan-book.summary", "ok": true, "optional": false, "title": "While the loan is active: weighted rate, deployed senior, /v1/dashboard/summary and /v1/financial-position match the registry" },
    { "id": "stellar.loan-book.closed", "ok": true, "optional": false, "title": "After close the loan book shows the loan Closed with what was repaid; deployed senior and secured loans drop it" },
    { "id": "stellar.loan-book.yield", "ok": true, "optional": false, "title": "/v1/dashboard/summary cumulative yield equals the interest the minter minted to sPLUSD" },
    { "id": "evm.lp.onboarding", "ok": true, "optional": false, "title": "LP signs up by email + OTP, links its EVM wallet by personal_sign challenge, passes Sumsub and is allowed on the WhitelistRegistry" },
    { "id": "evm.lp.deposit-voucher", "ok": true, "optional": false, "title": "approve + requestDeposit moves the USDC; the API serves an EIP-712 voucher for the request" },
    { "id": "evm.lp.voucher-deadline", "ok": false, "optional": true, "title": "EVM deposit and withdrawal vouchers carry a deadline within 24 h (#1798)", "details": "the API returned deadline null (deposit), null (withdrawal)", "issue": 1798 },
    { "id": "evm.lp.deposit-claim", "ok": true, "optional": false, "title": "claimDeposit with the voucher mints the deposit in PLUSD" },
    { "id": "evm.lp.stake", "ok": true, "optional": false, "title": "Staking PLUSD mints sPLUSD shares" },
    { "id": "evm.lp.unstake", "ok": true, "optional": false, "title": "Redeeming sPLUSD returns PLUSD" },
    { "id": "evm.lp.withdrawal-too-early", "ok": true, "optional": false, "title": "Claiming an unfunded withdrawal reverts with WithdrawalQueueTooEarly" },
    { "id": "evm.lp.withdrawal-claim", "ok": true, "optional": false, "title": "Once funded, claimWithdrawal pays USDC at the queue rate and burns the PLUSD" },
    { "id": "evm.reconcile.tvl", "ok": true, "optional": false, "title": "Dashboard TVL for 31337 equals deposits requested minus withdrawals paid on chain" },
    { "id": "evm.reconcile.plusd-supply", "ok": true, "optional": false, "title": "PLUSD totalSupply equals the API TVL less unclaimed deposits" },
    { "id": "evm.reconcile.positions", "ok": true, "optional": false, "title": "API positions and request statuses match the chain (sPLUSD shares, claimed requests)" },
    { "id": "evm.reconcile.withdrawal-queue", "ok": true, "optional": false, "title": "/v1/withdrawal-queue items and in-queue amount match the queue's totalQueued and totalClaimed" },
    { "id": "evm.reconcile.financial-position", "ok": true, "optional": false, "title": "/v1/financial-position secured loans outstanding equals the loan registry's outstandingTotal" },
    { "id": "evm.loan.submission", "ok": true, "optional": false, "title": "The originator submits a 31337 loan through the API and the trustee approves it" },
    { "id": "evm.loan.documents", "ok": true, "optional": false, "title": "Loan documents stored in MinIO are served unchanged through the IPFS stub and listed in the 31337 loan book" },
    { "id": "evm.loan.draw", "ok": true, "optional": false, "title": "drawLoan mints the loan as Approved with the submitted economics in 6-decimal units and the rate in ppm, and the API links the submission" },
    { "id": "evm.loan.disburse", "ok": true, "optional": false, "title": "registerDeal, the Cash reporter's recordWireIn books the cash, disburse draws the senior tranche; the loan turns Performing and the DEBT token tracks it" },
    { "id": "evm.loan.collateral", "ok": true, "optional": false, "title": "A controlled cargo lot with the warehouse receipt's hash, marked at the static price, values the collateral on the collateral registry above the floor" },
    { "id": "evm.loan.margin-call", "ok": true, "optional": false, "title": "Marking the collateral down below the coverage floor emits MarginCall on the collateral registry" },
    { "id": "evm.loan.repay", "ok": true, "optional": false, "title": "repay through the minter books principal and accrued interest, clears the outstanding and the DEBT token, and mints the interest to sPLUSD" },
    { "id": "evm.loan.close", "ok": true, "optional": false, "title": "closeLoan with EarlyRepayment closes the repaid loan" },
    { "id": "evm.loan-book.entry", "ok": true, "optional": false, "title": "/v1/loan-book principal, senior tranche and senior outstanding of the 31337 loan match the loan registry" },
    { "id": "evm.loan-book.rate", "ok": true, "optional": false, "title": "/v1/loan-book rate of the 31337 loan is the registry's ppm rate as a fraction (#765, fixed in #1434)", "details": "API rate 0.120000 vs chain currentRate 120000 ppm = 0.120000 (submitted 1200 bps)" },
    { "id": "evm.loan-book.collateral", "ok": true, "optional": false, "title": "/v1/loan-book values the 31337 collateral at the static price × quantity, less the haircut" },
    { "id": "evm.loan-book.ltv-range", "ok": true, "optional": true, "title": "31337 loan-book LTV is within 0–200% and equals principal / collateral (#765)", "details": "LTV 0.4000 (40.00%): principal 1000.000000 / collateral 2500.000000 = 0.4000", "issue": 765 },
    { "id": "evm.loan-book.margin-call", "ok": true, "optional": false, "title": "/v1/audit-log shows the collateral registry's MarginCall for the 31337 loan with its coverage and floor" },
    { "id": "evm.loan-book.summary", "ok": true, "optional": false, "title": "While the 31337 loan is active: weighted rate, deployed senior, /v1/dashboard/summary and /v1/financial-position match the registry" },
    { "id": "evm.loan-book.closed", "ok": true, "optional": false, "title": "After close the 31337 loan book shows the loan Closed with what was repaid; deployed senior and secured loans drop it" },
    { "id": "evm.loan-book.yield", "ok": true, "optional": false, "title": "/v1/dashboard/summary cumulative yield for 31337 equals the interest the minter minted to sPLUSD" }
  ],
  "canBeRequired": ["stellar.loan-book.ltv-range", "evm.loan-book.ltv-range"],
  "artifacts": ["logs/api.log", "logs/build.log", "logs/compose.log", "logs/deploy.log", "logs/evm-deploy.log", "logs/fakes.log", "logs/lp.log", "logs/trustee.log", "logs/worker.log"]
}
```

Both `ltv-range` checks pass and are in `canBeRequired`; their entries stay in `checks.json` because #765 (the Hoodi data defect) is still open.

## Browser passes

Driven with the Playwright MCP (headless Chromium 158), against the stack above, after `run.ts`, desktop 1440×900 and then 375×812. The Chrome DevTools MCP of `.mcp.json` was not available to the agent, and no `chromium` is on the `PATH`. Sessions came from the API as the skill describes (`captcha_token: "e2e"`, the passcode from `logs/api.log`), a fresh email per LP pass. Console errors in every pass: only Reown / WalletConnect `403`/`400` for the placeholder project id `e2e`.

### LP app on Stellar — ❌ blocked after Connect (BUG-39)

| Step | Result |
|------|--------|
| Session | ✅ signed in; "Finish account setup" dialog shown and closed |
| Connect | ✅ terms gate first, then Stellar tab → **E2E test wallet** (first row); the account page shows `GDQUX6…KZK7`, the stack's `lp-browser` key. The header shows only the Account button, not the address |
| Link settlement address | ✅ SEP-53 challenge signed by the test wallet; "Linked to your connected wallet" |
| Deposit | ❌ USDC balance shows `—` and the amount input stays disabled; Horizon serves 1000 USDC for the account. `Horizon.Server` refuses the stack's `http://localhost:58000` without `allowHttp` (BUG-39), and the PLUSD trustline step uses the same client |
| Stake, withdraw, activity, 375 px | not walked: blocked by the deposit |

### LP app on EVM — ✅ with two UI defects

Test wallet `0x315D…bB3E` (from `E2E_EVM_WALLET_KEY`; 1000 USDC).

| Step | Result |
|------|--------|
| Session, connect | ✅ terms gate, Ethereum tab → **E2E test wallet**; account page: `0x315D…bB3E`, USDC $1,000.00, header network "Chain 31337" |
| Link | ✅ `personal_sign` challenge; settlement address `0x315d…bb3e` |
| Deposit | ✅ `approve` and `requestDeposit` of **1000** USDC: the anvil minimum is 1000 (`$1,000 (Min)` chip), so the skill's 100 is refused. KYC by `sumsubGreen` (`31337`, the lower-cased address) |
| Claim | ❌ then ✅: with 0 USDC left the page shows "Add funds to your USDC balance" instead of the steps, so Claim is unreachable (BUG-40). After topping the wallet up with `anvil_dealERC20` (1000 USDC) the steps return and `claimDeposit` mints 1000 PLUSD |
| Stake | ✅ 600 PLUSD (`approve` + `deposit`) → 600.00 sPLUSD shown; chain 599.999973 shares |
| Withdraw | ✅ `requestWithdrawal` of the remaining 400 PLUSD. The first claim reverted `ERC20InsufficientAllowance(queue, 0, 400e6)`: the journey's own claim had used the custodian's approval. The toast read "That request could not be found…" (BUG-41). After the custodian (unlocked anvil account) approved the queue for 400 USDC, `claimWithdrawal` paid 400 USDC |
| Activity | ✅ Sell +400.00 USDC, Stake −600.00 PLUSD / +600.00 sPLUSD, Buy +1,000.00 PLUSD; API `/v1/requests`: Withdraw 400000000, Stake 600000000 (shares 599999973), Deposit 1000000000, all `Completed` |
| Dashboard | ✅ Total Balance $600.00 (= sPLUSD position), $0.00 unrealized (API `total_unrealized_pnl` −27 base units), TVL $1.8K (API `tvl` 1800.000018); chain: PLUSD 0, USDC 1400 (1000 dealt + 400 claimed), sPLUSD 599.999973 |
| 375 px | ✅ hamburger menu; Activity and Home figures equal desktop; `scrollWidth` 375 (the stats strip scrolls inside its own `overflow-x: auto` wrapper); a second 1000 USDC deposit request went through, and the Claim step was hidden again (BUG-40) |

### Operations Console on Stellar — ✅

Signed in through the Connect modal → Stellar → **E2E test wallet** as `GBMWGN…2GPV` (the stack's `trustee` key), "Trustee · connected". API reads below signed in as `signIn` does.

| Step | Result |
|------|--------|
| Loan book (`/loans`, chain Stellar) | ✅ deployed senior $0, at-risk $0, weighted rate and tenor `—`, top concentration `—` (API `summary`: 0 / 0 / null); tabs All 1, Active 0, Watchlist 0, Default 0, Closed 1; the row: senior outstanding $0.00, LTV `—` (`ltv_bps` null, #1998), a "Margin call" chip, nearest payment 16 Feb 2027 (`1802743833`), stage Closed |
| Loan detail (`/loans/0?chain=99000001`) | ✅ facility / disbursed $1K / $800, repaid to date $800 (`800.000030`), interest to distribute $0 (`not_minted_yield` 0), epoch 1 · 12.0 % · 18 Nov 2026 → 16 Feb 2027, offtaker $1.1K / principal $1K / interest $0, offtaker still owed $300 of $1.1K (`299.999970`), warehouse pledge Active, XAU $900 per Mt, margin call "Open since 18 Nov 2026 · cure by 25 Nov 2026" (`opened_at` 1794967855, `cure_by` 1795572655); LTV, security value and amount owed `—` because `valuation` is null (#1998), with "Updating from chain…" (`refresh_pending: true`) |
| Attention counts | ✅ sidebar Cash Management badge 1 = `cash_management.count` 1 (one escrowed wire-in); origination and loans 0, so the overview shows no Needs attention section |
| 375 px | the console is desktop-only by decision #786-5 ([trustee-flows.md](../frontend/trustee-flows.md)): the sidebar fills the viewport and the page scrolls to 680 px; `/loans` figures equal desktop |

No percentage outside 0–200 % was shown. Observations, not ❌ (the figures equal the API): the closed Stellar loan still shows an open margin call, because the security registry keeps `margin_call_at` after `close_loan`; the first margin-call event in `/security` carries `ltv_bps` 4294967295 (`u32::MAX`, no valuation at that moment).
