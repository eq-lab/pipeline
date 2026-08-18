import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStellarWallet, useStellarConnectors } from "./useStellarWallet";
import {
  _resetStellarConnectionStoreForTests,
  markStellarConnectionHydrated,
  setStellarConnectionAddress,
} from "./connectionStore";

// ── Mock the Stellar kit singleton (./config) ─────────────────────────────────
// vi.hoisted ensures the mock functions are available when vi.mock factory runs,
// because vi.mock is hoisted to the top of the file by Vitest's transform.

const {
  mockAuthModal,
  mockGetAddress,
  mockDisconnect,
  mockSignTransactionKit,
  mockSignMessageKit,
  mockSetWallet,
  mockFetchAddress,
} = vi.hoisted(() => ({
  mockAuthModal: vi.fn(),
  mockGetAddress: vi.fn(),
  mockDisconnect: vi.fn(),
  mockSignTransactionKit: vi.fn(),
  mockSignMessageKit: vi.fn(),
  mockSetWallet: vi.fn(),
  mockFetchAddress: vi.fn(),
}));

vi.mock("./config", () => ({
  StellarWalletsKit: {
    authModal: mockAuthModal,
    getAddress: mockGetAddress,
    disconnect: mockDisconnect,
    signTransaction: mockSignTransactionKit,
    signMessage: mockSignMessageKit,
    setWallet: mockSetWallet,
    fetchAddress: mockFetchAddress,
  },
}));

// ── Mock @creit.tech/stellar-wallets-kit events ───────────────────────────────
// connectionStore.ts subscribes to addressUpdatedEvent and disconnectEvent at
// module load. Provide no-op stub subjects so those subscriptions don't
// interfere with tests (kit events are tested separately via the store).

vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  addressUpdatedEvent: { subscribe: vi.fn() },
  disconnectEvent: { subscribe: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const STELLAR_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const STELLAR_ADDR2 =
  "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RIGPZPD5HJVBBR47WM6A";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useStellarWallet — no mocks, no real wallet", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockDisconnect.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
  });

  afterEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
  });

  it("reports disconnected by default (getAddress rejects)", async () => {
    const { result } = renderHook(() => useStellarWallet(), { wrapper });
    await waitFor(() => {
      expect(result.current.address).toBeUndefined();
    });
    expect(result.current.isConnected).toBe(false);
  });
});

describe("useStellarWallet — localStorage mock", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
    mockGetAddress.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
  });

  afterEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
  });

  it("reports connected when address + isConnected mocks are set", () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);
    localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");

    const { result } = renderHook(() => useStellarWallet(), { wrapper });
    expect(result.current.address).toBe(STELLAR_ADDR);
    expect(result.current.isConnected).toBe(true);
  });
});

describe("useStellarWallet — connect() with no gate mounted (Trustee-style)", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
    mockAuthModal.mockResolvedValue({ address: STELLAR_ADDR });
  });

  afterEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
  });

  it("calls authModal directly — the default no-op gate proceeds immediately", async () => {
    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.connect());

    await waitFor(() => {
      expect(result.current.address).toBe(STELLAR_ADDR);
    });
    expect(mockAuthModal).toHaveBeenCalledTimes(1);
  });

  it("Mock path: connect() is a no-op when mock address is set", () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.connect());

    expect(mockAuthModal).not.toHaveBeenCalled();
  });
});

describe("useStellarWallet — disconnect()", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockDisconnect.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
    mockAuthModal.mockResolvedValue({ address: STELLAR_ADDR2 });
    mockDisconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
  });

  it("calls StellarWalletsKit.disconnect() and clears address on real path", async () => {
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
    _resetStellarConnectionStoreForTests();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockSignTransactionKit.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
  });

  afterEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
  });

  it("real path: delegates to StellarWalletsKit.signTransaction with correct passphrase and address", async () => {
    mockAuthModal.mockResolvedValue({ address: STELLAR_ADDR });
    mockSignTransactionKit.mockResolvedValue({
      signedTxXdr: "signed-xdr",
      signerAddress: STELLAR_ADDR,
    });

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.connect());
    await waitFor(() => expect(result.current.address).toBe(STELLAR_ADDR));

    const signResult = await act(() =>
      result.current.signTransaction("unsigned-xdr"),
    );

    expect(mockSignTransactionKit).toHaveBeenCalledOnce();
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

    expect(mockSignTransactionKit).not.toHaveBeenCalled();
  });
});

describe("useStellarWallet — signMessage()", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockSignMessageKit.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
  });

  afterEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
  });

  it("real path: delegates to StellarWalletsKit.signMessage and returns the base64 signature", async () => {
    mockAuthModal.mockResolvedValue({ address: STELLAR_ADDR });
    mockSignMessageKit.mockResolvedValue({
      signedMessage: "base64signature==",
      signerAddress: STELLAR_ADDR,
    });

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    act(() => result.current.connect());
    await waitFor(() => expect(result.current.address).toBe(STELLAR_ADDR));

    const signResult = await act(() =>
      result.current.signMessage("Welcome to Pipeline!"),
    );

    expect(mockSignMessageKit).toHaveBeenCalledWith(
      "Welcome to Pipeline!",
      expect.objectContaining({ address: STELLAR_ADDR }),
    );
    expect(signResult).toEqual({ signature: "base64signature==" });
  });

  it("mock path: signMessage rejects with the documented mock error", async () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);

    const { result } = renderHook(() => useStellarWallet(), { wrapper });

    await expect(
      act(() => result.current.signMessage("hello")),
    ).rejects.toThrow("signMessage is not mockable");

    expect(mockSignMessageKit).not.toHaveBeenCalled();
  });
});

// ── Tests: useStellarConnectors ───────────────────────────────────────────────

describe("useStellarConnectors — connectWallet calls kit directly", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
    mockGetAddress.mockClear();
    mockSetWallet.mockClear();
    mockFetchAddress.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
    mockFetchAddress.mockResolvedValue({ address: STELLAR_ADDR });
  });

  afterEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
  });

  it("calls setWallet + fetchAddress directly", async () => {
    const { result } = renderHook(() => useStellarConnectors(), { wrapper });

    await act(async () => {
      await result.current.connectWallet("freighter");
    });

    expect(mockSetWallet).toHaveBeenCalledWith("freighter");
    expect(mockFetchAddress).toHaveBeenCalledOnce();
  });

  it("clears a stale hydrated address BEFORE fetching the picked wallet's (#1106 regression)", async () => {
    markStellarConnectionHydrated();
    setStellarConnectionAddress("GSTALEFREIGHTERADDRESS");

    let resolveFetch!: (v: { address: string }) => void;
    mockFetchAddress.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(
      () => ({
        connectors: useStellarConnectors(),
        wallet: useStellarWallet(),
      }),
      { wrapper },
    );
    expect(result.current.wallet.address).toBe("GSTALEFREIGHTERADDRESS");

    let connectPromise!: Promise<void>;
    act(() => {
      connectPromise = result.current.connectors.connectWallet("hana");
    });

    expect(result.current.wallet.address).toBeUndefined();
    expect(result.current.wallet.isConnected).toBe(false);

    await act(async () => {
      resolveFetch({ address: "GHANAADDRESS" });
      await connectPromise;
    });

    expect(result.current.wallet.address).toBe("GHANAADDRESS");
    expect(result.current.wallet.isConnected).toBe(true);
  });

  it("a same-address re-pick still transitions the store (undefined → address), never a silent no-op", async () => {
    markStellarConnectionHydrated();
    setStellarConnectionAddress(STELLAR_ADDR);

    const transitions: Array<string | undefined> = [];
    let resolveFetch!: (v: { address: string }) => void;
    mockFetchAddress.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(
      () => ({
        connectors: useStellarConnectors(),
        wallet: useStellarWallet(),
      }),
      { wrapper },
    );

    let connectPromise!: Promise<void>;
    act(() => {
      connectPromise = result.current.connectors.connectWallet("freighter");
    });
    transitions.push(result.current.wallet.address);

    await act(async () => {
      resolveFetch({ address: STELLAR_ADDR });
      await connectPromise;
    });
    transitions.push(result.current.wallet.address);

    expect(transitions).toEqual([undefined, STELLAR_ADDR]);
  });

  it("mock short-circuit: connectWallet is a no-op when mock address is set", async () => {
    localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);

    const { result } = renderHook(() => useStellarConnectors(), { wrapper });

    await act(async () => {
      await result.current.connectWallet("freighter");
    });

    expect(mockSetWallet).not.toHaveBeenCalled();
    expect(mockFetchAddress).not.toHaveBeenCalled();
  });

  it("invokes onUnavailable callback when kit throws", async () => {
    mockFetchAddress.mockRejectedValueOnce(new Error("wallet unavailable"));
    const onUnavailable = vi.fn();

    const { result } = renderHook(() => useStellarConnectors(), { wrapper });

    await act(async () => {
      await result.current.connectWallet("freighter", onUnavailable);
    });

    expect(onUnavailable).toHaveBeenCalledOnce();
  });
});

// ── Cross-instance propagation tests (regression guard for issue #692) ────────

describe("useStellarWallet — shared store cross-instance propagation", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
    mockGetAddress.mockClear();
    mockAuthModal.mockClear();
    mockDisconnect.mockClear();
    mockGetAddress.mockRejectedValue(new Error("no prior connection"));
    mockDisconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
    _resetStellarConnectionStoreForTests();
  });

  it("connect() on one instance propagates to a second independent instance (regression for #692)", async () => {
    mockAuthModal.mockResolvedValue({ address: STELLAR_ADDR });

    const { result: result1 } = renderHook(() => useStellarWallet(), {
      wrapper,
    });
    const { result: result2 } = renderHook(() => useStellarWallet(), {
      wrapper,
    });

    act(() => result1.current.connect());

    await waitFor(() => {
      expect(result1.current.address).toBe(STELLAR_ADDR);
    });
    expect(result2.current.address).toBe(STELLAR_ADDR);
    expect(result2.current.isConnected).toBe(true);
  });
});
