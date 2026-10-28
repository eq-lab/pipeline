// spec: docs/frontend/trustee-flows.md#render-level-auth-gate-1008-1749
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrusteeShell } from "./TrusteeShell";

let mockStatus:
  | "unauthenticated"
  | "connecting"
  | "authenticated"
  | "unauthorized" = "unauthenticated";

vi.mock("@/auth/TrusteeSessionProvider", () => ({
  useTrusteeSession: () => ({
    status: mockStatus,
    address: undefined,
    error: undefined,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock("@/components/TrusteeSidebar", () => ({
  TrusteeSidebar: () => <div data-testid="sidebar" />,
}));

beforeEach(() => {
  mockStatus = "unauthenticated";
});

describe("TrusteeShell auth gate", () => {
  it("renders the sign-in overlay (and no route content) while unauthenticated", () => {
    render(<TrusteeShell />);
    expect(screen.getByTestId("sign-in-overlay")).toBeInTheDocument();
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
  });

  it("renders the overlay for the connecting and unauthorized states too", () => {
    for (const status of ["connecting", "unauthorized"] as const) {
      mockStatus = status;
      const { unmount } = render(<TrusteeShell />);
      expect(screen.getByTestId("sign-in-overlay")).toBeInTheDocument();
      expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("renders the sidebar + outlet (and no overlay) when authenticated", () => {
    mockStatus = "authenticated";
    render(<TrusteeShell />);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.queryByTestId("sign-in-overlay")).not.toBeInTheDocument();
  });
});
