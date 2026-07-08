import { createFileRoute } from "@tanstack/react-router";
import { Card, LinkCard } from "@pipeline/ui";
import { TRUSTEE_FLOW_TYPES } from "@/lib/flowTypes";

/**
 * Landing page — lists the four Trustee flow types with a link to each
 * placeholder route. No data, no wallet calls (Issue #777 scaffold).
 */
function TrusteeIndex() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-12 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-m)] leading-[var(--text-pipeline-heading-m--line-height)] text-[color:var(--color-pipeline-ink)]">
        Trustee Admin
      </h1>
      <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] text-[color:var(--color-pipeline-ink-muted)]">
        Choose a flow type to continue. See{" "}
        <code>docs/product-specs/trustee-dashboard.md</code> for the full spec.
      </p>

      <Card variant="white" className="flex flex-col gap-2">
        {TRUSTEE_FLOW_TYPES.map((type) => (
          <LinkCard key={type.path} href={type.path} label={type.heading} />
        ))}
      </Card>
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: TrusteeIndex,
});
