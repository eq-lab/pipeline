// spec: docs/frontend/wallet-flows.md#wrong-network
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { walletState, viewState, switchState, mutate } = vi.hoisted(() => ({
  walletState: {
    isConnected: true,
    address: "0x1234000000000000000000000000000000000000" as string | undefined,
    chainId: 560048 as number | undefined,
  },
  viewState: { kind: "evm" as "evm" | "stellar" },
  switchState: { isPending: false, error: null as Error | null },
  mutate: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ ENV: { EVM_CHAIN_ID: 560048 } }));
vi.mock("wagmi", () => ({
  useSwitchChain: () => ({ mutate, ...switchState }),
}));
vi.mock("./useEvmWallet", () => ({ useEvmWallet: () => walletState }));
vi.mock("../useActiveChain", () => ({
  useActiveChain: () => ({ kind: viewState.kind, chainId: 560048 }),
}));

import { EvmChainAutoSwitch } from "./EvmChainAutoSwitch";
import { useEvmNetworkGuard } from "./useEvmNetworkGuard";

beforeEach(() => {
  localStorage.clear();
  mutate.mockClear();
  walletState.isConnected = true;
  walletState.address = "0x1234000000000000000000000000000000000000";
  walletState.chainId = 560048;
  viewState.kind = "evm";
  switchState.isPending = false;
  switchState.error = null;
});

afterEach(() => localStorage.clear());

describe("useEvmNetworkGuard", () => {
  it("is not wrong on the configured chain", () => {
    const { result } = renderHook(() => useEvmNetworkGuard());
    expect(result.current.isWrongNetwork).toBe(false);
    expect(result.current.wrongNetwork).toBeUndefined();
    expect(result.current.expectedChain.name).toBe("Hoodi");
  });

  it("is wrong on another chain in the EVM view", () => {
    walletState.chainId = 1;
    const { result } = renderHook(() => useEvmNetworkGuard());
    expect(result.current.isWrongNetwork).toBe(true);
    expect(result.current.currentChainId).toBe(1);
    expect(result.current.wrongNetwork?.chainName).toBe("Hoodi");
  });

  it("ignores a wrong chain in the Stellar view", () => {
    walletState.chainId = 1;
    viewState.kind = "stellar";
    const { result } = renderHook(() => useEvmNetworkGuard());
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it("is not wrong when disconnected or the chain is unknown", () => {
    walletState.isConnected = false;
    walletState.chainId = 1;
    expect(
      renderHook(() => useEvmNetworkGuard()).result.current.isWrongNetwork,
    ).toBe(false);
    walletState.isConnected = true;
    walletState.chainId = undefined;
    expect(
      renderHook(() => useEvmNetworkGuard()).result.current.isWrongNetwork,
    ).toBe(false);
  });

  it("switchNetwork requests the configured chain", () => {
    walletState.chainId = 1;
    const { result } = renderHook(() => useEvmNetworkGuard());
    result.current.switchNetwork();
    expect(mutate).toHaveBeenCalledWith({ chainId: 560048 });
  });

  it("in mock mode switchNetwork only warns, naming the chainId key", () => {
    localStorage.setItem("pipeline.mock.wallet.address", walletState.address!);
    walletState.chainId = 1;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => useEvmNetworkGuard());
    result.current.switchNetwork();
    expect(mutate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("pipeline.mock.wallet.chainId"),
    );
    warn.mockRestore();
  });

  it("passes the mutation's pending and error state through", () => {
    walletState.chainId = 1;
    const error = new Error("rejected");
    switchState.isPending = true;
    switchState.error = error;
    const { result } = renderHook(() => useEvmNetworkGuard());
    expect(result.current.isSwitching).toBe(true);
    expect(result.current.switchError).toBe(error);
    expect(result.current.wrongNetwork?.isSwitching).toBe(true);
  });
});

describe("EvmChainAutoSwitch", () => {
  it("prompts once right after connecting on the wrong chain", () => {
    walletState.chainId = 1;
    const { rerender } = renderHook(() => EvmChainAutoSwitch());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ chainId: 560048 });
    rerender();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("does not prompt on the configured chain or when disconnected", () => {
    renderHook(() => EvmChainAutoSwitch());
    walletState.address = undefined;
    walletState.isConnected = false;
    walletState.chainId = 1;
    renderHook(() => EvmChainAutoSwitch());
    expect(mutate).not.toHaveBeenCalled();
  });

  it("prompts again for a later connection", () => {
    walletState.chainId = 1;
    const { rerender } = renderHook(() => EvmChainAutoSwitch());
    walletState.address = undefined;
    walletState.isConnected = false;
    rerender();
    walletState.address = "0x5678000000000000000000000000000000000000";
    walletState.isConnected = true;
    rerender();
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("never prompts in mock mode", () => {
    localStorage.setItem("pipeline.mock.wallet.address", walletState.address!);
    walletState.chainId = 1;
    renderHook(() => EvmChainAutoSwitch());
    expect(mutate).not.toHaveBeenCalled();
  });
});
