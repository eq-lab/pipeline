import { createFileRoute } from "@tanstack/react-router";
import { TRUSTEE_NAV_ITEMS } from "@/lib/nav";

/**
 * Risk Council index (placeholder) — the `/risk-council` list/hub page.
 * Moved here from the old `risk-council.tsx` leaf route (issue #782's routing
 * restructure, mirroring `loans.tsx` / `loans.index.tsx`) so a sibling
 * `risk-council.escalate.$id.tsx` page can register at
 * `/risk-council/escalate/$id` under the new `risk-council.tsx`
 * pass-through `<Outlet/>` layout.
 *
 * See docs/product-specs/trustee-dashboard.md, "Type 3 — RISK_COUNCIL
 * proposals" section, for flows 10-12 (escalate to default, off-cycle
 * re-term, write-down close). Flow 10 (escalate to default) now has a real
 * page (`risk-council.escalate.$id.tsx`, #782); a list/hub view surfacing
 * live Watchlist candidates for escalation, plus flows 11/12, land in later
 * sub-issues of epic #775.
 */
const navItem = TRUSTEE_NAV_ITEMS.find((t) => t.path === "/risk-council")!;

function RiskCouncilIndex() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-2 px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-m)] leading-[var(--text-pipeline-heading-m--line-height)] text-[color:var(--color-pipeline-ink)]">
        {navItem.heading}
      </h1>
      <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink-muted)]">
        {navItem.description}
      </p>
    </main>
  );
}

export const Route = createFileRoute("/risk-council/")({
  component: RiskCouncilIndex,
});
