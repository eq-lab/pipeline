/**
 * Unit tests for `RouteGate` — the single source of truth for the Trustee
 * app's auth redirects (#791, hardened in #921).
 *
 * #921: `RouteGate` alone decides whether to redirect based on
 * `useTrusteeSession().status` and the current path — the session provider no
 * longer imperatively navigates on sign-in, which used to race this gate and
 * strand the URL on `/sign-in` (dashboard + sign-in overlay both mounted).
 * These tests pin the four decision branches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SessionStatus } from "./sessionStore";
import { RouteGate } from "./RouteGate";

let mockStatus: SessionStatus = "unauthenticated";
let mockPathname = "/sign-in";

vi.mock("./TrusteeSessionProvider", () => ({
  useTrusteeSession: () => ({ status: mockStatus }),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: mockPathname }),
  // Render the redirect target as exact text so tests can assert direction.
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  Outlet: () => <div data-testid="outlet" />,
}));

function renderGate(status: SessionStatus, pathname: string) {
  mockStatus = status;
  mockPathname = pathname;
  return render(<RouteGate />);
}

beforeEach(() => {
  mockStatus = "unauthenticated";
  mockPathname = "/sign-in";
});

describe("RouteGate — auth redirect decisions (#921)", () => {
  it("redirects an authenticated visitor OFF /sign-in to /", () => {
    renderGate("authenticated", "/sign-in");
    expect(screen.getByTestId("navigate").textContent).toBe("/");
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("redirects an unauthenticated visitor on a protected route to /sign-in", () => {
    renderGate("unauthenticated", "/");
    expect(screen.getByTestId("navigate").textContent).toBe("/sign-in");
    expect(screen.queryByTestId("outlet")).not.toBeInTheDocument();
  });

  it("renders the route (no redirect) for an authenticated visitor on a protected route", () => {
    renderGate("authenticated", "/");
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("stays on /sign-in (no redirect) while still connecting — not yet authenticated", () => {
    renderGate("connecting", "/sign-in");
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });

  it("keeps an unauthorized visitor on /sign-in (shows the error card, no redirect loop)", () => {
    renderGate("unauthorized", "/sign-in");
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });
});
