/**
 * Tests for the Trustee sign-in gate overlay (Figma node 4174-31660).
 *
 * Moved from the retired `/sign-in` route (#1008): the gate is now
 * `SignInOverlay`, rendered by `TrusteeShell` on the current URL whenever the
 * session is not authenticated (render-level gate; /sign-in remains only as the
 * canonical logged-out URL). This suite mocks
 * `useTrusteeSession` rather than mounting the full wallet/router provider
 * stack, so it stays a focused unit test of the card + overlay render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SignInOverlay } from "./SignInOverlay";

const mockSignIn = vi.fn();
const mockSignOut = vi.fn();

let mockSessionState: {
  status: "unauthenticated" | "connecting" | "authenticated" | "unauthorized";
  address: string | undefined;
  error: string | undefined;
} = { status: "unauthenticated", address: undefined, error: undefined };

vi.mock("@/auth/TrusteeSessionProvider", () => ({
  useTrusteeSession: () => ({
    ...mockSessionState,
    signIn: mockSignIn,
    signOut: mockSignOut,
  }),
}));

function renderOverlay() {
  return render(<SignInOverlay />);
}

beforeEach(() => {
  mockSignIn.mockClear();
  mockSignOut.mockClear();
  mockSessionState = {
    status: "unauthenticated",
    address: undefined,
    error: undefined,
  };
});

describe("Trustee sign-in overlay", () => {
  it("renders without throwing", () => {
    expect(() => renderOverlay()).not.toThrow();
  });

  it("shows the sign-in heading and subtext", () => {
    renderOverlay();
    expect(
      screen.getByRole("heading", { name: "Sign in to access Pipeline" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Connect your wallet to unlock the dashboard, metrics, and deal activity.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the Connect Wallet button and footer caption", () => {
    renderOverlay();
    expect(
      screen.getByRole("button", { name: "Connect Wallet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No account? Contact your administrator."),
    ).toBeInTheDocument();
  });

  it("renders the sign-in card and overlay test hooks", () => {
    renderOverlay();
    expect(screen.getByTestId("sign-in-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-card")).toBeInTheDocument();
  });

  it("clicking Connect Wallet invokes useTrusteeSession().signIn()", () => {
    renderOverlay();

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it("shows a busy state while status is 'connecting'", () => {
    mockSessionState = {
      status: "connecting",
      address: undefined,
      error: undefined,
    };
    renderOverlay();

    const button = screen.getByRole("button", { name: "Connecting…" });
    expect(button).toBeDisabled();
  });

  it("renders the 'not authorized' error state on status 'unauthorized'", () => {
    mockSessionState = {
      status: "unauthorized",
      address: undefined,
      error:
        "This wallet is not authorized to sign in. Contact your administrator.",
    };
    renderOverlay();

    expect(screen.getByTestId("sign-in-error")).toHaveTextContent(
      "This wallet is not authorized to sign in. Contact your administrator.",
    );
    expect(
      screen.getByRole("button", { name: "Try a different wallet" }),
    ).toBeInTheDocument();
  });

  it("clicking the retry action on the unauthorized state calls signOut()", () => {
    mockSessionState = {
      status: "unauthorized",
      address: undefined,
      error:
        "This wallet is not authorized to sign in. Contact your administrator.",
    };
    renderOverlay();

    fireEvent.click(
      screen.getByRole("button", { name: "Try a different wallet" }),
    );

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
