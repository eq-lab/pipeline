// spec: docs/frontend/account-page.md#country-select-1715
import { parseCountries, type Country } from "@/lib/countries";

export const COUNTRIES_URL = "https://flagcdn.com/en/codes.json";

export async function fetchCountries(signal?: AbortSignal): Promise<Country[]> {
  const res = await fetch(COUNTRIES_URL, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!res.ok) throw new Error(`Countries request failed: ${res.status}`);
  return parseCountries(await res.json());
}
