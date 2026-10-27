// spec: docs/frontend/account-page.md#country-select-1715
import { useState } from "react";
import type React from "react";
import { act } from "@testing-library/react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { COUNTRIES_URL } from "@/api/countries";

export const COUNTRIES_FIXTURE: Record<string, string> = {
  nl: "Netherlands",
  pe: "Peru",
  us: "United States",
  ae: "United Arab Emirates",
  fr: "France",
  gb: "United Kingdom",
  "gb-eng": "England",
  eu: "European Union",
};

export function stubCountriesFetch(
  options: { fail?: boolean; payload?: unknown } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url !== COUNTRIES_URL)
      return new Response("not found", { status: 404 });
    if (options.fail) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify(options.payload ?? COUNTRIES_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    countryCalls: () =>
      fetchMock.mock.calls.filter(([u]) => String(u) === COUNTRIES_URL),
  };
}

export function createCountriesClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

export function CountriesWrapper({
  children,
  client,
}: {
  children: React.ReactNode;
  client?: QueryClient;
}) {
  const [own] = useState(createCountriesClient);
  return (
    <QueryClientProvider client={client ?? own}>{children}</QueryClientProvider>
  );
}

export async function settleCountryRetries() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
}
