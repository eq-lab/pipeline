// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { Card } from "@pipeline/ui";
import type { WithdrawQueueInfo } from "@/wallet";
import { useWithdrawQueueCard } from "./useWithdrawQueueCard";

interface WithdrawQueueCardProps {
  queue: WithdrawQueueInfo | undefined;
  hasRequest: boolean;
}

const bodyClasses =
  "font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)]";

export function WithdrawQueueCard({
  queue,
  hasRequest,
}: WithdrawQueueCardProps) {
  const view = useWithdrawQueueCard(queue, hasRequest);

  const textColor =
    view.tone === "payable"
      ? "text-[color:var(--color-pipeline-positive)]"
      : "text-[color:var(--color-pipeline-ink)]";
  const cardVariant =
    view.tone === "payable"
      ? "positive"
      : view.tone === "waiting"
        ? "yellow"
        : "white";

  return (
    <>
      {hasRequest && (
        <Card
          variant={cardVariant}
          data-testid="withdraw-queue-card"
          data-tone={view.tone}
          className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4"
        >
          <span
            className={`${bodyClasses} ${textColor}`}
            data-testid="withdraw-queue-payable"
          >
            {view.status}
          </span>
          <span className={`${bodyClasses} ${textColor}`}>
            Your position{" "}
            <strong
              className="font-[var(--font-weight-emphasized)]"
              data-testid="withdraw-queue-position"
            >
              {view.position}
            </strong>
          </span>
        </Card>
      )}
      {view.recoveryRate !== undefined && (
        <Card variant="yellow" data-testid="withdraw-recovery-rate-notice">
          <p
            className={`${bodyClasses} text-[color:var(--color-pipeline-ink)]`}
          >
            Recovery rate {view.recoveryRate}. Every claim pays USDC equal to
            the PLUSD burned times this rate.
          </p>
        </Card>
      )}
    </>
  );
}
