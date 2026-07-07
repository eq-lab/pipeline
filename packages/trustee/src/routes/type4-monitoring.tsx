import { createFileRoute } from "@tanstack/react-router";
import { TRUSTEE_FLOW_TYPES } from "@/lib/flowTypes";

/**
 * Type 4 — Decision monitoring (placeholder).
 *
 * See docs/product-specs/trustee-dashboard.md, "Type 4 — Decision
 * monitoring" section, for surfaces 13-17 (mint queue, reserves and
 * invariants, T-Bill band and forward strip, portfolio aggregates, audit
 * log). Read-only monitoring UI lands in a per-surface sub-issue of epic
 * #775.
 */
const flowType = TRUSTEE_FLOW_TYPES.find(
  (t) => t.path === "/type4-monitoring",
)!;

function Type4Monitoring() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-2 px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-m)] leading-[var(--text-pipeline-heading-m--line-height)] text-[color:var(--color-pipeline-ink)]">
        {flowType.heading}
      </h1>
      <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink-muted)]">
        {flowType.description}
      </p>
    </main>
  );
}

export const Route = createFileRoute("/type4-monitoring")({
  component: Type4Monitoring,
});
