# Issue #1503: Deployment config: point the LP app and API at hoodi-v5 on staging; EVM voucher signer + CHAINS for the API; prod EVM pending mainnet

Source: https://github.com/eq-lab/pipeline/issues/1503 (parent epic #1494)

## Scope

Human decision: every `argocd` change (`pipeline/test.yaml`, `pipeline/prod.yaml`, Vault secrets for the
signer key) is applied by the human, outside this repo. This plan covers only the repo-side items:

1. `.env.example`: a complete, worked EVM block for the API voucher signer (`CHAIN_<id>_TYPE`,
   `CHAIN_<id>_SIGNER_KEY`, `CHAIN_<id>_DM_ADDRESS`, `CHAIN_<id>_WQ_ADDRESS`) using Hoodi `560048` /
   hoodi-v5 addresses as the example, and the frontend `VITE_*` EVM address comments pointing at hoodi-v5.
2. `docs/FRONTEND.md` runtime-key table: note the hoodi-v5 values that staging uses.
3. `docs/exec-plans/tech-debt-tracker.md` TD-131: refresh (hoodi-v5 exists and is configured for staging;
   remaining gap is mainnet only, tracked by #1436).
4. Draft text of the "vars to flip" comment for #1436 (included below; the manager/human posts it).

Out of scope: any Rust/TS code change (EIP-712 domains `("PipelineDepositManager","v1")` and
`("PipelineWithdrawalQueue","v1")` already match `packages/api/src/config.rs`), argocd edits, Vault,
contract changes, prod enablement.

Verified facts (2026-10-15, `pipeline-contracts/deployments/hoodi-v5.json` + on-chain reads):

| Contract | hoodi-v5 proxy |
|---|---|
| DepositManager | `0x7A8B7628Cd2DdE7E065F1BB441A0A8AcA993c1a9` |
| WithdrawalQueue | `0x369033D21a4A62f837D4eeF9F65407Ae00357e75` |
| StakedPipelineUSD | `0x87CD1002bdB9401423cb50A860314FC8f11440Cd` |
| PipelineMinter | `0xE75814d9618285AE4d789D4424672597DC494D3E` |

On-chain `verifier()` on DM and WQ: `0x85297318f9b850b96a8e9521d80945519d1efd62` (differs from
`ChainValues.sol`'s `0xd3b978148e1Ee61b528354f72b39451c46dCA57C`).

## Assumptions and Risks

- `CHAIN_<id>_TYPE` defaults to `evm` when unset (`packages/shared/src/chains.rs::parse_chain_type`), so
  setting it explicitly is documentation clarity, not a requirement.
- The API voucher signer key must derive to the on-chain verifier `0x8529…fd62`; if the holder of that key
  cannot supply it, `setVerifier` must be called on both contracts instead. Vouchers signed by any other key
  revert on-chain. This is an operational risk for the human's argocd/Vault step, not this repo's diff.
- `scripts/check-chain-env-names.sh` scans `.env.example` for retired spellings; new lines must use the
  current API names (`CHAIN_<id>_SIGNER_KEY` / `_DM_ADDRESS` / `_WQ_ADDRESS`, which are not yet renamed).
- Staging verification in the issue (`/v1/deposits/<id>/voucher?chain_id=560048` returns a signature,
  EVM deposit shows in `/v1/requests`) depends on the human's argocd rollout; the coder cannot run it.
- Real addresses in `.env.example` are public contract addresses; no secrets are added (signer key stays `0x...`).

## Open Questions

- Should `.env.example` keep `CHAINS=1` / `DEFAULT_CHAIN_ID=1` as the active example, or switch the API
  example to `CHAINS=560048` with the hoodi-v5 block uncommented? Plan default: keep the active lines as-is
  and add the Hoodi block commented out, to avoid changing local-dev behavior.
- Who holds the private key for verifier `0x85297318f9b850b96a8e9521d80945519d1efd62` (needed for the
  staging Vault secret), or should `setVerifier` be called to match `ChainValues.sol`? Not blocking the repo
  diff, but blocks the issue's staging verification.

## Implementation Steps

1. `/.env.example`, API section (currently lines ~36-42): replace the generic `CHAIN_1_*` signer example with
   a worked Hoodi block, commented out:
   ```
   # Hoodi hoodi-v5 example (staging; add 560048 to CHAINS):
   # CHAIN_560048_TYPE=evm                                         # default evm when unset
   # CHAIN_560048_SIGNER_KEY=0x...                                 # secret; must derive to on-chain verifier() of DM and WQ
   # CHAIN_560048_DM_ADDRESS=0x7A8B7628Cd2DdE7E065F1BB441A0A8AcA993c1a9   # DepositManager proxy, EIP-712 ("PipelineDepositManager","v1")
   # CHAIN_560048_WQ_ADDRESS=0x369033D21a4A62f837D4eeF9F65407Ae00357e75   # WithdrawalQueue proxy, EIP-712 ("PipelineWithdrawalQueue","v1")
   ```
   Keep the generic `CHAIN_<id>_*` key lines above it.
2. `/.env.example`, frontend section (lines ~207-209): keep zero-address values (EVM hooks short-circuit
   locally) but change the `# set on Hoodi` comments to name the hoodi-v5 proxy for each
   (`0x7A8B…c1a9`, `0x3690…7e75`, `0x87CD…40Cd`, full addresses).
3. Optionally, in the worker EVM example (lines ~85-95), add a one-line comment that hoodi-v5 addresses
   live in `pipeline-contracts/deployments/hoodi-v5.json` (incl. PipelineMinter `0xE758…4D3E`). No key changes.
4. `docs/FRONTEND.md` "Supported runtime keys" table (~line 209): add a third column "Staging (Hoodi hoodi-v5)"
   with the three proxy addresses (other rows: `—` or current staging value if known: chain id `560048`),
   and a sentence that prod keeps zero addresses until mainnet (#1436). Keep table formatted for prettier.
5. `docs/exec-plans/tech-debt-tracker.md` TD-131: retitle to reflect the narrowed gap (e.g.
   "No mainnet EVM deployment for the current contracts"), update Location/Gap/Impact: hoodi-v5 is the
   post-rework Hoodi deployment, configured for staging via #1503 (worker already indexes it; API + LP app
   pointed at it); the remaining gap is an Ethereum mainnet deployment and its prod mapping, tracked by
   #1436; deploy-CI/environment-mapping suggestion remains. Add a dated note (2026-10-15) rather than
   marking RESOLVED. Do not rewrite other TDs that cite TD-131 as "no EVM chain runs"; optionally note in
   TD-131 that those latent impacts are now live on staging.
6. Draft #1436 comment (manager/human posts it; coder includes it in the PR description):
   > Prod EVM enablement (from #1503). Once a mainnet deployment of the reworked contracts exists, flip in
   > `argocd/pipeline/prod.yaml`:
   > - Worker: `CHAINS` add `1`; `CHAIN_1_EVM_RPC_URL`, `CHAIN_1_EVM_START_BLOCK` (deploy block),
   >   `CHAIN_1_EVM_INDEXER_{DEPOSIT_MANAGER,WITHDRAWAL_QUEUE,STAKED_PLUSD,LOAN_REGISTRY,MINTER}_ADDRESS`
   >   (+ optional COLLATERAL_REGISTRY / DEAL_TOKEN_FACTORY), `CHAIN_1_EVM_PRICE_POLLER_STAKED_PLUSD_ADDRESS`,
   >   `CHAIN_1_RELAYER_SIGNER_KEY` (Vault), `CHAIN_1_RELAYER_REGISTRY_ADDRESS`.
   > - API: `CHAINS` add `1`; `CHAIN_1_TYPE=evm`; `CHAIN_1_SIGNER_KEY` (Vault; must derive to on-chain
   >   `verifier()`), `CHAIN_1_DM_ADDRESS`, `CHAIN_1_WQ_ADDRESS`.
   > - LP frontend: `VITE_EVM_CHAIN_ID=1` (already), `VITE_EVM_RPC_URL`, `VITE_DEPOSIT_MANAGER_ADDRESS`,
   >   `VITE_WITHDRAWAL_QUEUE_ADDRESS`, `VITE_STAKED_PLUSD_ADDRESS` (currently zero).
   > Staging reference: hoodi-v5 (`CHAIN_560048_*`), see TD-131 and `.env.example`.

## Test Strategy

Docs/config-only change. Run:
- `scripts/check-chain-env-names.sh` (no retired spellings in `.env.example`).
- Repo lint/format for markdown (`yarn prettier --check docs/FRONTEND.md` or the project's `/test-fast` lint stage).
- Sanity: `cargo test -p api config` is unaffected (no code change) — optional.
- Grep the three hoodi-v5 addresses to confirm they appear consistently with correct EIP-55 casing.
Live staging verification (voucher endpoint returns a signature; EVM deposit appears in `/v1/requests`
and Claim unlocks) is done by the human after the argocd rollout.

## Docs to Update

- `.env.example`
- `docs/FRONTEND.md` (runtime keys table)
- `docs/exec-plans/tech-debt-tracker.md` (TD-131)
- No product-spec change (no behavior change).
