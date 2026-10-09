// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import { chipStyle, type StatusBand } from "./detailTokens";

export function StatusChip({
  band,
  label,
  testId,
}: {
  band: StatusBand;
  label: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-band={band}
      className="inline-flex items-center rounded-[4px] border border-solid px-[7px] py-[3px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
      style={chipStyle(band)}
    >
      {label}
    </span>
  );
}
