# Issue #263: /test Mocks tab — drop redundant "No mocks" and "Disconnected wallet" scenarios

Source: https://github.com/eq-lab/pipeline/issues/263

## Scope

Remove two scenarios from the registry that drives the `/test` Mocks tab because they duplicate behavior already covered by the top-level **Clear mocks** button:

1. `prod-defaults` — "Production defaults (no mocks)". Identical end state to **Clear mocks** (empty `keys: {}`).
2. `disconnected` — "Disconnected wallet". Sets only `pipeline.mock.wallet.isConnected: "false"`; with no other mock keys set the app is already disconnected, so this only adds value in the niche case where a real wallet is connected and the dev wants to force the disconnected view. A one-off DevTools `localStorage.setItem(...)` is a perfectly fine escape hatch for that.

The Mocks tab will go from 11 to 9 scenarios. The **Clear mocks** button and its behavior remain unchanged.

Affected files:

- `packages/frontend/src/routes/test/-scenarios.ts` — delete the two scenario entries.
- `packages/frontend/src/routes/test/-scenarios.test.ts` — drop assertions tied to the removed scenarios, swap helper test fixtures to use a still-existing scenario.
- `packages/frontend/src/routes/-test.test.tsx` — verify Mocks tab still renders correctly and that `SCENARIOS.length` is implicitly correct (existing test uses `SCENARIOS.length`, so it auto-tracks).

Out of scope (per Issue):

- Renaming the **Clear mocks** button.
- Re-shuffling the remaining scenario order.
- Adding any new scenarios.
- Any product-spec edits — `/test` is a developer surface with no product spec.

## Assumptions and Risks

- **Assumption.** No external code references the removed scenario ids (`prod-defaults`, `disconnected`) other than the two test files identified by `grep`. Confirmed by `grep -rn` against `packages/frontend/src` — only the registry and `-scenarios.test.ts` mention them.
- **Assumption.** The Mocks-tab tests in `-test.test.tsx` already key off `SCENARIOS.length` and `SCENARIOS.findIndex(...)` rather than fixed array offsets, so removing two entries does not require changes there. Verified by reading the file (`expect(enableButtons.length).toBe(SCENARIOS.length)`).
- **Risk.** The `-scenarios.test.ts` describe block named **`enableScenarioKeys()`** uses `id === "disconnected"` as its primary fixture (lines 105, 115, 135, 167, 179). After deletion those `find(...)!` calls return `undefined` and the non-null assertion will explode at runtime. Mitigation: replace with `connected-fresh` (a still-existing scenario whose keys differ enough from another one to keep the "clear-before-apply" assertion meaningful). For the A→B test, switch `scenarioA = "connected-fresh"`, `scenarioB = "connected-allowance-ok"` (different balance + allowance values, distinct from each other).
- **Risk.** The `prod-defaults scenario leaves no mock keys` test (line 140) becomes meaningless once `prod-defaults` is gone — delete the test outright. The structural invariant "every key starts with `pipeline.mock.`" already lives in a separate test and is unaffected.
- **Risk.** Existing manual-QA muscle memory may expect to find a `prod-defaults` card. Mitigation: the Clear mocks button is more prominent than any scenario card, and the Issue explicitly chooses the declutter.
- **No dependency on unfinished work.** #255 is closed and the file landed; this is a pure tightening pass.

## Open Questions

_None_

## Implementation Steps

1. **Edit `packages/frontend/src/routes/test/-scenarios.ts`:**
   - Delete the scenario block headed `// 1. Production defaults` (the entry with `id: "prod-defaults"`, lines ~64–71 of the current file).
   - Delete the scenario block headed `// 2. Disconnected wallet` (the entry with `id: "disconnected"`, lines ~73–82).
   - Renumber the remaining numbered comments (`// 3. Connected, fresh wallet …` → `// 1.`, etc.) so the visual ordering stays clean. Pure cosmetic — does not affect runtime.

2. **Edit `packages/frontend/src/routes/test/-scenarios.test.ts`:**
   - In the `enableScenarioKeys()` describe block (around lines 103–147):
     - Replace `SCENARIOS.find((s) => s.id === "disconnected")!` with `SCENARIOS.find((s) => s.id === "connected-fresh")!` in the "sets exactly the scenario's keys" test (line 105).
     - In the "clears a previous scenario's keys before applying the new one" test (lines 114–131), change `scenarioA` to `"connected-fresh"` and `scenarioB` to `"connected-allowance-ok"`. Both have overlapping `WALLET_CONNECTED_BASE` keys plus a differing `balance` / `allowance`, so the assertion that A's unique keys are wiped still has teeth (A and B have different values for the same balance/allowance keys, so "A's unique keys" reduces to `[]` — adjust assertion to assert that final keys exactly match B's keys, which the test already does at line 122–123).
     - In the "leaves non-mock keys untouched" test (line 135), swap `"disconnected"` for `"connected-fresh"`.
     - **Delete** the entire `prod-defaults scenario leaves no mock keys` test (lines 140–146) — the scenario no longer exists.
   - In the `enableScenario() and clearMocksAndReload()` describe block (around lines 157–204):
     - Swap both occurrences of `id === "disconnected"` (lines 167, 179) for `id === "connected-fresh"`.
   - Re-read the `SCENARIOS registry` describe block (lines 42–67): no changes required. All assertions are structural (unique ids, key prefix, non-empty title/description) and pass on any non-empty registry.

3. **`packages/frontend/src/routes/-test.test.tsx` review only — no edits required:**
   - `?tab=mocks shows an Enable button for each scenario` asserts `enableButtons.length === SCENARIOS.length`, which auto-adjusts (9 instead of 11).
   - `each Enable button corresponds to the right scenario` uses `SCENARIOS.findIndex((s) => s.id === "connected-allowance-ok")` — that scenario survives.
   - If there is a `Status tab has no content buttons` test counting `buttons.length === 2`, that count is independent of scenarios and unaffected.
   - Final action in this step: run the file to confirm the assumption (see Test Strategy).

4. **Lint pass:** `npx tsx scripts/lint-docs.ts` (project rule for TS changes). The file edits don't touch docs structure, but the lint script verifies cross-doc references.

5. **Unit + integration pass for the affected package:**
   - `cd packages/frontend && yarn test --run src/routes/test/-scenarios.test.ts src/routes/-test.test.tsx`
   - All assertions must pass.

## Test Strategy

- **Unit (existing, modified).** `packages/frontend/src/routes/test/-scenarios.test.ts` continues to cover:
  - Registry invariants (`unique ids`, `pipeline.mock.` prefix, non-empty title/description).
  - `clearAllMocks()` behavior (unchanged).
  - `enableScenarioKeys()` for a representative scenario (now `connected-fresh` instead of `disconnected`) — exact-key application, prior-scenario wipe, non-mock keys preserved.
  - `enableScenario()` / `clearMocksAndReload()` call `_reload.fn`.

- **Integration (existing).** `packages/frontend/src/routes/-test.test.tsx` continues to cover Mocks-tab rendering. The `enableButtons.length === SCENARIOS.length` assertion is the regression net for "the registry shrank from 11 to 9 and the UI matches".

- **Edge cases to confirm green:**
  - Tests asserting structural invariants over `SCENARIOS` (no ids leaked outside the file, all keys prefixed) still pass without any list-length hardcoding.
  - No test references `SCENARIOS[0]` or `SCENARIOS[1]` by index expecting the old scenarios — verified via `grep -n "SCENARIOS\[" packages/frontend/src` during planning; the only indexed access in `-test.test.tsx` is `SCENARIOS[0]` for "click first Enable button," whose contract is "the first card in the list," which remains valid (the new first scenario is `connected-fresh`).

- **Manual sanity (not blocking, optional for the coder):** Run the dev frontend, visit `/test?tab=mocks`, confirm exactly 9 scenario cards render starting with "Connected, fresh wallet …".

## Docs to Update

- None. `/test` is an internal developer surface with no product spec or user doc entry. The completed-plan archive for #255 (`docs/exec-plans/completed/issue-255-test-two-tabs.md`) lists all 11 original scenarios in a table; that document is **historical** and must not be retroactively edited (per project convention — completed plans are an immutable record of decisions at the time). No exception here.
- The execution plan for this Issue (this file) will be moved to `docs/exec-plans/completed/` by the manager on close.
