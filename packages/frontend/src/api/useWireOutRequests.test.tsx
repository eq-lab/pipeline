// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  kind: "stellar" as "stellar" | "evm",
  configured: true,
  stellar: { address: "GLP" as string | undefined, isConnected: true },
  evm: { address: "0xAbC" as string | undefined, isConnected: true },
  apiFetch: vi.fn(),
}));

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: h.kind }),
  useStellarWallet: () => h.stellar,
  useEvmWallet: () => h.evm,
  isWireOutMinterConfigured: () => h.configured,
}));
vi.mock("@/lib/env", () => ({
  ENV: { STELLAR_CHAIN_ID: 99000001, EVM_CHAIN_ID: 560048 },
}));
vi.mock("./client", () => ({ apiFetch: h.apiFetch }));

import { useWireOutRequests } from "./useWireOutRequests";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const row = (event: string, lp: string, id: number, ts: string) => ({
  chain_id: 1,
  timestamp: ts,
  event_name: event,
  details: { lp, id, amount: "1" },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.kind = "stellar";
  h.configured = true;
  h.stellar = { address: "GLP", isConnected: true };
  h.evm = { address: "0xAbC", isConnected: true };
});

describe("useWireOutRequests", () => {
  it("keeps only WireOutRequested rows for the Stellar wallet, in served order", async () => {
    h.apiFetch.mockResolvedValue({
      items: [
        row("WireOutRequested", "GLP", 5, "2026-10-30T10:00:00Z"),
        row("WireOutRequested", "GOTHER", 4, "2026-10-30T09:00:00Z"),
        row("WireOutSettled", "GLP", 3, "2026-10-30T08:00:00Z"),
        row("WireOutRequested", "GLP", 0, "2026-10-30T07:00:00Z"),
      ],
    });
    const { result } = renderHook(() => useWireOutRequests(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items).toEqual([
      { id: "5", timestamp: "2026-10-30T10:00:00Z" },
      { id: "0", timestamp: "2026-10-30T07:00:00Z" },
    ]);
    expect(h.apiFetch).toHaveBeenCalledWith("/v1/audit-log?chain_id=99000001");
  });

  it("matches EVM addresses case-insensitively on the EVM chain id", async () => {
    h.kind = "evm";
    h.apiFetch.mockResolvedValue({
      items: [row("WireOutRequested", "0xABC", 9, "2026-10-30T10:00:00Z")],
    });
    const { result } = renderHook(() => useWireOutRequests(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(h.apiFetch).toHaveBeenCalledWith("/v1/audit-log?chain_id=560048");
  });

  it("does not fetch when disconnected or the minter is unconfigured", async () => {
    h.stellar = { address: undefined, isConnected: false };
    renderHook(() => useWireOutRequests(), { wrapper });
    h.stellar = { address: "GLP", isConnected: true };
    h.configured = false;
    renderHook(() => useWireOutRequests(), { wrapper });
    await Promise.resolve();
    expect(h.apiFetch).not.toHaveBeenCalled();
  });

  it("surfaces a fetch failure as error with no items", async () => {
    h.apiFetch.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useWireOutRequests(), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.items).toEqual([]);
  });
});
