// spec: docs/frontend/wallet-flows.md#active-chain-for-protocol-reads (chain-served check via GET /v1/chains, #1605).
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

import { chainDisplayName, useChainServed } from "./useChainServed";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

const CHAINS_BODY = {
  chains: [
    { chain_id: 99_000_001, kind: "stellar" },
    { chain_id: 560048, kind: "evm" },
  ],
  default_chain_id: 99_000_001,
};

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
  it("reads GET /v1/chains once; a listed chain is served", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(CHAINS_BODY), { status: 200 }),
    );
    const { result } = renderHook(() => useChainServed(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.served).toBeUndefined();
    await waitFor(() => expect(result.current.served).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain("/v1/chains");
    expect(result.current.chainName).toBe("Hoodi");
  });

  it("a chain missing from the list is not served", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(CHAINS_BODY), { status: 200 }),
    );
    activeChain.chainId = 1;
    const { result } = renderHook(() => useChainServed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.served).toBe(false));
    expect(result.current.chainName).toBe("Ethereum");
  });

  it("a failing /v1/chains counts as served (no false notice)", async () => {
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

  it("the Stellar view is looked up in the same list", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(CHAINS_BODY), { status: 200 }),
    );
    activeChain.kind = "stellar";
    activeChain.chainId = 99_000_001;
    const { result } = renderHook(() => useChainServed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.served).toBe(true));
    expect(result.current.chainName).toBe("Stellar");
  });

  it("a Stellar chain id absent from the list is not served", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          chains: [{ chain_id: 560048, kind: "evm" }],
          default_chain_id: 560048,
        }),
        { status: 200 },
      ),
    );
    activeChain.kind = "stellar";
    activeChain.chainId = 99_000_001;
    const { result } = renderHook(() => useChainServed(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.served).toBe(false));
  });
});

describe("chainDisplayName", () => {
  it("names known chains and falls back for unknown ids", () => {
    expect(chainDisplayName("stellar", 99_000_001)).toBe("Stellar");
    expect(chainDisplayName("evm", 560048)).toBe("Hoodi");
    expect(chainDisplayName("evm", 424242)).toBe("chain 424242");
  });
});
