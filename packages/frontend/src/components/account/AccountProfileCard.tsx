// spec: docs/frontend/account-page.md#production-lp-data-contract-1373
import { Button, TextField } from "@pipeline/ui";

export interface AccountProfileCardProps {
  legalName: string;
  country: string;
  onLegalNameChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  onSave: () => void;
  canSave: boolean;
  disabled: boolean;
  busy: boolean;
}

export function AccountProfileCard({
  legalName,
  country,
  onLegalNameChange,
  onCountryChange,
  onSave,
  canSave,
  disabled,
  busy,
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
          disabled={disabled}
        />
      </label>
      <label className="flex flex-col gap-2" htmlFor="account-country">
        <span>Country</span>
        <TextField
          id="account-country"
          value={country}
          onChange={onCountryChange}
          placeholder="Country"
          disabled={disabled}
        />
      </label>
      <Button
        variant="primary-dark"
        className="w-full disabled:opacity-[0.32]"
        disabled={!canSave}
        onClick={onSave}
      >
        {busy ? "Saving…" : "Save profile"}
      </Button>
    </div>
  );
}
