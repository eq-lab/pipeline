// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import { Link } from "@tanstack/react-router";
import { StatusChip } from "./StatusChip";
import { INK_MUTED, type StatusBand } from "./detailTokens";

export function DetailHero({
  backTo,
  backLabel,
  title,
  status,
  meta,
  statusTestId,
  metaTestId,
}: {
  backTo: "/loans" | "/lp-counterparties";
  backLabel: string;
  title: string;
  status: { label: string; band: StatusBand } | null;
  meta: string;
  statusTestId?: string;
  metaTestId?: string;
}) {
  return (
    <div className="flex flex-col gap-[8px]">
      <Link
        to={backTo}
        className="self-start font-[family-name:var(--font-display)] text-[18px] leading-[25.2px] text-[#262524] no-underline hover:underline"
      >
        {backLabel}
      </Link>
      <h1 className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px] text-[#262524]">
        {title}
      </h1>
      <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
        {status && (
          <StatusChip
            band={status.band}
            label={status.label}
            testId={statusTestId}
          />
        )}
        <span
          data-testid={metaTestId}
          className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: INK_MUTED }}
        >
          {meta}
        </span>
      </div>
    </div>
  );
}
