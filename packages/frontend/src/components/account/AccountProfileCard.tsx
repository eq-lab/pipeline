// spec: docs/frontend/account-page.md#production-lp-data-contract-1373
import { Button, TextField } from "@pipeline/ui";
import { CountryField } from "./CountryField";
import { SettlementAddressRow } from "./SettlementAddressRow";
import type { SettlementRowView } from "./settlementAddress";

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
  settlement?: SettlementRowView;
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
      {settlement && <SettlementAddressRow {...settlement} />}
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
