// spec: docs/frontend/dashboard-components.md#renderrequestrow
import { useWithdrawalRequestQueueState } from "@/wallet";
import type { WalletViewKind } from "@/wallet";
import { formatTokenAmount } from "@/lib/format";

interface WithdrawRequestQueueMetaProps {
  chainKind: WalletViewKind;
  requestId: string;
  plusdDecimals: number | undefined;
}

function parseId(value: string): bigint | undefined {
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

export function WithdrawRequestQueueMeta({
  chainKind,
  requestId,
  plusdDecimals,
}: WithdrawRequestQueueMetaProps) {
  const { position, payableNow } = useWithdrawalRequestQueueState(
    chainKind,
    parseId(requestId),
  );
  const positionText =
    position !== undefined
      ? `${formatTokenAmount(position, plusdDecimals)} PLUSD`
      : "—";
  const payableText =
    payableNow === undefined
      ? "—"
      : payableNow
        ? "Payable now"
        : "Not payable yet";

  return (
    <span data-testid="withdraw-request-queue-meta">
      Position {positionText} · {payableText}
    </span>
  );
}
