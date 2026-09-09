// spec: docs/frontend/dashboard-components.md#riskbanner
// (always-visible unaudited-contracts risk disclosure, mounted below TopBar in __root.tsx, #1231).

export const RISK_BANNER_TEXT =
  "You are using an unaudited version of smart contracts and should acknowledge related risks";

export function RiskBanner() {
  return (
    <div
      role="note"
      data-testid="risk-banner"
      className={[
        "w-full px-4 py-2 text-center",
        "bg-[var(--color-pipeline-ink)]",
        "font-[family-name:var(--font-body)]",
        "text-[length:var(--text-pipeline-caption)]",
        "leading-[var(--text-pipeline-caption--line-height)]",
        "text-[color:var(--color-pipeline-on-dark)]",
      ].join(" ")}
    >
      {RISK_BANNER_TEXT}
    </div>
  );
}
