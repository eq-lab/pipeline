// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import type { ReactNode } from "react";
import { chipStyle, type StatusBand } from "./detailTokens";

const BAND_BUTTON_BASE =
  "inline-flex items-center justify-center rounded-[4px] border border-solid font-[family-name:var(--font-body)] disabled:cursor-not-allowed disabled:opacity-50";

export function BandButton({
  band,
  onClick,
  disabled,
  testId,
  ariaLabel,
  children,
}: {
  band: StatusBand;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-band={band}
      data-testid={testId}
      aria-label={ariaLabel}
      className={`${BAND_BUTTON_BASE} h-[32px] px-[12px] text-[13px] leading-[18.2px] whitespace-nowrap`}
      style={chipStyle(band)}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function BandIconButton({
  band,
  label,
  icon,
  onClick,
  disabled,
  testId,
}: {
  band: StatusBand;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-band={band}
      data-testid={testId}
      className={`${BAND_BUTTON_BASE} size-[32px] shrink-0`}
      style={chipStyle(band)}
      onClick={onClick}
      disabled={disabled}
    >
      <span aria-hidden="true" className="inline-flex items-center">
        {icon}
      </span>
    </button>
  );
}
