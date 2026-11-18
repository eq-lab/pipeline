// spec: docs/frontend/hooks.md
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { env, view, evm, stellar } = vi.hoisted(() => ({
  env: { EVM_CHAIN_ID: 560048, STELLAR_CHAIN_ID: 99_000_001 },
  view: { kind: "evm" as "evm" | "stellar" },
  evm: { isConnected: false, address: undefined as string | undefined },
  stellar: { isConnected: false, address: undefined as string | undefined },
}));

vi.mock("@/lib/env", () => ({ ENV: env }));
vi.mock("./WalletViewContext", () => ({ useWalletView: () => view }));
vi.mock("./evm/useEvmWallet", () => ({ useEvmWallet: () => evm }));
vi.mock("./stellar/useStellarWallet", () => ({
  useStellarWallet: () => stellar,
}));

import { useActiveChainConnection } from "./useActiveChainConnection";

const EVM_ADDRESS = "0x1234000000000000000000000000000000000001";
const STELLAR_ADDRESS =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

beforeEach(() => {
  view.kind = "evm";
  evm.isConnected = false;
  evm.address = undefined;
  stellar.isConnected = false;
  stellar.address = undefined;
});

describe("useActiveChainConnection", () => {
  it("reports the EVM wallet when the view is evm and EVM is connected", () => {
    evm.isConnected = true;
    evm.address = EVM_ADDRESS;
    const { result } = renderHook(() => useActiveChainConnection());
    expect(result.current).toEqual({
      kind: "evm",
      address: EVM_ADDRESS,
      isConnected: true,
      chainId: 560048,
    });
  });

  it("reports the Stellar wallet when the view is stellar and Stellar is connected", () => {
    view.kind = "stellar";
    stellar.isConnected = true;
    stellar.address = STELLAR_ADDRESS;
    const { result } = renderHook(() => useActiveChainConnection());
    expect(result.current).toEqual({
      kind: "stellar",
      address: STELLAR_ADDRESS,
      isConnected: true,
      chainId: 99_000_001,
    });
  });

  it("defaults to evm and disconnected when nothing is connected", () => {
    const { result } = renderHook(() => useActiveChainConnection());
    expect(result.current).toEqual({
      kind: "evm",
      address: undefined,
      isConnected: false,
      chainId: 560048,
    });
  });

  it("follows the view, not the connection flags", () => {
    view.kind = "stellar";
    evm.isConnected = true;
    evm.address = EVM_ADDRESS;
    stellar.address = STELLAR_ADDRESS;
    const { result } = renderHook(() => useActiveChainConnection());
    expect(result.current.kind).toBe("stellar");
    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBe(STELLAR_ADDRESS);
  });

  it("passes the address through unmasked while disconnected", () => {
    evm.address = EVM_ADDRESS;
    const { result } = renderHook(() => useActiveChainConnection());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBe(EVM_ADDRESS);
  });
});
