// spec: docs/frontend/account-page.md#settlement-address-1813
import { AccountListRow } from "./AccountListRow";
import type { SettlementRowView } from "./settlementAddress";

export function SettlementAddressRow({
  address,
  caption,
  tone,
}: SettlementRowView) {
  return (
    <div className="flex w-full flex-col" data-testid="settlement-address-row">
      <AccountListRow
        variant="plain"
        leading={null}
        caption="Settlement address"
        title={address ?? "—"}
        wrapTitle
      />
      {caption && (
        <p
          role={tone === "negative" ? "alert" : undefined}
          className={[
            "px-2",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body-s)]",
            "leading-[var(--text-pipeline-body-s--line-height)]",
            tone === "negative"
              ? "text-[color:var(--color-pipeline-negative-strong)]"
              : "text-[color:var(--color-pipeline-ink-subtle)]",
          ].join(" ")}
        >
          {caption}
        </p>
      )}
    </div>
  );
}
