import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { EvmWalletProvider } from "./EvmWalletProvider";
import { useEvmWallet, useEvmConnectors } from "./useEvmWallet";

// ── Mock wagmi ────────────────────────────────────────────────────────────────

const mockWagmiConnect = vi.fn();
const mockSignMessageAsync = vi.fn();

vi.mock("wagmi", async (importOriginal) => {
  const original = await importOriginal<typeof import("wagmi")>();
  return {
    ...original,
    WagmiProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useAccount: vi.fn(() => ({
      address: undefined,
      isConnected: false,
    })),
    useChainId: vi.fn(() => 1),
    useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
    useReadContract: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      error: null,
    })),
    useConnect: vi.fn(() => ({ connect: mockWagmiConnect })),
    useConnectors: vi.fn(() => [
      { id: "injected" },
      { id: "coinbaseWallet" },
      { id: "walletConnect" },
    ]),
    useSignMessage: vi.fn(() => ({ signMessageAsync: mockSignMessageAsync })),
  };
});

// ── Mock AppKit ───────────────────────────────────────────────────────────────

const mockOpen = vi.fn();

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: vi.fn(() => ({ open: mockOpen })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    QueryClientProvider: ({
      children,
    }: {
      children: React.ReactNode;
      client: unknown;
    }) => <>{children}</>,
  };
});

// ── Mock config (prevent real AppKit init during tests) ─────────────────────

vi.mock("./config", () => ({
  initEvmWalletConnect: () => ({}),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return <EvmWalletProvider>{children}</EvmWalletProvider>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useEvmWallet — no mocks, no real wallet", () => {
  beforeEach(() => localStorage.clear());

  it("reports disconnected by default", () => {
    const { result } = renderHook(() => useEvmWallet(), { wrapper });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBeUndefined();
  });
});

describe("useEvmWallet — localStorage mock", () => {
  beforeEach(() => localStorage.clear());

  it("reports connected when address + isConnected mocks are set", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");

    const { result } = renderHook(() => useEvmWallet(), { wrapper });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.address).toBe(
      "0x1234000000000000000000000000000000000000",
    );
  });

  it("defaults isConnected to true when only address is set", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );

    const { result } = renderHook(() => useEvmWallet(), { wrapper });
    expect(result.current.isConnected).toBe(true);
  });
});

describe("useEvmWallet — connect() with no gate mounted (Trustee-style)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
  });

  it("calls useAppKit().open() directly — the default no-op gate proceeds immediately", () => {
    const { result } = renderHook(() => useEvmWallet(), { wrapper });

    act(() => result.current.connect());

    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("does NOT call open() for mock address (dev affordance)", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );

    const { result } = renderHook(() => useEvmWallet(), { wrapper });

    act(() => result.current.connect());

    expect(mockOpen).not.toHaveBeenCalled();
  });
});

describe("useEvmWallet — signMessage()", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSignMessageAsync.mockClear();
  });

  it("delegates to wagmi signMessageAsync and returns a hex signature", async () => {
    mockSignMessageAsync.mockResolvedValue("0xdeadbeef");

    const { result } = renderHook(() => useEvmWallet(), { wrapper });

    const signResult = await act(() =>
      result.current.signMessage("Welcome to Pipeline!"),
    );

    expect(mockSignMessageAsync).toHaveBeenCalledWith({
      message: "Welcome to Pipeline!",
    });
    expect(signResult).toEqual({ signature: "0xdeadbeef" });
  });

  it("rejects on the mock path (signMessage is not mockable)", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );

    const { result } = renderHook(() => useEvmWallet(), { wrapper });

    await expect(
      act(() => result.current.signMessage("hello")),
    ).rejects.toThrow("signMessage is not mockable");
    expect(mockSignMessageAsync).not.toHaveBeenCalled();
  });
});

// ── Tests: useEvmConnectors ────────────────────────────────────────────────────

describe("useEvmConnectors — connectWallet calls wagmi connect directly", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWagmiConnect.mockClear();
    mockOpen.mockClear();
  });

  it("calls wagmi connect with matching connector", () => {
    const { result } = renderHook(() => useEvmConnectors(), { wrapper });

    act(() => result.current.connectWallet("injected"));

    expect(mockWagmiConnect).toHaveBeenCalledOnce();
    expect(mockWagmiConnect).toHaveBeenCalledWith({
      connector: { id: "injected" },
    });
  });

  it("mock short-circuit: connectWallet is a no-op when mock address is set", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );

    const { result } = renderHook(() => useEvmConnectors(), { wrapper });

    act(() => result.current.connectWallet("injected"));

    expect(mockWagmiConnect).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("falls back to AppKit open() when connector id not registered", async () => {
    const wagmi = await import("wagmi");
    vi.mocked(wagmi.useConnectors).mockReturnValueOnce([]);

    const { result } = renderHook(() => useEvmConnectors(), { wrapper });

    act(() => result.current.connectWallet("injected"));

    expect(mockWagmiConnect).not.toHaveBeenCalled();
    expect(mockOpen).toHaveBeenCalledOnce();
  });
});
