// spec: docs/frontend/hooks.md#usewalletview
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { WalletViewProvider, useWalletView } from "./WalletViewContext";

const { evm, stellar } = vi.hoisted(() => ({
  evm: { isConnected: false },
  stellar: { isConnected: false },
}));

vi.mock("./evm/useEvmWallet", () => ({ useEvmWallet: () => evm }));
vi.mock("./stellar/useStellarWallet", () => ({
  useStellarWallet: () => stellar,
}));
vi.mock("./useSingleWalletInvariant", () => ({
  useSingleWalletInvariant: () => {},
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <WalletViewProvider>{children}</WalletViewProvider>;
}

beforeEach(() => {
  evm.isConnected = false;
  stellar.isConnected = false;
});

describe("useWalletView — outside provider", () => {
  it("returns kind: 'evm' without throwing and exposes no setter", () => {
    const { result } = renderHook(() => useWalletView());
    expect(result.current).toEqual({ kind: "evm" });
  });
});

describe("useWalletView — derived from the connected wallet", () => {
  it("defaults to evm when nothing is connected", () => {
    const { result } = renderHook(() => useWalletView(), { wrapper });
    expect(result.current.kind).toBe("evm");
  });

  it("is evm when the EVM wallet is connected", () => {
    evm.isConnected = true;
    const { result } = renderHook(() => useWalletView(), { wrapper });
    expect(result.current.kind).toBe("evm");
  });

  it("is stellar when only the Stellar wallet is connected", () => {
    stellar.isConnected = true;
    const { result } = renderHook(() => useWalletView(), { wrapper });
    expect(result.current.kind).toBe("stellar");
  });

  it("does not expose setKind", () => {
    const { result } = renderHook(() => useWalletView(), { wrapper });
    expect("setKind" in result.current).toBe(false);
  });
});
