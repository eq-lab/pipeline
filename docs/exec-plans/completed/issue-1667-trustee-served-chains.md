# Issue #1667: Trustee: hide target-chain options the API does not serve (via GET /v1/chains)

Source: https://github.com/eq-lab/pipeline/issues/1667

Epic: #1521 (LoanBook API — multi-chain). Branch `feat/1667-trustee-served-chains`, draft PR #1872.

## Scope

In scope (`packages/trustee` only):

- New hook `useChains` over the public `GET /v1/chains` (shipped in #1608 / PR #1636), plus a
  derived `useServedTargetChains` that intersects the env-based `TARGET_CHAINS` with the served
  list and picks a default.
- Origination form (`/origination/new`) **Target chain** `<select>`: served-only options, default
  from `default_chain_id`, disabled while loading, env fallback on failure. JSON import accepts a
  `target_chain_id` only when it is one of the currently offered options.
- Loans page (`/loans`) **chain filter**: same served-only options; "All chains" stays the default
  and is always present.
- Spec + user-stories updates.

Out of scope:

- `targetChainLabel`, `isStellarTarget`, `chainAmountDecimals`, `stellarOnlyActionReason` — labels
  and per-loan logic keep reading `TARGET_CHAINS` / env (labels for a loan's own `chain_id` must
  render regardless of whether the API still serves it).
- `DEFAULT_TARGET_CHAIN_ID` call sites in `lib/loanRoute.ts` (missing `?chain=` search param on a
  loan link) and `routes/-origination-detail.ts` (submission rows without a `target_chain_id`) —
  these are a loan's legacy-chain fallback, not "offering" a chain; they stay on the env Stellar id.
- Any LP-app change (#1605 already shipped `useChainServed`); no shared package is introduced —
  the trustee app does not depend on `@pipeline/frontend` (epic #775, TD-42 hand-mirror
  convention).
- TD-150/151/152 (Stellar-only write gates) are unaffected. Chain-scope rule: both surfaces are
  cross-network selectors (the form picks a target chain, the filter narrows an all-chains page),
  so they list all served chains, not the session's signed-in chain.
- No Figma/design work — behaviour change on existing controls.

## Assumptions and Risks

- The endpoint is public. `apiFetch` (mandatory for all trustee API calls, ESLint
  `no-restricted-globals`, TD-33) attaches `Authorization: Bearer` when a session token exists;
  the public route ignores it. The issue's "no auth header" is read as "no auth required" — the
  hook must not be gated on a session (`enabled` always true). No `apiFetch` change.
- `retry: false` (mirrors LP `useChainServed`) so a failed request falls back to the env list
  immediately instead of keeping the select disabled through React Query's retry backoff.
- Query key `["chains"]`, `staleTime: Infinity` — one request per app load.
- Edge case: the served list shares **no** id with `TARGET_CHAINS` (misconfigured deployment).
  Options are then empty: the form select renders empty and disabled and submit fails client-side
  with "Required." on `target_chain_id`; the loans filter shows only "All chains". No new copy is
  invented for this case; it is documented in the spec as such.
- Membership filtering only: served ids are compared to env ids; nothing else is derived
  ([[no-frontend-computed-metrics]]). Served chains absent from env (no label source) are **not**
  added — the intersection is `TARGET_CHAINS ∩ served`, order kept from `TARGET_CHAINS`.
- #1602 user story 1 ("submit to an unserved EVM chain → 400 copy") becomes reachable only via the
  failure fallback after this change; the 400 copy stays (still needed for the fallback path and
  per-loan calls). Its story doc gets a one-line precondition note.
- Form value derivation (no `useEffect`): stored value is kept, but the **effective** target-chain
  value is `stored` when it is among the current options, else the computed default. This avoids an
  effect that races with user input and makes the loading→loaded transition a pure re-render.

## Open Questions

_None_

## Implementation Steps

1. **`packages/trustee/src/api/useChains.ts`** (new; header
   `// spec: docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100 (served chains, #1667).`)
   - Types `ChainItem { chain_id: number; kind: "evm" | "stellar" }`,
     `ChainsResponse { chains: ChainItem[]; default_chain_id: number }` (hand-mirror of
     `packages/api/src/routes/chains.rs`).
   - `useChains()` — `useQuery<ChainsResponse, Error>({ queryKey: ["chains"], queryFn: () =>
     apiFetch<ChainsResponse>("/v1/chains"), staleTime: Infinity, retry: false })`; returns the
     query.
   - `useServedTargetChains(): { options: ReadonlyArray<TargetChainOption>; defaultChainId: number | null; isLoading: boolean }`
     — calls `useChains()` and delegates to the pure `servedTargetChains` (step 2).
2. **`packages/trustee/src/lib/targetChains.ts`** — add pure
   `servedTargetChains(status: "pending" | "error" | "success", data: { chains: { chain_id: number }[]; default_chain_id: number } | undefined)`
   (local structural param type, so `lib/` does not import from `api/`):
   - `pending` → `{ options: [], defaultChainId: null, isLoading: true }`.
   - `error` → `{ options: TARGET_CHAINS, defaultChainId: DEFAULT_TARGET_CHAIN_ID, isLoading: false }`.
   - `success` → `options = TARGET_CHAINS.filter(c => data.chains.some(s => s.chain_id === c.id))`;
     `defaultChainId = options.some(o => o.id === data.default_chain_id) ? data.default_chain_id : options[0]?.id ?? null`.
   Keep `TARGET_CHAINS`, `DEFAULT_TARGET_CHAIN_ID`, `targetChainLabel` unchanged.
3. **`packages/trustee/src/routes/-origination-new.ts`**
   - Remove the static `TARGET_CHAINS` options from `FORM_SECTIONS`; the target-chain `FieldDef`
     keeps `options: []` (still marks it as a select so `parseSubmissionJson` skips the
     "missing" path and `FieldInput` renders a `<select>`).
   - `emptyFormValues()` sets `[TARGET_CHAIN_FIELD]: ""` (no fabricated choice before the list
     resolves).
   - `parseSubmissionJson(text, targetChainIds: ReadonlyArray<number>)` — for `TARGET_CHAIN_FIELD`
     membership is checked against `targetChainIds` (stringified) instead of `field.options`;
     other option fields (none today) keep `field.options`.
   - `useOriginationNewForm(targetChains: { options; defaultChainId })`:
     - effective value `targetChainValue = options.some(o => String(o.id) === stored) ? stored : defaultChainId == null ? "" : String(defaultChainId)`;
       expose `values` with `[TARGET_CHAIN_FIELD]: targetChainValue` so the select and
       `buildForSubmit` read the same value;
     - `importFromJson` passes `options.map(o => o.id)` to `parseSubmissionJson` and keeps the
       current effective value when the JSON has none / an unoffered one;
     - expose `targetChainOptions: ReadonlyArray<{ value: string; label: string }>` for the view.
   - Drop the `DEFAULT_TARGET_CHAIN_ID` / `TARGET_CHAINS` imports.
4. **`packages/trustee/src/routes/origination.new.tsx`**
   - `const targetChains = useServedTargetChains();` → `useOriginationNewForm(targetChains)`.
   - `FieldInput` gains `options` (override) and `disabled` props; for `TARGET_CHAIN_FIELD` the page
     passes `form.targetChainOptions` and `disabled={targetChains.isLoading || form.targetChainOptions.length === 0}`;
     `<select disabled>` uses the existing classes plus `disabled:cursor-not-allowed disabled:opacity-50`
     (same disabled treatment as the submit button). Submit button unchanged.
5. **`packages/trustee/src/routes/loans.index.tsx`**
   - `ChainFilter` takes `options: ReadonlyArray<TargetChainOption>` and `disabled: boolean`;
     renders "All chains" + `options` (labels from `TargetChainOption.label`). The page calls
     `useServedTargetChains()` and passes `options` / `isLoading`. Replace the `TARGET_CHAINS`
     import. This file is in `scripts/lint-comments.baseline.json` — do not add comments; shrink its
     baseline entry if the edit removes any.
6. **Docs** (see Docs to Update) — spec first, then code.
7. Run `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts`, trustee `yarn lint`,
   `yarn test` (trustee workspace), and `yarn build` for `packages/trustee`.

## Test Strategy

- **`packages/trustee/src/api/-useChains.test.tsx`** (new; mirror
  `packages/frontend/src/api/useChainServed.test.tsx` — `vi.stubGlobal("fetch")`, `QueryClientProvider`
  with `retry: false`, mocked `@/lib/env` with `STELLAR_CHAIN_ID: 99_000_001`, `EVM_CHAIN_ID: 560048`):
  - requests `GET …/v1/chains` once; `useServedTargetChains` is `isLoading` with no options first;
  - served `[stellar, 560048]`, `default_chain_id: 560048` → both options, default 560048;
  - served `[stellar]` only → EVM option absent (acceptance 1), default Stellar;
  - `default_chain_id` not among options → first option;
  - 500 → env fallback `TARGET_CHAINS`, default `DEFAULT_TARGET_CHAIN_ID`, not loading (acceptance 3).
- **`packages/trustee/src/lib/-targetChains.test.ts`** — table tests for `servedTargetChains`
  (pending / error / success incl. empty intersection → `options: []`, `defaultChainId: null`).
- **`packages/trustee/src/routes/-origination-new.test.ts`** — update: `emptyFormValues()` target
  is `""`; `parseSubmissionJson` takes the offered ids (accepted when offered, ignored when not,
  never "missing"); `buildSubmitLoanInput` with an empty target → `Required.`
- **`packages/trustee/src/routes/-origination-new-page.test.tsx`** — `vi.mock("@/api/useChains")`
  for `useServedTargetChains`:
  - loading → select disabled, no options;
  - served Stellar-only → one option, EVM absent;
  - `defaultChainId: 560048` → select preselects it and the submit posts `chainId: 560048`
    (acceptance 2);
  - error-fallback shape → both env options enabled; existing "choose EVM → posts `chain_id`"
    test keeps passing under this mock.
- **`packages/trustee/src/routes/-loans.index.test.tsx`** — mock `useServedTargetChains`:
  served Stellar-only → filter offers "All chains" + "Stellar" only; loading → only "All chains",
  disabled; fallback → env list; existing filter-change test keeps passing.

## Docs to Update

- `docs/frontend/trustee-flows.md` (not size-capped; 2106 lines):
  - "Target chain (#1536)" bullet (~line 1383): options are `TARGET_CHAINS ∩ GET /v1/chains`
    (`useServedTargetChains`, `api/useChains.ts`, #1667); default = served `default_chain_id` when
    offered, else first option; disabled while loading; on request failure the env list +
    Stellar default; empty intersection → empty disabled select, "Required." on submit. Replace
    "An id the API does not have in `CHAINS` is a `400` rendered inline" with: only reachable on the
    fallback path, still rendered via the #1602 copy.
  - Import-from-JSON bullet (~line 1407): "one of the configured ids" → "one of the offered
    (served) ids".
  - Loan book `useLoanBook` bullet (~line 236–239): chain filter lists "All chains" + served
    `TARGET_CHAINS` (same hook; disabled with only "All chains" while loading; env list on failure).
- `docs/user-stories/epic-1521/1667-trustee-served-chains.md` (new): stories — (1) API `CHAINS`
  without the env EVM chain → neither the Target chain select nor the loans chain filter offers it;
  (2) Target chain defaults to `default_chain_id`; (3) `/v1/chains` blocked (DevTools request
  blocking) → both surfaces show the env list and the form submits; (4) select disabled until the
  list arrives.
- `docs/user-stories/epic-1521/1602-trustee-chain-id-400-copy.md`: one-line precondition note on
  Story 1 — since #1667 the unserved chain is only selectable when `/v1/chains` fails (block it).
- No `docs/product-specs/` change (no file touched there, so no 200-line cap concern).
- `docs/exec-plans/tech-debt-tracker.md`: none expected; if the coder adds a hand-mirrored
  `ChainsResponse` type, note it under the existing TD-42 hand-mirror entry as a further pair
  (LP `useChainServed.ts` ↔ trustee `useChains.ts`).
