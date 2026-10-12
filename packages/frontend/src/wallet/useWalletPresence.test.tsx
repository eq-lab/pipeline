import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWalletPresence } from "./useWalletPresence";

const mockUseEvmWallet = vi.fn();
const mockUseStellarWallet = vi.fn();

vi.mock("./evm/useEvmWallet", () => ({
  useEvmWallet: () => mockUseEvmWallet(),
}));
vi.mock("./stellar/useStellarWallet", () => ({
  useStellarWallet: () => mockUseStellarWallet(),
}));

const evmDisconnect = vi.fn();
const stellarDisconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

function setWallets(opts: {
  evmConnected: boolean;
  evmSettled: boolean;
  stellarConnected: boolean;
  stellarSettled: boolean;
}) {
  mockUseEvmWallet.mockReturnValue({
    isConnected: opts.evmConnected,
    isSettled: opts.evmSettled,
    disconnect: evmDisconnect,
  });
  mockUseStellarWallet.mockReturnValue({
    isConnected: opts.stellarConnected,
    isSettled: opts.stellarSettled,
    disconnect: stellarDisconnect,
  });
}

describe("useWalletPresence — isAnyConnected", () => {
  it("false when neither namespace is connected", () => {
    setWallets({
      evmConnected: false,
      evmSettled: true,
      stellarConnected: false,
      stellarSettled: true,
    });
    const { result } = renderHook(() => useWalletPresence());
    expect(result.current.isAnyConnected).toBe(false);
  });

  it("true when only EVM is connected", () => {
    setWallets({
      evmConnected: true,
      evmSettled: true,
      stellarConnected: false,
      stellarSettled: true,
    });
    const { result } = renderHook(() => useWalletPresence());
    expect(result.current.isAnyConnected).toBe(true);
  });

  it("true when only Stellar is connected", () => {
    setWallets({
      evmConnected: false,
      evmSettled: true,
      stellarConnected: true,
      stellarSettled: true,
    });
    const { result } = renderHook(() => useWalletPresence());
    expect(result.current.isAnyConnected).toBe(true);
  });

  it("true when both namespaces are connected", () => {
    setWallets({
      evmConnected: true,
      evmSettled: true,
      stellarConnected: true,
      stellarSettled: true,
    });
    const { result } = renderHook(() => useWalletPresence());
    expect(result.current.isAnyConnected).toBe(true);
  });
});

describe("useWalletPresence — isSettled", () => {
  it("false while EVM is reconnecting", () => {
    setWallets({
      evmConnected: false,
      evmSettled: false,
      stellarConnected: false,
      stellarSettled: true,
    });
    const { result } = renderHook(() => useWalletPresence());
    expect(result.current.isSettled).toBe(false);
  });

  it("false while Stellar has not settled", () => {
    setWallets({
      evmConnected: false,
      evmSettled: true,
      stellarConnected: false,
      stellarSettled: false,
    });
    const { result } = renderHook(() => useWalletPresence());
    expect(result.current.isSettled).toBe(false);
  });

  it("true once both namespaces have settled", () => {
    setWallets({
      evmConnected: false,
      evmSettled: true,
      stellarConnected: false,
      stellarSettled: true,
    });
    const { result } = renderHook(() => useWalletPresence());
    expect(result.current.isSettled).toBe(true);
  });
});

describe("useWalletPresence — disconnectAll", () => {
  it("disconnects only the connected namespaces", () => {
    setWallets({
      evmConnected: true,
      evmSettled: true,
      stellarConnected: false,
      stellarSettled: true,
    });
    const { result } = renderHook(() => useWalletPresence());
    result.current.disconnectAll();
    expect(evmDisconnect).toHaveBeenCalledTimes(1);
    expect(stellarDisconnect).not.toHaveBeenCalled();
  });

  it("disconnects both namespaces when both are connected", () => {
    setWallets({
      evmConnected: true,
      evmSettled: true,
      stellarConnected: true,
      stellarSettled: true,
    });
    const { result } = renderHook(() => useWalletPresence());
    result.current.disconnectAll();
    expect(evmDisconnect).toHaveBeenCalledTimes(1);
    expect(stellarDisconnect).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when neither namespace is connected", () => {
    setWallets({
      evmConnected: false,
      evmSettled: true,
      stellarConnected: false,
      stellarSettled: true,
    });
    const { result } = renderHook(() => useWalletPresence());
    result.current.disconnectAll();
    expect(evmDisconnect).not.toHaveBeenCalled();
    expect(stellarDisconnect).not.toHaveBeenCalled();
  });
});
