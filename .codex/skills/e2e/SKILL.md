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

## Journeys

- **Stellar LP** (`--chains stellar --journeys lp`): onboarding (email + OTP, wallet challenge, Sumsub), deposit → voucher → claim → stake → unstake → withdrawal (too early, then claim), and the API ↔ chain reconcile of TVL, PLUSD supply, positions, withdrawal queue and `/v1/financial-position`. Checks `stellar.lp.*` and `stellar.reconcile.*` are required; `stellar.known-bugs.*` are optional (BUG-37, BUG-32). The other open known bugs are listed in `docs/e2e.md` as not covered yet or not observable.
7. Tear down: `scripts/e2e/down.sh --tag <tag>`, also after a failure.

## Browser pass: LP app

<!-- filled by a later child -->

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
