// spec: docs/frontend/wallet-flows.md#active-chain-for-protocol-reads (chain-served probe, #1605).
import { Card } from "@pipeline/ui";

export interface ChainNotServedNoticeProps {
  chainName: string;
  className?: string;
}

export function ChainNotServedNotice({
  chainName,
  className,
}: ChainNotServedNoticeProps) {
  return (
    <Card
      variant="white"
      className={["flex w-full flex-col gap-2 p-8", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="chain-not-served"
      role="status"
    >
      <span className="font-[family-name:var(--font-display)] text-[24px] leading-[32px] text-[color:var(--color-pipeline-ink)]">
        Not available on {chainName}
      </span>
      <span className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink-muted)]">
        Pipeline isn&apos;t available on {chainName} yet. Switch your wallet to
        a supported network to see protocol data.
      </span>
    </Card>
  );
}

export default ChainNotServedNotice;
