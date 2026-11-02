// spec: docs/product-specs/staking.md#default-pockets
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ stellar: vi.fn(), evm: vi.fn() }));

vi.mock("./stellar/useStellarPocketClaim", () => ({
  useStellarPocketClaim: () => h.stellar(),
}));
vi.mock("./evm/useEvmPocketClaim", () => ({
  useEvmPocketClaim: () => h.evm(),
}));

import { usePocketClaim } from "./usePocketClaim";

const idle = {
  claim: vi.fn(),
  isPending: false,
  isSuccess: false,
  error: null,
  loanId: undefined,
  amountRaw: undefined,
  hash: undefined,
  reset: vi.fn(),
};

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  qc = new QueryClient();
  h.stellar.mockReturnValue(idle);
  h.evm.mockReturnValue(idle);
});

describe("usePocketClaim", () => {
  it("returns the hook of the active kind", () => {
    const evm = { ...idle, hash: "0xe" };
    h.evm.mockReturnValue(evm);
    const { result } = renderHook(() => usePocketClaim("evm"), { wrapper });
    expect(result.current).toBe(evm);
  });

  it("invalidates the pocket reads and the PLUSD balance on success", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    h.stellar.mockReturnValue({ ...idle, isSuccess: true, hash: "tx" });
    renderHook(() => usePocketClaim("stellar"), { wrapper });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["pocket"]);
    expect(keys).toContainEqual(["stellarSacToken"]);
    expect(keys).toContainEqual(["readContract"]);
  });

  it("does not invalidate before a claim succeeds", () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => usePocketClaim("stellar"), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });
});
