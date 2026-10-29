// spec: docs/frontend/trustee-flows.md#onoff-ramp-tab
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRampEvents } from "./useRampEvents";
import { useRampAddresses } from "./useRampAddresses";
import { useReviewRampEvent } from "./useReviewRampEvent";

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

const sessionChain = vi.hoisted(() => ({
  chainId: 560048 as number | undefined,
}));

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
  useSessionState: () => ({
    status: "authenticated",
    address: "0xabc",
    chainId: sessionChain.chainId,
    error: undefined,
  }),
}));

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

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function firstUrl(): string {
  return String(fetchMock.mock.calls[0]?.[0] ?? "");
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

const CASES: Array<[string, number | undefined, number]> = [
  ["an EVM session", 560048, 560048],
  ["a Stellar session", 99_000_001, 99_000_001],
  ["no session chain", undefined, 99_000_001],
];

describe.each(CASES)("ramp hooks for %s", (_label, session, expected) => {
  it("useRampEvents requests the session chain", async () => {
    sessionChain.chainId = session;
    fetchMock.mockResolvedValueOnce(ok({ events: [] }));
    const { result } = renderHook(() => useRampEvents(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual({ events: [] }));
    expect(firstUrl()).toContain(`/v1/ramp/events?chain_id=${expected}`);
    expect(result.current.chainId).toBe(expected);
  });

  it("useRampAddresses requests the session chain", async () => {
    sessionChain.chainId = session;
    fetchMock.mockResolvedValueOnce(ok({ ramp_addresses: [] }));
    const { result } = renderHook(() => useRampAddresses(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() =>
      expect(result.current.data).toEqual({ ramp_addresses: [] }),
    );
    expect(firstUrl()).toContain(`/v1/ramp/addresses?chain_id=${expected}`);
  });
});

describe("useReviewRampEvent", () => {
  it("POSTs Approved to the bare review path with no query string", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { result } = renderHook(() => useReviewRampEvent(), {
      wrapper: makeWrapper(),
    });
    await act(() =>
      result.current.reviewAsync({ id: 7, decision: "Approved" }),
    );
    expect(firstUrl()).toBe("http://localhost:8080/v1/ramp/events/7/review");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ decision: "Approved" });
  });

  it("POSTs Rejected with its reason", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { result } = renderHook(() => useReviewRampEvent(), {
      wrapper: makeWrapper(),
    });
    await act(() =>
      result.current.reviewAsync({
        id: 7,
        decision: "Rejected",
        reason: "dup",
      }),
    );
    expect(firstUrl()).not.toContain("?");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      decision: "Rejected",
      reason: "dup",
    });
  });
});
