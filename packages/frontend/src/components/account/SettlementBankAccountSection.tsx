// spec: docs/frontend/account-page.md#settlement-bank-account-1885
import { useEffect, useId, useRef } from "react";
import { Button, TextField } from "@pipeline/ui";
import type { SettlementBankAccountSummary } from "@/api";
import { AccountListRow } from "./AccountListRow";
import {
  BANK_FIELDS,
  BANK_FIELD_LABELS,
  bankAccountDetail,
  type BankField,
} from "./settlementBankAccount";
import type { SettlementBankAccountDraft } from "./useSettlementBankAccountDraft";

export interface SettlementBankAccountSectionProps {
  account: SettlementBankAccountSummary | null;
  kybStatus: string | undefined;
  writable: boolean;
  disabled: boolean;
  controls: SettlementBankAccountDraft;
  testIdPrefix?: string;
}

const BODY_S = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body-s)]",
  "leading-[var(--text-pipeline-body-s--line-height)]",
];

const MUTED = "text-[color:var(--color-pipeline-ink-muted)]";
const SUBTLE = "text-[color:var(--color-pipeline-ink-subtle)]";
const INK = "text-[color:var(--color-pipeline-ink)]";

const HELPERS: Partial<Record<BankField, string>> = {
  account_number: "Enter an IBAN, an account number, or both.",
  routing_number: "Enter a SWIFT/BIC code, a routing number, or both.",
};

function caption(
  account: SettlementBankAccountSummary | null,
  kybStatus: string | undefined,
  writable: boolean,
): string | null {
  if (writable) {
    return account === null
      ? "Optional. Needed only to withdraw to a bank account by wire."
      : null;
  }
  if (kybStatus === "UnderReview")
    return "Locked while your account is under review.";
  if (kybStatus === "Passed")
    return account === null
      ? "To add a bank account, contact support."
      : "To change it, contact support.";
  return null;
}

export function SettlementBankAccountSection({
  account,
  kybStatus,
  writable,
  disabled,
  controls,
  testIdPrefix,
}: SettlementBankAccountSectionProps) {
  const baseId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const formOpen = writable && controls.open;
  useEffect(() => {
    if (formOpen) firstRef.current?.focus();
  }, [formOpen]);
  const id = (suffix: string) =>
    testIdPrefix ? `${testIdPrefix}-${suffix}` : suffix;
  const note = caption(account, kybStatus, writable);
  return (
    <div
      className="flex w-full flex-col"
      data-testid={id("settlement-bank-row")}
    >
      <AccountListRow
        variant="plain"
        leading={null}
        caption="Settlement bank account"
        title={account ? account.account_holder_name : "Not added"}
        trailing={
          writable && !controls.open ? (
            <Button
              type="button"
              variant="secondary"
              size="compact"
              disabled={disabled}
              onClick={controls.openForm}
              data-testid={id("settlement-bank-open")}
            >
              {account === null ? "Add" : "Replace"}
            </Button>
          ) : undefined
        }
      />
      {account && (
        <p
          className={["px-2", ...BODY_S, MUTED].join(" ")}
          data-testid={id("settlement-bank-detail")}
        >
          {bankAccountDetail(account)}
        </p>
      )}
      {note && (
        <p
          className={["px-2", ...BODY_S, SUBTLE].join(" ")}
          data-testid={id("settlement-bank-caption")}
        >
          {note}
        </p>
      )}
      {formOpen && (
        <div
          className="flex flex-col gap-2 px-2 pt-2"
          data-testid={id("settlement-bank-form")}
        >
          {account && (
            <p className={[...BODY_S, INK].join(" ")}>
              Replacing {bankAccountDetail(account)}. Enter the full account
              again.
            </p>
          )}
          {BANK_FIELDS.map((field, index) => {
            const inputId = `${baseId}-${field}`;
            const error = controls.errors[field];
            return (
              <div key={field} className="flex flex-col gap-2">
                <label htmlFor={inputId} className={[...BODY_S, INK].join(" ")}>
                  {BANK_FIELD_LABELS[field]}
                </label>
                <TextField
                  id={inputId}
                  ref={index === 0 ? firstRef : undefined}
                  value={controls.draft[field]}
                  onChange={(next) => controls.setField(field, next)}
                  autoComplete="off"
                  spellCheck={false}
                  invalid={error !== undefined}
                  error={error}
                  disabled={disabled}
                  className="[&>div:not(:focus-within)]:border-[color:var(--color-pipeline-line)]"
                />
                {HELPERS[field] && (
                  <p className={[...BODY_S, SUBTLE].join(" ")}>
                    {HELPERS[field]}
                  </p>
                )}
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="compact"
              disabled={disabled}
              onClick={controls.cancel}
              data-testid={id("settlement-bank-cancel")}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
