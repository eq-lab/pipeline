# Issue #1234: Update X and Y axes on LP dashboard charts per new Figma

Source: https://github.com/eq-lab/pipeline/issues/1234

Branch: `feat/1234-lp-chart-axes` (draft PR #1235). Labels: `enhancement`, `frontend`, `planning`.

## Scope

Apply the new X/Y axis design to the three LP charts, and repair the response parsing that the
already-merged backend change broke.

| Chart | Component(s) | Figma node | Endpoint |
| --- | --- | --- | --- |
| TVL card | `packages/frontend/src/components/dashboard/TvlCard.tsx` | `3283:67622` | `GET /v1/dashboard/tvl-history` |
| Cumulative Yield card | `packages/frontend/src/components/dashboard/YieldHistoryPanel.tsx` + `YieldBarChart.tsx` | `3283:68333` | `GET /v1/dashboard/yield-history` |
| Total Balance card | `packages/frontend/src/components/PortfolioPlaceholderCard.tsx` (+ `ChartDatesRow.tsx`) | `1497:95197` | `GET /v1/positions/history` |

Two things change:

1. **Parsing repair (blocking, do first).** Commit `f0f6f54` ("Add average/max/min values to
   chart-related endpoints", already on `origin/main`) changed the two dashboard endpoints in a
   **breaking** way and the frontend has not been updated. See "Verified served shapes" below.
2. **Axis work.** Per the Figma extraction below, on all three charts:
   - **Y axis — net new.** A 32px left column with three labels (top / half / `$0`), scaled from
     the newly served `max` instead of the frontend-computed series maximum. No Y axis exists in
     the code or the current spec today.
   - **X axis — two labels become five.** `ChartDatesRow` grows from the endpoint-only pair that
     #1133 shipped to five evenly spaced `MMM d` labels, changing its contract for all three
     callers at once.
   - **No gridlines, no axis spines, and no average/min/max reference line** — confirmed absent
     from all three Figma nodes by full subtree enumeration. Do not add them.

Out of scope: backend changes of any kind (all three endpoints are already updated); the trustee
app's charts; adding a time-range selector to the dashboard cards (Figma's "Top" frame still shows
none); bar/series rendering itself, beyond the height re-normalisation the new Y domain forces; and
the missing global error boundary (log as tech debt, do not build it here).

## Verified served shapes

Confirmed live against `https://api.pipeline.stage.eqlab.net` (the `.env` `VITE_API_BASE_URL`) on
2026-09-10 — not inferred from the Rust source:

`GET /v1/dashboard/tvl-history` — **breaking**, was a bare `TvlPoint[]`:

```json
{ "series": [{ "timestamp": "2026-08-05T15:29:36Z", "tvl": "1000000.000000" }],
  "max": "19002000.000000", "min": "1000.000000", "average": "18450060.931931" }
```

`GET /v1/dashboard/yield-history` — **breaking**, was a bare `YieldPoint[]`:

```json
{ "series": [{ "timestamp": "2026-08-12T08:42:38Z", "cumulative_yield": "15550.635325" }],
  "max": "43193.947876", "min": "15550.635325", "average": "38527.068576" }
```

`GET /v1/positions/history` — **additive / non-breaking**; `history` is unchanged and two sibling
`SeriesStat` objects were added:

```json
{ "wallet": "G…", "interval": "daily", "history": [],
  "shares_balance": { "max": "0", "min": "0", "average": "0" },
  "cumulative_realized_pnl": { "max": "0", "min": "0", "average": "0" } }
```

Units: the two dashboard stats are 6-decimal USDC strings already in human units (same as their
series values). The `positions/history` stats are **raw share strings on the same scale as
`history[].shares_balance`**, so they need the identical `/ 10 ** decimals` treatment `buildSeries`
already applies — not a new normalisation.

### Why the parsing repair is blocking

`useYieldHistoryPanel.ts:146-159` does:

```ts
const cumulativeBars = pointsToBars((yieldHistoryQuery.data ?? []).map((p) => …));
const tvlBars = pointsToBars((tvlHistoryQuery.data ?? []).map((p) => …));
```

`data` is now a non-null **object**, so `?? []` does not fire and `.map` is `undefined` → a
`TypeError` thrown during render. There is **no error boundary anywhere in
`packages/frontend/src`** (grep for `ErrorBoundary` / `componentDidCatch` / `errorComponent`
returns nothing), and `/dashboard` (`packages/frontend/src/routes/dashboard.tsx:45`) renders
`YieldHistoryPanel` directly. The LP Dashboard route is therefore **crashing on `main` right now**.
Land step 1 even if the axis design is still being settled.

## Assumptions and Risks

- The backend is done and merged (`f0f6f54` is in `origin/main`); the branch is one commit ahead
  (`abcac54 chore: start work on #1234`). No backend PR to wait on.
- **Backend `min`/`max` fall outside the sampled series' own extremes.** On staging TVL, `max` is
  `19002000` while the largest sampled point is `19001859.37`, and `min` is `1000` while the
  smallest sampled point is `1000000`. This is deliberate: `window_stats` integrates the exact
  event stream, while `series` is a coarser `interval` sampling. It matters less than it would have
  under a gridline design (Figma has no gridlines, so nothing visually contradicts a label), but it
  does mean the top tick is derived from a value that no plotted bar reaches. That is correct and
  expected; do not "fix" it by reverting to frontend-computed extremes.
- `average` is **time-weighted**, not the mean of the samples, so for a monotonically rising
  cumulative series it sits far above the midpoint (staging TVL: `average` 18.45M against a
  1000→19.002M range). If Open Question 1 turns up a newer design with an average line, expect it
  to render near the top of the plot — that would be arithmetically right, not a bug.
- Because the Y baseline is `$0` and not the served `min`, the `min` field goes unused. Do not wire
  it in "for completeness"; an unused served field is better than an invented axis affordance.
- `pointsToBars` normalises against a frontend-computed `Math.max(...)` and floors every bar at
  `MIN_HEIGHT_PCT = 2`. Re-basing it on the rounded domain changes existing behaviour, and
  `packages/frontend/src/utils/yieldSeries.test.ts:65` ("the last bar has height = 100 when
  accrued is monotone and max is last") will legitimately need updating — the tallest bar now
  reaches `max / ceilTo1SigFig(max)` (≈77% in the Figma TVL sample), never exactly 100.
- `pointsToBars` is a **catalogued** util (`docs/frontend/utils.md:32`); a signature change must
  update that row in the same commit (FRONTEND.md rule 4). `accrualToBars` shares the same shape
  and backs `/v1/stats/yield` — do not change it in lockstep unless that endpoint also grew stats.
- `YieldBarChart`'s `bars` prop is already a **pre-normalised 0–100 `height`**, so the Y scale is
  decided upstream in `useYieldHistoryPanel`, not in the chart. Since Figma draws no gridlines, the
  axis has no reason to live inside the SVG — keep it a sibling DOM element (as `ChartDatesRow`
  already is) so `YieldBarChart` stays dumb and its prop contract is unchanged.
- `PortfolioPlaceholderCard.tsx:226` recomputes `Math.max(...series.values)` **inside** the
  per-point `.map`, i.e. O(n²) and re-derived per bar. Hoist it while touching this code.
- The 32px Y column eats plot **width**, and the 8px gap + 16px X row eat **height**. Figma's TVL
  block is 24px taller than what the code renders today (264 vs 240), against fixed
  `h-[404px] md:h-[460px]` card heights — the mobile 404px case is the tight one and Figma only
  provides the 460px desktop frame. Re-check both breakpoints rather than trusting the numbers.
- Risk: `ChartDatesRow` is shared by all three cards, so widening it from two labels to five is a
  breaking contract change for every caller in one commit. Its four existing tests
  (`TvlCard.test.tsx:26-52`) and the Portfolio endpoint-label tests
  (`PortfolioPlaceholderCard.test.tsx:173-195`) all assert the two-label behaviour and will need
  rewriting, not just extending.
- Risk: the existing docs contain a contradiction the edit will have to resolve —
  `docs/frontend/dashboard-components.md:1037-1038` says the TVL chart container is 224px while
  `:1044-1046` says "fixed 240px tall". Also `:263-265` and `:1283` still claim the Portfolio
  chart is a "constant-zero placeholder / no client-side derivation", already superseded by the
  served-series mode at `:213-220`.
- `#1003` (jsdom `localStorage` TypeError) is **closed** (fixed by `595afcc`), so
  `packages/frontend/src/routes/-dashboard.test.tsx` runs again — unlike during #1133, assertions
  can go in the natural file. Do not carry over the "#1003-broken" workaround.
- Per project convention, do **not** drive the user's browser to verify; the user runs their own
  dev server with HMR. Verify shapes with `curl` (as above) and ask the user to hard-refresh and
  report the Network tab.

## Resolutions (2026-09-10, from the user)

All six questions below are settled; implement accordingly. Where a resolution contradicts an
Implementation Step, the resolution wins:

1. **The Y axis is `0 / average / max` — the served values, not a derived scale.** The design
   intent (confirmed by the user) is that the middle tick is the backend's `average` and the top
   is the backend's `max`; the Figma mock just drew the average at the geometric middle with a
   pretty half-value. This is why `f0f6f54` added the stats. `min` stays unused (the baseline is a
   literal `$0`).
2. **Top tick = raw served `max`, no rounding.** Format compactly with zero decimals (`$23M`) in
   the mock's label style. The tallest bar reaches the top of the plot (normalise against the raw
   `max`, not a rounded domain) — `ceilTo1SigFig` is NOT needed; drop it from step 3 and drop the
   re-normalisation in step 4 (keep `pointsToBars`' optional explicit domain-max parameter, passing
   the served `max`, so sampled series normalise against the window stat rather than the sampled
   extremes).
3. **Average tick is positioned proportionally** (`average / max` of the plot height), value-true —
   not pinned to the middle. `ChartValueAxis` therefore takes `{ maxLabel, avgLabel, avgFraction }`
   (or similar) and absolutely positions the middle label; `justify-between` alone no longer works.
4. **No frontend-derivation carve-out needed** — no rounding happens; compact formatting of served
   values is presentation, same as `formatCompactUsd` today.
5. **Portfolio Y axis**: 1:1 USD over the shares series, consistent with the shipped headline.
6. **X ticks**: five labels sampled from real served `series[].timestamp` values — never
   synthesised instants.

Also verified this session (curl against the live Figma file): the fourth Y-column label in the
Figma nodes (`6267:9421` / `6268:9431`) is a hidden stray **"Aug 3" date label**, not a value —
ignore it.

## Open Questions

The Figma extraction settled what were the four biggest unknowns, and those answers are recorded in
"Figma axis specification" rather than left open: the Y baseline is **`$0`** on all three charts
(not the served `min`); **all three** charts get a Y axis; the X axis goes from today's two endpoint
labels to **five**; and there are **no gridlines, spines, or reference lines** anywhere. What
remains:

1. **The design does not use `min` or `average` at all — is that intended?** The backend added
   `max`, `min` *and* `average` to all three endpoints in `f0f6f54`, but these Figma nodes surface
   only a max-derived scale. Either (a) the fields were added for a newer axis design that lives at
   a node id not given in the Issue, or (b) `min`/`average` are for something other than these
   charts. This is the one question that could change the shape of the work, so it should be
   answered before step 4 — if there is a newer Figma frame with an average line, the plan's
   component design changes. **If the answer is (b), ship the max-only scale as specified.**
2. **Confirm the one-significant-figure rounding rule.** It is inferred from three data points (see
   the table above); TVL's `$30M` from $23.14M is what rules out the conventional 1-2-5 ladder, but
   three samples cannot fully pin a rounding rule (e.g. is $9.1M → $10M, and is an exact $30.0M max
   left at $30M or pushed to $40M?). Cheap to get wrong and visible on every chart.
3. **Does the top tick derive from the series `max` or from the headline/summary value?** For TVL
   these differ: the axis would come from `tvl-history.max` while the headline comes from
   `summary.tvl`, and `dashboard-components.md:1216-1217` already establishes the deliberate
   precedent that the headline is *not* read off the chart. In the Figma sample both round to
   `$30M`, so the render cannot discriminate. Using the series `max` keeps the axis honest about
   the plotted data; confirm that is wanted.
4. **Is rounding the served `max` up to a tick value an acceptable frontend derivation?** It is
   presentation, not a metric, and the alternative (labelling the raw `19002000.000000`) is not
   what Figma shows. But the "no frontend-computed metrics" rule currently has exactly one
   documented carve-out (the `deployedRatio` exception at `dashboard-components.md:1039-1043`), so
   this likely needs the same explicit language — a call for the reviewer, not the coder.
5. **Portfolio Y axis unit.** Figma labels it in USD (`$1K` / `$500` / `$0`) while the plotted
   series is `shares_balance`. Today the card already displays shares as dollars 1:1
   (`formatBigintCurrency(splusdSharesActive, activeDecimals)` for the headline), so a USD-formatted
   axis over a shares series is consistent with shipped behaviour — but it is worth a one-line
   confirmation that 1:1 is intended here rather than a share-price conversion.
6. **Do the five X ticks have to be real served timestamps?** Even spacing across the window can be
   done either by sampling five actual `series[].timestamp` values or by computing five evenly
   spaced instants between the endpoints. The former never shows a date the backend did not serve
   (the standing convention, and how #1133 justified its endpoint labels); the latter gives the
   even 7-day steps Figma shows. Prefer the former unless told otherwise.

> These are design/behaviour decisions the planner cannot make alone. Per the frontend flow the
> manager should gate on them before implementation starts. Note that **step 1 (the parsing repair)
> is independent of every question here** and fixes a live crash — it can and should land first.

## Implementation Steps

1. **Repair the two dashboard hooks (do this first, independently reviewable).**
   - `packages/frontend/src/api/useDashboardTvlHistory.ts`: keep `TvlPoint`, add
     `TvlHistoryResponse { series: TvlPoint[]; max: string; min: string; average: string }`, change
     the `useQuery` generic and `apiFetch` type argument to it, and widen
     `UseDashboardTvlHistoryResult.data` to `TvlHistoryResponse | undefined`. Update the
     "No events → `200 []`" line in the file header — the empty response is now
     `{ series: [], max: "0.000000", min: "0.000000", average: "0.000000" }`.
   - `packages/frontend/src/api/useDashboardYieldHistory.ts`: the same, with
     `YieldHistoryResponse` / `cumulative_yield`.
   - `packages/frontend/src/components/dashboard/useYieldHistoryPanel.ts:146-159`: read
     `…data?.series ?? []` instead of `…data ?? []`, and thread the new `max`/`min`/`average`
     through to whatever the axis needs (step 3).
   - Re-check the `empty` branch at `:212-230`: `summaryAllNull` plus both bar arrays being `null`
     still decides `state: "empty"`, and an all-zero stats block must not flip it to `ready`.
2. **Type the additive `positions/history` fields.** In
   `packages/frontend/src/api/usePositionsHistory.ts`, add
   `export interface SeriesStat { max: string; min: string; average: string }` and the
   `shares_balance: SeriesStat` / `cumulative_realized_pnl: SeriesStat` members on
   `PositionHistoryResponse`. No parsing change is required — only the Y axis consumes them.
3. **Add the axis-domain + tick-label utils** (new module, e.g.
   `packages/frontend/src/utils/chartAxis.ts`; FRONTEND.md rule 3 requires a unit test in the same
   commit, rule 4 a row in `docs/frontend/utils.md`):
   - `ceilTo1SigFig(value: number): number` — the domain rule derived above (23.14e6 → 30e6,
     43.2e3 → 50e3, 942.8 → 1000). Handle 0, negatives, and exact powers of ten explicitly.
   - `axisTicks(max: string): { top: number; mid: number; bottom: number }` or an ordered
     `string[]` of three formatted labels — top, half, `0`.
   - `formatAxisTickUsd(value: number): string` — compact, **zero decimals**, `$` prefix: `$30M`,
     `$15M`, `$50K`, `$500`, and bare `$0`. This is deliberately *not* `formatCompactUsd`, which
     emits one decimal (`"$30.0M"`); do not "reuse" it and lose the Figma formatting.
4. **Re-base bar heights on the axis domain.** Extend `pointsToBars` in
   `packages/frontend/src/utils/yieldSeries.ts` with an optional explicit domain max, e.g.
   `pointsToBars(points, domainMax?: number)`, falling back to today's frontend-computed max when
   omitted so `accrualToBars`' callers and `/v1/stats/yield` stay untouched. Normalise `height`
   against the rounded domain, so the tallest bar reaches `max / ceilTo1SigFig(max)` rather than
   100%. Keep the `MIN_HEIGHT_PCT = 2` floor. Update `docs/frontend/utils.md:32` in the same commit.
5. **Build the Y-axis component.** No Y-axis/tick component exists in `packages/ui/src` or
   `packages/frontend/src` today, so this is net-new — but it is small: **three text labels, no
   gridlines, no spine.** Add it in its own file (FRONTEND.md rule 1), e.g.
   `packages/frontend/src/components/ChartValueAxis.tsx`, taking three already-formatted label
   strings and staying dumb exactly as `ChartDatesRow` does, with a one-line `// spec:` pointer
   header and no narrative comments. Structure per Figma: `w-[32px] flex flex-col items-start
   justify-between h-full pt-0 pb-[20px]`, labels in the caption tokens +
   `--color-pipeline-ink-muted`. Render it as a **sibling** of the chart SVG (an outer flex row with
   **no gap**), never inside `YieldBarChart` — the chart's `bars` prop stays a pre-normalised 0–100
   `height` and the chart stays dumb.
6. **Widen `ChartDatesRow` from two labels to five.** Figma shows 5 `MMM d` labels, so its
   `{ start, end }` contract changes for all three callers at once — take an ordered `string[]`
   (assert 5) and render each `w-[44px] overflow-hidden text-ellipsis`, first left, middle three
   `text-center`, last `text-right`, in the existing 16px row. Derive the five labels from **served
   timestamps** (sample `series[].timestamp` at five evenly spaced indices, the same way `pickPoint`
   already resamples) rather than synthesising instants — see Open Question 6. Preserve the current
   "absent when the series is null/empty — never invented dates" caller gating and the cross-year
   `'YY` suffix from `formatAxisDateRange`; with five labels the year-collision case it was added
   for needs re-checking.
7. **Wire the three cards** (each stays a pure view; the domain + formatted labels are computed in
   the hook / route and passed as props):
   - `TvlCard.tsx` — from `tvl-history.max`. Figma's plot is **240px** with an 8px gap and the 16px
     X row (264 total), where the code today has a 224px container + 16px row (240 total). This
     resolves the doc's 224-vs-240 contradiction in favour of a 240px plot, but the region grows by
     24px — re-check the fixed `h-[404px] md:h-[460px]` card, especially mobile (Figma's frame is
     the 460 desktop one).
   - `YieldHistoryPanel.tsx` — from `yield-history.max`, on the Cumulative Yield card
     (`h-[128px]` mobile / `md:h-auto md:flex-1`). Figma node `3283:68333` is a 560×300 frame with a
     172px plot, which does not correspond to either the 248px mobile card or the desktop
     `md:h-[460px]` row — reconcile against the real responsive layout instead of hard-coding 172px.
   - `PortfolioPlaceholderCard.tsx` — from `shares_balance.max`, scaled by `activeDecimals` exactly
     as `buildSeries` does. The home route (`packages/frontend/src/routes/index.tsx:131`) already
     owns the fetch, so pass the scaled domain in as a prop. Its 120px plot already matches the
     component's `VB_H = 120`. Hoist the `Math.max(...series.values)` out of the `.map` at `:226`
     and feed it the same domain. Keep the zero-placeholder branch rendering no fabricated axis.
8. **Missing-data behaviour.** A tick whose backing value is null/absent/non-numeric renders `"—"`,
   never `0` and never a computed substitute. When the stats block is missing entirely, render the
   chart without a Y axis rather than a column of dashes. `max === min === 0` (the documented
   empty-chain response) must not divide by zero — render the empty seam that
   `dashboard-components.md:1170-1174` already specifies.
9. **Docs.** Update `docs/frontend/dashboard-components.md` per "Docs to Update" below.
10. **Catalogue the pre-existing gap.** `formatAxisDate` / `formatAxisDateRange`
    (`packages/frontend/src/utils/formatDate.ts`) are used by all three charts but are missing from
    `docs/frontend/utils.md` (FRONTEND.md rule 4). Add their rows while editing that file.
11. **Gate.** `yarn workspace @pipeline/frontend lint`, `… test`, `… build`, plus
    `npx tsx scripts/lint-docs.ts`. Then log the absent global error boundary in
    `docs/exec-plans/tech-debt-tracker.md` (a breaking API shape change white-screened a whole
    route with no containment) — note it, do not fix it here.

## Figma axis specification

Extracted from the local Figma Dev Mode MCP server (`http://127.0.0.1:3845/mcp`) for the three
nodes named in the Issue. Values below are copied out of the responses — the session's asset URLs
have since expired, so re-extract only if something here looks wrong.

**The single most important finding: the design contains no gridlines, no axis spines, and no
average / max / min reference line, pill, or marker on any of the three charts.** Every node in all
three subtrees is either a tick `Label` or a data-bar `Line NNN`; every one of the 699 / 480 / 480
bar vectors is a ~1px vertical bottom-anchored stroke, with no horizontal vector anywhere. The Y
axis is **three text labels in a 32px column** and nothing more.

### Shared axis system (identical on all three charts)

Outer flex row: a fixed 32px Y-label column (**0px gap**, flush against the plot), then a `flex-1`
column holding the plot, an **8px** gap (`size-8`), and a **16px** X-label row.

Every tick label on every chart uses the same type and color, which map exactly onto tokens the
code already uses for `ChartDatesRow` — so **typography and color need no change**:

| Property | Figma | Existing token |
| --- | --- | --- |
| Family | `font/text-font-family` → Graphik LC | `--font-body` |
| Size / line-height | `font/font-size/caption` 12 / `font/line-height/caption` 16 | `--text-pipeline-caption` + `--text-pipeline-caption--line-height` |
| Weight | 400 Regular | `font-normal` |
| Color | `content-test/secondary` = `#38373599` | `--color-pipeline-ink-muted` = `rgb(56 55 53 / 0.6)` (`packages/ui/src/styles/theme.css:81`) — **exact match, verified** |

The Dev Mode CSS emits a stale literal fallback `rgba(50,56,55,0.6)` (`#323837`) that does *not*
match the variable. Ignore it; `--color-pipeline-ink-muted` is already correct.

- **Y column:** `w-[32px]`, `flex flex-col items-start justify-between h-full`, `pt-0`,
  `pb-[20px]` (`size-20`). **3 labels**, left-aligned, top→bottom.
- **X row:** `h-[16px]`, `flex items-center justify-between w-full`. **5 labels**, each `w-[44px]`
  with `overflow-hidden text-ellipsis`; first left-aligned, middle three `text-center`, last
  `text-right`. Format `MMM d` — no year, no leading zero ("Jul 20", "Aug 3").
- Consistent geometry: axis block height = plot height + 24px (8px gap + 16px row).

Each Y column also holds a **hidden 4th `Label` reading "Aug 3"** — a vestigial copy of an X label.
The design is 3 Y ticks; ignore it.

### Per-node values

| | Y ticks (top→bottom) | X ticks | Plot (w×h) | Axis block | Frame |
| --- | --- | --- | --- | --- | --- |
| TVL `3283:67622` (headline `$23.14M`) | `$30M`, `$15M`, `$0` | `Jul 20`, `Jul 27`, `Aug 3`, `Aug 10`, `Aug 17` | 496×**240** | 264 | 560×460 |
| Yield `3283:68333` (headline `$43.2K`) | `$50K`, `$25K`, `$0` | same five | 496×**172** | 196 | 560×300 |
| Portfolio `1497:95197` (headline `$942.80`) | `$1K`, `$500`, `$0` | stale, see below | 578×**120** | 144 | 642×274 |

Sub-node ids: TVL Y `6267:9418`, X `6002:9267`, chart frame `6267:9425`, plot `3283:67630`. Yield Y
`6268:9428`, X `6002:9279`, chart frame `6268:9434`, plot `3283:68337`. Portfolio Y `6268:26551`,
X `6002:27376`, plot `Chart Container` (instance children carry `I…;…` ids).

### The Y-axis domain rule (derived, needs confirmation — see Open Questions)

In all three nodes the **top tick is the max rounded up to one significant figure**, the middle
tick is exactly half of it, and the bottom tick is `$0`:

| Headline max | Top tick | 1-sig-fig ceil | 1-2-5 ceil |
| --- | --- | --- | --- |
| $23.14M | **$30M** | 30M ✓ | 25M ✗ |
| $43.2K | **$50K** | 50K ✓ | 50K ✓ |
| $942.80 | **$1K** | 1K ✓ | 1K ✓ |

TVL is the discriminating case and it rules out the conventional 1-2-5 ladder. So: **domain
`[0, ceilTo1SigFig(max)]`, ticks at the top, half, and 0.** This settles the baseline question —
it is `$0` on every chart, *not* the served `min`, which the design never shows.

Consequence for bar heights: the tallest bar must reach `max / ceilTo1SigFig(max)` of the plot
height (TVL: 23.14/30 ≈ 77%), **not** 100% as `pointsToBars` does today. The Figma renders confirm
the bars stop short of the top.

### Tick label formatting

Compact USD, `$` prefix, **no decimals** — `$30M`, `$15M`, `$50K`, `$25K`. Zero renders bare as
`$0`. Values under 1000 render plain, no suffix: `$500`. Note the Portfolio axis mixes forms on one
axis (`$1K` top, `$500` middle) — consistent with "compact above 1K, plain below".

This is **not** `formatCompactUsd`, which emits one decimal (`"$30.0M"`, `"$8.0M"`). A new
zero-decimal axis-tick formatter is required.

### Known file drift — do not treat as spec

- Portfolio's X labels are `Aug 13`, `Jul 27`, `Aug 3`, `Aug 10`, `Aug 20` — the first is **out of
  chronological order**, stale placeholder content visible in the render. The five-label,
  even-spacing structure is the spec; that sequence is not.
- Y label widths are inconsistent (`w-[44px]` on TVL's `$30M` and Portfolio's `$1K`, auto on the
  rest). Looks like drift; a uniform 32px column with auto-width labels matches the layout.
- TVL and Yield each carry two **hidden** half/quarter-height alternate `Chart` frames. Portfolio
  instead has all three overlaid and visible, producing its layered look. Only the axis matters
  here; do not chase the bar rendering.

## Test Strategy

All frontend suites run with `TZ=UTC vitest run`; `#1003` is fixed so every file below executes.

- **`packages/frontend/src/api/useDashboardTvlHistory.test.tsx` and
  `useDashboardYieldHistory.test.tsx`** — the existing fixtures (`FIXTURE_WITH_DATA`,
  `FIXTURE_EMPTY`) are bare arrays and must be re-shaped to the object form. Add a regression test
  that the hook surfaces `series`/`max`/`min`/`average`, and one asserting an **array-shaped**
  response (the old contract) does not throw — cheap insurance against the exact crash this issue
  fixes.
- **`packages/frontend/src/components/dashboard/useYieldHistoryPanel.test.tsx`** — the mock
  `localStorage` payloads at `:118-124` are arrays; convert them. Add the key regression: with an
  object-shaped response the hook reaches `state: "ready"` with non-null `tvlBars` /
  `cumulativeBars` (today it throws). Cover an empty `series` with a non-zero stats block, and
  a present `series` with a missing/partial stats block.
- **`packages/frontend/src/utils/yieldSeries.test.ts`** — new cases for the explicit domain: a
  served `max` above the series max yields a last-bar height `< 100`; a served `max` below the
  series max clamps rather than exceeding 100; omitting the domain preserves today's behaviour
  (guarding `accrualToBars` callers). Update the existing `:65` assertion, which encodes the old
  frontend-computed-max behaviour.
- **New `packages/frontend/src/utils/chartAxis.test.ts`** — the highest-value new tests, because
  the domain rule is the part most likely to be subtly wrong. Table-drive `ceilTo1SigFig` against
  the three Figma-confirmed cases (23.14e6 → 30e6, 43.2e3 → 50e3, 942.8 → 1000) plus 0, an exact
  power of ten, an exact `3e7` (already 1 sig fig — must not jump to 4e7), a sub-dollar value, and
  a negative. Then `formatAxisTickUsd`: `$30M`, `$15M`, `$50K`, `$25K`, `$500`, bare `$0`, and
  explicitly assert it does **not** emit `formatCompactUsd`'s one-decimal form.
- **`TvlCard.test.tsx`** — the three Y ticks render top/half/`$0` in order with the Figma
  formatting; a tick shows `"—"` for a missing stat; no Y axis at all when the stats block is
  absent. The four existing `ChartDatesRow` cases (`:26-52`) assert two labels and must be
  rewritten for five.
- **`PortfolioPlaceholderCard.test.tsx`** — Y ticks derive from `shares_balance.max` scaled by
  `decimals` (mirroring the `buildSeries` case at `:245`); placeholder mode renders no fabricated
  Y values. The endpoint-label cases at `:173-195` and the cross-year case at `:226` assert the
  two-label row and need rewriting for five; the served-series, period-tab and tooltip-format
  cases (`:196-320`) should keep passing untouched.
- **`packages/frontend/src/routes/-dashboard.test.tsx`** — one integration assertion that
  `/dashboard` renders `dashboard-panel-yield-history` without throwing against an object-shaped
  mock. This is the test that would have caught the current breakage.
- **New `ChartValueAxis`** — a small render test (three labels, order, testid, caption + ink-muted
  token classes, the `w-[32px]`/`pb-[20px]` structure); keep it proportionate, as #1133 did for
  `ChartDatesRow`.
- **`ChartDatesRow`** — five labels in order, correct alignment classes on first/middle/last, and
  the caller gating (absent for a null/empty series) preserved.
- Edge cases to cover explicitly: `max === "0"` on the documented empty-chain response (no
  divide-by-zero, empty seam not a degenerate axis); all-zero series with a non-zero stats block;
  a single-point series resampled to five X labels (expect repeats — assert no crash, do not
  special-case); and the real staging condition where the served `max` exceeds every sampled point.
- Token-exact visual verification against the three Figma nodes is the ux-tester pass, not a unit
  test.

## Docs to Update

`docs/frontend/dashboard-components.md` — behaviour is specified here, not in code comments
(FRONTEND.md rule 6). Keep every `###` heading's exact text and level: the anchors are referenced
by `// spec:` pointers in `TvlCard.tsx`, `YieldBarChart.tsx`, `YieldHistoryPanel.tsx`,
`useYieldHistoryPanel.ts`, `PortfolioPlaceholderCard.tsx` and `ChartDatesRow.tsx`, and nothing
lints them.

- `### ChartDatesRow` (`:194-205`) — restate the X axis as five `MMM d` labels. **`:202` currently
  reads "No intermediate ticks, no gridlines."** — the first half is now wrong (five ticks) and the
  second half is still right (Figma has no gridlines), so rewrite it precisely rather than deleting
  it. Consider whether the section/anchor name still fits a five-tick row; if it is renamed, every
  `// spec:` pointer to `#chartdatesrow` must move in the same commit.
- `### TvlCard` (`:1025-1051`) — new Y axis; and resolve the 224px (`:1037`) vs 240px (`:1044`)
  chart-height contradiction in favour of Figma's 240px plot + 8px gap + 16px X row.
- `### YieldBarChart` (`:1127-1145`) — record that `height` stays a pre-normalised 0–100 percentage,
  that the domain now comes from the served `max` upstream, and that the axis is a sibling element
  so this component's contract is unchanged.
- `### YieldHistoryPanel` (`:1147-1189`) and `### useYieldHistoryPanel` (`:1191-1227`) — the new
  response shapes, where the axis domain comes from, and the empty/partial-stats behaviour.
- `### PortfolioPlaceholderCard` (`:207-267`) — the Y axis and its share-decimals scaling; and fix
  the stale "constant-zero placeholder / no client-side derivation" **Data rule** at `:263-265`,
  already superseded by the served-series mode at `:213-220`.
- `### Home route` (`:1248-1293`) — `:1283` repeats the same stale constant-zero-placeholder claim.
- State plainly that the Y scale is derived from the backend-served `max`, that the baseline is a
  literal `$0` rather than the served `min`, and that the deliberate gap between the served `max`
  and the largest sampled point is expected. **Rounding the served `max` up to a tick value is a
  frontend derivation**, so it needs an explicit **approved exception** carve-out in the same style
  as the `deployedRatio` one at `:1039-1043` — currently the file's only documented exception to the
  "no frontend-computed metrics" rule (see Open Question 4).
- Record the domain rule itself (`[0, ceilTo1SigFig(max)]`, ticks at top/half/0) here, not in a code
  comment — it is behaviour, and per FRONTEND.md rule 6 the source keeps only a one-line pointer.

`docs/frontend/utils.md` — update the `pointsToBars` row (`:32`) for the new optional domain
argument, add rows for the new `chartAxis` helpers (`ceilTo1SigFig`, `axisTicks`,
`formatAxisTickUsd`) per rule 4, and add the missing `formatAxisDate` / `formatAxisDateRange` rows
(a pre-existing rule-4 gap). Keep the table's existing alphabetical ordering.

`docs/exec-plans/tech-debt-tracker.md` — log the missing global React error boundary.

No new doc files, so `scripts/lint-docs.ts` reachability (rule 2) is unaffected; keep code fences
balanced and a single trailing newline (rule 3).
