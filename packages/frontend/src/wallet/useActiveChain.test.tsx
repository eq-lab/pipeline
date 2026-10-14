import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { env, view, evm, stellar } = vi.hoisted(() => ({
  env: { EVM_CHAIN_ID: 560048, STELLAR_CHAIN_ID: 99_000_001 },
  view: { kind: "evm" as "evm" | "stellar" },
  evm: { isConnected: false },
  stellar: { isConnected: false },
}));

vi.mock("@/lib/env", () => ({ ENV: env }));
vi.mock("./WalletViewContext", () => ({ useWalletView: () => view }));
vi.mock("./evm/useEvmWallet", () => ({ useEvmWallet: () => evm }));
vi.mock("./stellar/useStellarWallet", () => ({
  useStellarWallet: () => stellar,
}));

import { useActiveChain } from "./useActiveChain";

beforeEach(() => {
  view.kind = "evm";
  evm.isConnected = false;
  stellar.isConnected = false;
});

describe("useActiveChain", () => {
  it("defaults to Stellar with no wallet, even when the view says evm", () => {
    const { result } = renderHook(() => useActiveChain());
    expect(result.current).toEqual({ kind: "stellar", chainId: 99_000_001 });
  });

  it("follows a connected EVM wallet regardless of the view kind", () => {
    view.kind = "stellar";
    evm.isConnected = true;
    const { result } = renderHook(() => useActiveChain());
    expect(result.current).toEqual({ kind: "evm", chainId: 560048 });
  });

  it("follows a connected Stellar wallet regardless of the view kind", () => {
    view.kind = "evm";
    stellar.isConnected = true;
    const { result } = renderHook(() => useActiveChain());
    expect(result.current).toEqual({ kind: "stellar", chainId: 99_000_001 });
  });

  it.each(["evm", "stellar"] as const)(
    "breaks a both-connected tie with the view kind (%s)",
    (kind) => {
      view.kind = kind;
      evm.isConnected = true;
      stellar.isConnected = true;
      const { result } = renderHook(() => useActiveChain());
      expect(result.current.kind).toBe(kind);
    },
  );
});
