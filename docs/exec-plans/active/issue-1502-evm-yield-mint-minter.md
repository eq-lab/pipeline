# Issue #1502: Relayer: rewrite the EVM yield-mint phase for PipelineMinter (TD-130, #1068)

Source: https://github.com/eq-lab/pipeline/issues/1502

## Scope

Verification finding: the work this Issue asks for is already moot on `main`.

- PR #1455 (`feature/evm-relayer`, merged as 45845a4e) deleted the EVM yield-mint phase instead of rewriting it. Rationale in `docs/exec-plans/active/evm-relayer-v5.md` D1: on hoodi-v5, `PipelineMinter.repay` mints the sPLUSD vault yield in the same transaction, so a relayer has nothing to submit.
- On `main` (and this branch), `packages/worker/src/relayer/yield_mint/` no longer exists. `packages/worker/src/relayer/evm/` holds only `job.rs`, `mod.rs` and `whitelist.rs`. No `PipelineYieldMinter` `sol!` bindings or EVM `yield_minter_address` setting are left in `packages/worker`.
- `docs/exec-plans/tech-debt-tracker.md` already marks TD-130 `[RESOLVED 2026-10-13 / feature/evm-relayer]`.
- The remaining `yield_minter_address` references, in `packages/shared/src/yield_mint_outbox_repo.rs` and migration `20260602000001_yield_mint_outbox.sql`, belong to the Stellar `stellar/yield_mint.rs` phase, which is still live. They stay.
- #1068 (EVM retry-forever because there is no "nothing to mint" skip) is moot as well, since the code it describes was deleted.

Because of this, the Issue's Problem statement ("the EVM relayer on staging runs this phase every cycle") describes the code as it was before #1455. Unless the human answers the Open Questions differently, there is no code to write.

Out of scope: the Stellar yield-mint phase, the outbox schema, and the orphaned BitGo client (TD-140).

## Assumptions and Risks

- Assumes the staging worker image is built from a `main` that includes #1455. If staging still runs an older image, the error logs described in the Issue may still appear until the next deploy. That is a deployment matter, not a code one.
- `CHAIN_560048_RELAYER_YIELD_MINTER_ADDRESS` may still be set in the external argocd config. This repo has no reference to it, and the env var is now ignored. Removing it is cosmetic and happens outside this repo.
- Risk if D1 is wrong: if `PipelineMinter.repay` does not actually mint vault yield on hoodi-v5, EVM sPLUSD holders would accrue no yield. This planner could not read `MinterUpgradeable.sol` because `pipeline-contracts` is not checked out locally, so this rests on D1 alone.

## Open Questions

- The Issue looks already resolved by #1455 (phase deleted, TD-130 RESOLVED). Should the human close #1502 and #1068 as "completed by #1455" and close draft PR #1516 without merging?
- Should someone confirm against `pipeline-contracts` `MinterUpgradeable.sol` (hoodi-v5) that `repay` mints the sPLUSD vault yield itself (D1)? The planner could not verify this locally.
- Should someone remove `CHAIN_560048_RELAYER_YIELD_MINTER_ADDRESS` from the staging argocd values (external repo)?

## Implementation Steps

If the human confirms the Issue is moot:

1. Make no code changes. Close #1502 and #1068 with a comment pointing at #1455 and `evm-relayer-v5.md` D1, then close draft PR #1516 and delete branch `feat/1502-evm-yield-mint-minter`.

If D1 turns out to be wrong (`repay` does not mint yield), this plan must be redone. The rewrite would mirror `relayer/stellar/yield_mint.rs` against the actual `PipelineMinter` entry point, so re-plan only after the contract is confirmed.

## Test Strategy

- Run `cargo test -p worker` and `cargo test -p shared` on the branch to confirm that `main` builds and passes with no EVM yield-mint code.
- Run `grep -rn "PipelineYieldMinter\|relayer/yield_mint" packages/` and expect no hits.

## Docs to Update

- None required. TD-130 is already marked RESOLVED. If the Issue is closed as moot, the manager may append to TD-130's Resolution line: "#1502 / #1068 closed as superseded."
