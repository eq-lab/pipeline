import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanSubmissions } from "./useLoanSubmissions";

// ── Mock @/wallet (client.ts dependency) ─────────────────────────────────────

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: "evm" }),
  useEvmWallet: () => ({ address: undefined, isConnected: false }),
  useStellarWallet: () => ({ address: undefined, isConnected: false }),
  subscribeMock: () => () => {},
  // readMock reads from localStorage (jsdom provides this in the test environment)
  readMock: (key: string, parse: (raw: string) => unknown) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return undefined;
      return parse(raw);
    } catch {
      return undefined;
    }
  },
  parseJson: (value: string) => JSON.parse(value) as unknown,
}));

// ── Mock ENV ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

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

describe("useLoanSubmissions — no chain scoping", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("requests all submissions without chain_id", async () => {
    renderHook(() => useLoanSubmissions(), { wrapper: makeWrapper() });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/v1/loan-book/submissions");
    expect(url).not.toContain("chain_id");
  });
});
