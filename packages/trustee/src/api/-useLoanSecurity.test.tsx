// spec: docs/frontend/trustee-flows.md#security-card
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanSecurity } from "./useLoanSecurity";
import type { LoanSecurityResponse } from "./useLoanSecurity";

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    WALLETCONNECT_PROJECT_ID: "replace-me",
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  },
}));

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
}));

const STELLAR = 99_000_001;
const EVM = 560048;

const FIXTURE: LoanSecurityResponse = {
  refresh_pending: false,
  terms: { advance_ratio_bps: 8000, margin_call_ratio_bps: 8500 },
  valuation: { value: "100.000000", debt: "81.000000", ltv_bps: 8100 },
};

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return wrapper;
}

beforeEach(() => {
  fetchMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLoanSecurity", () => {
  it("fetches /v1/loan-book/{id}/security with the Stellar chain id and the bearer header", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );
    const { result } = renderHook(() => useLoanSecurity(STELLAR, "7"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/loan-book/7/security");
    expect(url).toContain(`chain_id=${STELLAR}`);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer test-token",
    );
    expect(result.current.notConfigured).toBe(false);
  });

  it("does not fetch for an EVM chain and reports notConfigured", () => {
    const { result } = renderHook(() => useLoanSecurity(EVM, "7"), {
      wrapper: makeWrapper(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.notConfigured).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch for a non-numeric loan id", () => {
    const { result } = renderHook(() => useLoanSecurity(STELLAR, "abc"), {
      wrapper: makeWrapper(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.notConfigured).toBe(true);
  });

  it("maps a security_registry_not_configured 404 to notConfigured and stops polling", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "security_registry_not_configured" }),
        { status: 404 },
      ),
    );
    const { result } = renderHook(() => useLoanSecurity(STELLAR, "7"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.notConfigured).toBe(true);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats any other 404 as an error, not notConfigured", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    const { result } = renderHook(() => useLoanSecurity(STELLAR, "7"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.notConfigured).toBe(false);
  });

  it("keeps the loaded data when a refetch fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(FIXTURE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "boom" }), { status: 502 }),
      );
    const { result } = renderHook(() => useLoanSecurity(STELLAR, "7"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });
    result.current.refetch();
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toEqual(FIXTURE);
  });

  it("surfaces a 500 as an error, not as notConfigured", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    const { result } = renderHook(() => useLoanSecurity(STELLAR, "7"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.notConfigured).toBe(false);
  });
});
