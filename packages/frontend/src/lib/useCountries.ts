// spec: docs/frontend/account-page.md#country-select-1715
import { useQuery } from "@tanstack/react-query";
import { fetchCountries } from "@/api/countries";
import type { Country } from "./countries";

export function useCountries(): {
  countries: Country[];
  status: "loading" | "ready" | "error";
} {
  const query = useQuery({
    queryKey: ["countries", "flagcdn", "en"],
    queryFn: ({ signal }) => fetchCountries(signal),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
    refetchOnWindowFocus: false,
  });
  if (query.data) return { countries: query.data, status: "ready" };
  if (query.status === "error") return { countries: [], status: "error" };
  return { countries: [], status: "loading" };
}
