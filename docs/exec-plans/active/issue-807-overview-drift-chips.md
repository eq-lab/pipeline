# Issue #807: Trustee Overview: add reconciliation drift text + provenance chips (mock, exact Figma styles)

Source: https://github.com/eq-lab/pipeline/issues/807

## Scope

Two **static, presentation-only, mock** additions to the existing Overview
Capital Allocation card (built in #797, merged). No new data hook, no API call,
no computed values. Both were explicitly deferred in #797 ("no backing field")
and the requester now wants them as interim static content, to be wired to real
provenance/drift data in a later follow-up.

**In scope — exactly these two, added to `CapitalAllocationCard.tsx`:**

1. **Reconciliation drift text** — a static string in the Capital Allocation
   header row, right-aligned opposite the "Capital Allocation" label:
   `RECONCILES TO PLUSD BACKING · DRIFT < 0.01%`. Green, bold, uppercase-styled
   (already uppercase literal), letter-spaced, per Figma node `4116:8931`.

2. **Four provenance chips** — a static pill row below the legend, per Figma
   "Data source legend" group `4116:8966`. Left-to-right:
   - `on-chain balance · current block` (brand/blue)
   - `Relayer API · refreshed 2m ago` (positive/green)
   - `Trustee feed · reconciled today` (warning/amber)
   - `stale values are labeled inline` (negative/red)
   Each chip = a small dot + label inside a subtle-fill, thin-border rounded
   pill. Colours are per-chip (see token mapping below).

**Explicitly OUT of scope (per requester):**

- Cash in Transit card, Active Deal card, Needs Attention section (that's #799).
- Bar percentages / any change to bar or legend data.
- Any change to the real `GET /v1/capital-allocation` wiring (total + buckets)
  or `useCapitalAllocationCard.ts` — the real-data render path stays intact.
- No new backend field, no provenance/drift API — these strings are hard-coded
  mock chrome.

## Assumptions and Risks

- **Branch is checked out**: `feat/807-overview-drift-chips`. #797 is merged, so
  `CapitalAllocationCard.tsx` + `useCapitalAllocationCard.ts` + its test already
  exist on `main`/this branch. No dependency on unmerged work.
- **These are mock strings by explicit decision.** They violate the general
  [no frontend-computed metrics] rule's spirit only in that they show values
  with no backing field — but the requester has explicitly authorised them as
  interim static mock text (documented in the issue body and #797's deferral).
  The plan records this as a tech-debt follow-up so it is not mistaken for real
  data later. Coder MUST add an inline comment on both blocks marking them as
  mock/static, mirroring the existing "Explicitly deferred/omitted" note in the
  component's doc comment (which must be updated — see step 5).
- **Placement risk (drift text):** the header row is currently
  `flex w-full items-baseline justify-between` with a single child, so the label
  sits left. Adding the drift text as a second child makes `justify-between`
  push it right automatically — no layout rework needed. Figma uses
  `items-baseline` + `flex-wrap`; keep `items-baseline`.
- **Chip colours mostly do not map to existing tokens** (see mapping). Following
  the SignInCard / #786 / #797-bucket precedent, non-matching hex/alpha values
  are documented scoped one-off arbitrary values inline. Do NOT invent new
  global theme tokens for one-off mock chrome.
- **Font-size 12.5px (drift text) is not a token.** `--text-pipeline-caption` is
  12px. Use the arbitrary `text-[12.5px]` with `leading-[17.5px]`
  `tracking-[0.75px]` to stay pixel-exact; document as a one-off.
- **Test runner quirk:** if the workspace vitest runner breaks under Node 20 in
  the sandbox, fall back to `node node_modules/.bin/vitest run` (per issue note).

## Open Questions

_None_ — scope is tightly bounded, the requester narrowed it to exactly these
two additions, and the exact strings/styles are fixed by the Figma export on
disk. All colour/size decisions are resolvable from tokens + documented one-off
precedent.

## Token / style mapping (from `/tmp/figma-ov-8928/` export)

Drift text (`4116:8931`):
- colour `#208000` → **exact** `--color-pipeline-positive-primary`.
- `font-['Inter:Bold'] font-bold`, `text-[12.5px]`, `tracking-[0.75px]`,
  `leading-[17.5px]`. Size + tracking + line-height are arbitrary one-offs.

Chips (group `4116:8966`): container `flex flex-wrap items-center gap-x-2`
(Figma `gap-[0px_8px]` → `gap-x-2`), sitting below the legend. Each chip:
`h-[24.8px]` (~`h-[25px]`), `rounded-[4px]` → `--radius-pipeline-card`, thin
solid border, `px-[7px]`-ish with a `6px` dot at left (`opacity-75`,
`rounded-[3px]`), label `text-[12px]` → `--text-pipeline-caption`,
`leading-[16.8px]`.

Per-chip colours (text / bg / border):
1. `#000080` (= `--color-pipeline-brand`, exact) / `rgba(0,0,128,0.05)` /
   `rgba(0,0,128,0.25)`. Text uses the token; bg+border are alpha derivatives
   (one-offs).
2. `#208000` (= `--color-pipeline-positive-primary`, exact) /
   `rgba(32,128,0,0.06)` / `rgba(32,128,0,0.25)`. Bg+border one-offs.
3. `#6e6400` / `rgba(211,235,117,0.16)` / `rgba(201,162,0,0.35)`. No token match
   (theme `--color-pipeline-warning` is `#b58a00`, different) — all three are
   one-offs.
4. `#b20000` / `rgba(178,0,0,0.07)` / `rgba(178,0,0,0.25)`. Note text `#b20000`
   is NOT `--color-pipeline-negative` (`#c0392b`) — use the exact Figma hex as a
   one-off; do not substitute the token.

Because chip colour trios repeat a shape (dot+bg+border+text sharing a hue),
prefer a small local array literal in the `.tsx` (each entry: `{ label, text,
bg, border, dot }`) mapped over, rather than four hand-copied blocks. This is
static config, not derived state, so it stays in the view file (does not warrant
a hook per FRONTEND.md rule 2). Keep it inside `CapitalAllocationCard.tsx`.

## Implementation Steps

1. On branch `feat/807-overview-drift-chips`, open
   `packages/trustee/src/components/CapitalAllocationCard.tsx`.

2. **Drift text.** In the header row `div` (`flex w-full items-baseline
   justify-between`), add a second child after the "Capital Allocation" span:
   a `<span data-testid="capital-allocation-drift">` with the literal text
   `RECONCILES TO PLUSD BACKING · DRIFT < 0.01%` and classes:
   `font-[family-name:var(--font-body)] font-bold text-[12.5px]
   leading-[17.5px] tracking-[0.75px]
   text-[color:var(--color-pipeline-positive-primary)]`.
   Add an inline comment: static mock text, no backing field (issue #807).
   The existing `justify-between` will right-align it; header stays a single row.

3. **Provenance chips.** After the closing legend `</div>` (still inside the
   `<>…</>` non-loading branch, so chips render only with data — matching Figma
   where they sit under the legend), add a chip row. Define a local const array
   of 4 chip descriptors `{ label, text, bg, border, dot }` using the exact
   colours from the mapping above (token vars for chips 1–2 text/dot where they
   match; arbitrary rgba/hex elsewhere). Render:
   `<div className="flex w-full flex-wrap items-center gap-x-2 gap-y-2"
   data-testid="capital-allocation-provenance">` mapping each descriptor to a
   pill: `inline-flex items-center gap-[7px] h-[25px] rounded-[var(--radius-pipeline-card)]
   border border-solid px-[7px]` with `style={{ backgroundColor: c.bg,
   borderColor: c.border }}`, containing a `size-[6px] shrink-0 rounded-[3px]
   opacity-75` dot (`style={{ backgroundColor: c.dot }}`, `aria-hidden`) and a
   label span `text-[length:var(--text-pipeline-caption)]
   leading-[var(--text-pipeline-caption--line-height)]
   font-[family-name:var(--font-body)]` with `style={{ color: c.text }}`.
   Add an inline comment: static mock provenance chips, no backing field (#807).
   Chip text is chip-specific colour so use inline `style` for text/bg/border/dot
   (mirrors the existing legend's `style={{ backgroundColor: row.color }}`
   pattern in this same file — consistent, and avoids arbitrary-class colour
   soup).

4. Keep the loading skeleton and error branches unchanged. The drift text lives
   in the always-rendered header row (fine — it is static chrome, shows in all
   states, matching Figma which has no skeleton for it). The chips live only in
   the loaded branch (they visually belong under the legend).

5. **Update the component doc comment.** The current block-comment lists the
   drift header and provenance chips under "Explicitly deferred/omitted". Rewrite
   that paragraph to state they are now rendered as **static mock chrome** (issue
   #807), with no backing field, pending a real provenance/drift wiring
   follow-up. Add the one-off colour/size notes for the drift text and chips to
   the "Pixel/token mapping" section of the comment.

6. **Log tech debt.** Append an entry to
   `docs/exec-plans/tech-debt-tracker.md`: "Trustee Overview drift text +
   provenance chips are static mock strings (#807) — wire to real
   provenance/drift API when available." (Per AGENTS.md tech-debt rule; this is
   the deliberate shortcut being taken.)

7. Run lint/build + tests (see Test Strategy). Do NOT commit — the manager
   commits the plan and the implementation.

## Test Strategy

Extend `packages/trustee/src/components/-CapitalAllocationCard.test.tsx` (hook is
already mocked there; pure render tests, no network):

1. **Drift text renders (full-data case).** In the existing "renders the
   formatted total…" test (or a new `it`), assert
   `screen.getByText("RECONCILES TO PLUSD BACKING · DRIFT < 0.01%")` is in the
   document. Also assert it is present via the `capital-allocation-drift`
   testid.
2. **All four chips render.** New `it("renders the four provenance chips")`:
   with full-data mock, assert each of the four exact strings is present:
   `on-chain balance · current block`, `Relayer API · refreshed 2m ago`,
   `Trustee feed · reconciled today`, `stale values are labeled inline`. Assert
   the `capital-allocation-provenance` container renders exactly 4 chip children.
3. **Drift text shows in loading state too** (it is in the header row): in the
   existing "shows a skeleton while loading" test, assert the drift text is still
   present (documents the intended always-on placement). Conversely assert the
   **chips do NOT** render while loading (they live in the loaded branch) — e.g.
   `queryByTestId("capital-allocation-provenance")` is null.
4. **Guard the existing "no percentage labels" test.** The drift text contains
   `%` inside "< 0.01%", which will now match the existing
   `expect(container.textContent).not.toMatch(/%/)` assertion and break it.
   Update that test: scope the no-% assertion to the legend/bar region only
   (e.g. query the legend rows' text), OR change it to assert no *bucket*
   percentage labels (`7%`, `4%`, `1%`, `83%`) appear — keeping its original
   intent (no client-computed bar percentages) while allowing the literal drift
   string. This is a required edit, not optional — flag clearly for the coder.

Run: `yarn workspace @pipeline/trustee test` (fallback
`node node_modules/.bin/vitest run` from the trustee package dir under Node 20).
Then `yarn workspace @pipeline/trustee build` (or the repo's typecheck) and
`npx tsx scripts/lint-docs.ts` after the doc/tech-debt edits.

Figma verification (frontend flow has no separate testing phase, but the plan
must include Figma-based verification): compare the rendered header + chip row
against `/tmp/figma-ov-8928/get_screenshot_0.png` — drift text green top-right,
four coloured pills in a wrapping row under the legend, dot+label per pill,
correct order and hues.

## Docs to Update

- `packages/trustee/src/components/CapitalAllocationCard.tsx` doc block-comment
  (move drift/chips from "deferred" to "static mock chrome", add one-off notes).
- `docs/exec-plans/tech-debt-tracker.md` — mock-strings follow-up entry.
- No product-spec change: this is presentation-only interim mock content with no
  new user- or agent-facing behaviour or backend contract.
- No new shared util or hook → `docs/frontend/utils.md` / `hooks.md` unchanged.
