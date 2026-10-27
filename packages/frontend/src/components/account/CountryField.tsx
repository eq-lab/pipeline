// spec: docs/frontend/account-page.md#country-select-1715
import { useMemo } from "react";
import { Combobox, TextField } from "@pipeline/ui";
import { countryOptions } from "@/lib/countries";
import { useCountries } from "@/lib/useCountries";

export interface CountryFieldProps {
  id: string;
  value: string;
  savedValue: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
}

export function CountryField({
  id,
  value,
  savedValue,
  onChange,
  disabled,
  className,
}: CountryFieldProps) {
  const { countries, status } = useCountries();
  const options = useMemo(
    () => countryOptions(countries, savedValue, value),
    [countries, savedValue, value],
  );

  if (status === "loading") {
    return (
      <Combobox
        id={id}
        value=""
        onChange={onChange}
        options={[]}
        placeholder="Loading countries…"
        className={className}
        disabled
      />
    );
  }

  if (status === "error") {
    return (
      <>
        <TextField
          id={id}
          value={value}
          onChange={onChange}
          placeholder="Country"
          className={className}
          disabled={disabled}
        />
        <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink-muted)]">
          Couldn&apos;t load the country list. Type your country instead.
        </p>
      </>
    );
  }

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Search country"
      emptyText="No countries found"
      clearLabel="Clear country"
      className={className}
      disabled={disabled}
    />
  );
}
