/**
 * Unit tests for `useStellarXlmBalance` — native XLM read with the
 * funded-account discriminator (Horizon 404 → `accountExists: false`).
 * spec: docs/frontend/wallet-flows.md#xlm-funding-rule
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStellarXlmBalance } from "./useStellarXlmBalance";
import { STELLAR_MOCK_KEYS } from "./mock";

const mockLoadAccount = vi.hoisted(() => vi.fn());

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    loadAccount(address: string) {
      return mockLoadAccount(address);
    }
  }
  return { Horizon: { Server: MockServer } };
});

const mockStellarWallet = vi.hoisted(() => ({
  address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV" as
    | string
    | undefined,
  isConnected: true,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("./useStellarWallet", () => ({
  useStellarWallet: () => ({ ...mockStellarWallet }),
}));

vi.mock("./chain", () => ({
  horizonUrl: "https://horizon-testnet.stellar.org",
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function notFoundError(): Error {
  const err = new Error("Not Found") as Error & {
    response: { status: number };
  };
  err.response = { status: 404 };
  return err;
}

beforeEach(() => {
  mockStellarWallet.address =
    "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
  mockStellarWallet.isConnected = true;
  mockLoadAccount.mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe("useStellarXlmBalance", () => {
  it("returns the native balance line and accountExists true", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "5.0" },
        { asset_type: "native", balance: "12.3456789" },
      ],
    });
    const { result } = renderHook(() => useStellarXlmBalance(), { wrapper });
    await waitFor(() => expect(result.current.xlmBalance).toBe("12.3456789"));
    expect(result.current.accountExists).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("maps Horizon 404 to zero balance with accountExists false, no error", async () => {
    mockLoadAccount.mockRejectedValue(notFoundError());
    const { result } = renderHook(() => useStellarXlmBalance(), { wrapper });
    await waitFor(() => expect(result.current.accountExists).toBe(false));
    expect(result.current.xlmBalance).toBe("0");
    expect(result.current.error).toBeNull();
  });

  it("surfaces non-404 errors and leaves balance/accountExists undefined", async () => {
    mockLoadAccount.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useStellarXlmBalance(), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.xlmBalance).toBeUndefined();
    expect(result.current.accountExists).toBeUndefined();
  });

  it("returns undefined fields when disconnected without calling Horizon", () => {
    mockStellarWallet.isConnected = false;
    mockStellarWallet.address = undefined;
    const { result } = renderHook(() => useStellarXlmBalance(), { wrapper });
    expect(result.current.xlmBalance).toBeUndefined();
    expect(result.current.accountExists).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });

  it("serves the localStorage mock without calling Horizon", () => {
    localStorage.setItem(STELLAR_MOCK_KEYS.balanceXlm, "0");
    const { result } = renderHook(() => useStellarXlmBalance(), { wrapper });
    expect(result.current.xlmBalance).toBe("0");
    expect(result.current.accountExists).toBe(true);
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });
});
