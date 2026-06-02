import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStellarWallet } from "./useStellarWallet";
import { WalletGateProvider } from "../WalletGateProvider";

// ── Mock the Stellar kit singleton (./config) ─────────────────────────────────
// vi.hoisted ensures the mock functions are available when vi.mock factory runs,
// because vi.mock is hoisted to the top of the file by Vitest's transform.

const {
  mockAuthModal,
  mockGetAddress,
  mockDisconnect,
  mockSignTransactionKit,
} = vi.hoisted(() => ({
  mockAuthModal: vi.fn(),
  mockGetAddress: vi.fn(),
  mockDisconnect: vi.fn(),
  mockSignTransactionKit: vi.fn(),
}));

vi.mock("./config", () => ({
  StellarWalletsKit: {
    authModal: mockAuthModal,
    getAddress: mockGetAddress,
    disconnect: mockDisconnect,
    signTransaction: mockSignTransactionKit,
  },
}));

// ── Mock FirstConnectionModal ─────────────────────────────────────────────────

let capturedModalProps: {
  open: boolean;
  onContinue: () => void;
  onDismiss: () => void;
} = { open: false, onContinue: () => {}, onDismiss: () => {} };

const mockModalOnContinue = vi.fn();
const mockModalOnDismiss = vi.fn();

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

// ── Wrapper ───────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return <WalletGateProvider>{children}</WalletGateProvider>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STELLAR_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const STELLAR_ADDR2 =
  "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RIGPZPD5HJVBBR47WM6A";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useStellarWallet — no mocks, no real wallet", () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockDisconnect.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
    capturedModalProps = {
      open: false,
      onContinue: () => {},
      onDismiss: () => {},
    };
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("reports disconnected by default (getAddress rejects)", async () => {
    const { result } = renderHook(() => useStellarWallet(), { wrapper });
    await waitFor(() => {
      // Give the async getAddress call time to settle.
      expect(result.current.address).toBeUndefined();
    });
    expect(result.current.isConnected).toBe(false);
  });
});

describe("useStellarWallet — localStorage mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockDisconnect.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
    capturedModalProps = {
      open: false,
      onContinue: () => {},
      onDismiss: () => {},
    };
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("reports connected when address + isConnected mocks are set", () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);
    localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");

    const { result } = renderHook(() => useStellarWallet(), { wrapper });
    expect(result.current.address).toBe(STELLAR_ADDR);
    expect(result.current.isConnected).toBe(true);
  });

  it("defaults isConnected to true when only address is set", () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);

    const { result } = renderHook(() => useStellarWallet(), { wrapper });
    expect(result.current.isConnected).toBe(true);
  });

  it("reports disconnected when isConnected mock is 'false'", () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);
    localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "false");

    const { result } = renderHook(() => useStellarWallet(), { wrapper });
    expect(result.current.isConnected).toBe(false);
  });

  it("re-renders when isConnected is flipped post-mount", () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
    const { result } = renderHook(() => useStellarWallet(), { wrapper });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "false");
      window.dispatchEvent(
        new CustomEvent("pipeline-mock:wallet", {
          detail: { key: "pipeline.mock.wallet.stellar.isConnected" },
        }),
      );
    });

    expect(result.current.isConnected).toBe(false);
  });
});

describe("useStellarWallet — connect() with terms gate", () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockDisconnect.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
    mockAuthModal.mockResolvedValue({ address: STELLAR_ADDR });
    mockDisconnect.mockResolvedValue(undefined);
    mockModalOnContinue.mockClear();
    mockModalOnDismiss.mockClear();
    capturedModalProps = {
      open: false,
      onContinue: () => {},
      onDismiss: () => {},
    };
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Gated path: opens the gate when terms are NOT acknowledged", async () => {
    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.connect());

    // Gate should be open, authModal NOT called directly.
    expect(capturedModalProps.open).toBe(true);
    expect(mockAuthModal).not.toHaveBeenCalled();
  });

  it("Gated path: invoking onProceed from gate calls authModal and stores address", async () => {
    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.connect());
    expect(capturedModalProps.open).toBe(true);

    // User clicks Continue — this invokes handleContinue in WalletGateProvider.
    act(() => mockModalOnContinue());

    await waitFor(() => {
      expect(result.current.address).toBe(STELLAR_ADDR);
    });
    expect(mockAuthModal).toHaveBeenCalledTimes(1);
  });

  it("Pre-acknowledged path: when flat ack flag is set, connect() calls authModal directly", async () => {
    localStorage.setItem("pipeline.wallet.termsAcknowledged", "true");

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.connect());

    // Gate NOT opened.
    expect(capturedModalProps.open).toBe(false);

    await waitFor(() => {
      expect(result.current.address).toBe(STELLAR_ADDR);
    });
    expect(mockAuthModal).toHaveBeenCalledTimes(1);
  });

  it("Mock path: connect() is a no-op when mock address is set (neither gate nor authModal)", () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    capturedModalProps = {
      open: false,
      onContinue: () => {},
      onDismiss: () => {},
    };

    act(() => result.current.connect());

    expect(capturedModalProps.open).toBe(false);
    expect(mockAuthModal).not.toHaveBeenCalled();
  });

  it("double connect while gate is open is a no-op (deduplication)", () => {
    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.connect());
    expect(capturedModalProps.open).toBe(true);

    act(() => result.current.connect());
    expect(capturedModalProps.open).toBe(true);
    expect(mockAuthModal).not.toHaveBeenCalled();
  });
});

describe("useStellarWallet — disconnect()", () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockDisconnect.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
    mockAuthModal.mockResolvedValue({ address: STELLAR_ADDR2 });
    mockDisconnect.mockResolvedValue(undefined);
    capturedModalProps = {
      open: false,
      onContinue: () => {},
      onDismiss: () => {},
    };
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("calls StellarWalletsKit.disconnect() and clears address on real path", async () => {
    // First connect to set an address.
    localStorage.setItem("pipeline.wallet.termsAcknowledged", "true");

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.connect());
    await waitFor(() => expect(result.current.address).toBe(STELLAR_ADDR2));

    act(() => result.current.disconnect());

    await waitFor(() => expect(result.current.address).toBeUndefined());
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnect() is a no-op + console warning on mock path", () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.disconnect());

    expect(mockDisconnect).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });
});

describe("useStellarWallet — signTransaction()", () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockDisconnect.mockClear();
    mockSignTransactionKit.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("real path: delegates to StellarWalletsKit.signTransaction with correct passphrase and address", async () => {
    // Pre-set terms so connect() calls authModal directly.
    localStorage.setItem("pipeline.wallet.termsAcknowledged", "true");
    mockAuthModal.mockResolvedValue({ address: STELLAR_ADDR });
    mockSignTransactionKit.mockResolvedValue({
      signedTxXdr: "signed-xdr",
      signerAddress: STELLAR_ADDR,
    });

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    // Connect to get an address.
    act(() => result.current.connect());
    await waitFor(() => expect(result.current.address).toBe(STELLAR_ADDR));

    // Call signTransaction.
    const signResult = await act(() =>
      result.current.signTransaction("unsigned-xdr"),
    );

    expect(mockSignTransactionKit).toHaveBeenCalledOnce();
    const firstCall = mockSignTransactionKit.mock.calls[0];
    const calledXdr = firstCall?.[0];
    const calledOpts = firstCall?.[1];
    expect(calledXdr).toBe("unsigned-xdr");
    expect(typeof calledOpts?.networkPassphrase).toBe("string");
    expect(signResult).toEqual({
      signedTxXdr: "signed-xdr",
      signerAddress: STELLAR_ADDR,
    });
  });

  it("mock path: signTransaction rejects with the documented mock error", async () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    await expect(
      act(() => result.current.signTransaction("some-xdr")),
    ).rejects.toThrow("signTransaction is not mockable");

    // Kit.signTransaction should NOT be called on mock path.
    expect(mockSignTransactionKit).not.toHaveBeenCalled();
  });
});
