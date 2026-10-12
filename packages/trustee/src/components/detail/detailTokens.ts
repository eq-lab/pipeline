// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import type { CSSProperties } from "react";

export type StatusBand =
  | "positive"
  | "attention"
  | "negative"
  | "neutral"
  | "info";

export const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
export const NEGATIVE_RED = "#b20000";
export const ATTENTION_AMBER = "#6e6400";
export const POSITIVE_GREEN = "var(--color-pipeline-positive-primary)";
export const BRAND = "var(--color-pipeline-brand)";
export const INK = "var(--color-pipeline-ink)";
export const INK_MUTED = "rgba(56,55,53,0.6)";

export function chipStyle(band: StatusBand): CSSProperties {
  switch (band) {
    case "positive":
      return {
        color: POSITIVE_GREEN,
        backgroundColor: "rgba(32,128,0,0.08)",
        borderColor: "rgba(32,128,0,0.3)",
      };
    case "attention":
      return {
        color: ATTENTION_AMBER,
        backgroundColor: "rgba(110,100,0,0.08)",
        borderColor: "rgba(110,100,0,0.3)",
      };
    case "negative":
      return {
        color: NEGATIVE_RED,
        backgroundColor: "rgba(178,0,0,0.08)",
        borderColor: "rgba(178,0,0,0.3)",
      };
    case "info":
      return {
        color: BRAND,
        backgroundColor: "rgba(0,0,128,0.08)",
        borderColor: "rgba(0,0,128,0.3)",
      };
    default:
      return {
        color: INK_MUTED,
        backgroundColor: "rgba(56,55,53,0.06)",
        borderColor: LINE_COLOR,
      };
  }
}

export function cardStyle() {
  return { border: `1px solid ${LINE_COLOR}` } as const;
}

export const CARD_CLASS =
  "flex w-full flex-col rounded-[4px] bg-[color:var(--color-pipeline-surface)]";

export const DETAIL_SECONDARY_BUTTON_CLASS =
  "!h-[40px] !rounded-[4px] !px-[16px] border border-solid bg-white text-[#262524]";

export function detailSecondaryButtonStyle(): CSSProperties {
  return { borderColor: LINE_COLOR };
}
