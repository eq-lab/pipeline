import { createFileRoute } from "@tanstack/react-router";
import { CapitalAllocationCard } from "@/components/CapitalAllocationCard";
import { NeedsAttention } from "@/components/NeedsAttention";

/**
 * Overview — the Trustee app's index route (Figma node `4116:8855`'s
 * "Overview" nav item, active by default; page body Figma node `4116:8922`).
 *
 * #786 retired the #777 scaffold's "pick a flow type" launcher page and left
 * a placeholder body here. Issue #797 replaces that placeholder with the real
 * Overview page: the "Overview" header + the Capital Allocation card wired to
 * `GET /v1/capital-allocation`.
 *
 * Net scope for #797 (see `docs/exec-plans/active/issue-797-*.md` "Decisions"
 * section, human-confirmed 2026-07-08) — everything else in the Figma frame
 * is deferred/out of scope:
 *   - No header timestamp — no `as_of`/`generated_at` API field exists yet.
 *   - No reconciliation header / provenance chips on the card — no backing
 *     field.
 *   - No standalone Cash-in-Transit or Active Deal cards — removed entirely
 *     (the `in_transit` bucket stays in the Capital Allocation legend).
 *
 * Issue #818 adds the "Needs Attention" section directly after the Capital
 * Allocation content (resolved OQ#3, human review), rendering ONLY the
 * Origination group, backed by real `GET /v1/loan-book/submissions?status=InReview`
 * data. The whole section (heading and all) renders nothing when there are
 * no in-review submissions — see `NeedsAttention.tsx`. The Loans —
 * Payments Due / Cash Management / Risk Council groups remain deferred to
 * follow-up issue #799 (blocked on backend endpoints).
 *
 * `<NeedsAttention />` is passed as `CapitalAllocationCard`'s `children`
 * (human review follow-up, issue #818) rather than mounted as its own
 * sibling `Card` — per the Figma background node `4116:8928`, Capital
 * Allocation and Needs Attention share ONE continuous white surface, not two
 * stacked white blocks.
 */
function Overview() {
  return (
    <main className="flex w-full max-w-[1180px] flex-col gap-[30px] px-[56px] pt-[40px] pb-[80px]">
      <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-title)] leading-[var(--text-pipeline-title--line-height)] text-[color:var(--color-pipeline-ink-subtle)]">
        Overview
      </h1>
      <CapitalAllocationCard>
        <NeedsAttention />
      </CapitalAllocationCard>
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: Overview,
});
