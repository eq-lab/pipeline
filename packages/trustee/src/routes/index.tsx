import { createFileRoute } from "@tanstack/react-router";
import { CapitalAllocationCard } from "@/components/CapitalAllocationCard";
import { NeedsAttention } from "@/components/NeedsAttention";

/**
 * Overview — the Trustee app's index route.
 *
 * spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer,
 * docs/frontend/trustee-flows.md#needs-attention-section.
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
