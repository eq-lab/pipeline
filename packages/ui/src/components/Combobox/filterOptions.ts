// spec: docs/frontend/ui-components.md#combobox
export interface ComboboxOption {
  value: string;
  label: string;
  iconUrl?: string;
  keywords?: string[];
  selectedLabel?: string;
}

export function filterOptions<T extends ComboboxOption>(
  options: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLocaleLowerCase("en");
  if (q === "") return [...options];
  return options.filter(
    (o) =>
      o.label.toLocaleLowerCase("en").includes(q) ||
      (o.keywords ?? []).some((k) => k.toLocaleLowerCase("en") === q),
  );
}
