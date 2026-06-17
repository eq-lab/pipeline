/**
 * Tests for useStellarWithdrawalVoucher hook.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useStellarWithdrawalVoucher } from "./useStellarWithdrawalVoucher";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/wallet", async () => {
  const actual = await vi.importActual<typeof import("@/wallet")>("@/wallet");
  return {
    ...actual,
    useStellarWallet: vi.fn(() => ({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      isConnected: true,
    })),
    subscribeMock: vi.fn(() => () => {}),
  };
});

const mockApiFetch = vi.fn();
vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// ── Wrapper ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useStellarWithdrawalVoucher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("idle when requestId is undefined", () => {
    const { result } = renderHook(
      () => useStellarWithdrawalVoucher(undefined),
      { wrapper: makeWrapper() },
    );

    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(result.current.signatureBytes).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it("idle when wallet disconnected", async () => {
    const { useStellarWallet } = await import("@/wallet");
    vi.mocked(useStellarWallet).mockReturnValue({
      address: undefined,
      isConnected: false,
    } as ReturnType<typeof useStellarWallet>);

    const { result } = renderHook(
      () => useStellarWithdrawalVoucher("42"),
      { wrapper: makeWrapper() },
    );

    expect(result.current.status).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("ready status when signature present", async () => {
    const { useStellarWallet } = await import("@/wallet");
    vi.mocked(useStellarWallet).mockReturnValue({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      isConnected: true,
    } as ReturnType<typeof useStellarWallet>);

    const hexSig = `0x${"ab".repeat(64)}`; // 0x + 128-char hex = 64 bytes
    mockApiFetch.mockResolvedValue({
      request_id: "42",
      amount: "10000000",
      user: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      signature: hexSig,
    });

    const { result } = renderHook(
      () => useStellarWithdrawalVoucher("42"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.data?.signature).toBe(hexSig);
    expect(result.current.signatureBytes).toBeInstanceOf(Uint8Array);
    expect(result.current.signatureBytes?.length).toBe(64);
    expect(result.current.error).toBeNull();
  });

  it("request URL includes &chain_id=99000001", async () => {
    const { useStellarWallet } = await import("@/wallet");
    vi.mocked(useStellarWallet).mockReturnValue({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      isConnected: true,
    } as ReturnType<typeof useStellarWallet>);

    mockApiFetch.mockResolvedValue({
      request_id: "42",
      amount: "10000000",
      user: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      signature: "ab".repeat(64),
    });

    const { result } = renderHook(
      () => useStellarWithdrawalVoucher("42"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining("chain_id=99000001"),
    );
  });

  it("hex→bytes decode correctness", async () => {
    const { useStellarWallet } = await import("@/wallet");
    vi.mocked(useStellarWallet).mockReturnValue({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      isConnected: true,
    } as ReturnType<typeof useStellarWallet>);

    // Known hex: 0xdeadbeef + padding to 64 bytes
    const knownHex = "0xdeadbeef" + "00".repeat(60);
    mockApiFetch.mockResolvedValue({
      request_id: "42",
      amount: "10000000",
      user: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      signature: knownHex,
    });

    const { result } = renderHook(
      () => useStellarWithdrawalVoucher("42"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    const bytes = result.current.signatureBytes!;
    expect(bytes[0]).toBe(0xde);
    expect(bytes[1]).toBe(0xad);
    expect(bytes[2]).toBe(0xbe);
    expect(bytes[3]).toBe(0xef);
    expect(bytes[4]).toBe(0x00);
  });

  it("failed status when API errors (non-retriable)", async () => {
    const { useStellarWallet } = await import("@/wallet");
    vi.mocked(useStellarWallet).mockReturnValue({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      isConnected: true,
    } as ReturnType<typeof useStellarWallet>);

    mockApiFetch.mockRejectedValue(new Error("Internal Server Error"));

    const { result } = renderHook(
      () => useStellarWithdrawalVoucher("42"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("failed"));

    expect(result.current.error?.message).toMatch(/Internal Server Error/);
    expect(result.current.data).toBeUndefined();
  });

  it("accepts bigint requestId", async () => {
    const { useStellarWallet } = await import("@/wallet");
    vi.mocked(useStellarWallet).mockReturnValue({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      isConnected: true,
    } as ReturnType<typeof useStellarWallet>);

    const hexSig = "cd".repeat(64);
    mockApiFetch.mockResolvedValue({
      request_id: "99",
      amount: "10000000",
      user: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      signature: hexSig,
    });

    const { result } = renderHook(
      () => useStellarWithdrawalVoucher(99n),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/withdrawals/99/voucher"),
    );
  });
});
