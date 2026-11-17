---
name: e2e
description: Run the Pipeline end-to-end harness on a local stack — bring it up, run the journeys, check, read the JSON result, tear down, and report passed / ❌ / seen in the browser / not checked.
---

# E2E

Runs the scripted end-to-end harness against a disposable local stack. The contract, `checks.json` format and exit codes are in [`docs/e2e.md`](../../../docs/e2e.md).

## Before you start

- Read `AGENTS.md`, then the product specs of the journeys you run, starting from [`docs/product-specs/index.md`](../../../docs/product-specs/index.md) (docs-first). A ❌ is judged against the spec, not against what the code happens to do.
- Local only: never point anything at `stage.eqlab.net` or a production URL.

## Steps

1. Pick a tag, e.g. `$(date +%F)-a`.
2. Bring the stack up: `scripts/e2e/up.sh --tag <tag>` (see the local stack section of `docs/e2e.md`). A non-zero exit is a stack failure: report it and stop.
3. Run: `npx tsx scripts/e2e/run.ts --tag <tag> [--chains …] [--journeys …]`.
4. Check: `npx tsx scripts/e2e/check.ts --tag <tag> --json`. Exit `0`: every required check passed; `1`: a required check failed; `2`: the run itself failed.
5. Read the JSON: `ok`, every `checks[]` entry (`details`, `issue`, `finding`), `canBeRequired`, `error`. Read the `artifacts` logs (already redacted) for every ❌.
6. Do the browser passes below that apply.
7. Tear down: `scripts/e2e/down.sh --tag <tag>`, also after a failure.

## Journeys

- **Stellar LP** (`--chains stellar --journeys lp`): onboarding (email + OTP, wallet challenge, Sumsub), deposit → voucher → claim → stake → unstake → withdrawal (too early, then claim), and the API ↔ chain reconcile of TVL, PLUSD supply, positions, withdrawal queue and `/v1/financial-position`. Checks `stellar.lp.*` and `stellar.reconcile.*` are required; `stellar.known-bugs.*` are optional (BUG-37, BUG-32). The other open known bugs are listed in `docs/e2e.md` as not covered yet or not observable.

## Browser pass: LP app

Real Soroban transactions from the LP app at `http://localhost:55173`, signed by the [E2E test wallet](../../../packages/frontend/src/wallet/README.md#e2e-test-wallet) with the stack's `lp-browser` key (1000 USDC; a different LP from the one `run.ts` creates). Run it after `run.ts`, with the Playwright MCP, at desktop width (1440×900) and again at 375 px for the screens below. One pass per stack: the key is fresh on every `up.sh`.

1. **Session.** Sign-up in the browser stays blocked (no Turnstile site key on a local stack), so sign up through the API as `signupLp` in `scripts/e2e/lib/stellar-world.ts` does (`POST /v1/auth/signup` with `captcha_token: "e2e"`, the passcode from `logs/api.log`, `POST /v1/auth/verify-otp`, `POST /v1/lps/me`), then put the session in the page: `localStorage["pipeline.auth.session"] = JSON.stringify({ token, expiresAt: Date.now() + expires_in * 1000, email })` and reload. Do not link the address through the API.
2. **Connect.** Open the Connect modal → Soroban tab → **E2E test wallet** (first row) → accept the terms gate. The header shows the `lp-browser` address (`stellar keys address lp-browser` with `STELLAR_CONFIG_HOME=$E2E_HOME/stacks/<tag>/stellar`). Link the settlement address from the account page: the challenge is signed by the test wallet (SEP-53).
3. **Deposit** 100 USDC (`/deposit`). After the first deposit request, pass KYC as `passKyc` does: the applicant through `POST /v1/kyc/applicants`, then `postSumsubWebhook` from `scripts/e2e/fakes.ts` with a `GREEN` review, and wait until the relayer authorizes the address on PLUSD. Claim the deposit.
4. **Stake** part of the PLUSD (`/stake`), then **withdraw** (`/withdraw`, which opens `/deposit?direction=withdraw`): request, and claim once the queue allows it.
5. **Activity and dashboard.** `/transactions` lists every step with its amount and status; `/dashboard` shows the position. Compare each figure with the API (`/v1/requests`, `/v1/pnl`, `/v1/dashboard/summary`, `/v1/withdrawal-queue`, with the session token) and the chain: API 6-decimal USD strings against chain amounts / 10.
6. **375 px.** Resize to 375×812 and repeat the reads of step 5, plus one deposit: nothing clipped or overlapping, figures equal to desktop.

Report under "Seen in the browser" each step with ✅ or ❌, the figure pairs that differ, and screenshots of any ❌. A UI defect becomes a finding as in "New findings" below; never paste the secret, the passcode or the session token.

## Browser pass: Operations Console

<!-- filled by a later child -->

## New findings

- A defect with no check yet: add a check for it in its journey and an optional entry to `scripts/e2e/checks.json` with `"issue": "pending"` and a one-line `finding`, and describe it in the handoff. The reviewer files it as a follow-up naming the check id; the issue number then replaces `pending`.
- A check in `canBeRequired` whose bug is fixed: remove its entry from `checks.json` so it becomes required.
- Never post secrets (keys, seeds, passcodes) in a report; quote only redacted output.

## Report

```
E2E <tag> — commit <sha>, contracts stellar <ref> / evm <ref>, exit <code>

Passed: <n> required, <n> optional
❌ <check id> — <details> (issue <n> | pending: <finding> | required)
Seen in the browser: <what was looked at and what it showed>
Not checked: <journeys, chains or passes skipped, and why>
```
