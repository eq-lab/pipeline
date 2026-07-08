import { createFileRoute } from "@tanstack/react-router";
import { TRUSTEE_NAV_ITEMS } from "@/lib/nav";

/**
 * Cash Management (placeholder).
 *
 * See docs/product-specs/trustee-dashboard.md, "Type 2 — Capital Wallet MPC
 * co-signature" section, for flows 8-9 (T-Bill allocation swap, Withdrawal
 * Queue Wallet top-up). MPC request assembly + signature tracking UI lands in
 * a per-flow sub-issue of epic #775 (#786 replaces the #777 scaffold's
 * `/type2-mpc` route with the Figma nav taxonomy).
 */
const navItem = TRUSTEE_NAV_ITEMS.find((t) => t.path === "/cash-management")!;

function CashManagement() {
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

export const Route = createFileRoute("/cash-management")({
  component: CashManagement,
});
