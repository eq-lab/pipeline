import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRouter,
  createRoute,
  createRootRoute,
  RouterProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import { TopBar } from "./TopBar";

// Mock SVG assets — jsdom cannot handle CSS mask URLs.
vi.mock("@pipeline/ui/assets/icons/nav-home.svg", () => ({
  default: "/nav-home.svg",
}));
vi.mock("@pipeline/ui/assets/icons/nav-dollar.svg", () => ({
  default: "/nav-dollar.svg",
}));
vi.mock("@pipeline/ui/assets/icons/nav-stats.svg", () => ({
  default: "/nav-stats.svg",
}));
vi.mock("@pipeline/ui/assets/icons/nav-history.svg", () => ({
  default: "/nav-history.svg",
}));

/** Builds a minimal in-test router that renders <TopBar /> on every route. */
function buildRouter(initialPath: string, activeNavProp?: string) {
  const rootRoute = createRootRoute({
    component: () =>
      activeNavProp ? <TopBar activeNav={activeNavProp} /> : <TopBar />,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const depositRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/deposit",
    component: () => null,
  });
  const transactionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/transactions",
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([
    indexRoute,
    depositRoute,
    transactionsRoute,
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

describe("TopBar — route-driven active state", () => {
  it("highlights Home on /", async () => {
    const router = buildRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Convert" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("highlights Convert on /deposit", async () => {
    const router = buildRouter("/deposit");
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Convert" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("navigates to /deposit when Convert is clicked", async () => {
    const user = userEvent.setup();
    const router = buildRouter("/");
    render(<RouterProvider router={router} />);

    // Wait for initial render.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );

    await user.click(screen.getByRole("button", { name: "Convert" }));

    // After navigation, Convert should be active.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Convert" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("explicit activeNav prop overrides route-derived state", async () => {
    const router = buildRouter("/", "markets");
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Markets" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("clicking Markets (no route) does not throw", async () => {
    const user = userEvent.setup();
    const router = buildRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() => screen.getByRole("button", { name: "Markets" }));

    // Should not throw — Markets has no `to`, so onClick is undefined.
    await expect(
      user.click(screen.getByRole("button", { name: "Markets" })),
    ).resolves.not.toThrow();
  });

  it("highlights History on /transactions", async () => {
    const router = buildRouter("/transactions");
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "History" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("navigates to /transactions when History is clicked", async () => {
    const user = userEvent.setup();
    const router = buildRouter("/");
    render(<RouterProvider router={router} />);

    // Wait for initial render.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );

    await user.click(screen.getByRole("button", { name: "History" }));

    // After navigation, History should be active.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "History" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });
});
