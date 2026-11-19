# Issue #2058: Home: merged Recent activity feed — interleave bank wire-ins / wire-outs from GET /v1/requests with the on-chain rows

Source: https://github.com/eq-lab/pipeline/issues/2058

Parent epic: #1419 (LP home screen states). Split out of #1282.

## Scope

In scope (LP app, `packages/frontend`):

- Type the two optional lists `GET /v1/requests` already serves (#1314, `packages/api/src/routes/analytics.rs`
  `LpWireInItem` / `LpWireOutItem`) on `RequestsResponse` in `src/api/useRequests.ts`. They are not typed
  anywhere in the LP app today (`grep wire_ins packages/frontend/src` is empty).
- One pure merge of `requests[]`, `wire_ins[]` and `wire_outs[]` into a single newest-first feed, used by both
  the home `RecentActivityCard` (top 5, `View All` unchanged) and `/transactions`, so the two surfaces agree.
- Bank rows rendered through the same `ActivityRow` + `TwoLineAmount` pattern as the on-chain rows:
  - wire-in: title `Add funds`, secondary line `Bank transfer · {status}`;
  - wire-out: title `Withdraw funds`, secondary line `Bank transfer · {status}`;
  - `{status}` is the served string verbatim, `—` when missing; amount `—` when missing; time `—` when missing.
- `/transactions` tabs: bank wire-ins show under All and Buy, wire-outs under All and Sell (same placement
  #1811 chose for wire-outs on the epic branch).
- Docs + user-stories doc (see Docs to Update).

Out of scope:

- The LP wire-out *request* UI (#1757, merged into `epic/1795-lp-ui`, not on `main`).
- Any backend change. EVM minter scope (TD-169): EVM views get neither list, so they stay on-chain only.
- Cross-chain merge: render exactly what the active view's `chain_id` query returns.
- `pocket_claims[]` (served on the same response, not part of this issue).
- New visual elements: none. No status chip component exists; the served status rides on the existing
  `TwoLineAmount` secondary line, which is where on-chain rows already show `Pending` / `Verification failed`.

## Assumptions and Risks

- **Served shapes (verified in `analytics.rs`).**
  `wire_ins?: { chain_id: number; id: number; status: string; amount: string; value_date: string; ref_hash: string; recorded_at: string; assigned_at?: string }[]`
  `wire_outs?: { chain_id: number; id: number; status: string; amount: string; requested_at: string; settled_at?: string; value_date?: string; ref_hash?: string; cancelled_at?: string }[]`
  Both keys are omitted when no in-scope chain has a minter (all EVM today) or the lookup fails
  (`degrade_minter_list`). `pocket_claims` is also served but untyped; leave it untyped.
- **Status vocabulary (verified in `packages/api/src/minter_cash_book.rs`).** Wire-in: `Direct` | `Assigned`
  only reach an LP (`Escrowed`/`Returned` never have the LP as receiver). Wire-out: `Pending` | `Settled` |
  `Cancelled` — the same strings #1811's `WireOutStatus` uses, so no wire-out vocabulary conflict. Type the
  `status` fields as `string` (served verbatim), not as a closed union.
- **Amounts are already human decimal strings** (`to_base6_string`, e.g. `"986.301369"`), unlike `requests[].amount`
  which is a raw integer. `formatTokenAmount` calls `BigInt(raw)` and would throw on them, so a small
  formatter for a decimal string is needed (same `en-US`, 2-fraction-digit formatter the other rows use; no
  rescaling). Per the "display backend values verbatim" rule this is formatting only.
- **Served order.** Backend sorts wire-ins newest first by `assigned_at ?? recorded_at`
  (`docs/product-specs/minter-cash-book.md` line 86) and wire-outs by `requested_at`. The issue text says merge
  wire-ins by `recorded_at`; that key is not monotonic in served order for assigned wires. Plan default:
  merge on the served sort key (`assigned_at ?? recorded_at`), which keeps each list's served order and is the
  moment the sPLUSD reached the wallet — see Open Questions.
- **Chain scope.** `useRequests` already keys on `useActiveRequestsScope()` (active wallet view →
  `ENV.STELLAR_CHAIN_ID` / `ENV.EVM_CHAIN_ID`) and both surfaces call it, so the home card and `/transactions`
  are both per-network on the active view's chain and agree by construction. This is the LP rule, not the
  Trustee cross-network rule. Do NOT depend on `useActiveChainConnection` (#1333, PR #2032, not on `main`).
- **Overlap with #1757 / PR #1811 (major).** `epic/1795-lp-ui` (3 commits ahead of `origin/main`, draft PR #1804
  awaiting design approval) already edits `RecentActivityCard.tsx` and `routes/transactions.tsx` and adds
  `components/activity/useActivityFeed.ts` (`mergeActivityFeed`, `ActivityFeedItem`) and
  `components/activity/renderWireOutRow.tsx`. Its wire-out source is `GET /v1/audit-log` + per-id contract
  reads, and its spec says "a wallet-scoped endpoint is the recommended backend follow-up" — which is the
  served `wire_outs[]` this issue consumes. Building on `main` guarantees a merge conflict when #1804 lands.
  Mitigation in this plan: reuse #1811's names (`useActivityFeed`, `mergeActivityFeed`, `ActivityFeedItem`,
  `renderWireOutRow`) and its row copy/icon mapping, so reconciliation is "swap the audit-log source for served
  `wire_outs`". Base branch choice is an Open Question.
- **Figma.** Frame `6701:97136` could not be read: the Figma MCP server failed to connect and the local Dev Mode
  MCP at `127.0.0.1:3845` did not answer. Bank rows therefore follow the existing on-chain row pattern
  (same `ActivityRow`, same `TwoLineAmount`) and #1811's wire-out row; no new visual element is introduced.
  Visual verification against the frame is a step in Test Strategy once it is readable.
- **Staging data.** Acceptance needs a staging Stellar wallet with at least one `WireIn` and one
  `WireOutRequested`. None is confirmed to exist on testnet (escrowed wires none; minter `CD2LPGLX…`).
  If absent, verify with unit/route tests and note the staging gap in the PR.
- **Mock keys.** No new `pipeline.mock.api` behaviour; verification is on real API data (Network tab).

## Open Questions

1. **Base branch vs #1811 overlap.** PR #1811 (on `epic/1795-lp-ui`, not on `main`) already merges wire-outs into
   the same home card and `/transactions` via audit-log + contract reads. Build #2058 on `main` (current branch,
   reusing #1811's names so the epic rebase swaps the source to served `wire_outs[]`), or base it on
   `epic/1795-lp-ui` and replace #1811's audit-log path there? Plan default: `main`, and file a follow-up on
   epic #1795 to drop `useWireOutRequests`' audit-log listing in favour of served `wire_outs[]` when #1804 rebases.
2. **Wire-in merge timestamp.** Issue says `recorded_at`; the spec and served order use `assigned_at ?? recorded_at`.
   Plan default: `assigned_at ?? recorded_at` (shown as the row time too). Confirm.
3. **Wire-in amount unit.** The served wire-in `amount` is the USD wired = PLUSD minted 1:1, but the LP receives
   sPLUSD (shares not served). #1811's wire-out row shows `−{amount} PLUSD`. Which suffix for the wire-in row:
   `+{amount} USD` (plan default, it is the bank amount and avoids claiming a PLUSD balance the LP never held),
   `+{amount} PLUSD`, or whatever frame `6701:97136` shows once readable? Also confirm wire-out `−{amount} PLUSD`.

## Implementation Steps

- [x] 1. **Types** — `packages/frontend/src/api/useRequests.ts`:
   - Add `export interface WireInItem { chain_id: number; id: number; status: string; amount: string; value_date: string; ref_hash: string; recorded_at: string; assigned_at?: string }`.
   - Add `export interface WireOutItem { chain_id: number; id: number; status: string; amount: string; requested_at: string; settled_at?: string; value_date?: string; ref_hash?: string; cancelled_at?: string }`.
   - Extend `RequestsResponse` with `wire_ins?: WireInItem[]; wire_outs?: WireOutItem[]`.
   - Export both types from `src/api/index.ts` next to `RequestItem`.
   - No change to the query, key or expectation polling (`activityRefresh.ts` reads only `requests`).
- [x] 2. **Formatter** — `packages/frontend/src/lib/format.ts`: add `formatDecimalAmount(value: string | undefined): string`
   → `"—"` when `undefined` or `Number(value)` is not finite, else the existing module `tokenFormatter.format(Number(value))`.
   Shrink `scripts/lint-comments.baseline.json` for `format.ts` if the touched lines are listed; no new comments.
- [x] 3. **Merge** — new `packages/frontend/src/components/activity/useActivityFeed.ts` (one spec-pointer header to
   `docs/frontend/dashboard-components.md#activity-feed`):
   - `export type ActivityFeedItem = { kind: "request"; item: RequestItem } | { kind: "wireIn"; item: WireInItem } | { kind: "wireOut"; item: WireOutItem }`.
   - `export function activityTime(entry): string | undefined` → `created_at` / `assigned_at ?? recorded_at` / `requested_at`.
   - `export function mergeActivityFeed(data: RequestsResponse | undefined): ActivityFeedItem[]` — 3-way merge of the
     served lists newest first, each list's served order preserved, unparseable time sorts as 0, ties resolved
     requests → wire-ins → wire-outs. Missing keys behave as empty arrays. No filtering, no derived fields.
   - `export function useActivityFeed({ limit }: { limit?: number } = {})` → `{ items, requests }` where
     `requests = useRequests()` and `items = mergeActivityFeed(requests.data)` sliced to `limit` after the merge.
- [x] 4. **Rows** — new `packages/frontend/src/components/activity/renderBankTransferRow.tsx` (one header pointing to
   `dashboard-components.md#renderbanktransferrow`), exporting `renderWireInRow(item, testId?, className?)` and
   `renderWireOutRow(item, testId?, className?)`:
   - Both: `ActivityRow` with `timestamp = formatActivityTime(activityTime)` (`—` when missing), amount
     `<TwoLineAmount primary={…} secondary={`Bank transfer · ${item.status || "—"}`} tone=… />` imported from
     `./renderRequestRow`.
   - Wire-in: title `Add funds`; primary `+{formatDecimalAmount(amount)} USD` (unit per Open Question 3);
     `Direct` / `Assigned` → `check-circle` / `success`, tone `default`; any other served string → `clock-pending` / `neutral`, muted.
   - Wire-out: title `Withdraw funds`; primary `−{formatDecimalAmount(amount)} PLUSD`; mapping copied from #1811:
     `Settled` → `check-circle` / `success` (default tone); `Cancelled` → `arrow-down-circle` / `neutral` (muted);
     anything else (incl. `Pending`) → `clock-pending` / `warning` (muted).
   - Add `export function renderActivityRow(entry: ActivityFeedItem, chainKind, testId, className, evmStakeDecimals)`
     in the same file dispatching to `renderRequestRow` / `renderWireInRow` / `renderWireOutRow`, so both call sites
     use one switch.
- [x] 5. **Home card** — `packages/frontend/src/components/RecentActivityCard.tsx`: replace `useRequests()` with
   `const { items, requests } = useActivityFeed({ limit: MAX_ROWS })`; `isLoading` / `error` from `requests`;
   `showList` uses `items.length`; map `items` through `renderActivityRow` keeping `home-activity-row-${i}` /
   `home-activity-row-inner-${i}` test ids and `"pb-4"`. Empty state, `View All`, layout untouched.
- [x] 6. **Activity page** — `packages/frontend/src/routes/transactions.tsx`: use `useActivityFeed()` (no limit); keep
   `data`, `isLoading`, `error`, `refetch` from `requests`; filter: `all` → everything; `buy` → `Deposit` requests +
   `wireIn`; `sell` → `Withdraw` requests + `wireOut`; `stake` / `unstake` → request types only. Rows via
   `renderActivityRow` with `transactions-row-${i}`. Loading/error/empty logic unchanged.
- [x] 7. **Lint/build** — `yarn workspace` lint + typecheck + `yarn build` for `packages/frontend`,
   `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts`.

## Test Strategy

- `src/components/activity/useActivityFeed.test.ts` (new): `mergeActivityFeed`
  - omitted `wire_ins` / `wire_outs` → exactly `requests` in served order;
  - interleaving by time across all three lists, newest first;
  - assigned wire-in sorts by `assigned_at`, direct by `recorded_at`;
  - ties: request before wire-in before wire-out; served order preserved within each list;
  - unparseable timestamp sorts last; `undefined` data → `[]`.
- `src/components/activity/renderBankTransferRow.test.tsx` (new): titles `Add funds` / `Withdraw funds`; secondary
  `Bank transfer · Direct`, `· Assigned`, `· Pending`, `· Settled`, `· Cancelled` verbatim; an unknown served
  status string rendered verbatim; empty status → `Bank transfer · —`; amount `"1234.5"` → `1,234.50`; missing /
  non-numeric amount → `—`; time shape regex, missing time → `—`; icon/tone per status.
- `src/lib/format.test.ts`: `formatDecimalAmount` cases (`"986.301369"` → `986.30`, `"0.000000"` → `0.00`,
  `undefined` / `"abc"` → `—`).
- `src/components/RecentActivityCard.test.tsx`: response with no wire keys renders as today (existing tests stay
  green); response with wire rows interleaves and caps at 5; wire-only response (empty `requests`) shows the list
  and `View All`, not the empty state.
- `src/routes/-transactions.test.tsx`: All shows interleaved rows; Buy shows Deposit + wire-in; Sell shows
  Withdraw + wire-out; Stake/Unstake exclude bank rows; wire-only wallet is not empty.
- `src/api/useRequests.test.tsx`: served `wire_ins` / `wire_outs` pass through `data` untouched.
- Manual (real API, Network tab — no mocks): staging Stellar wallet with a wire-in and a wire-out → both rows on
  home and `/transactions` in timestamp order with served status; EVM view → no bank rows, card unchanged;
  wallet with no bank movements → unchanged. Ask the user to report what they see rather than driving their browser.
- Figma verification: once frame `6701:97136` (Recent activity, 478×634) is readable, compare the bank rows'
  title/secondary/amount copy and icon against it; any difference becomes a follow-up issue via `ux-reviewer`.

## Docs to Update

- `docs/frontend/dashboard-components.md`
  - `### RecentActivityCard`: rows come from the merged feed (`useActivityFeed`), bank wire-ins/wire-outs from
    `GET /v1/requests` interleave by time; omitted lists = on-chain rows only; also fix the stale "top 3" to 5.
  - `## Activity`: new `### Activity feed` (merge rule, timestamp per row kind, tie order, chain scope = the active
    view's `chain_id`, no cross-chain merge) and `### renderBankTransferRow` (copy, verbatim status, `—` rules,
    icon/tone table, amount is a served decimal string formatted to 2 dp).
  - `### Transactions route`: tab membership of bank rows.
- `packages/frontend/src/api/README.md` `### useRequests()`: document `data.wire_ins` / `data.wire_outs` (optional,
  Stellar minter chains only).
- `docs/user-stories/epic-1419/2058-merged-activity-feed.md` (new) + `docs/user-stories/index.md` entry: stories for
  interleaved rows on home, the same rows on `/transactions` with tab filtering, EVM/no-bank wallet unchanged,
  served status verbatim. Note that the Figma frame was not readable at planning time.
- `docs/exec-plans/tech-debt-tracker.md`: entry that `epic/1795-lp-ui`'s `useWireOutRequests` (audit-log listing)
  duplicates served `wire_outs[]` and must be reconciled when #1804 rebases on `main`.
- No `docs/frontend/activity*.md` exists; nothing to update there.
