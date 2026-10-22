// spec: docs/frontend/wallet-flows.md#active-chain-for-protocol-reads (chain-served probe, #1605).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const activeChain = vi.hoisted(() => ({
  kind: "evm" as "evm" | "stellar",
  chainId: 560048,
}));

vi.mock("@/wallet/useActiveChain", () => ({
  useActiveChain: () => ({
    kind: activeChain.kind,
    chainId: activeChain.chainId,
  }),
}));

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

import {
  chainDisplayName,
  isUnknownChainError,
  useChainServed,
} from "./useChainServed";
import { ApiError } from "./client";

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
  fetchMock.mockReset();
  activeChain.kind = "evm";
  activeChain.chainId = 560048;
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useChainServed", () => {
  it("probes /v1/pnl with the zero wallet and the active chain; a 200 means served", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ total_pnl: "0" }), { status: 200 }),
    );
    const { result } = renderHook(() => useChainServed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.served).toBe(true));
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain(
      "/v1/pnl?wallet=0x0000000000000000000000000000000000000000&chain_id=560048",
    );
    expect(result.current.chainName).toBe("Hoodi");
  });

  it("a 400 `unknown chain_id` means not served", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "unknown chain_id: 1 (configured: 99000002)" }),
        { status: 400 },
      ),
    );
    activeChain.chainId = 1;
    const { result } = renderHook(() => useChainServed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.served).toBe(false));
    expect(result.current.chainName).toBe("Ethereum");
  });

  it("any other failure counts as served (a flaky probe never hides a working chain)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "internal error" }), {
        status: 500,
      }),
    );
    const { result } = renderHook(() => useChainServed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.served).toBe(true));
  });

  it("the Stellar view is served without a request", async () => {
    activeChain.kind = "stellar";
    activeChain.chainId = 99_000_001;
    const { result } = renderHook(() => useChainServed(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.served).toBe(true);
    expect(result.current.chainName).toBe("Stellar");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("isUnknownChainError / chainDisplayName", () => {
  it("matches only a 400 whose message starts with unknown chain_id", () => {
    expect(isUnknownChainError(new ApiError(400, "unknown chain_id: 1"))).toBe(
      true,
    );
    expect(isUnknownChainError(new ApiError(400, "bad wallet"))).toBe(false);
    expect(isUnknownChainError(new ApiError(404, "unknown chain_id: 1"))).toBe(
      false,
    );
    expect(isUnknownChainError(new Error("unknown chain_id: 1"))).toBe(false);
  });

  it("names known chains and falls back for unknown ids", () => {
    expect(chainDisplayName("stellar", 99_000_001)).toBe("Stellar");
    expect(chainDisplayName("evm", 560048)).toBe("Hoodi");
    expect(chainDisplayName("evm", 424242)).toBe("chain 424242");
  });
});
