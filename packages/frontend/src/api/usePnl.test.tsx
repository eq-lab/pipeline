import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePnl, type PnlResponse } from "./usePnl";

const mockWalletView = vi.hoisted(() => ({ kind: "evm" as "evm" | "stellar" }));
const mockEvmWallet = vi.hoisted(() => ({
  address: "0x1234000000000000000000000000000000000001",
  isConnected: true,
}));
const mockStellarWallet = vi.hoisted(() => ({
  address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  isConnected: true,
}));

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: mockWalletView.kind }),
  useEvmWallet: () => mockEvmWallet,
  useStellarWallet: () => mockStellarWallet,
  subscribeMock: () => () => {},
  readMock: () => undefined,
  parseJson: (value: string) => JSON.parse(value),
}));

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99000001,
  },
}));

const RESPONSE: PnlResponse = {
  wallet: mockEvmWallet.address,
  positions: [],
  total_unrealized_pnl: "42800000000000000000",
  total_realized_pnl: "0",
  total_pnl: "42800000000000000000",
  avg_apy: "0.0842",
};

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("usePnl", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
    mockWalletView.kind = "evm";
    mockEvmWallet.isConnected = true;
    mockStellarWallet.isConnected = true;
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("fetches EVM PnL with wallet and EVM chain id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => usePnl(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(RESPONSE));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/v1/pnl?wallet=${mockEvmWallet.address}&chain_id=560048`,
      ),
      undefined,
    );
  });

  it("fetches Stellar PnL with wallet and Stellar chain id", async () => {
    mockWalletView.kind = "stellar";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => usePnl(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.data).toEqual(RESPONSE));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/v1/pnl?wallet=${mockStellarWallet.address}&chain_id=99000001`,
      ),
      undefined,
    );
  });

  it("stays disabled when the active wallet is disconnected", async () => {
    mockEvmWallet.isConnected = false;

    const { result } = renderHook(() => usePnl(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
