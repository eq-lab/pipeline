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
function buildRouter(
  initialPath: string,
  props?: Partial<React.ComponentPropsWithoutRef<typeof TopBar>>,
) {
  const rootRoute = createRootRoute({
    component: () => <TopBar {...props} />,
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
  const withdrawRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/withdraw",
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
    withdrawRoute,
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
    expect(screen.getByRole("button", { name: "Deposit" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("highlights Deposit on /deposit", async () => {
    const router = buildRouter("/deposit");
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Deposit" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("highlights Deposit on /withdraw (withdraw shares the dollar icon)", async () => {
    const router = buildRouter("/withdraw");
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Deposit" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("navigates to /deposit when Deposit is clicked", async () => {
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

    await user.click(screen.getByRole("button", { name: "Deposit" }));

    // After navigation, Deposit should be active.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Deposit" })).toHaveAttribute(
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
    const router = buildRouter("/", { activeNav: "stats" });
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stats" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("clicking Stats (no route) does not throw", async () => {
    const user = userEvent.setup();
    const router = buildRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() => screen.getByRole("button", { name: "Stats" }));

    // Should not throw — Stats has no `to`, so onClick is undefined.
    await expect(
      user.click(screen.getByRole("button", { name: "Stats" })),
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

describe("TopBar — wallet prop (connected state)", () => {
  it("renders Connect Wallet button when wallet prop is absent", async () => {
    const router = buildRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Connect Wallet" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("$10,000.00")).not.toBeInTheDocument();
  });

  it("renders WalletPill with balance when wallet prop is provided", async () => {
    const router = buildRouter("/", { wallet: { balance: "$10,000.00" } });
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(screen.getByText("$10,000.00")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Connect Wallet" }),
    ).not.toBeInTheDocument();
  });

  it("home page still renders Connect Wallet button (no wallet prop passed)", async () => {
    // Regression guard: the home page invocation passes no wallet prop.
    const router = buildRouter("/");
    render(<RouterProvider router={router} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Connect Wallet" }),
      ).toBeInTheDocument(),
    );
  });
});
