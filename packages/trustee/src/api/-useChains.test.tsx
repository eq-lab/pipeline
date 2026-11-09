import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

import { useServedTargetChains } from "./useChains";
import { DEFAULT_TARGET_CHAIN_ID, TARGET_CHAINS } from "@/lib/targetChains";

const fetchMock = vi.fn();

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const STELLAR = { chain_id: 99_000_001, kind: "stellar" };
const EVM = { chain_id: 560048, kind: "evm" };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useServedTargetChains (#1667)", () => {
  it("requests GET /v1/chains once and is loading with no options first", async () => {
    respond({ chains: [STELLAR, EVM], default_chain_id: 560048 });
    const { result } = renderHook(() => useServedTargetChains(), { wrapper });
    expect(result.current).toEqual({
      options: [],
      defaultChainId: null,
      isLoading: true,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "http://localhost:8080/v1/chains",
    );
  });

  it("offers both chains and the served default", async () => {
    respond({ chains: [STELLAR, EVM], default_chain_id: 560048 });
    const { result } = renderHook(() => useServedTargetChains(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options).toEqual(TARGET_CHAINS);
    expect(result.current.defaultChainId).toBe(560048);
  });

  it("omits the EVM chain when only Stellar is served", async () => {
    respond({ chains: [STELLAR], default_chain_id: 99_000_001 });
    const { result } = renderHook(() => useServedTargetChains(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options.map((o) => o.id)).toEqual([99_000_001]);
    expect(result.current.defaultChainId).toBe(99_000_001);
  });

  it("picks the first option when the served default is not offered", async () => {
    respond({ chains: [STELLAR], default_chain_id: 560048 });
    const { result } = renderHook(() => useServedTargetChains(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.defaultChainId).toBe(99_000_001);
  });

  it("falls back to the env list on a failed request", async () => {
    respond({ error: "boom" }, 500);
    const { result } = renderHook(() => useServedTargetChains(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options).toEqual(TARGET_CHAINS);
    expect(result.current.defaultChainId).toBe(DEFAULT_TARGET_CHAIN_ID);
  });
});
