// spec: docs/frontend/account-page.md#settlement-address
import { useEffect, useRef } from "react";
import { Button } from "@pipeline/ui";
import { AccountListRow } from "./AccountListRow";
import {
  SETTLEMENT_ACTION_LABELS,
  type SettlementControls,
  type SettlementRowView,
} from "./settlementAddress";

type RowHandlers = Pick<SettlementControls, "onLink" | "onChange" | "onCancel">;

const BODY_S = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body-s)]",
  "leading-[var(--text-pipeline-body-s--line-height)]",
];

export function SettlementAddressRow({
  kind,
  label,
  address,
  caption,
  tone,
  action,
  confirm,
  onLink,
  onChange,
  onCancel,
}: SettlementRowView & RowHandlers) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirming = confirm !== null;
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  return (
    <div
      className="flex w-full flex-col"
      data-testid="settlement-address-row"
      data-kind={kind ?? "none"}
    >
      <AccountListRow
        variant="plain"
        leading={null}
        caption={label}
        title={address ?? "—"}
        wrapTitle
        trailing={
          action !== null && kind !== null ? (
            <Button
              variant="secondary"
              size="compact"
              onClick={() =>
                action === "change" ? onChange(kind) : onLink(kind)
              }
            >
              {SETTLEMENT_ACTION_LABELS[action]}
            </Button>
          ) : undefined
        }
      />
      {caption && (
        <p
          role={tone === "negative" ? "alert" : undefined}
          className={[
            "px-2",
            ...BODY_S,
            tone === "negative"
              ? "text-[color:var(--color-pipeline-negative-strong)]"
              : "text-[color:var(--color-pipeline-ink-subtle)]",
          ].join(" ")}
        >
          {caption}
        </p>
      )}
      {confirm !== null && kind !== null && (
        <div
          className="flex flex-col gap-2 px-2 pt-2"
          data-testid="settlement-change-confirm"
        >
          {(
            [
              ["From", confirm.from],
              ["To", confirm.to],
            ] as const
          ).map(([name, value]) => (
            <p
              key={name}
              className={[
                "break-all",
                ...BODY_S,
                "text-[color:var(--color-pipeline-ink)]",
              ].join(" ")}
            >
              <span className="text-[color:var(--color-pipeline-ink-muted)]">
                {name}
              </span>{" "}
              {value}
            </p>
          ))}
          <div className="flex gap-2">
            <Button
              ref={confirmRef}
              variant="primary-dark"
              size="compact"
              onClick={() => onLink(kind)}
            >
              Confirm change
            </Button>
            <Button variant="secondary" size="compact" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettlementAddressRows({
  settlement,
}: {
  settlement: SettlementControls;
}) {
  return (
    <div className="flex flex-col gap-2">
      {settlement.rows.map((row) => (
        <SettlementAddressRow
          key={row.kind ?? "none"}
          {...row}
          onLink={settlement.onLink}
          onChange={settlement.onChange}
          onCancel={settlement.onCancel}
        />
      ))}
    </div>
  );
}
