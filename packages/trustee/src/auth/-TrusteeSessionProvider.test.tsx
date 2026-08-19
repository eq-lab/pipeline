/**
 * Unit tests for `TrusteeSessionProvider` / `useTrusteeSession()` (#791, plus
 * the #793/#794/#795 follow-ups).
 *
 * Covers the exec plan's test strategy:
 *   - Initial state is `unauthenticated`.
 *   - `signIn()` ALWAYS opens the connect modal, then once the user's
 *     explicitly-picked chain connects, drives challenge → sign → verify →
 *     `authenticated`, storing a token (verified via the session store) —
 *     with NO navigation (#1008: the shell swaps the overlay in place).
 *   - `401` on the challenge → `unauthorized` with an explanatory error.
 *   - The user rejecting the signature → back to `unauthenticated`, no error.
 *   - `signOut()` clears the token, disconnects both wallets, and navigates
 *     to `/sign-in` (URL convention — the overlay gate doesn't depend on it).
 *   - Hydration from an existing valid token → `authenticated` (covered by
 *     `-sessionStore.test.ts`; this file focuses on the orchestration).
 *   - (#793) Cancelling the connect modal (no wallet chosen) resets `status`
 *     back to `unauthenticated` — no more stuck "Connecting…".
 *   - (#794/#1106) A Stellar pick drives the challenge with the freshly
 *     fetched `G…` address and `STELLAR_CHAIN_ID` — never the ambient
 *     (possibly stale-hydrated, different-wallet) address.
 *   - (#795) `signIn()` ALWAYS opens the modal, even when a wallet (e.g. an
 *     auto-reconnected/persisted EVM session) is already connected — ambient
 *     connection state never auto-signs or skips the picker. Only the user's
 *     explicit `onModalWalletSelect` pick drives the flow.
 *
 * Wallet hooks (`useEvmWallet`, `useStellarWallet`, `useConnectModal`) and
 * the auth API wrappers are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  TrusteeSessionProvider,
  useTrusteeSession,
} from "./TrusteeSessionProvider";
import { _resetSessionStoreForTests, getSessionToken } from "./sessionStore";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const mockOpenConnectModal = vi.fn();
let evmState = { isConnected: false, address: undefined as string | undefined };
let stellarState = {
  isConnected: false,
  address: undefined as string | undefined,
};
const mockEvmSignMessage = vi.fn();
const mockStellarSignMessage = vi.fn();
const mockEvmDisconnect = vi.fn();
const mockStellarDisconnect = vi.fn();

// Captured subscribers so tests can simulate the modal firing `onCancel` /
// `onWalletSelect`, mirroring `ConnectModalProvider`'s real contract.
let cancelListeners: Array<() => void> = [];
let walletSelectListeners: Array<(chain: "evm" | "soroban") => void> = [];

function fireModalCancel() {
  cancelListeners.forEach((l) => l());
}

function fireModalWalletSelect(chain: "evm" | "soroban") {
  walletSelectListeners.forEach((l) => l(chain));
}

vi.mock("@pipeline/wallet-connect", () => ({
  useEvmWallet: () => ({
    ...evmState,
    signMessage: mockEvmSignMessage,
    disconnect: mockEvmDisconnect,
  }),
  useStellarWallet: () => ({
    ...stellarState,
    signMessage: mockStellarSignMessage,
    disconnect: mockStellarDisconnect,
  }),
  useConnectModal: () => ({
    open: mockOpenConnectModal,
    close: vi.fn(),
    onCancel: (listener: () => void) => {
      cancelListeners.push(listener);
      return () => {
        cancelListeners = cancelListeners.filter((l) => l !== listener);
      };
    },
    onWalletSelect: (listener: (chain: "evm" | "soroban") => void) => {
      walletSelectListeners.push(listener);
      return () => {
        walletSelectListeners = walletSelectListeners.filter(
          (l) => l !== listener,
        );
      };
    },
  }),
}));

const mockGetAuthChallenge = vi.fn();
const mockPostAuthVerify = vi.fn();
vi.mock("@/api/auth", () => ({
  getAuthChallenge: (...args: unknown[]) => mockGetAuthChallenge(...args),
  postAuthVerify: (...args: unknown[]) => mockPostAuthVerify(...args),
}));

vi.mock("@/lib/env", () => ({
  ENV: { EVM_CHAIN_ID: 560048, STELLAR_CHAIN_ID: 99000001 },
}));

class ApiUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnauthorizedError";
  }
}

// ── Test harness ──────────────────────────────────────────────────────────────

function Probe() {
  const session = useTrusteeSession();
  return (
    <div>
      <span data-testid="status">{session.status}</span>
      <span data-testid="address">{session.address ?? ""}</span>
      <span data-testid="error">{session.error ?? ""}</span>
      <button onClick={session.signIn}>sign in</button>
      <button onClick={session.signOut}>sign out</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <TrusteeSessionProvider>
      <Probe />
    </TrusteeSessionProvider>,
  );
}

beforeEach(() => {
  _resetSessionStoreForTests();
  mockNavigate.mockClear();
  mockOpenConnectModal.mockClear();
  mockEvmSignMessage.mockReset();
  mockStellarSignMessage.mockReset();
  mockEvmDisconnect.mockClear();
  mockStellarDisconnect.mockClear();
  mockGetAuthChallenge.mockReset();
  mockPostAuthVerify.mockReset();
  evmState = { isConnected: false, address: undefined };
  stellarState = { isConnected: false, address: undefined };
  cancelListeners = [];
  walletSelectListeners = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TrusteeSessionProvider — initial state", () => {
  it("starts unauthenticated", () => {
    renderProvider();
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
  });
});

describe("TrusteeSessionProvider — signIn() happy path (EVM)", () => {
  it("opens the connect modal, then drives challenge -> sign -> verify -> authenticated after the user picks EVM", async () => {
    mockGetAuthChallenge.mockResolvedValue({
      message: "Welcome to Pipeline! ...",
      nonce: "n1",
    });
    mockEvmSignMessage.mockResolvedValue({ signature: "0xdeadbeef" });
    mockPostAuthVerify.mockResolvedValue({
      token: "jwt-token",
      expiresIn: 86400,
    });

    const { rerender } = renderProvider();

    act(() => screen.getByText("sign in").click());

    expect(mockOpenConnectModal).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");

    // The user explicitly picks the EVM tab in the modal.
    act(() => fireModalWalletSelect("evm"));

    // Simulate the wallet connecting after the pick, then force a re-render
    // so the mocked `useEvmWallet()` is re-invoked with the new module-level
    // state (the real hook would re-render reactively on its own).
    evmState = { isConnected: true, address: "0xabc" };
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );

    await waitFor(() => {
      expect(mockPostAuthVerify).toHaveBeenCalled();
    });

    expect(mockGetAuthChallenge).toHaveBeenCalledWith("0xabc", 560048);
    expect(mockEvmSignMessage).toHaveBeenCalledWith("Welcome to Pipeline! ...");
    expect(mockPostAuthVerify).toHaveBeenCalledWith({
      chainId: 560048,
      address: "0xabc",
      signature: "0xdeadbeef",
    });

    await waitFor(() => {
      expect(getSessionToken()).toBe("jwt-token");
    });
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    // (#1008) Sign-IN never navigates — the shell swaps the overlay for the
    // app on the same URL. (Only signOut resets the URL, cosmetically.)
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("TrusteeSessionProvider — 401 on challenge", () => {
  it("sets status to unauthorized with an explanatory error", async () => {
    mockGetAuthChallenge.mockRejectedValue(
      new ApiUnauthorizedError("address is not authorized"),
    );
    evmState = { isConnected: true, address: "0xabc" };

    renderProvider();
    act(() => screen.getByText("sign in").click());
    act(() => fireModalWalletSelect("evm"));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("unauthorized");
    });
    expect(screen.getByTestId("error")).toHaveTextContent(
      "This wallet is not authorized to sign in.",
    );
    expect(mockPostAuthVerify).not.toHaveBeenCalled();
  });
});

describe("TrusteeSessionProvider — signature rejected", () => {
  it("returns to unauthenticated without an error when the user rejects the signature", async () => {
    mockGetAuthChallenge.mockResolvedValue({ message: "msg", nonce: "n1" });
    mockEvmSignMessage.mockRejectedValue(new Error("user rejected"));
    evmState = { isConnected: true, address: "0xabc" };

    renderProvider();
    act(() => screen.getByText("sign in").click());
    act(() => fireModalWalletSelect("evm"));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
    });
    expect(screen.getByTestId("error")).toHaveTextContent("");
    expect(mockPostAuthVerify).not.toHaveBeenCalled();
  });

  it("surfaces an explanatory error — not silence — when the wallet cannot sign messages (#1112)", async () => {
    mockGetAuthChallenge.mockResolvedValue({ message: "msg", nonce: "n1" });
    mockStellarSignMessage.mockRejectedValue({
      code: -3,
      message: 'Rabet does not support the "signMessage" function',
    });
    stellarState = { isConnected: true, address: "GRABETADDRESS" };

    const { rerender } = renderProvider();
    act(() => screen.getByText("sign in").click());
    act(() => fireModalWalletSelect("soroban"));
    stellarState = { isConnected: false, address: undefined };
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );
    stellarState = { isConnected: true, address: "GRABETADDRESS" };
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("unauthorized");
    });
    expect(screen.getByTestId("error")).toHaveTextContent(
      "This wallet cannot sign authentication messages",
    );
    expect(mockPostAuthVerify).not.toHaveBeenCalled();
  });
});

describe("TrusteeSessionProvider — 401 on verify", () => {
  it("sets status to unauthorized with a verification-failed error", async () => {
    mockGetAuthChallenge.mockResolvedValue({ message: "msg", nonce: "n1" });
    mockEvmSignMessage.mockResolvedValue({ signature: "0xsig" });
    mockPostAuthVerify.mockRejectedValue(
      new ApiUnauthorizedError("signature verification failed"),
    );
    evmState = { isConnected: true, address: "0xabc" };

    renderProvider();
    act(() => screen.getByText("sign in").click());
    act(() => fireModalWalletSelect("evm"));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("unauthorized");
    });
    expect(screen.getByTestId("error")).toHaveTextContent(
      "Sign-in verification failed",
    );
  });
});

describe("TrusteeSessionProvider — signOut()", () => {
  it("clears the token, disconnects connected wallets, and navigates to /sign-in", () => {
    evmState = { isConnected: true, address: "0xabc" };
    renderProvider();

    act(() => screen.getByText("sign out").click());

    expect(getSessionToken()).toBeUndefined();
    expect(mockEvmDisconnect).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/sign-in" });
  });

  it("disconnects BOTH wallets when both are connected, so no stale connection lingers", () => {
    evmState = { isConnected: true, address: "0xabc" };
    stellarState = { isConnected: true, address: "GBOTHCONNECTED" };
    renderProvider();

    act(() => screen.getByText("sign out").click());

    expect(mockEvmDisconnect).toHaveBeenCalledTimes(1);
    expect(mockStellarDisconnect).toHaveBeenCalledTimes(1);
  });
});

// ── #793 — modal dismissed without connecting ──────────────────────────────────

describe("TrusteeSessionProvider — modal cancelled (#793)", () => {
  it("resets status to unauthenticated when the modal is cancelled with no wallet chosen", async () => {
    renderProvider();

    act(() => screen.getByText("sign in").click());

    expect(mockOpenConnectModal).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");

    // Simulate the user dismissing the modal (Escape / × button) without
    // picking a wallet — `ConnectModalProvider` fires `onCancel` in this case.
    act(() => fireModalCancel());

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
    });
    expect(mockGetAuthChallenge).not.toHaveBeenCalled();
  });

  it("does not get stuck on Connecting… across repeated open/cancel cycles", async () => {
    renderProvider();

    for (let i = 0; i < 2; i += 1) {
      act(() => screen.getByText("sign in").click());
      expect(screen.getByTestId("status")).toHaveTextContent("connecting");

      act(() => fireModalCancel());
      await waitFor(() => {
        expect(screen.getByTestId("status")).toHaveTextContent(
          "unauthenticated",
        );
      });
    }
  });

  it("a cancel signal after a successful sign-in does not clobber the authenticated state", async () => {
    mockGetAuthChallenge.mockResolvedValue({ message: "msg", nonce: "n1" });
    mockEvmSignMessage.mockResolvedValue({ signature: "0xsig" });
    mockPostAuthVerify.mockResolvedValue({
      token: "jwt-token",
      expiresIn: 86400,
    });
    evmState = { isConnected: true, address: "0xabc" };

    renderProvider();
    act(() => screen.getByText("sign in").click());
    act(() => fireModalWalletSelect("evm"));

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
    });

    // A stray cancel signal (e.g. a late modal-close event) must not revert
    // an already-authenticated session — the effect only resets state that
    // is still "connecting".
    act(() => fireModalCancel());
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
  });
});

// ── #794 — Stellar wallet drives the flow when explicitly picked ──────────────

describe("TrusteeSessionProvider — Stellar connect via explicit modal pick (#794)", () => {
  it("drives the challenge with the Stellar G… address and STELLAR_CHAIN_ID after the user picks Soroban and Freighter connects", async () => {
    mockGetAuthChallenge.mockResolvedValue({
      message: "Welcome to Pipeline! ...",
      nonce: "n1",
    });
    mockStellarSignMessage.mockResolvedValue({ signature: "c3RlbGxhcg==" });
    mockPostAuthVerify.mockResolvedValue({
      token: "jwt-token-stellar",
      expiresIn: 86400,
    });

    const { rerender } = renderProvider();
    act(() => screen.getByText("sign in").click());
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");

    act(() => fireModalWalletSelect("soroban"));

    stellarState = {
      isConnected: true,
      address: "GABCDEXAMPLEFREIGHTERADDRESS",
    };
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );

    await waitFor(() => {
      expect(mockPostAuthVerify).toHaveBeenCalled();
    });

    expect(mockGetAuthChallenge).toHaveBeenCalledWith(
      "GABCDEXAMPLEFREIGHTERADDRESS",
      99000001,
    );
    expect(mockPostAuthVerify).toHaveBeenCalledWith({
      chainId: 99000001,
      address: "GABCDEXAMPLEFREIGHTERADDRESS",
      signature: "c3RlbGxhcg==",
    });

    await waitFor(() => {
      expect(getSessionToken()).toBe("jwt-token-stellar");
    });
  });
});

describe("TrusteeSessionProvider — pre-connected wallet picked explicitly in the modal (#794/#1106)", () => {
  it("#1106 regression: a stale hydrated Stellar address never drives the challenge — sign-in waits for the freshly picked wallet's address", async () => {
    mockGetAuthChallenge.mockResolvedValue({ message: "msg", nonce: "n1" });
    mockStellarSignMessage.mockResolvedValue({ signature: "c3RlbGxhcg==" });
    mockPostAuthVerify.mockResolvedValue({ token: "jwt", expiresIn: 86400 });
    stellarState = { isConnected: true, address: "GSTALEFREIGHTERADDRESS" };

    const { rerender } = renderProvider();
    act(() => screen.getByText("sign in").click());

    // The modal always opens, even with a wallet already connected (#795).
    expect(mockOpenConnectModal).toHaveBeenCalledTimes(1);
    expect(mockGetAuthChallenge).not.toHaveBeenCalled();

    act(() => fireModalWalletSelect("soroban"));
    expect(mockGetAuthChallenge).not.toHaveBeenCalled();

    stellarState = { isConnected: false, address: undefined };
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );
    expect(mockGetAuthChallenge).not.toHaveBeenCalled();

    stellarState = { isConnected: true, address: "GHANAFRESHADDRESS" };
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );

    await waitFor(() => {
      expect(mockGetAuthChallenge).toHaveBeenCalledWith(
        "GHANAFRESHADDRESS",
        99000001,
      );
    });
    expect(mockGetAuthChallenge).not.toHaveBeenCalledWith(
      "GSTALEFREIGHTERADDRESS",
      99000001,
    );
  });

  it("does not hard-prefer EVM when both wallets are already connected — waits for the user's modal pick, then the fresh Stellar re-fetch", async () => {
    mockGetAuthChallenge.mockResolvedValue({ message: "msg", nonce: "n1" });
    mockStellarSignMessage.mockResolvedValue({ signature: "c3RlbGxhcg==" });
    mockEvmSignMessage.mockResolvedValue({ signature: "0xsig" });
    mockPostAuthVerify.mockResolvedValue({ token: "jwt", expiresIn: 86400 });
    evmState = { isConnected: true, address: "0xabc" };
    stellarState = { isConnected: true, address: "GBOTHCONNECTED" };

    const { rerender } = renderProvider();
    act(() => screen.getByText("sign in").click());

    // Both chains are already connected — the modal opens and neither
    // ambient connection auto-signs.
    expect(mockOpenConnectModal).toHaveBeenCalledTimes(1);
    expect(mockGetAuthChallenge).not.toHaveBeenCalled();

    act(() => fireModalWalletSelect("soroban"));
    expect(mockGetAuthChallenge).not.toHaveBeenCalled();

    stellarState = { isConnected: false, address: undefined };
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );
    stellarState = { isConnected: true, address: "GBOTHCONNECTED" };
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );

    await waitFor(() => {
      expect(mockGetAuthChallenge).toHaveBeenCalledWith(
        "GBOTHCONNECTED",
        99000001,
      );
    });
    expect(mockEvmSignMessage).not.toHaveBeenCalled();
  });

  it("drives EVM when the user picks the EVM tab with both wallets already connected", async () => {
    mockGetAuthChallenge.mockResolvedValue({ message: "msg", nonce: "n1" });
    mockEvmSignMessage.mockResolvedValue({ signature: "0xsig" });
    mockPostAuthVerify.mockResolvedValue({ token: "jwt", expiresIn: 86400 });
    evmState = { isConnected: true, address: "0xabc" };
    stellarState = { isConnected: true, address: "GBOTHCONNECTED" };

    renderProvider();
    act(() => screen.getByText("sign in").click());
    expect(mockOpenConnectModal).toHaveBeenCalledTimes(1);

    act(() => fireModalWalletSelect("evm"));

    await waitFor(() => {
      expect(mockGetAuthChallenge).toHaveBeenCalledWith("0xabc", 560048);
    });
    expect(mockStellarSignMessage).not.toHaveBeenCalled();
  });
});

// ── #795 — signIn() always opens the modal; ambient state never hijacks ───────

describe("TrusteeSessionProvider — signIn() always opens the modal (#795)", () => {
  it("opens the modal even when exactly one wallet (e.g. an auto-reconnected/persisted EVM session) is already connected", () => {
    // Simulates wagmi restoring a persisted EVM connection on page load,
    // before the user ever clicks "Connect Wallet".
    evmState = { isConnected: true, address: "0xpersisted" };

    renderProvider();
    act(() => screen.getByText("sign in").click());

    expect(mockOpenConnectModal).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");
    // No sign-in kicked off automatically from the ambient connection.
    expect(mockGetAuthChallenge).not.toHaveBeenCalled();
    expect(mockEvmSignMessage).not.toHaveBeenCalled();
  });

  it("does not auto-sign with a pre-connected EVM wallet even if it later re-renders while the modal is open", async () => {
    evmState = { isConnected: true, address: "0xpersisted" };

    const { rerender } = renderProvider();
    act(() => screen.getByText("sign in").click());
    expect(mockOpenConnectModal).toHaveBeenCalledTimes(1);

    // A re-render (e.g. an unrelated state change) must not cause the watch
    // effect to pick up the already-connected EVM wallet — no chain has been
    // explicitly picked yet.
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGetAuthChallenge).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");
  });

  it("signs in with the explicitly-picked Freighter (Soroban) wallet even when an ambient EVM connection is present", async () => {
    mockGetAuthChallenge.mockResolvedValue({ message: "msg", nonce: "n1" });
    mockStellarSignMessage.mockResolvedValue({ signature: "c3RlbGxhcg==" });
    mockPostAuthVerify.mockResolvedValue({ token: "jwt", expiresIn: 86400 });
    // Ambient/auto-reconnected EVM wallet present at page load.
    evmState = { isConnected: true, address: "0xpersisted" };

    const { rerender } = renderProvider();
    act(() => screen.getByText("sign in").click());
    expect(mockOpenConnectModal).toHaveBeenCalledTimes(1);

    // The user explicitly picks Freighter/Soroban in the picker.
    act(() => fireModalWalletSelect("soroban"));
    stellarState = { isConnected: true, address: "GEXPLICITPICK" };
    rerender(
      <TrusteeSessionProvider>
        <Probe />
      </TrusteeSessionProvider>,
    );

    await waitFor(() => {
      expect(mockGetAuthChallenge).toHaveBeenCalledWith(
        "GEXPLICITPICK",
        99000001,
      );
    });
    expect(mockEvmSignMessage).not.toHaveBeenCalled();
  });
});
