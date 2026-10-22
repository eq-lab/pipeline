import { Navigate, createFileRoute, redirect } from "@tanstack/react-router";
import { BalanceSheetPanel } from "@/components/dashboard/BalanceSheetPanel";
import { DeploymentMonitorPanel } from "@/components/dashboard/DeploymentMonitorPanel";
import { WithdrawalQueuePanel } from "@/components/dashboard/WithdrawalQueuePanel";
import { YieldHistoryPanel } from "@/components/dashboard/YieldHistoryPanel";
import { ChainNotServedNotice } from "@/components/ChainNotServedNotice";
import { useChainServed } from "@/api";
import { isMainnetNetwork } from "@/wallet/networkSwitcher";
import { useIsMainnetNetwork } from "@/wallet/useNetworkIdentity";

// spec: docs/frontend/dashboard-components.md#dashboard-route
// (layout, panel order, entry point, Figma references).

const titleClasses = [
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-l)]",
  "md:leading-[var(--text-pipeline-heading-l--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

function Dashboard() {
  const isMainnet = useIsMainnetNetwork();
  const { served, chainName } = useChainServed();
  if (isMainnet) return <Navigate to="/" replace />;
  return (
    <div
      data-testid="dashboard-page-root"
      data-node-id="3283:12098"
      className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]"
    >
      <main
        data-testid="dashboard-main"
        className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-8 md:px-8"
      >
        <h1 className={titleClasses} data-testid="dashboard-title">
          Protocol Dashboard
        </h1>

        {served === false ? (
          <ChainNotServedNotice chainName={chainName} />
        ) : (
          <div
            data-testid="dashboard-content-container"
            className="rounded-[var(--radius-pipeline-card-lg)] bg-[color:var(--color-pipeline-surface)] p-4 md:p-8"
          >
            {/* spec: docs/frontend/dashboard-components.md#dashboard-route (panel order) */}
            <div
              data-testid="dashboard-grid"
              className="grid grid-cols-1 gap-12 md:gap-24"
            >
              <YieldHistoryPanel />
              <BalanceSheetPanel />
              <DeploymentMonitorPanel />
              <WithdrawalQueuePanel />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/dashboard")({
  // spec: docs/frontend/dashboard-components.md#dashboard-route (mainnet gate, Issue #1243)
  beforeLoad: () => {
    if (isMainnetNetwork("stellar")) {
      throw redirect({ to: "/" });
    }
  },
  component: Dashboard,
});
