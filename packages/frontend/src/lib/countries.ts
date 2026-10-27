// spec: docs/frontend/account-page.md#country-select-1715
import type { ComboboxOption } from "@pipeline/ui";

export const flagUrl = (code: string) => `https://flagcdn.com/${code}.svg`;

export type Country = { code: string; name: string; flagUrl: string };

const EXCLUDED_CODES = new Set(["eu", "un"]);

export function parseCountries(json: unknown): Country[] {
  if (json === null || typeof json !== "object" || Array.isArray(json))
    throw new Error("Unexpected countries payload");
  const countries: Country[] = [];
  for (const [key, name] of Object.entries(json)) {
    if (!/^[a-z]{2}$/.test(key) || EXCLUDED_CODES.has(key)) continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    countries.push({ code: key.toUpperCase(), name, flagUrl: flagUrl(key) });
  }
  if (countries.length === 0) throw new Error("Empty countries payload");
  return countries.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function countryOptions(
  countries: Country[],
  ...values: (string | null | undefined)[]
): ComboboxOption[] {
  const options: ComboboxOption[] = countries.map((c) => ({
    value: c.name,
    label: c.name,
    iconUrl: c.flagUrl,
    keywords: [c.code],
  }));
  const known = new Set(countries.map((c) => c.name));
  for (const raw of values) {
    if (!raw || known.has(raw)) continue;
    known.add(raw);
    options.push({
      value: raw,
      label: `${raw} (as saved)`,
      selectedLabel: raw,
    });
  }
  return options;
}
