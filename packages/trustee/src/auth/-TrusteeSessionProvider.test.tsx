/**
 * Unit tests for `TrusteeSessionProvider` / `useTrusteeSession()` (#791).
 *
 * Covers the exec plan's test strategy:
 *   - Initial state is `unauthenticated`.
 *   - `signIn()` happy path: opens the connect modal, then once a wallet
 *     connects, drives challenge → sign → verify → `authenticated`, storing
 *     a token (verified via the session store) and redirecting to `/`.
 *   - `401` on the challenge → `unauthorized` with an explanatory error.
 *   - The user rejecting the signature → back to `unauthenticated`, no error.
 *   - `signOut()` clears the token and disconnects, then navigates to `/sign-in`.
 *   - Hydration from an existing valid token → `authenticated` (covered by
 *     `-sessionStore.test.ts`; this file focuses on the orchestration).
 *
 * Wallet hooks (`useEvmWallet`, `useStellarWallet`, `useConnectModal`) and
 * the auth API wrappers are mocked; `useNavigate` is mocked to capture
 * redirects without needing a real router tree.
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
  useConnectModal: () => ({ open: mockOpenConnectModal }),
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
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TrusteeSessionProvider — initial state", () => {
  it("starts unauthenticated", () => {
    renderProvider();
    expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
  });
});

describe("TrusteeSessionProvider — signIn() happy path (EVM)", () => {
  it("opens the connect modal, then drives challenge -> sign -> verify -> authenticated", async () => {
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

    // Simulate the wallet connecting after the modal opens, then force a
    // re-render so the mocked `useEvmWallet()` is re-invoked with the new
    // module-level state (the real hook would re-render reactively on its own).
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
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
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

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated");
    });
    expect(screen.getByTestId("error")).toHaveTextContent("");
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
});
