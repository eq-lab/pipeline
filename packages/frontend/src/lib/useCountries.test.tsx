// spec: docs/frontend/account-page.md#country-select-1715
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import {
  createCountriesClient,
  settleCountryRetries,
  stubCountriesFetch,
} from "@/test-support/countries";
import { useCountries } from "./useCountries";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function wrapperFor(client = createCountriesClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useCountries", () => {
  it("goes from loading to ready with sorted countries", async () => {
    stubCountriesFetch();
    const { result } = renderHook(() => useCountries(), {
      wrapper: wrapperFor(),
    });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const names = result.current.countries.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(names).not.toContain("European Union");
    expect(names).not.toContain("England");
  });

  it("reports error after the retries are exhausted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { countryCalls } = stubCountriesFetch({ fail: true });
    const { result } = renderHook(() => useCountries(), {
      wrapper: wrapperFor(),
    });
    await settleCountryRetries();
    expect(result.current.status).toBe("error");
    expect(countryCalls()).toHaveLength(3);
  });

  it("shares one request between consumers of the same client", async () => {
    const { countryCalls } = stubCountriesFetch();
    const wrapper = wrapperFor();
    const first = renderHook(() => useCountries(), { wrapper });
    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    const second = renderHook(() => useCountries(), { wrapper });
    expect(second.result.current.status).toBe("ready");
    expect(countryCalls()).toHaveLength(1);
  });
});
