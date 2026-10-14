// spec: docs/user-stories/epic-1494/1496-evm-voucher-chain-id.md
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useDepositVoucher } from "./useDepositVoucher";

const WALLET = "0x1111111111111111111111111111111111111111";

vi.mock("@/lib/env", () => ({
  ENV: { API_BASE_URL: "http://localhost:8080", EVM_CHAIN_ID: 560048 },
}));

vi.mock("@/wallet", () => ({
  useEvmWallet: vi.fn(() => ({ address: WALLET, isConnected: true })),
  subscribeMock: vi.fn(() => () => {}),
}));

const mockApiFetch = vi.fn();
vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useDepositVoucher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("idle when requestId is undefined", () => {
    const { result } = renderHook(() => useDepositVoucher(undefined), {
      wrapper: makeWrapper(),
    });
    expect(result.current.status).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("requests the voucher with wallet and EVM chain_id", async () => {
    mockApiFetch.mockResolvedValue({
      request_id: "42",
      amount: "10000000",
      user: WALLET,
      signature: "0xdead",
    });

    const { result } = renderHook(() => useDepositVoucher("42"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/v1/deposits/42/voucher?wallet=${WALLET}&chain_id=560048`,
    );
  });
});
