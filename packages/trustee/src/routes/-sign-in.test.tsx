/**
 * Tests for the Trustee sign-in gate route (Figma node 4174-31660).
 *
 * Rewritten for #791 — the previous version asserted the SignInCard's
 * "Connect Wallet" click was a no-op (the #778/#787-deferred contract). That
 * contract is now inverted: clicking "Connect Wallet" invokes
 * `useTrusteeSession().signIn()`. This suite mocks `useTrusteeSession` (per
 * the exec plan's test strategy) rather than mounting the full wallet/router
 * provider stack, so it stays a focused unit test of the card + route render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Route } from "./sign-in";

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

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
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

describe("Trustee sign-in route", () => {
  it("renders without throwing", () => {
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the sign-in heading and subtext", () => {
    renderRoute();
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
    renderRoute();
    expect(
      screen.getByRole("button", { name: "Connect Wallet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No account? Contact your administrator."),
    ).toBeInTheDocument();
  });

  it("renders the sign-in card and overlay test hooks", () => {
    renderRoute();
    expect(screen.getByTestId("sign-in-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-card")).toBeInTheDocument();
  });

  it("clicking Connect Wallet invokes useTrusteeSession().signIn()", () => {
    renderRoute();

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it("shows a busy state while status is 'connecting'", () => {
    mockSessionState = {
      status: "connecting",
      address: undefined,
      error: undefined,
    };
    renderRoute();

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
    renderRoute();

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
    renderRoute();

    fireEvent.click(
      screen.getByRole("button", { name: "Try a different wallet" }),
    );

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
