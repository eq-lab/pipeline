// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
import { Card, InfoRow } from "@pipeline/ui";
import type { WithdrawQueueInfo } from "@/wallet";
import { useWithdrawQueueCard } from "./useWithdrawQueueCard";

interface WithdrawQueueCardProps {
  queue: WithdrawQueueInfo | undefined;
  hasRequest: boolean;
}

const bodyClasses =
  "font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink)]";

export function WithdrawQueueCard({
  queue,
  hasRequest,
}: WithdrawQueueCardProps) {
  const view = useWithdrawQueueCard(queue, hasRequest);

  return (
    <div className="flex flex-col gap-4">
      {view.recoveryRate !== undefined && (
        <Card variant="yellow" data-testid="withdraw-recovery-rate-notice">
          <p className={bodyClasses}>
            Recovery rate {view.recoveryRate}. Every claim pays USDC equal to
            the PLUSD burned times this rate.
          </p>
        </Card>
      )}
      <Card variant="white" data-testid="withdraw-queue-card">
        <div className="flex flex-col gap-3">
          <h2
            className={`${bodyClasses} font-[var(--font-weight-bold)]`}
            data-testid="withdraw-queue-title"
          >
            Withdrawal queue
          </h2>
          <p className={bodyClasses} data-testid="withdraw-queue-copy">
            <strong>Paid in order.</strong> Requests are paid first in, first
            out. A request can be claimed once the withdrawal custody account
            holds enough USDC to cover it and every earlier unclaimed request.
            Until then the claim is refused as too early. Your PLUSD stays in
            the queue. Nothing is lost.
          </p>
          {view.position !== undefined && (
            <InfoRow
              label="Your position"
              value={view.position}
              data-testid="withdraw-queue-position"
            />
          )}
          <InfoRow
            label="Payable now"
            value={view.payableNow}
            data-testid="withdraw-queue-payable"
          />
          <InfoRow
            label="Total queued"
            value={view.totalQueued}
            data-testid="withdraw-queue-total-queued"
          />
          <InfoRow
            label="Total claimed"
            value={view.totalClaimed}
            data-testid="withdraw-queue-total-claimed"
          />
        </div>
      </Card>
    </div>
  );
}
