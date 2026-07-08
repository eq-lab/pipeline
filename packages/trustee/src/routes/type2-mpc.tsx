import { createFileRoute } from "@tanstack/react-router";
import { TRUSTEE_FLOW_TYPES } from "@/lib/flowTypes";

/**
 * Type 2 — Capital Wallet MPC co-signature (placeholder).
 *
 * See docs/product-specs/trustee-dashboard.md, "Type 2 — Capital Wallet MPC
 * co-signature" section, for flows 7-9 (loan disbursement, T-Bill allocation
 * swap, Withdrawal Queue Wallet top-up). MPC request assembly + signature
 * tracking UI lands in a per-flow sub-issue of epic #775.
 */
const flowType = TRUSTEE_FLOW_TYPES.find((t) => t.path === "/type2-mpc")!;

function Type2Mpc() {
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

export const Route = createFileRoute("/type2-mpc")({
  component: Type2Mpc,
});
