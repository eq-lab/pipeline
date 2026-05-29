import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { EvmWalletProvider } from "./EvmWalletProvider";
import { useEvmWallet } from "./useEvmWallet";

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

// ── Mock FirstConnectionModal to avoid portal/DOM issues ────────────────────
// We just need to verify gate open/close behavior, not the modal UI.

const mockModalOnContinue = vi.fn();
const mockModalOnDismiss = vi.fn();
let capturedModalProps: {
  open: boolean;
  onContinue: () => void;
  onDismiss: () => void;
} = { open: false, onContinue: () => {}, onDismiss: () => {} };

vi.mock("../../components/FirstConnectionModal", () => ({
  FirstConnectionModal: (props: {
    open: boolean;
    onContinue: () => void;
    onDismiss: () => void;
  }) => {
    capturedModalProps = props;
    mockModalOnContinue.mockImplementation(props.onContinue);
    mockModalOnDismiss.mockImplementation(props.onDismiss);
    return null;
  },
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

  it("reports disconnected when isConnected mock is false", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );
    localStorage.setItem("pipeline.mock.wallet.isConnected", "false");

    const { result } = renderHook(() => useEvmWallet(), { wrapper });
    expect(result.current.isConnected).toBe(false);
  });

  it("re-renders when isConnected is flipped post-mount", () => {
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    const { result } = renderHook(() => useEvmWallet(), { wrapper });
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

describe("useEvmWallet — connect() with terms gate", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    mockModalOnContinue.mockClear();
    mockModalOnDismiss.mockClear();
  });

  it("opens the gate (modal) and does NOT call open() when ack flag is absent", () => {
    const { result } = renderHook(() => useEvmWallet(), { wrapper });

    act(() => result.current.connect());

    // Gate was opened — modal is open.
    expect(capturedModalProps.open).toBe(true);
    // AppKit was NOT called.
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("calls useAppKit().open() when the ack flag is already set", () => {
    // Simulate pre-existing acknowledgement (no realAddress → use pending key).
    localStorage.setItem("pipeline.wallet.termsAcknowledged.pending", "true");

    const { result } = renderHook(() => useEvmWallet(), { wrapper });

    act(() => result.current.connect());

    // Gate was NOT opened.
    expect(capturedModalProps.open).toBe(false);
    // AppKit was called directly.
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("does NOT call open() and does NOT open gate for mock address (dev affordance)", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );

    const { result } = renderHook(() => useEvmWallet(), { wrapper });

    // Reset capturedModalProps to see if gate is opened.
    capturedModalProps = {
      open: false,
      onContinue: () => {},
      onDismiss: () => {},
    };

    act(() => result.current.connect());

    // Mock short-circuit — neither gate nor AppKit.
    expect(capturedModalProps.open).toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("double connect while gate is open is a no-op (deduplication)", () => {
    const { result } = renderHook(() => useEvmWallet(), { wrapper });

    act(() => result.current.connect());
    expect(capturedModalProps.open).toBe(true);

    // Second click while modal is open.
    act(() => result.current.connect());
    // Still open, no additional side effects.
    expect(capturedModalProps.open).toBe(true);
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
