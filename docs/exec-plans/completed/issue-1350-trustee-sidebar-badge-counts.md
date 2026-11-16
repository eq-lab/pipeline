# Issue #1350: Populate trustee sidebar nav badge counts from a backend source

Source: https://github.com/eq-lab/pipeline/issues/1350

Parent epic: #775. Source debt: TD-36. Backend dependency: #1864 (merged, deployed on staging).
Branch: `feat/1350-trustee-sidebar-badge-counts` (draft PR #1933).

## Scope

Wire the existing `NavBadge` slot in the Trustee sidebar to `GET /v1/attention-counts`
(`packages/api/src/routes/attention_counts.rs`, spec
`docs/product-specs/trustee-attention-counts.md`). The frontend does no counting: it renders
the served `count` integer.

Badge sources:

| Nav item | Served field | Scope |
|---|---|---|
| Origination (`/origination`) | `origination.count` (combined section) | all chains (cross-network page) |
| Loans (`/loans`) | `loans.count` (combined section) | all chains (cross-network page) |
| Cash Management (`/cash-management`) | `chains[i].cash_management.count` where `chains[i].chain_id === useSessionState().chainId` | the session's signed-in chain (per-network page) |

This follows the spec's "Per-chain and combined" rule and the trustee chain-scope rule. One
request serves all three: `GET /v1/attention-counts` with **no** `chain_id`, so the combined
sections cover every configured chain and `chains[]` carries the per-chain entries.

Overview, LP Counterparties, Risk Council and Audit Log get no badge (none in Figma
`4116:8855`, and the endpoint serves none).

Rendering rules:

- A served integer renders verbatim (no capping, no `99+`), except `0`, which hides the badge like an absent field (manager decision on #1350).
- No badge while the request is loading, when it fails (any non-2xx, including 401/403/500),
  when the field is absent or not a number, or, for Cash Management, when the session has no
  `chainId` or `chains[]` has no entry for it. There is no fallback to `ENV.STELLAR_CHAIN_ID`:
  the sidebar renders only for an authenticated session, which always carries `chainId`.
- Polling: `refetchInterval: 30_000`, the same as `useRampEvents` / `useLps` /
  `useCapitalAllocation`. Retry follows `useCashBook`: no retry on a 4xx, up to 2 retries
  otherwise.

Out of scope:

- `NeedsAttention` / `useNeedsAttention` on the Overview. #1864 added a separate route and did not
  extend that source, so there is no shared query to reuse. The Needs Attention lists keep their
  own `useLoanSubmissions` + `useLoanBook` reads.
- Invalidating `["attention-counts"]` from the action mutations (approve, record wire-in, settle
  wire-out, and so on). Badges catch up on the next 30 s poll. That is acceptable for a nav hint
  and matches the scope the manager gave.
- Badge visual changes. `NavBadge` already matches the Figma frame.
- Any backend change.

## Assumptions and Risks

- **Contract stability.** Types mirror `AttentionCountsResponse` in `attention_counts.rs` as
  merged. Only the three `count` fields and `chains[].chain_id` are read. The breakdown fields
  are typed (nullable where the DTO has `Option`) but not rendered.
- **Zero hides the badge.** The manager decided on #1350 that a served `0` is treated like an
  absent field in `navBadgeCounts`. Positive integers render verbatim.
- **Per-request backend cost.** Every Trustee page polls the route every 30 s. The #1864 plan
  accepted this (TD-174, recompute per request). Stopping the poll in background tabs is React
  Query's default (`refetchIntervalInBackground: false`), so no extra handling is needed.
- **`pending_bank_deposits` is chain-agnostic (TD-117).** It is part of every `chains[]` entry's
  `cash_management.count`. The badge shows the served per-chain count as is. The frontend does
  not adjust it.
- **Session chain not configured on the API.** If the trustee signed in on a chain that is
  missing from the API's `CHAINS`, `chains[]` has no entry and Cash Management shows no badge.
  That is the intended served-only behavior.
- **Tests.** `-TrusteeSidebar.test.tsx` renders without a `QueryClientProvider`, so it must mock
  the new hook (below). `-TrusteeShell.test.tsx` already stubs `TrusteeSidebar`, so it is
  unaffected.
- No dependency on open issues or unmerged PRs.

## Open Questions

_None_

## Implementation Steps

Status: steps 1-5 completed; `-authTransitions.test.tsx` also mocks `useAttentionCounts` because it renders the real sidebar.

1. **API hook: `packages/trustee/src/api/useAttentionCounts.ts`** (new). Header:
   `// spec: docs/product-specs/trustee-attention-counts.md#api-contract`. No other comments.
   - Export the types `OriginationCounts`, `LoanCounts`, `CashManagementCounts`,
     `ChainAttentionCounts` and `AttentionCountsResponse`. They mirror the Rust DTOs:
     - `margin_call_open`, `escrowed_wire_ins`, `pending_wire_outs`, `open_ramps` and
       `pending_ramp_events` are `number | null`;
     - every other field is `number`;
     - `chain_id` is `number`.
   - Export `attentionCountsKey = ["attention-counts"] as const`.
   - Export `useAttentionCounts()`, which returns
     `useQuery<AttentionCountsResponse, Error>` with these options:
     - `queryKey: attentionCountsKey`;
     - `queryFn: () => apiFetch<AttentionCountsResponse>("/v1/attention-counts")` (no `chain_id`);
     - `refetchInterval: 30_000`;
     - `retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2`
       (copied from `useCashBook.ts`).

2. **Sidebar hook: `packages/trustee/src/components/useNavBadgeCounts.ts`** (new). This is the
   co-located logic hook under FRONTEND.md rule 2. Header:
   `// spec: docs/frontend/trustee-flows.md#trustee-sidebar-figma-node-41168855-aside`.
   - Export a pure selector
     `navBadgeCounts(data: AttentionCountsResponse | undefined, chainId: number | undefined): Partial<Record<string, number>>`.
     It is keyed by nav path:
     - `"/origination"` gets `data.origination.count`;
     - `"/loans"` gets `data.loans.count`;
     - `"/cash-management"` gets the `cash_management.count` of
       `data.chains.find((c) => c.chain_id === chainId)`.
   - A key is set only when its value is `typeof === "number"`. When `data` is `undefined`, the
     selector returns `{}`. When `chainId` is `undefined` or no entry matches, it omits the Cash
     Management key. It reads defensively (`data.chains ?? []`, optional chaining on sections),
     so an unexpected shape yields no badge instead of throwing.
   - Export `useNavBadgeCounts()`. It reads `useAttentionCounts()` and
     `useSessionState().chainId` (from `@/auth/sessionStore`). It returns `{}` when
     `query.error` is set; otherwise it returns `navBadgeCounts(query.data, chainId)`. That way a
     failed refetch hides the badges instead of showing stale data. This follows the manager's
     rule "nothing when the request fails".

3. **`packages/trustee/src/lib/nav.ts`**:
   - Remove `badgeCount?: number` from `TrusteeNavItem`. Badge counts are runtime data and no
     longer static config.
   - Replace the header docblock with a 2-line spec pointer that no longer says "why
     `badgeCount` is unpopulated":
     `// The six Trustee nav sections.` and
     `// spec: docs/frontend/trustee-flows.md#nav-sections-libnavts`.
   - Leave the other field comments as they are, because the file is not baselined. Do not add
     any new comments.

4. **`packages/trustee/src/components/TrusteeSidebar.tsx`**:
   - `TrusteeSidebar` calls `const badgeCounts = useNavBadgeCounts();` and renders
     `<NavItem item={item} badgeCount={badgeCounts[item.path]} />`.
   - `NavItem` takes `{ item, badgeCount }: { item: TrusteeNavItem; badgeCount: number | undefined }`
     and renders `<NavBadge count={badgeCount} />`.
   - `NavBadge` is unchanged: it renders nothing for `undefined` and `{count}` otherwise.
   - Do not add new comments. Leave the existing header and inline comments alone; trimming them
     is not part of this issue.

5. **Lint and build** (inside `packages/trustee` for vitest):
   - `cd packages/trustee && npx vitest run`;
   - `yarn workspace @pipeline/trustee lint` (or the package's lint script) and its `build`;
   - from the repo root, `npx tsx scripts/lint-docs.ts` and `npx tsx scripts/lint-comments.ts`.
   - If the `-TrusteeSidebar.test.tsx` header is edited, shrink its
     `scripts/lint-comments.baseline.json` entry with `--update-baseline`.

## Test Strategy

- **`packages/trustee/src/api/-useAttentionCounts.test.tsx`** (new). Follow the
  `-useRampHooks.test.tsx` pattern: stub global `fetch`, mock `@/lib/env` and
  `@/auth/sessionStore` (`getSessionToken`), and wrap in a `QueryClientProvider`. Cases:
  - It requests `${API_BASE_URL}/v1/attention-counts` with no `chain_id` query, carries
    `Authorization: Bearer test-token`, and returns the served body unchanged.
  - A 403 surfaces as an error and is not retried: one fetch call. Use a client with default
    retry so the hook's own `retry` function is exercised.
  - A 500 is retried. Assert at least 2 calls or check the `retry` predicate directly. Keep it
    fast; a fake timer or a direct predicate test is fine.
  - Assert `refetchInterval` is 30 s, the same way `-useCapitalAllocation.test.tsx` does.
- **`packages/trustee/src/components/-useNavBadgeCounts.test.ts`** (new). Pure `navBadgeCounts`
  cases:
  - Origination and Loans come from the combined sections. Use a fixture where combined differs
    from any single chain to prove they are not read from `chains[]`.
  - Cash Management comes from the `chains[]` entry matching `chainId`. Cover both a Stellar
    (`99000001`) and an EVM (`560048`) session, each with a different count. The combined
    `cash_management.count` is never used.
  - `chainId` is `undefined`, or matches no entry: no `/cash-management` key, while the other two
    are still present.
  - `data` is `undefined`: `{}`.
  - A served `0` hides the badge: the key is omitted.
  - A missing or non-number `count` (malformed fixture cast through `unknown`) omits that key.
  - For `useNavBadgeCounts`, mock `@/api/useAttentionCounts` and `@/auth/sessionStore` and check
    two things. It returns `{}` when the query has an error, even with stale `data`. It returns
    the selected map when data is present.
- **`packages/trustee/src/components/-TrusteeSidebar.test.tsx`** (update):
  - Add `vi.mock("@/components/useNavBadgeCounts", ...)` with a hoisted, controllable return
    value. The default is `{}`.
  - Replace "does not render a badge for any nav item (no backend count source)" with:
    - With `{ "/origination": 2, "/loans": 3, "/cash-management": 5 }`, each of those three nav
      links contains a `trustee-nav-badge` with text `2` / `3` / `5`. Query within each link,
      for example `within(screen.getByRole("link", { name: /Origination/ }))`.
    - Overview, LP Counterparties, Risk Council and Audit Log never contain a badge.
    - With `{}`, no `trustee-nav-badge` is in the document.
  - Leave the existing network-switcher tests unchanged.
- **Manual check (staging, by the user).** Signed in on Stellar testnet, the Origination and Loans
  badges equal `origination.count` / `loans.count` from the Network tab's
  `/v1/attention-counts` response. Cash Management equals the `chains[]` entry for the session
  chain. Re-signing in on Hoodi changes only the Cash Management badge. Do not drive the user's
  browser; ask them to check.
- **Figma.** Badge styling already matches node `4116:8855` (`NavBadge` is unchanged), so no new
  design review is needed. The live review only confirms the badges appear on the three items.

## Docs to Update

- `docs/frontend/trustee-flows.md`:
  - In "Trustee sidebar (Figma node `4116:8855` "Aside")", rewrite the **Count badge slot**
    bullet to describe the shipped wiring and remove "wiring it is #1350":
    - the `useAttentionCounts` hook (`api/useAttentionCounts.ts`) makes one call with no
      `chain_id`, polls every 30 s, and does not retry a 4xx;
    - `useNavBadgeCounts` (`components/useNavBadgeCounts.ts`) maps the response:
      - Origination and Loans read the combined `count` (all chains);
      - Cash Management reads the `chains[]` entry for `useSessionState().chainId`, with no
        Stellar fallback;
    - a served positive integer renders verbatim and a served `0` hides the badge;
    - there is no badge while loading, on error (including a failed refetch with stale data),
      when a field is absent, or when the session chain has no entry;
    - the Overview, LP Counterparties, Risk Council and Audit Log items never have a badge.
  - In "Nav sections (`lib/nav.ts`)", replace the "`badgeCount` is unpopulated until #1350 …"
    sentence. The new sentence says that badge counts are runtime data supplied by
    `useNavBadgeCounts` (#1350, see Trustee sidebar), not a `TrusteeNavItem` field.
- `docs/exec-plans/tech-debt-tracker.md`: retitle TD-36 to
  `### TD-36: Trustee sidebar nav badges have no backend count source [RESOLVED <merge date> / #1350]`
  and add a one-line **Resolved** bullet: badges are wired to `GET /v1/attention-counts` via
  `useNavBadgeCounts`.
- `docs/product-specs/trustee-attention-counts.md` Overview: change "(wiring is #1350, TD-36)" to
  "(wired in #1350)".
- `docs/user-stories/epic-775/786-trustee-app-shell.md` Story 1: replace "no numeric count badges
  are shown (see … TD-36 …)" with this expectation: Origination, Loans and Cash Management show
  the served attention counts (see `1350-trustee-sidebar-badges.md`), and the other items show
  no badge.
- `docs/user-stories/epic-775/1350-trustee-sidebar-badges.md` (new). Its stories:
  1. Signed in on Stellar testnet, the three badges match `/v1/attention-counts`. Origination and
     Loans match the combined counts and Cash Management matches the `99000001` entry.
  2. Signed in on Hoodi, Origination and Loans are unchanged and Cash Management matches the
     `560048` entry.
  3. A zero count shows no badge.
  4. When the request fails (for example, blocked in DevTools), no badges show and the nav still
     works.
  5. Badges refresh within about 30 s after an action changes a count, for example approving a
     submission.
- `docs/product-specs/trustee-dashboard.md`: no change. Its line 182 already points at the
  attention-counts spec, and the file is at its line cap.
- `docs/frontend/hooks.md`: no change. Both hooks have a single consumer, so they are
  component-local under rule 5.
