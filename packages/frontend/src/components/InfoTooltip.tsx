// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal (hover / focus tooltip on the info glyph)
import React from "react";
import { InfoGlyph } from "./FundingDetailsGlyphs";

export interface InfoTooltipProps {
  label: string;
  text: string;
  align?: "start" | "end";
  "data-testid"?: string;
}

const TRIGGER_CLASS = [
  "flex h-6 w-6 shrink-0 items-center justify-center",
  "rounded-[var(--radius-pipeline-card)]",
  "transition-colors hover:bg-[rgba(56,55,53,0.08)]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]",
].join(" ");

const TOOLTIP_CLASS = [
  "pointer-events-none absolute bottom-full z-10 mb-1",
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150",
  "w-max max-w-full px-3 py-2 text-left whitespace-pre-line",
  "rounded-[var(--radius-pipeline-button)]",
  "bg-[var(--color-pipeline-ink)]",
  "text-[color:var(--color-pipeline-on-dark)]",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
].join(" ");

export function InfoTooltip({
  label,
  text,
  align = "end",
  "data-testid": testId,
}: InfoTooltipProps) {
  const id = React.useId();
  return (
    <span className="group inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className={TRIGGER_CLASS}
        data-testid={testId}
      >
        <InfoGlyph />
      </button>
      <span
        role="tooltip"
        id={id}
        className={[TOOLTIP_CLASS, align === "end" ? "right-0" : "left-0"].join(
          " ",
        )}
      >
        {text}
      </span>
    </span>
  );
}
