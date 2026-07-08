/**
 * Smoke test for the Trustee sign-in gate route (Figma node 4174-31660).
 * UI-only (Issue #787) — asserts the overlay/card renders, the copy and
 * "Connect Wallet" CTA are present, and clicking Connect Wallet performs no
 * navigation/network side effect (the no-op contract tied to #778).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Route } from "./sign-in";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

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

  it("clicking Connect Wallet is a no-op (no throw, no navigation)", () => {
    renderRoute();
    const navSpy = vi.fn();
    window.addEventListener("popstate", navSpy);

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" })),
    ).not.toThrow();

    expect(navSpy).not.toHaveBeenCalled();
    window.removeEventListener("popstate", navSpy);
  });

  it("renders the sign-in card and overlay test hooks", () => {
    renderRoute();
    expect(screen.getByTestId("sign-in-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-card")).toBeInTheDocument();
  });
});
