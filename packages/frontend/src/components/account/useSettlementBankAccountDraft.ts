// spec: docs/frontend/account-page.md#settlement-bank-account-1885
import { useCallback, useState } from "react";
import {
  EMPTY_BANK_DRAFT,
  bankDraftDirty,
  bankDraftPayload,
  parseBankAccountError,
  type BankDraft,
  type BankField,
} from "./settlementBankAccount";

type BankErrors = Partial<Record<BankField, string>>;

const PAIRED_ERROR: Partial<Record<BankField, BankField>> = {
  iban: "account_number",
  routing_number: "swift_bic_code",
};

export function useSettlementBankAccountDraft() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BankDraft>(EMPTY_BANK_DRAFT);
  const [errors, setErrors] = useState<BankErrors>({});

  const reset = useCallback(() => {
    setOpen(false);
    setDraft(EMPTY_BANK_DRAFT);
    setErrors({});
  }, []);

  const openForm = useCallback(() => {
    setDraft(EMPTY_BANK_DRAFT);
    setErrors({});
    setOpen(true);
  }, []);

  const setField = useCallback((field: BankField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const paired = PAIRED_ERROR[field];
      const next = { ...current };
      delete next[field];
      if (paired) delete next[paired];
      return next;
    });
  }, []);

  const applyError = useCallback((error: unknown): boolean => {
    const parsed = parseBankAccountError(error);
    if (!parsed) return false;
    setErrors({ [parsed.field]: parsed.message });
    return true;
  }, []);

  const dirty = open && bankDraftDirty(draft);

  return {
    open,
    draft,
    errors,
    dirty,
    openForm,
    cancel: reset,
    reset,
    setField,
    applyError,
    payload: () => (dirty ? bankDraftPayload(draft) : undefined),
  };
}

export type SettlementBankAccountDraft = ReturnType<
  typeof useSettlementBankAccountDraft
>;
