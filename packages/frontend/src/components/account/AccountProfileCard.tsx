// spec: docs/frontend/account-page.md#production-lp-data-contract-1373
import { Button, TextField } from "@pipeline/ui";
import { CountryField } from "./CountryField";
import { SettlementAddressRows } from "./SettlementAddressRow";
import type { SettlementControls } from "./settlementAddress";
import { SettlementBankAccountSection } from "./SettlementBankAccountSection";
import type { SettlementBankAccountSummary } from "@/api";
import type { SettlementBankAccountDraft } from "./useSettlementBankAccountDraft";

export interface AccountProfileBank {
  account: SettlementBankAccountSummary | null;
  kybStatus: string | undefined;
  controls: SettlementBankAccountDraft;
}

export interface AccountProfileCardProps {
  legalName: string;
  country: string;
  savedCountry: string;
  onLegalNameChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  onSave: () => void;
  canSave: boolean;
  writable: boolean;
  disabled: boolean;
  busy: boolean;
  settlement?: SettlementControls;
  bank?: AccountProfileBank;
}

export function AccountProfileCard({
  legalName,
  country,
  savedCountry,
  onLegalNameChange,
  onCountryChange,
  onSave,
  canSave,
  writable,
  disabled,
  busy,
  settlement,
  bank,
}: AccountProfileCardProps) {
  return (
    <div className="flex w-full flex-col gap-5 rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface)] p-4">
      <label className="flex flex-col gap-2" htmlFor="account-legal-name">
        <span>Name</span>
        <TextField
          id="account-legal-name"
          value={legalName}
          onChange={onLegalNameChange}
          placeholder="Legal company name"
          className="[&>div:not(:focus-within)]:border-[color:var(--color-pipeline-line)]"
          disabled={disabled}
        />
      </label>
      <div className="flex flex-col gap-2">
        <label htmlFor="account-country">Country</label>
        <CountryField
          id="account-country"
          value={country}
          savedValue={savedCountry}
          onChange={onCountryChange}
          className="[&>div:not(:focus-within)]:border-[color:var(--color-pipeline-line)]"
          disabled={disabled}
        />
      </div>
      {settlement && <SettlementAddressRows settlement={settlement} />}
      {bank && (
        <SettlementBankAccountSection
          account={bank.account}
          kybStatus={bank.kybStatus}
          writable={writable}
          disabled={disabled}
          controls={bank.controls}
        />
      )}
      {writable && (
        <Button
          variant="primary-dark"
          className="w-full disabled:opacity-[0.32]"
          disabled={!canSave}
          onClick={onSave}
        >
          {busy ? "Saving…" : "Save profile"}
        </Button>
      )}
    </div>
  );
}
