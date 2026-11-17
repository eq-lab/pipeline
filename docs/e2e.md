# End-to-end harness

A disposable local stack runs the real API, worker, contracts and apps; scripted journeys play on it, and a check runner reports one ✅/❌ per known finding as JSON. It is not part of the pre-commit gate. Agents drive it through the e2e skill ([Claude](../.claude/skills/e2e/SKILL.md) · [Codex](../.codex/skills/e2e/SKILL.md)).

## Local stack

Stellar only for now. Infrastructure runs in docker compose (project `pipeline-e2e`, `scripts/e2e/compose.yml`): Postgres on `54329` (database `pipeline_e2e`), MinIO on `59000` (the `SPACES_*` bucket), and `stellar/quickstart --local` (Soroban RPC on `58000/rpc`). On the host: the fakes on `58090`, `api` on `58080`, `worker`, the LP app on `55173` and the trustee app on `55174` (`vite dev`).

### Prerequisites

- Docker via colima, with docker compose (`brew install colima docker docker-compose && colima start`).
- Stellar CLI 30 (`brew install stellar-cli`), `just` and `jq`.
- Rust with the wasm target (`rustup target add wasm32v1-none`).
- Node and yarn (`yarn install` in the checkout), Chromium for the journeys.
- Read access to `eq-lab/pipeline-stellar-contracts` over HTTPS (`gh auth setup-git`).

### Usage

```bash
scripts/e2e/up.sh --prepare             # once per machine: pull images, clone and build the contracts
scripts/e2e/up.sh --tag <tag>           # bring the stack up; reports every service healthy
scripts/e2e/up.sh --tag <tag> --reclaim # first tear down the stack of another tag (a killed run)
scripts/e2e/down.sh --tag <tag>         # remove containers, volumes, processes and stacks/<tag>/
```

- `E2E_STELLAR_CONTRACTS_REF` (default `7646cef`) picks the contracts ref; `E2E_HEALTH_TIMEOUT_MS` (default 180000) the health timeout.
- `up.sh` deploys every contract with the contracts repository's own `just deploy-all` (network `e2e`, USDC a local SAC, every role granted, including `MINTER` on PLUSD to the deposit manager and the minter), builds `api` and `worker` from the working tree and starts every service. Before `deploy-all` it opens the capital wallet's USDC and PLUSD trustlines (the Minter refuses a custodian without them); after it, the custodian approves the withdrawal queue to spend its USDC (`deploy-all`'s own `approve-usdc` passes `--expiration_ledger`, but the SAC's `approve` takes `live_until_ledger`).
- One stack per machine: `$E2E_HOME/stack.lock` names the tag holding it. `up.sh` of another tag is refused with the `down.sh` command to run.
- `down.sh` finds containers, volumes and networks by the `pipeline-e2e.tag` label and processes by their pid files, so it works from any checkout and after the worktree that started the stack is gone. It is idempotent.
- Exit `2`: a port is taken (named with the process holding it), another tag holds the lock, or a service did not become healthy (named with its log path).

### State

All state lives outside the repository under `$E2E_HOME` (default `~/.cache/pipeline-e2e`):

- `contracts/pipeline-stellar-contracts@<ref>/`: the contracts cache, built in a temporary directory and renamed, under `<dir>.lock` (which holds the builder's pid; a lock whose builder is gone, such as a killed run's, is broken by the next invocation).
- `stacks/<tag>/`: `env.json` (the generated env), `.env.e2e-<app>` (the Vite variables), `pids/`, `logs/`, `stellar/` (the CLI config with the stack's keys), `contracts/` (the deployment and `addresses.json`) and `state.json`:

```json
{ "tag": "x", "chains": ["stellar"], "contracts": { "stellar": "7646cef" }, "durations": { "up": 0 }, "startedAt": "…", "ports": { "postgres": 54329 } }
```

### Clean environment

The developer `.env` never reaches the stack. `api` and `worker` start with only `PATH`, `HOME` and `env.json`, in `stacks/<tag>/run/`, whose empty `.env` is the first one `dotenvy` finds walking up, so neither a worktree `.env` nor an ancestor's (such as `~/.env`) loads. Each app runs its own Vite config through `scripts/e2e/vite.e2e.config.mts`, which moves `envDir` to `stacks/<tag>/`, with only the generated variables. Local Stellar uses chain id `99000001` with the standalone passphrase (`Standalone Network ; February 2017`) set explicitly for every component.

### Fakes

`scripts/e2e/fakes.ts`: `CRYSTAL_ENABLED=false`, `ELLIPTIC_ENABLED=false`; a Sumsub stub behind `SUMSUB_BASE_URL` (create applicant, get applicant, SDK token) and `postSumsubWebhook()` that posts a webhook signed with `SUMSUB_WEBHOOK_SECRET_KEY`; `EMAIL_DEV_LOG=true` (the passcode is in `logs/api.log`); `PRICE_PROVIDER_ALLOW_NON_MARKET=true` with static MetalpriceAPI rates; the IPFS gateways serve `stacks/<tag>/ipfs/<cid>`.

### Guard

`scripts/e2e/lib/guard.ts` refuses an env unless every URL is `localhost` / `127.0.0.1` (the database on `54329/pipeline_e2e`), nothing points at `stage.eqlab.net`, the only chain is `99000001` with the standalone passphrase, and every key comes from the tag's generated env. `up.sh` runs it on the generated env before starting anything.

`scripts/e2e/guard-hook.ts` is a Claude Code PreToolUse hook running the same guard on `scripts/e2e/*` commands (inline variables and URL arguments); it exits `2` on a violation. It is wired in `.claude/settings.json` by:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR\"/node_modules/.bin/tsx \"$CLAUDE_PROJECT_DIR\"/scripts/e2e/guard-hook.ts", "timeout": 30 } ] } ] } }
```

## Run and check

```bash
npx tsx scripts/e2e/run.ts --tag <tag> [--chains stellar,evm] [--journeys lp,loan]
npx tsx scripts/e2e/check.ts --tag <tag> [--json] [--optional <id>] [--require <id>]
```

- `run.ts` plays the selected journeys in registry order and writes what they recorded to `stacks/<tag>/run.json` (commit, timings, journeys, recorded figures, and `error` when a step failed). It does not judge anything.
- `check.ts` evaluates the checks of the journeys that ran against `run.json`, redacts the files in `logs/`, writes `stacks/<tag>/result.json` and prints it with `--json` (one ✅/❌ line per check otherwise). `--optional` and `--require` may repeat.
- Journeys live in `scripts/e2e/journeys/<chain>-<journey>.ts`, one module per journey exporting its steps and checks, and are registered in order in `scripts/e2e/journeys/index.ts`.
- Unit tests of the runner need no stack: `yarn test:e2e-scripts`.

## Stellar world

`scripts/e2e/lib/stellar-world.ts` sets up what every Stellar journey needs; chain access is in `scripts/e2e/lib/stellar.ts`.

- **Accounts:** a fresh LP key funded by friendbot, with USDC and PLUSD trustlines and 1000 USDC from the mock issuer; the stack's `deployer` (deposit and withdrawal custodian), `capital`, `usdc-issuer` and `trustee` keys from `stacks/<tag>/stellar`.
- **LP:** `POST /v1/auth/signup`, the passcode read from `logs/api.log` (`EMAIL_DEV_LOG=true`; it stays in the process), `POST /v1/auth/verify-otp`, `POST /v1/lps/me`, and the settlement address linked through the SEP-53 wallet challenge (`/v1/lps/me/link-address/challenge` and `/verify`).
- **Operators:** `auth_users` rows for the stack's `trustee` key (`{trustee}`), an originator (`{originator}`) and a team member (no role: the API has no `team` role); the trustee signs in through `/v1/auth/challenge` and `/v1/auth/verify`.
- **KYC** (`passKyc`, after the LP's first deposit request, from which the relayer creates its profile): the applicant through the Sumsub stub, a signed `GREEN` webhook, then a wait until the relayer has authorized the LP on PLUSD.
- **Contract roles:** granted by `up.sh` (`deploy-all`); the `trustee` key holds `TRUSTEE`, risk council and cash reporter.

## Stellar LP journey

`scripts/e2e/journeys/stellar-lp.ts` (`--journeys lp`): world → `request_deposit` of 100 USDC → KYC → deposit voucher (`GET /v1/deposits/{id}/voucher`) and `claim_request` → stake 60 PLUSD (`deposit` on sPLUSD) → `redeem` a third of the shares → the custodian moves its USDC out, `request_withdrawal` of all the LP's PLUSD and a claim, which must fail → the custodian funds the queue back and the claim succeeds → reconcile → known bugs. Contract function names are those of the pinned contracts ref.

| Check | What it compares |
|-------|------------------|
| `stellar.lp.onboarding` | email + OTP signup, wallet linked by challenge, Sumsub statuses green, LP authorized on PLUSD |
| `stellar.lp.operators` | three `auth_users` rows; the trustee's wallet sign-in |
| `stellar.lp.deposit-voucher` | the deposit moved the USDC; the voucher's amount and user; deadline in the future and within 24 h |
| `stellar.lp.deposit-claim` | PLUSD minted equals the deposit; the request is claimed on chain |
| `stellar.lp.stake` | shares minted, PLUSD spent, sPLUSD balance |
| `stellar.lp.unstake` | PLUSD returned, shares burned |
| `stellar.lp.withdrawal-too-early` | the unfunded claim fails with `TooEarly` (`Error(Contract, #2)`) |
| `stellar.lp.withdrawal-claim` | USDC paid at the queue rate, PLUSD burned, the request claimed |
| `stellar.reconcile.tvl` | `/v1/dashboard/summary` `tvl` against Σ deposit requests on chain less USDC paid by the queue |
| `stellar.reconcile.plusd-supply` | PLUSD supply on chain (Horizon: holders and contracts) against the API TVL less unclaimed deposits; no API endpoint serves the supply (`plusd_outstanding` is `null` by design) |
| `stellar.reconcile.positions` | `/v1/pnl` sPLUSD shares against the vault balance; `/v1/requests` statuses against the requests' `claimed` on chain |
| `stellar.reconcile.withdrawal-queue` | `/v1/withdrawal-queue` `total_queued`, `total_claimed`, `rate` against the contract |
| `stellar.reconcile.financial-position` | `/v1/financial-position` secured loans outstanding against the loan registry's `outstanding_total` |
| `stellar.known-bugs.lps-openapi-query` | optional, BUG-37: `payment_details` of `GET /v1/lps` in `/api-docs/openapi.json` is a query parameter |
| `stellar.known-bugs.assay-decimal-bound` | optional, BUG-32: a `1e1000` assay grade is refused with `400`; validation runs before the loan lookup, so `404` on an unknown loan means it passed |

API figures in 6-decimal USD strings are compared with chain amounts divided by 10 (truncated, as the API normalizes them).

### Known-bugs coverage

Open entries of [`known-bugs.md`](./exec-plans/known-bugs.md) that the Stellar journeys do not check:

| Entry | Coverage |
|-------|----------|
| BUG-25 (`effective_at` overflow) | not covered yet: needs a `MetalConcentrate` loan with a valuation anchor (a loan journey) |
| BUG-27 (whitelist disallow pass) | not covered yet: needs Elliptic, which the stack disables |
| BUG-14 (documents of old loans) | not observable: only loans indexed before `f73d54d` |
| BUG-9 (`GroupedRequest` amounts) | not observable: no endpoint uses the code |
| BUG-28, BUG-16 (trustee app) | not observable here: UI defects, for the browser pass |
| BUG-22, BUG-19 | not observable: lint and `tsc` defects |

## Result contract

`check.ts --json` (and `result.json`):

```json
{
  "schemaVersion": 1,
  "tag": "2026-11-17-a",
  "commit": "<pipeline sha>",
  "contracts": { "stellar": "7646cef", "evm": "3b74e98" },
  "startedAt": "…", "finishedAt": "…",
  "durations": { "up": 0, "run": 0, "check": 0 },
  "ok": true,
  "checks": [
    { "id": "stellar.lp.deposit-claim", "ok": true, "optional": false, "title": "LP deposit → voucher → claim mints PLUSD" },
    { "id": "evm.loan-book.ltv-range", "ok": false, "optional": true, "title": "Loan Book LTV within 0–200%", "details": "LTV 194411%", "issue": 765 }
  ],
  "canBeRequired": ["stellar.loan-book.ltv-range"],
  "artifacts": ["logs/api.log", "logs/worker.log"]
}
```

- `schemaVersion` starts at `1` and changes only on an incompatible change; external callers (including an external LLM service) read this result.
- `commit` is the pipeline commit `run.ts` ran from. `contracts` and `durations.up` come from `state.json`; any value that is missing is `null`, never invented. `startedAt` is the start of `run.ts`, `finishedAt` the end of `check.ts`. Durations are in seconds.
- Check ids are stable across runs: `<chain>.<area>.<name>` (lowercase, `-` inside a part).
- A check carries `details` when it has something to say (a failure always should), `issue` when `checks.json` lists it, and `finding` for a `"pending"` entry.
- `error` is present only when the run itself failed (no `run.json`, a step threw); `ok` is then `false`.
- `canBeRequired` lists the optional checks that passed.
- `artifacts` are paths relative to the stack directory.
- No private key, seed or email passcode appears in any field. Log artifacts are redacted in place: Stellar secret seeds, values of `private_key`, `secret`, `seed`, `mnemonic`, `password`, `passcode`, `otp`, `token` and `verification code is …`, and values of secret-named environment variables become `***`.

## `checks.json`

`scripts/e2e/checks.json` lists the optional checks; it is changed by hand in a commit. Every other registered check is required.

```json
{
  "evm.loan-book.ltv-range": { "issue": 765 },
  "stellar.lp.claim-voucher": { "issue": "pending", "finding": "Claimed voucher stays pending in the API" }
}
```

- An entry carries `issue`: an issue number, or `"pending"` with a one-line `finding` when the defect has no issue yet. A malformed entry fails the check run (exit `2`).
- `--optional <id>` / `--require <id>` override the file for one run; an id that no journey registers fails the run (exit `2`).
- Optional checks run and are reported; they never affect `ok` or the exit code.
- A new finding becomes an optional `"pending"` check; the reviewer files the issue and the number replaces `pending`. When the bug is fixed, the entry is removed and the check is required.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | every required check passed |
| `1` | a required check failed |
| `2` | the run itself failed: stack, scenario, script error or bad arguments |
