# End-to-end harness

A disposable local stack runs the real API, worker, contracts and apps; scripted journeys play on it, and a check runner reports one ✅/❌ per known finding as JSON. It is not part of the pre-commit gate. Agents drive it through the e2e skill ([Claude](../.claude/skills/e2e/SKILL.md) · [Codex](../.codex/skills/e2e/SKILL.md)).

## Local stack

Prerequisites, `up.sh` and `down.sh` are documented by the local stack (#1961). State lives outside the repository under `$E2E_HOME/stacks/<tag>/` (default `E2E_HOME=~/.cache/pipeline-e2e`): the generated env, logs in `logs/`, and `state.json`:

```json
{ "tag": "x", "chains": ["stellar"], "contracts": { "stellar": "7646cef" }, "durations": { "up": 0 }, "startedAt": "…", "ports": { "postgres": 54329 } }
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
