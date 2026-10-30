# Issue #1794: Stellar contract ids and signer roles in .env.example and backend.md: sync with deployments #36 / #37

Source: https://github.com/eq-lab/pipeline/issues/1794

Parent epic: #1776. Merge order step 3: after #1788 and #1793, before #1789 / #1790 / #1791.
Config and docs only. No Rust, no TypeScript, no migration, no `argocd` change.

## Scope

### Source of truth (verified 2026-10-30)

- **Contracts repo:** `pipeline-stellar-contracts` at **`7646cef`** (HEAD, "Implement security
  registry (#39)").
- **Files:**
  - `deployments/networks/testnet/addresses.json`: last written by deployment #36 (`e7c5b47`).
  - `deployments/networks/mainnet/addresses.json`: last written by deployment #37 (`b4d4a57`).
  - `config.json` (both networks): #38 (`ee87852`) only dropped `deal_tokens.cargo_issuer`.
  - #39 changed no deployment file.
  - So the ids at `7646cef` are the ids of the live #36 / #37 deployments. #38 and #39 are not
    deployed.
- **Ids in the issue body:** every one matches testnet `addresses.json`:
  - DM `CDMMJ2UO…`, WQ `CBVXURJR…`, sPLUSD `CDHSWXEG…`, AM `CDP7TUNB…`, PLUSD `CDGHLVGY…`;
  - USDC `CADLJ6YG…`, minter `CAPL5WN3…`, loan registry `CDWN5B3F…`, pocket `CD464CN7…`.
  - Mainnet USDC `CCW67TSZ…` comes from mainnet `config.json` `usdc`. Mainnet
    `addresses.json` has no `usdc` key, and testnet `config.json` `usdc` is empty because
    testnet uses a mock issuer.
- **pipeline-test:** `argocd/pipeline/test.yaml` lives in the separate `eq-lab/argocd` repo.
  - Checked at `origin/main` `3381597` (the local checkout's `pipeline-v2` branch is stale).
  - These lines hold the same testnet ids: `:189-197` (indexer), `:219` (`JOB_INDEXER_STELLAR_ASSET_ID`),
    `:232` (price poller), `:246-247` (relayer AM / PLUSD SAC), `:250` (WQ wallet), and
    `:97-99` (API DM / WQ / loan registry).
  - The pocket is not set there. That is correct: no code reads a pocket key yet.

### The `collateral_registry` trap: correct for the #36 / #37 ids, a trap only after a #39 deploy

The issue says `addresses.json` stores the SecurityRegistry under the old `collateral_registry` key
(`justfile:323`). That is true for the **HEAD justfile**, but no network has run it yet:

- #36 and #37 ran `deploy-collateral-registry` with `collateral_registry.wasm`
  (`git show e7c5b47:deployments/justfile:319`, same at `b4d4a57`).
- `stellar contract info interface --id CBSMJS5Q… --network testnet` returns the **legacy
  CollateralRegistry** interface: `pledge`, `lot`, `lots`, `set_stage`, `coverage`, … and no
  `register` / `perfect` / `record`.
- So today `CBSMJS5Q…` (testnet) and `CA76K5CU…` (mainnet) correctly go into
  `…_STELLAR_INDEXER_COLLATERAL_REGISTRY_ADDRESS`, as pipeline-test already does.
- Only an id written by `deploy-security-registry` (#39+) goes into
  `…_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS` (#1779). It never goes into the collateral key.
- **Second trap:** `deploy-all` runs `have collateral_registry || step deploy-security-registry`
  (`justfile:649`). An incremental #39 deploy on a network that already has the key therefore
  **keeps the old CollateralRegistry id**. Always decide by the on-chain interface, not by the
  key name.

The docs record this rule in that form.

### Signer roles, derived from the contracts (not from the issue text)

- **Relayer Phase 3 signer** (`CHAIN_<id>_RELAYER_STELLAR_SIGNER_SECRET`): needs
  **`WHITELIST_ADMIN` with execution delay 0**. Not `executor`, which no longer exists.
  - `setup-access` maps PLUSD `set_authorized` to `WHITELIST_ADMIN` (`justfile:715`).
  - It grants that role to `access.whitelist_admin` (`justfile:754`).
  - `AccessManager::execute` (`access-manager/src/lib.rs:384-406`) lets an immediate caller
    through. A delayed caller needs a scheduled operation, and the relayer never schedules.
  - The #36 justfile has the same mapping (`e7c5b47:deployments/justfile:722`).
  - Testnet on-chain (2026-10-30): `get_target_function_role(PLUSD, set_authorized)` =
    `WHITELIST_ADMIN`, and `has_role(WHITELIST_ADMIN, …)` = `{execution_delay: 0, is_member: true}`.
- **API voucher signer** (`STELLAR_VERIFIER_SECRET`): **no access-manager role.**
  - Its `G…` must equal the DM and WQ `verifier`. That value is set at construction from
    `config.json` `deposit_manager.verifier` / `withdrawal_queue.verifier`, and is changeable
    by `set_verifier`.
  - On-chain `verifier()` (2026-10-30): testnet DM and WQ = `GCZAXE3C…`, mainnet DM and WQ =
    `GAUCCZEC…`. Both match `config.json`.
  - `.env.example:192` still says `GDH66JAF…`, which is stale.
- **Indexer and price poller:** read-only. They need no key and no role.
- **Phase 4 yield-mint signer:** being deleted by #1793. It is not documented as a current role.
- **Not backend signers** (named only so ops do not confuse them):
  - Trustee wallets: `TRUSTEE`, and `CASH_REPORTER` with delay 0.
  - `RISK_COUNCIL`: delay 86400.
  - Contract-to-contract `MINTER` grants to the DM and the minter.

### In scope

1. **`.env.example`, backend keys only:**
   - **Testnet ids:** set every Stellar contract id to the `7646cef` testnet value. Fill the
     blank MINTER and LOAN_REGISTRY lines (148-149), the API loan-registry line (213), and the
     WQ-wallet G-accounts (146, 204).
   - **Stale notes:** fix the verifier pubkey note (192) and the relayer role note (173).
   - **Provenance:** record the contracts commit and the deployment numbers.
   - **Mainnet:** add a commented mainnet (99000002) id block.
   - **Keys that no code reads yet:** add the pocket (#1789), security-registry (#1779), API
     minter (#1790) and API withdrawal-queue (#1791) keys, each in a clearly labelled "not read
     by this build" group with its issue number.
2. **`docs/references/backend.md`:**
   - **New section:** "Stellar contract ids and signer roles". It holds the sync checklist, the
     key map, the trap, the cursor rule, the redeploy plan and the signer-role table.
   - **Line 289:** fix the stale `CHAIN_<id>_STELLAR_*_ID` naming sentence.
3. **Design docs: the same stale `executor` claim, one paragraph each:**
   - `docs/design-docs/multi-chain-kyc-sharding.md` §"On-chain mechanism" / §"Idempotency";
   - `docs/design-docs/whitelist-enforcement-model.md:38`.
4. **`docs/references/index.md:29`:** the generated Stellar reference is a pre-#36 snapshot. Say
   so, and point to the new section.
5. **Tracking:**
   - One tech-debt entry: regenerate `docs/generated/stellar-protocol-contracts.md`.
   - One user-stories doc for the ops checks (ISSUE_PROTOCOL §6).

### Out of scope

- **Anything in the `eq-lab/argocd` repo** (`pipeline/test.yaml`, `pipeline/prod.yaml`). It is
  live config, auto-deployed on merge. pipeline-test already holds the correct ids.
- **`VITE_STELLAR_*`** (`.env.example:245-259`). Left to a frontend follow-up.
- **`.env.example:178-186`** (the Phase 4 yield-mint block) and **`backend.md:325-326, 604-653`**.
  #1793 deletes or rewrites these, including the stale `executor` note at `backend.md:631`. The
  `.env.example:182` "`executor`" note goes with that block.
- **`backend.md:368-418`** (DealTokenFactory sections). #1788 owns these.
- **Test fixtures and golden vectors that pin old ids.** These are `packages/*/tests/**`,
  `packages/shared/src/stellar_voucher.rs` tests and `packages/api/src/routes/vouchers.rs:740`.
  They are test data, not deployment config.
- **The merged seed migration** `packages/shared/migrations/20260617000001_seed_stellar_splusd_vault.sql`.
  Merged migrations are never edited.
- **Contract or deployment changes.** Contracts are frozen.

## Assumptions and Risks

### Rollout safety (pipeline-test)

The issue body has no "Rollout safety" section. The epic-standard rules (as in #1789-#1793) apply
like this:

- **Nothing in this PR reaches a running service.**
  - `dotenvy::dotenv()` (`api/src/main.rs:40`, `worker/src/main.rs:24`) loads `.env`, never
    `.env.example`.
  - The images build no `.env` from it (`Dockerfile`, `docker/*/entrypoint.sh`).
  - The image Argo deploys on merge is unchanged.
- **No `argocd` file is touched.** The coder must not open a PR against `eq-lab/argocd`.
- **No migration, no env key read, no boot-time requirement.** Previous images keep booting, so
  rollback is trivial.
- **EVM is untouched.** No EVM line in `.env.example` changes.
- **CI:** `scripts/check-chain-env-names.sh` (`.github/workflows/lint.yml:37`) greps
  `.env.example` for retired spellings. New lines must use `CHAIN_<id>_STELLAR_[<COMPONENT>_]…` or
  `CHAIN_<id>_<COMPONENT>_STELLAR_…`. They must not use `CHAIN_<id>_START_BLOCK`,
  `CHAIN_<id>_PRICE_POLLER_STELLAR_*` or `CHAIN_<id>_STELLAR_LOAN_REGISTRY_ID`.

### Keys that no code reads yet

`rg -n 'POCKET_ADDRESS|SECURITY_REGISTRY_ADDRESS|STELLAR_API_MINTER_ADDRESS|STELLAR_API_WITHDRAWAL_QUEUE_ADDRESS' packages/api/src packages/worker/src packages/shared/src`
returns nothing at `a54ad106`.

- `shared::chains::validate_chain_kind_keys` (`chains.rs:49-73`) rejects only keys of the
  *other* chain kind. A not-yet-read `CHAIN_<id>_STELLAR_*` key is silently ignored, so it does no
  harm but also does nothing.
- The docs must say exactly that: "not read by this build; lands with #N".
- The coder re-runs the `rg` at implementation time. If a sibling has merged its reader by then,
  that key moves to the live block with its real comment, and the "not read" label is dropped.
- The key names are taken from the issue bodies:
  - `CHAIN_<id>_STELLAR_INDEXER_POCKET_ADDRESS` (#1789);
  - `CHAIN_<id>_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS` (#1779, epic #1775);
  - `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS` (#1790);
  - `CHAIN_<id>_STELLAR_API_WITHDRAWAL_QUEUE_ADDRESS` (#1791).

  If a sibling's plan renames one, that sibling's PR updates the line. Each sibling issue
  already lists `.env.example` / `backend.md` in its own docs scope.

### Coordination and conflicts

- **#1793** (PR #1803, draft, plan only so far): deletes `.env.example:178-186` and rewrites
  `backend.md:325-326, 604-632, 652-653`.
  - This plan edits none of those lines. Its `.env.example` hunks stop at line 176 and resume at
    line 187.
  - Whichever PR lands second rebases. The hunks are disjoint, so a conflict can arise only from
    adjacent context at 176/187. Resolve it by keeping both sides.
  - If #1794 merges first, the stale `executor` notes at `.env.example:182` and `backend.md:631`
    survive until #1793. The new backend.md section states the correct roles regardless.
- **#1788** (branch `fix/1788-dtf-debt-only-deal-registered`, plan only):
  - It edits `backend.md:368-418`. This plan does not touch those lines.
  - It hands `.env.example:151` (the "DEBT/CARGO movements" comment) to this issue.
  - Both PRs add an "Epic #1776" section to `docs/user-stories/index.md`. The second to merge
    appends its row to the section the first created.
- **#1779 / #1789 / #1790 / #1791:** each will flip its own "not read by this build" line. That
  is a small, predictable conflict, owned by the later PR.

### Other risks

- **Developer `.env` files** whose `STELLAR_VERIFIER_SECRET` maps to `GDH66JAF…` sign vouchers
  the #36 DM rejects. This was already true and is not caused by this PR. The checklist tells
  ops how to verify (`verifier()`).
- **`docs/generated/stellar-protocol-contracts.md`** still lists pre-#36 ids and WASM.
  `docs/references/index.md:29` calls it "verified testnet addresses". This plan relabels it and
  logs a TD instead of regenerating it here.
- **pipeline-prod (FYI only, out of scope):** `argocd` `origin/main` `pipeline/prod.yaml` pins
  API / worker at `v0.0.4`, and its Stellar keys match that old image:
  - retired `CHAIN_99000002_PRICE_POLLER_STELLAR_*` names;
  - no `…_STELLAR_API_LOAN_REGISTRY_ADDRESS`;
  - Phase 4 keys set.

  The new checklist applies when prod is upgraded. The manager may want #1793's argocd follow-up
  to cover `prod.yaml:294-295` too.
- **Contracts FYI (frozen, no action here):** HEAD `setup-access` maps the *legacy*
  CollateralRegistry function names (`pledge`, `set_stage`, …) onto the SecurityRegistry
  (`justfile:720-721`). The SecurityRegistry's own methods (`register`, `perfect`, …) would fall
  back to ADMIN. This affects Trustee roles under epic #1775, not backend signers. Relay it to
  #1779's planner; it changes nothing in this plan.

## Open Questions

_None_

## Implementation Steps

All paths are relative to the worktree
`/Users/aabliazimov/Documents/work/pipeline-chore-1794-stellar-contract-ids-sync`.

1. **Re-verify the inputs**, so nothing has moved since this plan:
   ```bash
   C=/Users/aabliazimov/Documents/work/pipeline-stellar-contracts
   git -C $C log -1 --format=%h                      # expect 7646cef (if newer: re-diff deployments/networks)
   git -C $C log --format='%h %s' -3 -- deployments/networks/testnet/addresses.json deployments/networks/mainnet/addresses.json
   jq . $C/deployments/networks/{testnet,mainnet}/addresses.json
   jq '{usdc, dm_verifier: .deposit_manager.verifier, wq_verifier: .withdrawal_queue.verifier, wq_custodian: .withdrawal_queue.custodian, whitelist_admin: .access.whitelist_admin}' $C/deployments/networks/{testnet,mainnet}/config.json
   rg -n 'POCKET_ADDRESS|SECURITY_REGISTRY_ADDRESS|STELLAR_API_MINTER_ADDRESS|STELLAR_API_WITHDRAWAL_QUEUE_ADDRESS' packages/api/src packages/worker/src packages/shared/src
   ```
   If the contracts HEAD moved and `addresses.json` changed (a #38 / #39 deploy), stop and report
   to the manager. The ids and the trap wording below assume #36 / #37.

2. **`.env.example`: Stellar indexer block (lines 136-164).**
   - Insert after line 139:
     ```
     #
     # Contract ids: pipeline-stellar-contracts@7646cef deployments/networks/<net>/addresses.json
     # (testnet = deployment #36, mainnet = #37 — mainnet block below). Which key takes which
     # contract, and how to re-sync: docs/references/backend.md "Stellar contract ids and signer roles".
     ```
   - Replace the values (full 56-char ids, copied from `addresses.json`, never from this plan):
     - 144 DM → `deposit_manager`.
     - 145 WQ → `withdrawal_queue`.
     - 146 WQ wallet `GDH66JAF…` → testnet `config.json` `withdrawal_queue.custodian`
       (`GA5TTGWU…`). Comment: "optional — config.json `withdrawal_queue.custodian` (MPC
       G-account), not the queue contract".
     - 147 sPLUSD → `staked_pl_usd`.
     - 148 LOAN_REGISTRY → `loan_registry`. Comment becomes "optional".
     - 149 MINTER → `minter`. Keep the existing comment.
     - 150 COLLATERAL_REGISTRY: move `CBSMJS5Q…` from the comment into the value. Comment:
       "optional — legacy CollateralRegistry: addresses.json `collateral_registry` from a #36 /
       #37 deploy; a #39+ id there is the SecurityRegistry (see below)".
     - 151 DEAL_TOKEN_FACTORY: the value is unchanged. Comment "per-deal DEBT/CARGO movements"
       becomes "per-deal DEBT movements (CARGO only for deals registered before contracts #38)".
     - 152 AM → `access_manager`, 153 USDC → `usdc`, 154 PLUSD → `plusd`. Keep "documentation
       only".
   - Insert after line 154 (before the polling lines):
     ```
     #
     # Not read by this build — each lands with the issue named; setting one today does nothing:
     # CHAIN_99000001_STELLAR_INDEXER_POCKET_ADDRESS=<testnet pocket id>             # #1789 — optional
     # CHAIN_99000001_STELLAR_INDEXER_SECURITY_REGISTRY_ADDRESS=                     # #1779 — optional; only a #39+ deploy's `collateral_registry` id (none deployed yet)
     ```
   - 161 price-poller sPLUSD → `staked_pl_usd`.
   - Line 75 `JOB_INDEXER_STELLAR_ASSET_ID` → testnet `usdc` (`CADLJ6YG…`).

3. **`.env.example`: Relayer whitelist block (166-176).**
   - 171 AM and 172 PLUSD SAC → the testnet ids.
   - 173 comment → "its G… must hold WHITELIST_ADMIN with execution delay 0 on the
     access-manager (config.json `access.whitelist_admin`)".
   - Do **not** touch 177-186.

4. **`.env.example`: API blocks (187-213).**
   - 192 comment → "chain-agnostic ed25519 seed; its G… must equal the DM / WQ `verifier`
     (testnet GCZAXE3C…, mainnet GAUCCZEC…)". Write both keys in full in the file.
   - 193 DM and 194 WQ → the testnet ids.
   - 204 `…_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID=G...` → the same `GA5TTGWU…` as line 146.
     Keep "optional".
   - 213 `…_STELLAR_API_LOAN_REGISTRY_ADDRESS=C...` → testnet `loan_registry`. Keep "required".
   - Insert after line 213:
     ```
     #
     # Not read by this build — each lands with the issue named; setting one today does nothing:
     # CHAIN_99000001_STELLAR_API_MINTER_ADDRESS=<testnet minter id>                 # #1790 — optional; cash-book scope
     # CHAIN_99000001_STELLAR_API_WITHDRAWAL_QUEUE_ADDRESS=<testnet WQ id>           # #1791 — optional; recovery-rate scope
     ```

5. **`.env.example`: new mainnet block**, inserted after the API LoanBook block (after the new
   step-4 lines, before `# ── Crystal Intelligence KYT`).
   - Header:
     ```
     # ── Stellar mainnet (99000002) ids ───────────────────────────
     #
     # pipeline-stellar-contracts@7646cef deployments/networks/mainnet (deployment #37). The same
     # keys as the testnet examples above, under CHAIN_99000002_; the passphrase has no default
     # off testnet. API / relayer / price-poller keys take the same id as the indexer key they
     # mirror (see backend.md "Stellar contract ids and signer roles").
     #
     ```
   - Then one commented line per item, with full values from mainnet `addresses.json` /
     `config.json`:
     - `CHAIN_99000002_TYPE=stellar`;
     - `CHAIN_99000002_STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015`;
     - indexer `DEPOSIT_MANAGER` / `WITHDRAWAL_QUEUE` / `STAKED_PLUSD` / `LOAN_REGISTRY` /
       `MINTER` / `COLLATERAL_REGISTRY` (legacy) / `DEAL_TOKEN_FACTORY` `_ADDRESS`;
     - `…_STELLAR_INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS` = `withdrawal_queue.custodian`;
     - `…_RELAYER_STELLAR_ACCESS_MANAGER_ID`, `…_RELAYER_STELLAR_PLUSD_SAC_ID`;
     - `JOB_INDEXER_STELLAR_ASSET_ID=` mainnet `config.json` `usdc` (`CCW67TSZ…`). Comment:
       "mainnet USDC — config.json `usdc`; addresses.json has none; job-level, so one network
       per worker";
     - a trailing "not read by this build" line for `CHAIN_99000002_STELLAR_INDEXER_POCKET_ADDRESS`
       (#1789).

   Do not add a mainnet `SECURITY_REGISTRY` line: mainnet has none deployed.

6. **`docs/references/backend.md`: line 289-291 sentence.** Replace "each contract's id supplied
   by a `CHAIN_<id>_STELLAR_*_ID` variable" with "each contract's id supplied by a
   `CHAIN_<id>_STELLAR_INDEXER_*_ADDRESS` variable (key map: [Stellar contract ids and signer
   roles](#stellar-contract-ids-and-signer-roles))". Change nothing else in that paragraph.

7. **`docs/references/backend.md`: new section** `### Stellar contract ids and signer roles`,
   inserted between `### Contract Upgrade Handling` (ends line 838) and `### Key Rotation`
   (line 840). Contents, in this order:

   a. **Source of truth.**
      - `pipeline-stellar-contracts` `deployments/networks/<testnet|mainnet>/addresses.json`
        holds the contract ids.
      - `config.json` holds the mainnet `usdc`, the `verifier`s, the `custodian`s and the
        `access.<role>` holders.
      - Current values are in `.env.example`, recorded at the commit named there (`7646cef`:
        testnet #36, mainnet #37).
      - `VITE_STELLAR_*` keys are synced separately (frontend).

   b. **Key map table.** Columns: `addresses.json` key | contract | worker key(s) | API key(s) |
      relayer key | notes. Rows:
      - `deposit_manager`: indexer `…_DEPOSIT_MANAGER_ADDRESS` (required); API
        `CHAIN_<id>_API_STELLAR_DM_CONTRACT_ID` (vouchers).
      - `withdrawal_queue`: indexer `…_WITHDRAWAL_QUEUE_ADDRESS` (required); API
        `…_API_STELLAR_WQ_CONTRACT_ID`; API `…_STELLAR_API_WITHDRAWAL_QUEUE_ADDRESS` (#1791, not
        read yet).
      - `staked_pl_usd`: indexer `…_STAKED_PLUSD_ADDRESS` (required); price poller
        `…_STELLAR_PRICE_POLLER_STAKED_PLUSD_ADDRESS` (required when the poller runs).
      - `loan_registry`: indexer `…_LOAN_REGISTRY_ADDRESS` (optional); API
        `…_STELLAR_API_LOAN_REGISTRY_ADDRESS` (required, must equal the indexer key).
      - `minter`: indexer `…_MINTER_ADDRESS` (optional; also gates relayer Phase 5); API
        `…_STELLAR_API_MINTER_ADDRESS` (#1790, not read yet).
      - `collateral_registry`: see the trap. Legacy → indexer `…_COLLATERAL_REGISTRY_ADDRESS`;
        SecurityRegistry → `…_SECURITY_REGISTRY_ADDRESS` (#1779, not read yet).
      - `deal_token_factory`: indexer `…_DEAL_TOKEN_FACTORY_ADDRESS` (optional).
      - `pocket`: indexer `…_POCKET_ADDRESS` (#1789, not read yet).
      - `access_manager`: relayer `…_RELAYER_STELLAR_ACCESS_MANAGER_ID` (required for the
        relayer).
      - `plusd`: relayer `…_RELAYER_STELLAR_PLUSD_SAC_ID` (required for the relayer).
      - `usdc` (testnet `addresses.json`; mainnet `config.json`): `JOB_INDEXER_STELLAR_ASSET_ID`
        (job-level, all Stellar chains of the worker).
      - `config.json` `withdrawal_queue.custodian`: indexer `…_WITHDRAWAL_QUEUE_WALLET_ADDRESS`
        and API `…_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID` (G-account).
      - `config.json` `deposit_manager.verifier` = `withdrawal_queue.verifier`: the public key of
        `STELLAR_VERIFIER_SECRET`.

      Add one line after the table: "`CHAIN_<id>_RELAYER_STELLAR_YIELD_MINTER_ID` /
      `…_RELAYER_STELLAR_LOAN_REGISTRY_ID` belong to the deleted Phase 4 (#1793) and are not
      synced." Also: "`CHAIN_<id>_STELLAR_{ACCESS_MANAGER,USDC_ASSET,PLUSD_ASSET}_ID` in
      `.env.example` are documentation only."

   c. **Trap: `collateral_registry`.**
      - #36 / #37 deployed the legacy CollateralRegistry under that key. HEAD's
        `deploy-security-registry` saves the SecurityRegistry under the same key
        (`justfile:323`).
      - Decide by the on-chain interface:
        `stellar contract info interface --id <id> --network <net>`. `pledge` / `lot` means
        CollateralRegistry → `…_COLLATERAL_REGISTRY_ADDRESS`. `register` / `perfect` /
        `record` means SecurityRegistry → `…_SECURITY_REGISTRY_ADDRESS`, **never** the
        collateral key.
      - An incremental `deploy-all` keeps an existing `collateral_registry` id
        (`justfile:649`), so an unchanged id after a #39 deploy is still the legacy contract.

   d. **Cursor rule.**
      - The Stellar cursor is one row per chain in `log_collector_state`. Every contract on the
        chain shares it.
      - `CHAIN_<id>_STELLAR_START_BLOCK` seeds it only while it is 0 (`stellar/poller.rs:295-307`).
      - A contract key added to a running chain is indexed only from the current cursor. Set it
        before the contract's deploy ledger passes, or rewind
        (`UPDATE log_collector_state SET last_indexed_block = <ledger> WHERE chain_id = <id>`,
        worker stopped) to a ledger still within Soroban RPC retention (about 7 days).
      - Re-indexed events are skipped by the `(chain_id, contract_address, block_number,
        log_index)` duplicate check (`shared/src/db.rs`).
      - Never `TRUNCATE` / delete `contract_logs` or `log_collector_state`. History older than
        retention cannot be re-fetched.

   e. **Full redeploy (every id changes).** A cursor plan, step by step:
      - record each new contract's deploy ledger;
      - switch every key above in one config change;
      - make sure the cursor is at or below the earliest deploy ledger. If it is already past
        that ledger, rewind within retention. Otherwise accept the gap and note it.
      - The old deployment's rows stay under their old `contract_address`. Readers scoped by the
        configured address ignore them. Chain-scoped readers (e.g. the Minter rows in "Minted
        yield") still see them.

   f. **Signer roles table.** Columns: env key | signer | access-manager role | delay | source.
      - `CHAIN_<id>_RELAYER_STELLAR_SIGNER_SECRET`: `WHITELIST_ADMIN`, delay 0 (`justfile:715,
        754`; `access.whitelist_admin`). A delayed holder is rejected, because the relayer never
        schedules.
      - `STELLAR_VERIFIER_SECRET`: no role. Its G… must equal the DM / WQ `verifier()`
        (`config.json` at deploy; `set_verifier` can change it).
      - Indexer and price poller: no key.

      Then a verification snippet:
      - `stellar contract invoke --id <AM> --network <net> --send=no -- has_role --role
        WHITELIST_ADMIN --account <relayer G…>`, expecting `execution_delay: 0, is_member: true`;
      - `… --id <DM|WQ> … -- verifier`, expecting the hex of the verifier G… public key.

      One line: Trustee wallet roles (`TRUSTEE`, `CASH_REPORTER` delay 0, `RISK_COUNCIL` delay
      86400) are frontend signers; see `product-specs/deposits.md` and
      `product-specs/loan-repayment-recovery.md`.

   g. **Checklist** (numbered, five to seven lines):
      1. pick the contracts commit;
      2. diff `addresses.json` / `config.json` against `.env.example` and both `argocd` files;
      3. map each key with the table;
      4. apply the trap check;
      5. for any new or changed contract, apply the cursor rule;
      6. verify the signer roles;
      7. update `.env.example` and the recorded commit; `argocd` changes go in their own PR in
         `eq-lab/argocd`, merged after the backend image that reads the key is deployed.

   Keep the section under about 90 lines. Use no inline HTML.

8. **`docs/design-docs/multi-chain-kyc-sharding.md`, §"On-chain mechanism" (line 125) and the
   paragraph after it (line 127):**
   - Rewrite to the actual call: `access_manager.execute(target = PLUSD SAC, function =
     "set_authorized", args = [Address(user), Bool(true)], caller = relayer G…)`, four positional
     args (`worker/src/relayer/stellar/whitelist.rs:108-123`; contract
     `access-manager/src/lib.rs:384`).
   - The caller needs `WHITELIST_ADMIN` with delay 0, granted by `setup-access`, or
     `just grant-role WHITELIST_ADMIN <G…>` (`justfile:505`).
   - Replace the `Operation`-struct / salt paragraph (127) with one sentence: there is no
     operation struct or salt; an immediate caller executes directly.
   - In §"Idempotency" (line 131), replace "the salt-based on-chain dedup means a duplicate
     submit is just a wasted fee" with "`set_authorized(addr, true)` is idempotent on the SAC,
     so a duplicate submit is just a wasted fee".
   - Leave line 121 alone (#1793 says it is already correct).

9. **`docs/design-docs/whitelist-enforcement-model.md:38`.** Replace "gated by the
   access-manager's `executor` role on the relayer's `G…` account" with "gated by the
   access-manager's `WHITELIST_ADMIN` role (execution delay 0) on the relayer's `G…` account".

10. **`docs/references/index.md:29`.** Change the description to: "pre-#36 testnet snapshot
    (2026-06-10): manager interfaces and SAC facts; its contract ids are superseded — current ids
    and key map in [backend.md](./backend.md#stellar-contract-ids-and-signer-roles)".

11. **`docs/exec-plans/tech-debt-tracker.md`.** Add one entry, numbered by the "Next free
    number" rule. The line says TD-159, but TD-159 already exists, so take the first unused
    number on the rebased `main` and bump the line.
    - Title: "`docs/generated/stellar-protocol-contracts.md` pins pre-#36 testnet ids and WASM
      interfaces".
    - Impact: misleading ids for ops and agents.
    - Fix: regenerate from `stellar contract info interface` against the #36 / #37 ids, or
      delete it in favour of the backend.md key map. Found while working on #1794.

12. **User-stories doc** `docs/user-stories/epic-1776/1794-stellar-contract-ids-sync.md`, in the
    format of `docs/user-stories/epic-1795/1760-…md`. Persona: operator. All steps are shell
    steps an agent can run (jq, rg, stellar CLI). Stories:
    1. Every backend Stellar contract id in `.env.example` (excluding `VITE_` lines) is a value
       in `addresses.json` (or mainnet `config.json` `usdc`) at the recorded commit, under the
       mapped key.
    2. pipeline-test (`eq-lab/argocd` `pipeline/test.yaml`) holds the same testnet ids for every
       key both files set.
    3. The testnet `collateral_registry` id exposes the legacy interface (`pledge` present,
       `register` absent), so it is configured as `…_COLLATERAL_REGISTRY_ADDRESS`.
    4. The relayer signer's `G…` has `WHITELIST_ADMIN` with `execution_delay: 0` on the testnet
       access-manager.
    5. The DM / WQ `verifier()` equals the `config.json` verifier.

    Add an "Epic #1776 — Stellar minter-era read models" section to
    `docs/user-stories/index.md` if #1788 has not already added it, and append the #1794 row.

13. **Run the verification in Test Strategy.** Fix anything it reports.

## Test Strategy

No code changes, so no unit tests and no clippy. The checks are scripted and run from the
worktree. None of them is committed.

1. **Id cross-check (acceptance 1).** A throwaway script in the scratchpad, Python or jq + rg:
   - Parse every `C…` / `G…` 56-char value on non-`VITE_` lines of `.env.example`.
   - Each must appear in testnet or mainnet `addresses.json`, or in the `config.json` fields
     above, at `7646cef`.
   - Each key must map to the expected JSON key:
     - `DEPOSIT_MANAGER` / `DM_CONTRACT_ID` → `deposit_manager`;
     - `WITHDRAWAL_QUEUE_ADDRESS` / `WQ_CONTRACT_ID` → `withdrawal_queue`;
     - `STAKED_PLUSD` → `staked_pl_usd`;
     - `LOAN_REGISTRY` → `loan_registry`;
     - `MINTER` → `minter`;
     - `COLLATERAL_REGISTRY` → `collateral_registry`;
     - `DEAL_TOKEN_FACTORY` → `deal_token_factory`;
     - `POCKET` → `pocket`;
     - `ACCESS_MANAGER` → `access_manager`;
     - `PLUSD_SAC` / `PLUSD_ASSET` → `plusd`;
     - `ASSET_ID` / `USDC_ASSET` → `usdc`;
     - `WITHDRAWAL_QUEUE_WALLET` → `withdrawal_queue.custodian`.
   - `CHAIN_99000001_` keys must match testnet and `CHAIN_99000002_` keys mainnet. The mainnet
     `JOB_INDEXER_STELLAR_ASSET_ID` line is the commented one in the mainnet block.
   - Expect zero mismatches.
2. **Stale ids gone:**
   `rg -n 'CARFA2Q|CC3TWGF|CDO4X3H|CBJUO44|CAC7JMG|CCWX3TK|GDH66JAF' .env.example` returns only
   `VITE_` lines (lines 245-259 do not hold these, so expect no output).
   `rg -n 'executor' .env.example docs/references/backend.md` returns hits only inside the
   #1793-owned regions (`.env.example:182`, `backend.md:631`) and the unrelated
   `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`.
3. **pipeline-test parity (read-only):**
   `git -C /Users/aabliazimov/Documents/work/argocd fetch && git -C … show origin/main:pipeline/test.yaml`.
   For every testnet key both files set, the values are equal. Report any difference to the
   manager. Do not edit argocd.
4. **Scope guard:**
   - `git diff --stat main` lists only `.env.example`, `docs/references/backend.md`,
     `docs/references/index.md`, the two design docs, `docs/exec-plans/tech-debt-tracker.md`,
     `docs/user-stories/epic-1776/1794-…md` and `docs/user-stories/index.md` (plus this plan).
   - `git diff main -- .env.example` shows no hunk inside lines 178-186 and none on a `VITE_`
     line.
   - `git diff main -- docs/references/backend.md` shows no hunk inside 325-326, 368-418 or
     604-653.
5. **Linters (acceptance 2):** `npx tsx scripts/lint-docs.ts` gives 0 errors (paste the
   summary in the PR), and `scripts/check-chain-env-names.sh` passes.
6. **Anchor check:** the `#stellar-contract-ids-and-signer-roles` links in steps 6 and 10
   resolve to the new heading. GitHub slugifies it exactly so; keep the heading text
   verbatim.

## Docs to Update

- `.env.example`: steps 2-5.
- `docs/references/backend.md`: steps 6-7.
- `docs/design-docs/multi-chain-kyc-sharding.md` and `docs/design-docs/whitelist-enforcement-model.md`:
  steps 8-9.
- `docs/references/index.md`: step 10.
- `docs/exec-plans/tech-debt-tracker.md`: step 11.
- `docs/user-stories/epic-1776/1794-stellar-contract-ids-sync.md` and `docs/user-stories/index.md`:
  step 12.
- No product-spec change: no user- or agent-facing behaviour changes.
