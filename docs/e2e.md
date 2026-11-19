# End-to-end harness

A disposable local stack runs the real API, worker, contracts and apps; scripted journeys play on it, and a check runner reports one ✅/❌ per known finding as JSON. It is not part of the pre-commit gate. Agents drive it through the e2e skill ([Claude](../.claude/skills/e2e/SKILL.md) · [Codex](../.codex/skills/e2e/SKILL.md)). The release evidence of the last full run is in [`e2e/release-run.md`](./e2e/release-run.md).

## Local stack

Two chains, Stellar and EVM; `--chains stellar,evm` picks them (default both). Infrastructure runs in docker compose (project `pipeline-e2e`, `scripts/e2e/compose.yml`): Postgres on `54329` (database `pipeline_e2e`), MinIO on `59000` (the `SPACES_*` bucket), `stellar/quickstart --local` (Soroban RPC on `58000/rpc`) and anvil (Foundry 1.9, chain id `31337`, RPC on `58545`). On the host: the fakes on `58090`, `api` on `58080`, `worker`, the LP app on `55173` and the trustee app on `55174` (`vite dev`).

### Prerequisites

- Docker via colima, with docker compose (`brew install colima docker docker-compose && colima start`).
- Stellar CLI 30 (`brew install stellar-cli`), `just` and `jq`.
- Rust with the wasm target (`rustup target add wasm32v1-none`).
- Node and yarn (`yarn install` in the checkout), Chromium for the journeys.
- Read access to `eq-lab/pipeline-stellar-contracts` over HTTPS (`gh auth setup-git`).
- For EVM: Foundry 1.9 (`foundryup`; `forge` on the host), read access to `eq-lab/pipeline-contracts` and its submodules over HTTPS, and npm registry access (the OpenZeppelin upgrades plugin runs `npx @openzeppelin/upgrades-core` during the deploy).

### Usage

```bash
scripts/e2e/up.sh --prepare                     # once per machine: pull images, clone and build both contract sets
scripts/e2e/up.sh --tag <tag>                   # bring the stack up with both chains; reports every service healthy
scripts/e2e/up.sh --tag <tag> --chains stellar  # one chain only: stellar or evm
scripts/e2e/up.sh --tag <tag> --reclaim         # first tear down the stack of another tag (a killed run)
scripts/e2e/down.sh --tag <tag>                 # remove containers (anvil too), volumes, processes and stacks/<tag>/
```

- `E2E_STELLAR_CONTRACTS_REF` (default `e9881ac`) and `E2E_CONTRACTS_REF` (default `3b74e98`, `eq-lab/pipeline-contracts`) pick the contracts refs; `E2E_HEALTH_TIMEOUT_MS` (default 180000) the health timeout.
- The EVM chain: anvil runs with a mnemonic generated per run (never anvil's default one); its ten accounts are unlocked, and custody is plain EOAs among them. `up.sh` deploys the contracts' `test/mocks/USDCMock` as USDC, then runs `script/Deploy.s.sol`, `script/RoleSetup.s.sol` and `script/Configure.s.sol` (deployment tag `e2e`) with `forge script --unlocked` in a copy of the cached build under `stacks/<tag>/evm-contracts/`. The pinned scripts hard-code anvil's default-mnemonic accounts and mainnet USDC for chain `31337` (`script/base/ChainValues.sol`); the cache build rewrites each of those addresses to `vm.envAddress("E2E_EVM_<name>")` and stops if the ref's names differ from the expected set (`EVM_ROLES` in `scripts/e2e/stack.ts`: account 0 the admin, whitelist manager and relayer signer, 1 treasury, 2 custodian, 3 verifier and API voucher signer, 4 capital wallet, 5 loan registry manager, 6 mint caller, 7 minter ops, 8 collateral trustee, 9 collateral valuer). forge runs with only `PATH`, `HOME` and those variables. The indexer reads chain `31337` from block 0 with `CHAIN_31337_EVM_INDEXER_LOG_CONFIRMATIONS_DELAY=0`, the price poller from the last deploy block; the apps get `VITE_EVM_CHAIN_ID=31337`, `VITE_EVM_RPC_URL` and the deployed addresses.
- `up.sh` also generates `lp-browser`, the key of the LP app's [E2E test wallet](../packages/frontend/src/wallet/README.md#e2e-test-wallet): funded by friendbot, a USDC trustline and 1000 USDC from the mock issuer (the app opens the PLUSD trustline itself). Its secret is `E2E_WALLET_SECRET` in `.env.e2e-frontend` only, next to the flag `VITE_E2E_WALLET=1`; `scripts/e2e/assert-prod-wallet.ts` (CI) proves a production build carries neither the module nor the secret. The Operations Console gets the same module with the stack's `trustee` key as its `E2E_WALLET_SECRET` (`.env.e2e-trustee`): the operator `run.ts` puts in `auth_users` signs in by wallet signature. With the EVM chain, `up.sh` likewise generates the EVM test wallet's key (`E2E_EVM_WALLET_KEY`, 100 ETH and 1000 USDC by `anvil_setBalance` / `anvil_dealERC20`), written to `.env.e2e-frontend` only.
- `up.sh` deploys every contract with the contracts repository's own `just deploy-all` (network `e2e`, USDC a local SAC, every role granted, including `MINTER` on PLUSD to the deposit manager and the minter), builds `api` and `worker` from the working tree and starts every service. Before `deploy-all` it opens the capital wallet's USDC and PLUSD trustlines (the Minter refuses a custodian without them); after it, the custodian approves the withdrawal queue to spend its USDC (`deploy-all`'s own `approve-usdc` passes `--expiration_ledger`, but the SAC's `approve` takes `live_until_ledger`).
- One stack per machine: `$E2E_HOME/stack.lock` names the tag holding it. `up.sh` of another tag is refused with the `down.sh` command to run.
- `down.sh` finds containers, volumes and networks by the `pipeline-e2e.tag` label and processes by their pid files, so it works from any checkout and after the worktree that started the stack is gone. It is idempotent.
- Exit `2`: a port is taken (named with the process holding it), another tag holds the lock, a service did not become healthy (named with its log path), or a deploy step failed (named with its output, such as `logs/evm-deploy.log` for forge).

### State

All state lives outside the repository under `$E2E_HOME` (default `~/.cache/pipeline-e2e`):

- `contracts/pipeline-stellar-contracts@<ref>/` and `contracts/pipeline-contracts@<ref>/`: the contracts caches, one directory per ref, each built in a temporary directory and renamed, under `<dir>.lock` (which holds the builder's pid; a lock whose builder is gone, such as a killed run's, is broken by the next invocation).
- `stacks/<tag>/`: `env.json` (the generated env), `.env.e2e-<app>` (the Vite variables), `pids/`, `logs/`, `stellar/` (the CLI config with the stack's keys), `contracts/` (the Stellar deployment and `addresses.json`), `evm-contracts/` (the EVM deployment, `deployments/anvil-e2e.json`) and `state.json`:

```json
{ "tag": "x", "chains": ["stellar", "evm"], "contracts": { "stellar": "e9881ac", "evm": "3b74e98" }, "durations": { "up": 0 }, "startedAt": "…", "ports": { "postgres": 54329 } }
```

### Clean environment

The developer `.env` never reaches the stack. `api` and `worker` start with only `PATH`, `HOME` and `env.json`, in `stacks/<tag>/run/`, whose empty `.env` is the first one `dotenvy` finds walking up, so neither a worktree `.env` nor an ancestor's (such as `~/.env`) loads. Each app runs its own Vite config through `scripts/e2e/vite.e2e.config.mts`, which moves `envDir` to `stacks/<tag>/`, with only the generated variables. Local Stellar uses chain id `99000001` with the standalone passphrase (`Standalone Network ; February 2017`) set explicitly for every component; local EVM uses chain id `31337`. With one chain, the apps still get the other chain's RPC (and Horizon) URLs on its local port, which is then dead, so they never fall back to the public Hoodi or Stellar testnet nodes. anvil runs `--silent`: its startup banner would print the run's private keys into a log artifact.

### Fakes

`scripts/e2e/fakes.ts`: `CRYSTAL_ENABLED=false`, `ELLIPTIC_ENABLED=false`; a Sumsub stub behind `SUMSUB_BASE_URL` (create applicant, get applicant, SDK token) and `postSumsubWebhook()` that posts a webhook signed with `SUMSUB_WEBHOOK_SECRET_KEY`; `EMAIL_DEV_LOG=true` (the passcode is in `logs/api.log`); captcha: `TURNSTILE_SECRET_KEY` unset (the API skips the check) and `VITE_E2E_CAPTCHA=1` with no site key, so the LP app's `Turnstile` hands out a stand-in token without loading Cloudflare and signup and OTP resend work in the browser ([Turnstile](./frontend/auth-components.md#turnstile)); `PRICE_PROVIDER_ALLOW_NON_MARKET=true` with static MetalpriceAPI rates (XAU at 2500 USD), which the asset price collector (`JOB_ASSET_PRICE_COLLECTOR_ENABLED=true`, one cycle a minute) stores for the loans' valuation anchors; the IPFS gateways serve `stacks/<tag>/ipfs/<cid>`, else the object `ipfs/<cid>` of the MinIO bucket (that prefix is anonymous-download; `minioPut` in `lib/stellar-world.ts` stores one with `mc pipe`).

### Guard

`scripts/e2e/lib/guard.ts` refuses an env unless every URL is `localhost` / `127.0.0.1` (the database on `54329/pipeline_e2e`), nothing points at `stage.eqlab.net`, the only chains are `99000001` (with the standalone passphrase) and `31337` (so mainnet ids and Hoodi `560048` are refused in `CHAINS`, `DEFAULT_CHAIN_ID`, `CHAIN_<id>_*` and `VITE_EVM_CHAIN_ID`), and every key comes from the tag's generated env. `up.sh` runs it on the generated env before starting anything.

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
- `npx tsx scripts/e2e/passcode.ts --tag <tag> --email <email> [--wait <seconds>]` prints only the latest signup/login passcode the API logged for that email (waits up to 10 s, exits 1 with a message if none). Browser passes use it instead of reading `logs/api.log` or calling the API; run it before `check.ts`, which redacts the log.
- Journeys live in `scripts/e2e/journeys/<chain>-<journey>.ts`, one module per journey exporting its steps and checks, and are registered in order in `scripts/e2e/journeys/index.ts`.
- Unit tests of the runner need no stack: `yarn test:e2e-scripts`.

## Stellar world

`scripts/e2e/lib/stellar-world.ts` sets up what every Stellar journey needs, once per run (`world()`: the journeys of a run share it); chain access is in `scripts/e2e/lib/stellar.ts`.

- **Accounts:** a fresh LP key funded by friendbot, with USDC and PLUSD trustlines and 1000 USDC from the mock issuer; the stack's `deployer` (deposit and withdrawal custodian), `capital`, `usdc-issuer` and `trustee` keys from `stacks/<tag>/stellar`.
- **LP:** `POST /v1/auth/signup`, the passcode read from `logs/api.log` (`EMAIL_DEV_LOG=true`; it stays in the process), `POST /v1/auth/verify-otp`, `POST /v1/lps/me`, and the settlement address linked through the SEP-53 wallet challenge (`/v1/lps/me/link-address/challenge` and `/verify`).
- **Operators:** `auth_users` rows for the stack's `trustee` key (`{trustee}`), an originator (`{originator}`) and a team member (no role: the API has no `team` role); the trustee and the originator sign in through `/v1/auth/challenge` and `/v1/auth/verify`.
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
| `stellar.known-bugs.lps-openapi-query` | optional, BUG-37 (#1990): `payment_details` of `GET /v1/lps` in `/api-docs/openapi.json` is a query parameter |
| `stellar.known-bugs.assay-decimal-bound` | a `1e1000` assay grade is refused with `400`; validation runs before the loan lookup, so `404` on an unknown loan means it passed |

API figures in 6-decimal USD strings are compared with chain amounts divided by 10 (truncated, as the API normalizes them).

### Known-bugs coverage

Open entries of [`known-bugs.md`](./exec-plans/known-bugs.md) that the Stellar journeys do not check:

| Entry | Coverage |
|-------|----------|
| BUG-25 (`effective_at` overflow) | not covered yet: needs a `MetalConcentrate` loan with a valuation anchor (the loan journey's is `StandardGoods`) |
| BUG-27 (whitelist disallow pass) | not covered yet: needs Elliptic, which the stack disables |
| BUG-14 (documents of old loans) | not observable: only loans indexed before `f73d54d` |
| BUG-9 (`GroupedRequest` amounts) | not observable: no endpoint uses the code |
| BUG-28, BUG-16 (trustee app) | not observable here: UI defects, for the browser pass |
| BUG-22, BUG-19 | not observable: lint and `tsc` defects |

## Stellar loan journey

`scripts/e2e/journeys/stellar-loan.ts` (`--journeys loan`; in a full run after LP, on the same world). Contract calls are encoded with the apps' encoders from `packages/wallet-connect/src/stellar/contracts/` (`loanRegistry.ts`, `minter.ts`, `securityRegistry.ts`); privileged ones go through the AccessManager's `execute`, signed by the stack's `trustee` key (trustee, risk council and Cash reporter).

1. **Submit and approve.** Two documents and the loan metadata JSON are stored in MinIO under `ipfs/<cid>` and served by the IPFS stub. The originator submits a 1000 USDC facility (800 senior, 200 equity, 12 %, offtaker price 1100) with a `StandardGoods` XAU anchor of quantity 1 and no haircut (`POST /v1/loan-book/loan`); the trustee approves it (`/review`).
2. **Draw.** `draw_loan` with the `draw_loan` args the API serves on the approved submission; the API links the submission to the loan id.
3. **Debt token**, as the contracts repo's `just new-deal <id>` does for ops: the trustee (the stack's DEBT issuer) sets `AUTH_REVOCABLE` and `AUTH_CLAWBACK_ENABLED`, deploys the `DEBT<nnnn>` SAC and makes the factory its admin, the capital wallet opens its trustline, and `register_deal`; `disburse` and `repay` sync the DEBT balance.
4. **Wire in and disburse.** As Cash reporter, `record_wire_in` of 800 USD into the minter's escrow; `disburse` of the senior tranche; the trustee marks the off-ramp complete.
5. **Collateral and margin call.** `set_terms` (advance 80 %, margin call 85 %), `register` and `perfect` a 1 Mt warehouse pledge carrying the receipt's sha256, `revalue` at the static price (2500), then at 900, which opens a margin call.
6. **Loan book while active**, read once the price collector has priced the loan.
7. **Repay** through the minter (`repay`, as Cash reporter): the outstanding principal and the interest accrued so far; the interest is minted to sPLUSD.
8. **Close** (`close_loan`, `EarlyRepayment`) and the **loan book after close**.

The stack grants the `trustee` `SECURITY_AGENT` (`register`, `perfect`) and `RISK_COUNCIL` (`set_terms`), so the journey signs every security registry call with it. Play the journeys once per stack: the loan journey's wire in and interest mint PLUSD that a second LP reconcile (`stellar.reconcile.tvl`, `plusd-supply`) does not count, and its active loans are not in `stellar.reconcile.financial-position`'s `outstanding_total`.

| Check | What it compares |
|-------|------------------|
| `stellar.loan.submission` | `InReview` after submit, `Approved` after review; the served `draw_loan` args in 7-decimal units and `rate_bps × 100` |
| `stellar.loan.documents` | each stored document's sha256 against the bytes the IPFS stub serves; the loan book lists the documents |
| `stellar.loan.draw` | the loan is `Approved` on chain with the API's economics; the submission links to its id |
| `stellar.loan.disburse` | the wire booked the cash, `disburse` took it and drew the tranche; the loan is `Performing` |
| `stellar.loan.collateral` | the pledge is `Active` with the receipt's hash and valued at the static price; no margin call yet |
| `stellar.loan.margin-call` | after the mark-down, LTV above 85 % and `margin_call_at` set |
| `stellar.loan.repay` | interest minted equals the interest repaid and the sPLUSD vault's `total_assets` delta; outstanding 0 |
| `stellar.loan.close` | `Closed` with `EarlyRepayment` |
| `stellar.loan-book.entry` | `/v1/loan-book` `principal`, `original_senior_tranche`, `senior_outstanding` and `rate` against the registry |
| `stellar.loan-book.collateral` | `spot_price` and `collateral` against the static price × quantity, less the haircut |
| `stellar.loan-book.ltv-range` | optional, #765: `ltv` within 0–200 % and equal to `principal / collateral`; `details` always carry the LTV |
| `stellar.loan-book.margin-call` | `margin_call_open` against the security registry's `margin_call_at` |
| `stellar.loan-book.ltv-bps` | `ltv_bps` against `ceil(debt × 10000 / value)` from the security registry (the worker reads `coverage_detail`) |
| `stellar.loan-book.summary` | while the loan is active: `weighted_rate` and `/v1/dashboard/summary` `loan_book_yield` against the loan's rate; `deployed_senior` against `outstanding_total`; `/v1/financial-position` secured loans and `outstanding_in_loans` against Σ facility of the registry's active loans (the spec's senior + equity, [dashboards.md](./product-specs/dashboards.md)) |
| `stellar.loan-book.closed` | after close: status `Closed`, `repaid_to_date` against the cumulative offtaker receipts, `deployed_senior` and secured loans as above |
| `stellar.loan-book.yield` | `/v1/dashboard/summary` `cumulative_yield_total` against Σ `interest_minted` of the minter's repayments |

## EVM world

`scripts/e2e/lib/evm-world.ts` sets up what the EVM journeys need on anvil (`31337`), once per run (`evmWorld()`), with viem; addresses come from the stack's `env.json` (`CHAIN_31337_*`, `VITE_*`), USDC and PLUSD from the deposit manager.

- **LP:** a fresh key, 100 ETH by `anvil_setBalance` and 2000 USDC of the mock by `anvil_dealERC20`; signed up as the Stellar LP is (`signupLp` in `lib/stellar-world.ts`), with its EVM address linked through the EIP-191 `personal_sign` challenge. LP calls are signed by its own key.
- **Custody:** the custodian (the deposit manager's `custodian()`, also the queue's asset holder) and the capital wallet are unlocked anvil accounts; their calls go out as `eth_sendTransaction`.
- **KYC** (`passEvmKyc`, after the first deposit request): the Sumsub stub and a `GREEN` webhook (`sumsubGreen`, shared with Stellar), then a wait until the relayer has allowed the LP on the `WhitelistRegistry`.

## EVM LP journey

`scripts/e2e/journeys/evm-lp.ts` (`--chains evm --journeys lp`): world → `approve` and `requestDeposit` of 1000 USDC (the anvil minimum deposit of the pinned contracts) → KYC → deposit voucher and `claimDeposit` → `approve` and `deposit` 600 PLUSD on sPLUSD → `redeem` a third of the shares → the custodian moves its USDC to the capital wallet, `requestWithdrawal` of all the LP's PLUSD and a `claimWithdrawal`, which must revert → the capital wallet sends the USDC back, the custodian approves the queue for it, and the claim succeeds → reconcile for chain `31337`. Writes use the LP app's ABIs (`packages/frontend/src/wallet/evm/abis/`); reads use a small ABI of the pinned contracts.

| Check | What it compares |
|-------|------------------|
| `evm.lp.onboarding` | email + OTP signup, EVM address linked by challenge, Sumsub statuses green, LP allowed on the `WhitelistRegistry` |
| `evm.lp.deposit-voucher` | the deposit moved the USDC; the voucher's amount and user |
| `evm.lp.voucher-deadline` | optional, #1798: the deposit and withdrawal vouchers carry a deadline in the future and within 24 h; `details` always carry what the API returned (EVM vouchers return `deadline: null`) |
| `evm.lp.deposit-claim` | PLUSD minted equals the deposit; the request is claimed on chain |
| `evm.lp.stake` | shares minted, PLUSD spent, sPLUSD balance |
| `evm.lp.unstake` | PLUSD returned, shares burned |
| `evm.lp.withdrawal-too-early` | the unfunded claim reverts with `WithdrawalQueueTooEarly` |
| `evm.lp.withdrawal-claim` | USDC paid equals the queue's `convertToAssets`, PLUSD burned, the request claimed |
| `evm.reconcile.tvl` | `/v1/dashboard/summary` `tvl` against Σ deposit requests on chain less the USDC value of the queue's `totalClaimed` |
| `evm.reconcile.plusd-supply` | PLUSD `totalSupply` against the API TVL less unclaimed deposits |
| `evm.reconcile.positions` | `/v1/pnl` sPLUSD shares against the vault balance; `/v1/requests` statuses against the requests' `claimed` on chain |
| `evm.reconcile.withdrawal-queue` | `/v1/withdrawal-queue` Σ items against `queueMetadata().totalQueued`, Σ completed items against `totalClaimed`, `in_queue_usd` against their difference; the API serves `total_queued`, `total_claimed` and `rate` for Stellar only (#1791), so they are recorded but not compared |
| `evm.reconcile.financial-position` | `/v1/financial-position` secured loans outstanding against the loan registry's `outstandingTotal()` |

EVM amounts have 6 decimals, as the API's USD strings. `/v1/requests` shows the claim before the queue's events and the PLUSD burn are indexed, so the reconcile waits up to 30 s for the queue and TVL to show it, then records what the API serves. The reconcile is chain-wide, so the journey may run again on the same stack.

## EVM loan journey

`scripts/e2e/journeys/evm-loan.ts` (`--chains evm --journeys loan`; in a full run after the EVM LP journey), the Stellar loan journey on anvil. Contract calls go straight to the pinned contracts (AccessManager-`restricted`, no relay), each from the unlocked anvil account holding the role (`EVM_ROLES` in `scripts/e2e/stack.ts`): loan registry manager for `drawLoan`, `registerDeal` and `closeLoan`; mint caller (the Cash reporter) for `recordWireIn` and `repay`, the latter with the LP app's minter ABI (`packages/wallet-connect/src/evm/contracts/minter.ts`); minter ops for `disburse`; collateral trustee and valuer for the collateral registry. The API's trustee and originator are fresh EVM keys with `auth_users` rows on `31337`, signed in by `personal_sign` challenge.

1. **Submit and approve**, as on Stellar, with `chain_id=31337`. The API serves no `draw_loan` args for an EVM target, so the journey encodes `drawLoan` from the approved submission's `loan_data`: 6-decimal amounts, the rate in ppm (`bps × 100`).
2. **Draw** and wait until the API links the submission to the loan id.
3. **Deal tokens**: `registerDeal`, which `disburse` and `repay` need for `syncDebt`.
4. **Wire in and disburse.** `recordWireIn` of 800 USD into the minter's escrow, `disburse` of the senior tranche; the trustee marks the off-ramp complete.
5. **Collateral and margin call.** `pledge` a 1 Mt gold cargo lot, `setControl` (collateral manager agreement) and `addDoc` with the receipt's sha256, `revalue` at the static price (2500), `setFloor` 11765 bps (the coverage of an 85 % LTV), then `revalue` at 900, which emits `MarginCall`.
6. **Loan book while active**, once the price collector has priced the loan, and the margin call in `/v1/audit-log`.
7. **Repay** through the minter: the outstanding principal and the interest accrued so far; the interest is minted to sPLUSD.
8. **Close** (`closeLoan`, `EarlyRepayment`) and the **loan book after close**.

The same as on Stellar: play it once per stack, after the EVM LP journey, whose reconcile does not count the PLUSD this journey mints.

| Check | What it compares |
|-------|------------------|
| `evm.loan.submission` | `InReview` after submit, `Approved` after review |
| `evm.loan.documents` | each stored document's sha256 against the bytes the IPFS stub serves; the loan book lists the documents |
| `evm.loan.draw` | the loan is `Approved` on chain with the submission's economics in 6-decimal units and the rate in ppm; the submission links to its id |
| `evm.loan.disburse` | the deal is registered; the wire booked the cash, `disburse` took it and drew the tranche; the loan is `Performing` and the capital wallet's DEBT balance equals the outstanding |
| `evm.loan.collateral` | the lot has its control and the receipt's hash, is valued at the static price and covers the floor; no `MarginCall` yet |
| `evm.loan.margin-call` | after the mark-down, `coverage` below the floor and a `MarginCall` with that floor |
| `evm.loan.repay` | `CashRepaid.interestMinted` equals the interest repaid and the sPLUSD `totalAssets` delta; outstanding and DEBT balance 0 |
| `evm.loan.close` | `Closed` with `EarlyRepayment` |
| `evm.loan-book.entry` | `/v1/loan-book` `principal`, `original_senior_tranche` and `senior_outstanding` against the registry |
| `evm.loan-book.rate` | the rate half of #765 (fixed in #1434): `/v1/loan-book` `rate` against the registry's `currentRate` (ppm) / 10⁶ and the submitted 12 %; `details` always carry both |
| `evm.loan-book.collateral` | `spot_price` and `collateral` against the static price × quantity, less the haircut |
| `evm.loan-book.ltv-range` | optional, #765: `ltv` within 0–200 % and equal to `principal / collateral`; `details` always carry the LTV |
| `evm.loan-book.margin-call` | the `MarginCall` row of `/v1/audit-log` for the loan against the chain event's coverage and floor (the loan book's `margin_call_open` and `ltv_bps` come from the Stellar security registry only) |
| `evm.loan-book.summary` | while the loan is active: `weighted_rate` and `loan_book_yield` against the loan's rate; `deployed_senior` against `outstandingTotal()`; `/v1/financial-position` secured loans and `outstanding_in_loans` against Σ facility of the registry's active loans |
| `evm.loan-book.closed` | after close: status `Closed`, `repaid_to_date` against Σ `PaymentRecorded` offtaker receipts, `deployed_senior` and secured loans as above |
| `evm.loan-book.yield` | `/v1/dashboard/summary` `cumulative_yield_total` against Σ `CashRepaid.interestMinted` |

## Result contract

`check.ts --json` (and `result.json`):

```json
{
  "schemaVersion": 1,
  "tag": "2026-11-17-a",
  "commit": "<pipeline sha>",
  "contracts": { "stellar": "e9881ac", "evm": "3b74e98" },
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
