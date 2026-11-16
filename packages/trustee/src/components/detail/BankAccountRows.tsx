// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import { useCopyToClipboard } from "@pipeline/ui";
import { useToast } from "@/components/ToastProvider";
import type { SettlementBankAccountDetails } from "@/api/useLp";
import { bankAccountRows } from "@/lib/settlementBankAccount";
import { CopyIcon } from "./DetailIcons";
import { KeyValueRow } from "./KeyValueRow";
import { INK_MUTED } from "./detailTokens";

const MONO_FIELDS = new Set([
  "iban",
  "account_number",
  "swift_bic_code",
  "routing_number",
]);
const MONO_CLASS = "font-mono text-[13px] leading-[18px] break-all";
const COPY_BUTTON_CLASS =
  "inline-flex size-[32px] shrink-0 items-center justify-center rounded-[4px] hover:bg-[rgba(0,0,128,0.06)]";

export function BankAccountRows({
  details,
  testIdPrefix,
}: {
  details: SettlementBankAccountDetails;
  testIdPrefix: string;
}) {
  const { showToast } = useToast();
  const { copy } = useCopyToClipboard();
  const rows = bankAccountRows(details);
  return (
    <div className="flex flex-col">
      {rows.map(({ field, label, value, copyable }, index) => (
        <KeyValueRow
          key={field}
          label={label}
          isLast={index === rows.length - 1}
        >
          <span className="inline-flex items-center justify-end gap-[8px]">
            <span
              data-testid={`${testIdPrefix}-${field}`}
              className={MONO_FIELDS.has(field) ? MONO_CLASS : undefined}
            >
              {value ?? "—"}
            </span>
            {copyable && value !== null && (
              <button
                type="button"
                aria-label={`Copy ${label}`}
                data-testid={`${testIdPrefix}-${field}-copy`}
                className={COPY_BUTTON_CLASS}
                style={{ color: INK_MUTED }}
                onClick={() =>
                  void copy(value).then((ok) => {
                    if (ok) showToast(`${label} copied`);
                  })
                }
              >
                <CopyIcon aria-hidden />
              </button>
            )}
          </span>
        </KeyValueRow>
      ))}
    </div>
  );
}
