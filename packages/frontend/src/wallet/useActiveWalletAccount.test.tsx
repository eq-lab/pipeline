import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useActiveWalletAccount } from "./useActiveWalletAccount";

const mockUseWalletView = vi.fn();
const mockUseEvmWallet = vi.fn();
const mockUseEvmToken = vi.fn();
const mockUseDepositManagerAddresses = vi.fn();
const mockUseStellarWallet = vi.fn();
const mockUseStellarToken = vi.fn();
const mockOpen = vi.fn();

vi.mock("./WalletViewContext", () => ({
  useWalletView: () => mockUseWalletView(),
}));
vi.mock("./evm/useEvmWallet", () => ({
  useEvmWallet: () => mockUseEvmWallet(),
}));
vi.mock("./evm/useEvmToken", () => ({
  useEvmToken: () => mockUseEvmToken(),
}));
vi.mock("./evm/useDepositManager", () => ({
  useDepositManagerAddresses: () => mockUseDepositManagerAddresses(),
}));
vi.mock("./stellar/useStellarWallet", () => ({
  useStellarWallet: () => mockUseStellarWallet(),
}));
vi.mock("./stellar/useStellarToken", () => ({
  useStellarToken: () => mockUseStellarToken(),
}));
vi.mock("./ConnectModalContext", () => ({
  useConnectModal: () => ({ open: mockOpen, close: vi.fn() }),
}));

const setKind = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDepositManagerAddresses.mockReturnValue({
    usdc: "0x1111111111111111111111111111111111111111",
  });
});

describe("useActiveWalletAccount — EVM", () => {
  it("connected: exposes address, truncated address, and formatted balance", () => {
    mockUseWalletView.mockReturnValue({ kind: "evm", setKind });
    mockUseEvmWallet.mockReturnValue({
      isConnected: true,
      address: "0x8493333333333333333333333333333333b92a",
    });
    mockUseEvmToken.mockReturnValue({ formattedBalance: "$10,000.00" });
    mockUseStellarWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
    });
    mockUseStellarToken.mockReturnValue({ formattedBalance: undefined });

    const { result } = renderHook(() => useActiveWalletAccount());
    expect(result.current.kind).toBe("evm");
    expect(result.current.isConnected).toBe(true);
    expect(result.current.address).toBe(
      "0x8493333333333333333333333333333333b92a",
    );
    expect(result.current.truncatedAddress).toBe("0x8493…b92a");
    expect(result.current.formattedBalance).toBe("$10,000.00");
  });

  it("disconnected: address and balance are undefined", () => {
    mockUseWalletView.mockReturnValue({ kind: "evm", setKind });
    mockUseEvmWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
    });
    mockUseEvmToken.mockReturnValue({ formattedBalance: undefined });
    mockUseStellarWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
    });
    mockUseStellarToken.mockReturnValue({ formattedBalance: undefined });

    const { result } = renderHook(() => useActiveWalletAccount());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBeUndefined();
    expect(result.current.truncatedAddress).toBeUndefined();
  });
});

describe("useActiveWalletAccount — Stellar", () => {
  it("connected: reads the Stellar namespace", () => {
    mockUseWalletView.mockReturnValue({ kind: "stellar", setKind });
    mockUseEvmWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
    });
    mockUseEvmToken.mockReturnValue({ formattedBalance: undefined });
    mockUseStellarWallet.mockReturnValue({
      isConnected: true,
      address: "GABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEWXYZ",
    });
    mockUseStellarToken.mockReturnValue({ formattedBalance: "$5,000.00" });

    const { result } = renderHook(() => useActiveWalletAccount());
    expect(result.current.kind).toBe("stellar");
    expect(result.current.isConnected).toBe(true);
    expect(result.current.formattedBalance).toBe("$5,000.00");
  });
});

describe("useActiveWalletAccount — connect", () => {
  it("routes to the shared connect modal", () => {
    mockUseWalletView.mockReturnValue({ kind: "evm", setKind });
    mockUseEvmWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
    });
    mockUseEvmToken.mockReturnValue({ formattedBalance: undefined });
    mockUseStellarWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
    });
    mockUseStellarToken.mockReturnValue({ formattedBalance: undefined });

    const { result } = renderHook(() => useActiveWalletAccount());
    result.current.connect();
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});
