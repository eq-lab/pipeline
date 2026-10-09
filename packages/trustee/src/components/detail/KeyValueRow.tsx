// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import { INK_MUTED, LINE_COLOR } from "./detailTokens";

export function KeyValueRow({
  label,
  children,
  tag,
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  tag?: string;
  isLast?: boolean;
}) {
  return (
    <div
      className="flex items-start justify-between gap-[16px] py-[12px]"
      style={isLast ? undefined : { borderBottom: `1px solid ${LINE_COLOR}` }}
    >
      <span
        className="font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
        style={{ color: INK_MUTED }}
      >
        {label}
        {tag && (
          <span
            className="ml-[6px] text-[11px] lowercase"
            style={{ color: INK_MUTED }}
          >
            {tag}
          </span>
        )}
      </span>
      <span className="text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]">
        {children}
      </span>
    </div>
  );
}
