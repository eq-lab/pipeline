// spec: docs/frontend/trustee-flows.md#audit-log (all-chains feed: no chain_id query, #1599).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuditLog } from "./useAuditLog";
import type { AuditLogResponse } from "./useAuditLog";

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

const FIXTURE: AuditLogResponse = {
  items: [
    {
      chain_id: 560048,
      timestamp: "2026-10-21T10:00:00Z",
      action: "Deal registered",
      scope: { loan_id: null, label: "Protocol" },
      reference: "",
      event_name: "DealRegistered",
      details: {},
    },
    {
      chain_id: 99_000_001,
      timestamp: "2026-10-21T09:00:00Z",
      action: "Repayment recorded",
      scope: { loan_id: "4", label: "Loan #4" },
      reference: "Helios Metals — Lithium",
      event_name: "PaymentRecorded",
      details: {},
    },
  ],
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

describe("useAuditLog", () => {
  it("fetches /v1/audit-log with no chain_id (every configured chain) and serves the merged feed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useAuditLog(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toMatch(/\/v1\/audit-log$/);
    expect(url).not.toContain("chain_id");
    expect(result.current.data?.items.map((item) => item.chain_id)).toEqual([
      560048, 99_000_001,
    ]);
  });

  it("surfaces a non-2xx response as an error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );

    const { result } = renderHook(() => useAuditLog(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toBeUndefined();
  });
});
