// spec: docs/frontend/bank-transfers.md#wire-out
import { useState } from "react";
import { Button, Card } from "@pipeline/ui";
import type { FlowState } from "@/wallet";
import { isWireOutMinterConfigured, useWalletView } from "@/wallet";
import { renderWireOutRow } from "@/components/activity/renderWireOutRow";
import { WireOutModal } from "./WireOutModal";
import type { ErrorDetails } from "./WireOutModal";
import { useWireOutGate } from "./useWireOutFlow";
import { useKybPassed, useWireOutSection } from "./useWireOutSection";

export const WIRE_OUT_DESCRIPTION =
  "You request a wire-out of an amount of PLUSD. The PLUSD moves into escrow. When the wire is sent, the Trustee settles the request and the PLUSD is burned. The Trustee can cancel the request instead, and the PLUSD returns to you.";

type WireOutFlow = Pick<
  FlowState,
  | "balance"
  | "decimals"
  | "formattedBalance"
  | "plusdAuthorized"
  | "refetchBalance"
>;

interface WireOutSectionProps {
  flow: WireOutFlow;
  onShowErrorDetails: (details: ErrorDetails) => void;
}

const textClasses =
  "m-0 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)]";

export function WireOutSection({
  flow,
  onShowErrorDetails,
}: WireOutSectionProps) {
  const { kind } = useWalletView();
  const kybPassed = useKybPassed();
  const { blockedReason } = useWireOutGate({
    kind,
    plusdAuthorized: flow.plusdAuthorized,
    kybPassed,
  });
  const [open, setOpen] = useState(false);
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);
  const { rows, refetch } = useWireOutSection(submittedIds);

  if (!isWireOutMinterConfigured(kind)) return null;

  return (
    <div className="flex flex-col gap-2">
      <Card
        variant="plain"
        padding="none"
        data-testid="wire-out-section"
        className="flex flex-col gap-3 px-4 py-4"
      >
        <h2
          className={`${textClasses} font-[var(--font-weight-emphasized)] text-[color:var(--color-pipeline-ink)]`}
        >
          Withdraw to a bank account
        </h2>
        <p
          data-testid="wire-out-description"
          className={`${textClasses} text-[color:var(--color-pipeline-ink-muted)]`}
        >
          {WIRE_OUT_DESCRIPTION}
        </p>
        <Button
          data-testid="wire-out-open"
          variant="primary-dark"
          size="m"
          className="self-start"
          disabled={blockedReason !== undefined}
          onClick={() => setOpen(true)}
        >
          Request bank wire-out
        </Button>
        {blockedReason !== undefined && (
          <p
            data-testid="wire-out-blocked-reason"
            className={`${textClasses} text-[length:var(--text-pipeline-caption)] text-[color:var(--color-pipeline-ink-muted)]`}
          >
            {blockedReason}
          </p>
        )}
      </Card>

      {rows.length > 0 && (
        <Card
          variant="plain"
          padding="none"
          data-testid="wire-out-list"
          className="flex flex-col gap-3 px-4 py-4"
        >
          <h2
            className={`${textClasses} font-[var(--font-weight-emphasized)] text-[color:var(--color-pipeline-ink)]`}
          >
            Your bank wire-outs
          </h2>
          {rows.map((row) => (
            <div key={row.id} data-testid={`wire-out-row-${row.id}`}>
              {renderWireOutRow({
                timestamp: row.timestamp,
                read: row.read,
                decimals: flow.decimals,
              })}
            </div>
          ))}
        </Card>
      )}

      <WireOutModal
        open={open}
        onClose={() => setOpen(false)}
        flow={flow}
        onSubmitted={(id) => {
          if (id !== undefined) setSubmittedIds((prev) => [id, ...prev]);
          refetch();
        }}
        onShowErrorDetails={onShowErrorDetails}
      />
    </div>
  );
}
