# Issue #255: Restructure /test as two tabs: Status (live readout) + Mocks (scenarios)

Source: https://github.com/eq-lab/pipeline/issues/255

## Scope

Restructure `packages/frontend/src/routes/test.tsx` from a single read-only page into a two-tab page driven by a TanStack Router search param:

- **Status tab** (default) — the existing read-only sections moved verbatim under a tab wrapper. No behavioral change; no buttons (already true post-#252).
- **Mocks tab** — new. Renders a global **Clear mocks** button and a list of scenario cards. Each card has a title, description, and an **Enable** button. Enable wipes every `pipeline.mock.*` key from `localStorage`, seeds the scenario's keys, then reloads the page via `window.location.reload()`.

Scenario data lives in a new module `packages/frontend/src/routes/test/scenarios.ts`. The page consumes that list — adding a scenario is one entry in the array.

The active tab is reflected in the URL via the `?tab=status|mocks` search param (TanStack Router `validateSearch` + `useSearch` + `useNavigate`). Default value is `status`; invalid values fall back to `status`.

**Out of scope** (per Issue):

- Any reactive plumbing (queryClient invalidation, custom events) for scenario activation — page reload is the contract.
- An "Active" badge on scenario cards.
- Multi-select / overlay scenarios.
- Storybook coverage of scenarios.
- Hiding `/test` in production builds.
- Renaming `/test`.

## Assumptions and Risks

**Assumptions**

- TanStack Router 1.168.x supports `validateSearch` and `useSearch` on file routes (it does — used widely in TSR docs). No new dependency required.
- `window.location.reload()` is acceptable as the scenario-activation contract; tests will stub it with `vi.spyOn(window, "location", "get")` or a similar JSDOM-friendly indirection. JSDOM doesn't expose a real `reload`, so the implementation must call it through a small indirection that tests can spy on — see Implementation Steps step 4.
- `localStorage.setItem` writes inside `enableScenario(...)` are intercepted by the same-tab mock bridge installed by `WalletProvider` — that bridge fires `pipeline-mock:wallet` events, but since we reload immediately after the writes those events don't affect anything in this flow. Safe.
- `#252` has already merged (it has — Issue is closed). The current `/test` page has zero buttons and only renders the read-only Status sections. The plan therefore only **adds** structure (tabs + Mocks tab); it does not delete any existing UI.
- Scenarios reference concrete USDC + DepositManager addresses. We use the existing placeholders that appear in `src/wallet/README.md`:
  - USDC: `0x2222000000000000000000000000000000000002`
  - DepositManager (spender for allowance): `0x3333000000000000000000000000000000000003`
  - The DepositManager named aliases (`pipeline.mock.wallet.contract.depositManager.usdc`) are also seeded so `useDepositManagerAddresses()` returns the USDC address that the allowance/balance keys are written under. Without this, the wallet hooks would read the real `ENV.DEPOSIT_MANAGER_ADDRESS` (often zero-address in dev) and the per-token mock keys wouldn't match.

**Risks**

- **`__mock_error` semantics drift.** Scenario 12 ("API down") wants the api wrapper to surface an error when it encounters `{ "__mock_error": true, "status": 500 }` in a mock value. The current `apiFetch` parses any mock JSON and returns it as-is — it does NOT interpret an `__mock_error` envelope. We have two choices: (a) extend `apiFetch` to recognise the envelope and throw, (b) drop scenario 12 from the initial set, or (c) ship scenario 12 with a payload that triggers a TS / runtime error in `useRequests` (brittle). The Issue explicitly says "Document the convention … in `src/api/README.md` as part of this PR." We interpret that as: **implement and document**. See Open Questions.
- **Search-param routing is new.** No other route in the project currently uses `validateSearch`. The pattern must be exact (TanStack Router types are strict). Mitigation: keep the search schema minimal — a single `tab: "status" | "mocks"` field with a fallback.
- **Stake/Unstake-with-real-flow keys** in scenarios 11 (mixed activity) are best-effort: Stake and Unstake rows are derived purely from the API mock; no separate localStorage keys are required for them beyond the api `requests` payload.
- **`window.location.reload` is unmockable in JSDOM.** Tests that need to assert "reload was called" must either spy on a wrapper function or replace `window.location` with a stub. The plan uses a tiny internal wrapper `reloadPage()` exported from `scenarios.ts` that the tests can `vi.spyOn`.

## Open Questions

1. **`__mock_error` envelope behaviour** — should `apiFetch` recognise `{ "__mock_error": true, "status": <n>, "message"?: <str> }` in a mock value and throw an `Error` (so React Query enters error state), or should scenario 12 be deferred to a later Issue once the convention is approved? The Issue body implies in-scope ("Document the convention … as part of this PR"), but the code change is a behaviour change in `apiFetch` that affects every consumer. **Default plan: implement it in this PR** — see Implementation Step 6 — but flag for human review on the planning gate.
2. **Initial scenario set scope** — the Issue lists 12 scenarios as "recommended starting set, implementer can refine." Are all 12 in scope for this PR, or only #1–#6 with the API-dependent ones (#7–#12) deferred? **Default plan: ship all 12** since they're cheap (data, not logic). Easy to drop later.

## Implementation Steps

### 1. Create the scenarios module — `packages/frontend/src/routes/test/scenarios.ts`

Define:

```ts
export interface TestScenario {
  id: string;
  title: string;
  description: string;
  keys: Record<string, string>;
}

export const SCENARIOS: ReadonlyArray<TestScenario> = [ /* 12 entries — see below */ ];

/** Wipes every `pipeline.mock.*` key from localStorage. Returns the list of removed keys (for testability). */
export function clearAllMocks(): string[] { /* iterate localStorage, collect + remove */ }

/** Pure helper: applies a scenario's keys after `clearAllMocks()`. Does NOT reload. */
export function enableScenarioKeys(scenario: TestScenario): void { /* clearAllMocks() + setItem each key */ }

/** Wrapper around `window.location.reload()` so tests can spy on it. */
export function reloadPage(): void { window.location.reload(); }

/** Full activation flow: enableScenarioKeys() then reloadPage(). Used by the Mocks tab UI. */
export function enableScenario(scenario: TestScenario): void { enableScenarioKeys(scenario); reloadPage(); }

/** Full clear flow: clearAllMocks() then reloadPage(). Used by the top-level Clear button. */
export function clearMocksAndReload(): void { clearAllMocks(); reloadPage(); }
```

Scenario data — exact `id` values (stable for URL fragments / tests / debugging):

| id | title | description (concise) | keys |
|---|---|---|---|
| `prod-defaults` | Production defaults (no mocks) | Every `pipeline.mock.*` key is removed. App falls through to real RPC / API. | `{}` (Enable behaves identically to Clear) |
| `disconnected` | Disconnected wallet | Wallet not connected. App env defaults; no overrides. | `{"pipeline.mock.wallet.isConnected":"false"}` |
| `connected-fresh` | Connected, fresh wallet (zero USDC, zero allowance) | Wallet connected; no funds; no approval. Home shows Portfolio transition; `/deposit` Approve disabled. | address, isConnected=true, depositManager.usdc/plusd, minDeposit=1_000_000, balance.<usdc>=0, allowance.<usdc>.<dm>=0 |
| `connected-below-min` | Connected, balance below min deposit | Triggers the low-balance banner on `/deposit` per Figma 1825:10214. | as `connected-fresh` + `balance.<usdc>=500_000` |
| `connected-allowance-zero` | Connected, balance ≥ min, allowance 0 | Approve is the live action on /deposit. | as `connected-fresh` + `balance.<usdc>=100_000_000`, `allowance.<usdc>.<dm>=0` |
| `connected-allowance-ok` | Connected, allowance ≥ amount, no active request | Confirm is the live action on /deposit. | as `connected-allowance-zero` but `allowance.<usdc>.<dm>=100_000_000_000` |
| `request-pending-verification` | Connected, PendingVerification request | Step 2 in flight (per #242). | as `connected-allowance-ok` + `api.GET./v1/requests` JSON with one Deposit, `status:"PendingVerification"` |
| `request-pending-claim` | Connected, PendingClaim request, voucher ready | Step 3 enabled. | as `request-pending-verification` with `status:"PendingClaim"` + `api.GET./v1/deposits/<id>/voucher` returning a signature |
| `request-verification-failed` | Connected, VerificationFailed request | Step 2 in failed state; input still editable. | as `request-pending-verification` with `status:"VerificationFailed"` |
| `history-completed` | Connected, Completed deposit history | `/transactions` and home RecentActivityCard render historical rows. | wallet keys from `connected-allowance-zero` + `api.GET./v1/requests` with several Completed Deposit/Withdraw rows |
| `history-mixed` | Connected, mixed activity (Deposit + Withdraw + Stake + Unstake) | Stresses the row-rendering helper across every `type`. | wallet keys + a wide `/v1/requests` mock spanning all 4 types and both terminal/in-flight statuses |
| `api-down` | API down | `pipeline.mock.api.GET./v1/requests` returns an error envelope; pages fall back to error/empty states. | wallet keys + `api.GET./v1/requests = JSON.stringify({ __mock_error: true, status: 500, message: "API down (mock)" })` |

Concrete addresses used in keys:

- Wallet address: `0x1234000000000000000000000000000000000000`
- USDC: `0x2222000000000000000000000000000000000002`
- DepositManager: `0x3333000000000000000000000000000000000003` (this is the spender; we also seed `pipeline.mock.wallet.contract.depositManager.usdc=<USDC>` so allowance and balance keys line up with what `useDepositManagerAddresses()` returns)

`scenarios.ts` MUST keep keys in a `Record<string, string>` (already-serialised) so it is trivially testable as data.

### 2. Search-param routing — update `packages/frontend/src/routes/test.tsx`

Replace the `createFileRoute("/test")({ component: TestPage })` export with:

```ts
type TestTab = "status" | "mocks";

export const Route = createFileRoute("/test")({
  validateSearch: (raw): { tab: TestTab } => {
    const tab = raw.tab === "mocks" ? "mocks" : "status";
    return { tab };
  },
  component: TestPage,
});
```

Inside `TestPage`:

```ts
const { tab } = Route.useSearch();
const navigate = Route.useNavigate();
const setTab = (next: TestTab) => navigate({ search: { tab: next } });
```

### 3. Render the SegmentedTabs + tab body — `packages/frontend/src/routes/test.tsx`

Layout (inside the existing `<main>`):

1. `<h1>` page heading (unchanged).
2. `<SegmentedTabs tabs={[{id:"status",label:"Status"},{id:"mocks",label:"Mocks"}]} activeId={tab} onSelect={(id) => setTab(id as TestTab)} />` — imported from `@pipeline/ui`.
3. Conditional body:
   - `tab === "status"` → existing read-only sections, extracted into a small `<StatusTab />` component in the same file (no behaviour change; pure refactor — move everything currently inside `<main>` after the `<h1>` into the component).
   - `tab === "mocks"` → new `<MocksTab />` component (see step 4).

### 4. Implement `<MocksTab />` — same file `packages/frontend/src/routes/test.tsx`

Structure:

```
<MocksTab>
  <div className="flex justify-end">
    <button onClick={clearMocksAndReload}>Clear mocks</button>
  </div>
  <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
    {SCENARIOS.map(s => (
      <li><ScenarioCard scenario={s} /></li>
    ))}
  </ul>
</MocksTab>
```

`<ScenarioCard>` renders title + description + Enable button (calls `enableScenario(scenario)`). Visual styling follows existing `Section`/card token conventions on the page — bordered, padded, paper background — no new design tokens.

Both buttons use the existing `<Button>` primitive from `@pipeline/ui` (verify it's still imported / re-add if it was dropped in #252).

### 5. Update tests — `packages/frontend/src/routes/-test.test.tsx`

Existing assertions to keep:
- Environment section heading renders on Status tab (default).
- MOCKED badge plumbing tests still pass — they assume Status is the visible tab, which is the default.

Existing assertion to **revise**:
- "renders no buttons" — this becomes "Status tab has no buttons; switching to Mocks tab reveals the Clear button + scenario Enable buttons."

New assertions:
- **Default tab is Status.** Render with no search param; assert the Environment heading is visible and the Clear button is not.
- **`?tab=mocks` lands on Mocks tab.** Render with `tab: "mocks"` in the route's search state; assert the Clear button is visible and an "Enable" button appears for each scenario.
- **`?tab=foo` falls back to Status.** Render with `tab: "foo" as any`; assert the Environment heading is visible.
- **Clear button:** mock `localStorage.setItem` with several `pipeline.mock.*` and one non-mock key; click Clear; assert all `pipeline.mock.*` keys are removed, the non-mock key survives, and `reloadPage` was called (spy on `reloadPage` via `vi.spyOn(scenariosModule, "reloadPage")` — module-level export makes this clean).
- **Enable button:** for a representative scenario (e.g. `connected-allowance-ok`), preset some unrelated `pipeline.mock.*` keys; click Enable; assert the unrelated keys are gone, every key in the scenario is set with its exact value, and `reloadPage` was called once.

Add a new test file `packages/frontend/src/routes/test/scenarios.test.ts`:

- Every `SCENARIOS[i].id` is unique.
- Every key in every scenario starts with `pipeline.mock.`.
- `enableScenarioKeys(scenario)` after a previous `enableScenarioKeys(otherScenario)` leaves localStorage with exactly `scenario.keys` (no leakage). Use `clearAllMocks()` semantics — verify with `Object.keys(localStorage).filter(k => k.startsWith("pipeline.mock."))`.
- `clearAllMocks()` returns the list of removed keys and leaves non-mock keys intact.

### 6. `apiFetch` — surface `__mock_error` envelope (pending Open Question 1)

Edit `packages/frontend/src/api/client.ts`:

After resolving a mock value (in either lookup branch), check if the value is an object of shape `{ __mock_error: true, status?: number, message?: string }`. If so, throw `new Error(value.message ?? \`HTTP ${value.status ?? 500} (mocked)\`)`.

Add tests in `packages/frontend/src/api/client.test.ts`:
- A mock value with `__mock_error: true` causes `apiFetch` to throw.
- A regular mock value is returned unchanged.
- The `status` and `message` fields are honoured in the thrown error.

### 7. Document the `__mock_error` convention — `packages/frontend/src/api/README.md`

Add a subsection under "API module" mock layer:

```
### Simulating API errors

Set a mock value to a JSON envelope:

\`\`\`js
localStorage.setItem(
  "pipeline.mock.api.GET./v1/requests",
  JSON.stringify({ __mock_error: true, status: 500, message: "API down (mock)" }),
);
\`\`\`

`apiFetch` recognises this envelope and throws an `Error` with the given `message` (or a synthesised `HTTP <status> (mocked)` message). React Query then enters the error state — useful for testing error UI without taking the real backend down.
```

### 8. Lint + format

After every change run:

```
yarn workspace @pipeline/frontend lint
yarn workspace @pipeline/frontend test
npx tsx scripts/lint-docs.ts
```

Fix any lint errors before committing.

## Test Strategy

**Unit / component tests (vitest + Testing Library)**

- `packages/frontend/src/routes/test/scenarios.test.ts` (new):
  - Unique ids.
  - Every key starts with `pipeline.mock.`.
  - `clearAllMocks()` removes only `pipeline.mock.*` keys and leaves others intact.
  - `enableScenarioKeys(B)` after `enableScenarioKeys(A)` leaves exactly `B.keys` in localStorage.
  - `enableScenario` and `clearMocksAndReload` call `reloadPage` (via module-level spy).

- `packages/frontend/src/routes/-test.test.tsx` (update):
  - Status is the default tab (no search param).
  - `tab=mocks` renders the Mocks tab with a Clear button + N Enable buttons (one per scenario).
  - Invalid `tab` value falls back to Status.
  - Clicking Clear removes all `pipeline.mock.*` keys, preserves non-mock keys, and calls `reloadPage` once.
  - Clicking an Enable button writes the scenario's keys exactly and calls `reloadPage` once.
  - Status tab continues to have zero buttons (regression for #252).
  - MOCKED badge plumbing still works on the Status tab.

- `packages/frontend/src/api/client.test.ts` (update):
  - `apiFetch` throws when the mock value is `{ __mock_error: true, ... }`.
  - The thrown error message uses `message` if present, else `HTTP <status> (mocked)`.
  - A non-error mock value is returned unchanged.

**Manual verification (no Figma reference — `/test` is dev-only)**

1. `yarn workspace @pipeline/frontend dev`, open `/test`, confirm Status is the default and matches today.
2. Click the Mocks tab. URL becomes `/test?tab=mocks`. Reload — still on Mocks.
3. Enable `connected-allowance-ok`. Page reloads. TopBar shows connected wallet, balance matches, allowance is sufficient. `/deposit` shows Confirm as the live action.
4. Enable `request-pending-claim`. Reload. `/deposit` shows Step 3 enabled (per #242 fix).
5. Enable `history-mixed`. Visit `/transactions` — all four tabs (Buy/Sell/Stake/Unstake) show rows.
6. Enable `api-down`. Visit `/transactions` — error / empty state renders, no crash.
7. Click Clear mocks. Page reloads to the unmocked state.
8. `localStorage.setItem("not-a-mock", "x")` in DevTools, then click Clear — confirm `not-a-mock` survives.

No Figma node referenced in the Issue; no design-comparison verification step required. Confirm the SegmentedTabs visual on `/test` is consistent with `/transactions` and `/stake` usage.

## Docs to Update

- `packages/frontend/src/api/README.md` — add the `__mock_error` envelope section (step 7).
- No product-spec changes — `/test` is a developer surface and isn't documented in `docs/product-specs/`.
- No design-doc changes — no new design tokens or components are introduced; `SegmentedTabs`, `Button`, and the existing page primitives are reused.
- No `docs/STORIES.md` change — `/test` is not part of the product user stories.
- After implementation, archive this exec plan to `docs/exec-plans/completed/` when the PR merges (manager handles this).
