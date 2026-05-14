import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { WalletProvider } from "./WalletProvider";
import { useWallet } from "./useWallet";

// ── Mock wagmi ────────────────────────────────────────────────────────────────

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
  wagmiConfig: {},
  wagmiAdapter: {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useWallet — no mocks, no real wallet", () => {
  beforeEach(() => localStorage.clear());

  it("reports disconnected by default", () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBeUndefined();
  });
});

describe("useWallet — localStorage mock", () => {
  beforeEach(() => localStorage.clear());

  it("reports connected when address + isConnected mocks are set", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");

    const { result } = renderHook(() => useWallet(), { wrapper });
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

    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current.isConnected).toBe(true);
  });

  it("reports disconnected when isConnected mock is false", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );
    localStorage.setItem("pipeline.mock.wallet.isConnected", "false");

    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current.isConnected).toBe(false);
  });

  it("re-renders when isConnected is flipped post-mount", () => {
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      localStorage.setItem("pipeline.mock.wallet.isConnected", "false");
      window.dispatchEvent(
        new CustomEvent("pipeline-mock:wallet", {
          detail: { key: "pipeline.mock.wallet.isConnected" },
        }),
      );
    });

    expect(result.current.isConnected).toBe(false);
  });
});

describe("useWallet — connect()", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
  });

  it("calls useAppKit().open() when no mock address is set", () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    act(() => result.current.connect());
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("does NOT call open() when a mock address is already set", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );
    const { result } = renderHook(() => useWallet(), { wrapper });
    act(() => result.current.connect());
    expect(mockOpen).toHaveBeenCalledTimes(0);
  });
});
