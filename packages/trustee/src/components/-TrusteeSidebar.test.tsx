/**
 * Tests for TrusteeSidebar (#786) — the persistent left nav panel replacing
 * the #777 scaffold's topbar.
 *
 * Mocks `useTrusteeSession` (per the exec plan's test strategy) and mounts a
 * minimal in-test TanStack router (mirroring
 * `packages/frontend/src/components/TopBar.test.tsx`) so `Link`/`activeProps`
 * resolve real active-route state without needing the full app router tree.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import { TrusteeSidebar } from "./TrusteeSidebar";
import { TRUSTEE_NAV_ITEMS } from "@/lib/nav";

const mockSignOut = vi.fn();

let mockSessionState: { address: string | undefined } = {
  address: "0x4c7f000000000000000000000000000000002a1b",
};

vi.mock("@/auth/TrusteeSessionProvider", () => ({
  useTrusteeSession: () => ({
    ...mockSessionState,
    signOut: mockSignOut,
  }),
}));

/** Builds a minimal in-test router that renders <TrusteeSidebar/> on every route. */
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute({
    component: () => <TrusteeSidebar />,
  });
  const children = TRUSTEE_NAV_ITEMS.map((item) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: item.path,
      component: () => null,
    }),
  );
  const routeTree = rootRoute.addChildren(children);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

function renderSidebar(initialPath = "/") {
  const router = buildRouter(initialPath);
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  mockSignOut.mockClear();
  mockSessionState = {
    address: "0x4c7f000000000000000000000000000000002a1b",
  };
});

describe("TrusteeSidebar", () => {
  it("renders without throwing", () => {
    expect(() => renderSidebar()).not.toThrow();
  });

  it("renders the Pipeline wordmark in white (visible on the navy sidebar)", async () => {
    renderSidebar();
    const logo = await screen.findByRole("img", { name: "Pipeline" });
    expect(logo).toBeInTheDocument();
    // `Logo` defaults to an inline `style={{ color: brand navy }}`, which
    // would make the wordmark invisible on this navy sidebar unless
    // overridden — guard the override explicitly (regression: the wordmark
    // was invisible before this was caught in review).
    expect(logo.style.color).toBe("var(--color-pipeline-on-dark)");
  });

  it("renders every nav item as a link to its route", async () => {
    renderSidebar();
    await screen.findByRole("img", { name: "Pipeline" });
    for (const item of TRUSTEE_NAV_ITEMS) {
      const link = screen.getByRole("link", { name: item.navLabel });
      expect(link).toHaveAttribute("href", item.path);
    }
  });

  it("marks the current route's nav item active via aria-current, with brand-on-white text; inactive items stay white-on-transparent", async () => {
    renderSidebar("/loans");
    const active = await screen.findByRole("link", {
      name: "Loans",
      current: "page",
    });
    expect(active).toBeInTheDocument();
    // Active: white surface + brand-navy text/icon (never both the brand and
    // on-dark color classes at once — that was the white-on-white regression
    // caught in review, where TanStack Router concatenates rather than
    // replaces `className`/`activeProps.className`).
    expect(active.className).toContain(
      "bg-[color:var(--color-pipeline-surface)]",
    );
    expect(active.className).toContain(
      "text-[color:var(--color-pipeline-brand)]",
    );
    expect(active.className).not.toContain(
      "text-[color:var(--color-pipeline-on-dark)]",
    );

    // Other items are not marked active, and keep the white-on-transparent
    // (on-dark) label color, not brand.
    const overview = screen.getByRole("link", { name: "Overview" });
    expect(overview).not.toHaveAttribute("aria-current");
    expect(overview.className).toContain(
      "text-[color:var(--color-pipeline-on-dark)]",
    );
    expect(overview.className).not.toContain(
      "text-[color:var(--color-pipeline-brand)]",
    );
  });

  it("marks Overview active on the index route", async () => {
    renderSidebar("/");
    const active = await screen.findByRole("link", {
      name: "Overview",
      current: "page",
    });
    expect(active).toBeInTheDocument();
    expect(active.className).toContain(
      "text-[color:var(--color-pipeline-brand)]",
    );
  });

  it("does not render a badge for any nav item (no backend count source)", async () => {
    renderSidebar();
    await screen.findByRole("img", { name: "Pipeline" });
    expect(screen.queryByTestId("trustee-nav-badge")).not.toBeInTheDocument();
  });

  it("renders the account chip with the truncated address and subtitle", async () => {
    renderSidebar();
    expect(
      await screen.findByTestId("trustee-account-address"),
    ).toHaveTextContent("0x4c7f…2a1b");
    expect(screen.getByText("Trustee · connected")).toBeInTheDocument();
  });

  it("renders nothing for the account chip when address is undefined", async () => {
    mockSessionState = { address: undefined };
    renderSidebar();
    await screen.findByRole("img", { name: "Pipeline" });
    expect(
      screen.queryByTestId("trustee-account-chip"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("'⋯' opens a menu with Sign out, and clicking it calls signOut", async () => {
    renderSidebar();

    const menuButton = await screen.findByRole("button", {
      name: "Account menu",
    });
    expect(
      screen.queryByRole("menuitem", { name: "Sign out" }),
    ).not.toBeInTheDocument();

    fireEvent.click(menuButton);

    const signOutItem = await screen.findByRole("menuitem", {
      name: "Sign out",
    });
    expect(signOutItem).toBeInTheDocument();

    fireEvent.click(signOutItem);
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  });
});
