// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { saveSession, clearSession } from "@/auth/session";
import { usePaymentDetails } from "./usePaymentDetails";
import type { PaymentDetailsRequest } from "./usePaymentDetails";

const BODY = {
  company_name: "Example Trust LLC",
  bank_name: "Example Bank",
  bank_address: "1 Example Street",
  account_number: "00000000",
  iban: "XX00 TEST 0000 0000 0000 00",
  swift_bic_code: "TESTXXXXXXX",
  payment_details: "PL-0000-0000-0000",
  chain_id: 99000001,
  receiver_address: "GAAA",
};

function wrapper(strict = false) {
  const client = new QueryClient();
  return ({ children }: { children: React.ReactNode }) => {
    const tree = (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return strict ? <React.StrictMode>{tree}</React.StrictMode> : tree;
  };
}

let fetchMock: ReturnType<typeof vi.spyOn>;

function mockOk() {
  fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () => new Response(JSON.stringify(BODY), { status: 200 }),
    );
}

beforeEach(() => {
  localStorage.clear();
  saveSession({ token: "jwt", expires_in: 3600, email: "lp@example.com" });
  vi.restoreAllMocks();
});

afterEach(() => {
  clearSession();
});

describe("usePaymentDetails", () => {
  it("makes one request per openId and none on re-render, focus, online", async () => {
    mockOk();
    const request: PaymentDetailsRequest = { openId: 1, chainId: 99000001 };
    const { result, rerender } = renderHook(() => usePaymentDetails(request), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.data?.payment_details).toBe("PL-0000-0000-0000");
  });

  it("does not refetch on a StrictMode remount", async () => {
    mockOk();
    const { result } = renderHook(
      () => usePaymentDetails({ openId: 1, chainId: 1 }),
      { wrapper: wrapper(true) },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a new openId makes exactly one more request", async () => {
    mockOk();
    const { result, rerender } = renderHook(
      ({ request }: { request: PaymentDetailsRequest | null }) =>
        usePaymentDetails(request),
      {
        wrapper: wrapper(),
        initialProps: {
          request: { openId: 1, chainId: 1 } as PaymentDetailsRequest | null,
        },
      },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ request: null });
    rerender({ request: { openId: 2, chainId: 1 } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("makes no request for a null request or without a session", async () => {
    mockOk();
    const { result } = renderHook(() => usePaymentDetails(null), {
      wrapper: wrapper(),
    });
    expect(result.current.status).toBe("idle");
    clearSession();
    const second = renderHook(
      () => usePaymentDetails({ openId: 1, chainId: 1 }),
      { wrapper: wrapper() },
    );
    expect(second.result.current.status).toBe("idle");
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([409, 500])(
    "a %i makes one request and is unavailable",
    async (code) => {
      fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ error: "x" }), { status: code }),
        );
      const { result } = renderHook(
        () => usePaymentDetails({ openId: 1, chainId: 1 }),
        { wrapper: wrapper() },
      );
      await waitFor(() => expect(result.current.status).toBe("unavailable"));
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
