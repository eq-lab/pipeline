/**
 * RiskBanner — always-visible unaudited-contracts risk disclosure, mounted
 * topmost in each app's root layout (#1231).
 * spec: docs/frontend/dashboard-components.md#riskbanner
 */

export const RISK_BANNER_TEXT =
  "You are using an unaudited version of smart contracts and should acknowledge related risks";

export function RiskBanner() {
  return (
    <div
      role="note"
      data-testid="risk-banner"
      className={[
        "w-full px-4 py-2 text-center",
        "bg-[var(--color-pipeline-brand)]",
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
