/**
 * Tests for TrusteeSidebar (#786) — the persistent left nav panel replacing
 * the #777 scaffold's topbar.
 *
 * Mocks `useTrusteeSession` (per the exec plan's test strategy) and mounts a
 * minimal in-test TanStack router (mirroring
 * `packages/frontend/src/components/TopBar.test.tsx`) so `Link`/`activeProps`
 * resolve real active-route state without needing the full app router tree.
 *
 * Also covers the network switcher (issue #1032): the static badge in the
 * account chip, the `⋯` popover's switch-network rows, and the mainnet
 * confirm dialog — `getNetworkSwitcherState` is stubbed (controllable per
 * test) while the real `navigateToNetworkLink` runs unmocked; the mainnet
 * gate is the styled `NetworkSwitchDialog` (#1032 polish).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const { mockNetworkSwitcherState } = vi.hoisted(() => ({
  mockNetworkSwitcherState: {
    currentNetwork: { id: "testnet", label: "Testnet" },
    otherNetworks: [] as { id: string; label: string; url: string }[],
  },
}));

vi.mock("@/lib/networkSwitcher", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/networkSwitcher")>();
  return {
    ...original,
    getNetworkSwitcherState: () => mockNetworkSwitcherState,
  };
});

// jsdom's `Location.prototype.assign` is non-configurable, so `vi.spyOn`
// cannot redefine it directly — replace `window.location` itself with a
// stand-in object for the duration of the test instead.
const ORIGINAL_WINDOW_LOCATION = window.location;

function mockLocationAssign() {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...ORIGINAL_WINDOW_LOCATION, assign },
    configurable: true,
    writable: true,
  });
  return assign;
}

function restoreWindowLocation() {
  Object.defineProperty(window, "location", {
    value: ORIGINAL_WINDOW_LOCATION,
    configurable: true,
    writable: true,
  });
}

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
  mockNetworkSwitcherState.currentNetwork = { id: "testnet", label: "Testnet" };
  mockNetworkSwitcherState.otherNetworks = [];
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

describe("TrusteeSidebar — network switcher (issue #1032)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreWindowLocation();
  });

  it("shows the static current-network badge with no other-network group when unconfigured", async () => {
    renderSidebar();

    const badge = await screen.findByTestId("trustee-network-badge");
    expect(badge).toHaveTextContent("Testnet");
    expect(
      screen.queryByTestId("trustee-network-switcher-group"),
    ).not.toBeInTheDocument();
  });

  it("reflects a mainnet current-network deployment in the static badge", async () => {
    mockNetworkSwitcherState.currentNetwork = {
      id: "mainnet",
      label: "Mainnet",
    };
    renderSidebar();

    expect(
      await screen.findByTestId("trustee-network-badge"),
    ).toHaveTextContent("Mainnet");
  });

  it("renders an other-network row in the ⋯ popover when configured", async () => {
    mockNetworkSwitcherState.otherNetworks = [
      {
        id: "mainnet",
        label: "Mainnet",
        url: "https://dashboard.pipeline.one",
      },
    ];
    const user = userEvent.setup();
    renderSidebar();

    const menuButton = await screen.findByRole("button", {
      name: "Account menu",
    });
    await user.click(menuButton);

    expect(
      await screen.findByTestId("trustee-network-link-mainnet"),
    ).toBeInTheDocument();
  });

  it("clicking a non-mainnet other-network row navigates directly, without a dialog", async () => {
    mockNetworkSwitcherState.otherNetworks = [
      {
        id: "futurenet",
        label: "Futurenet",
        url: "https://futurenet.example.com",
      },
    ];
    const assignSpy = mockLocationAssign();

    const user = userEvent.setup();
    renderSidebar();

    await user.click(
      await screen.findByRole("button", { name: "Account menu" }),
    );
    await user.click(
      await screen.findByTestId("trustee-network-link-futurenet"),
    );

    expect(
      screen.queryByTestId("network-switch-dialog"),
    ).not.toBeInTheDocument();
    expect(assignSpy).toHaveBeenCalledWith("https://futurenet.example.com");
  });

  it("clicking a mainnet other-network row opens the confirm dialog; confirming navigates", async () => {
    mockNetworkSwitcherState.otherNetworks = [
      {
        id: "mainnet",
        label: "Mainnet",
        url: "https://dashboard.pipeline.one",
      },
    ];
    const assignSpy = mockLocationAssign();

    const user = userEvent.setup();
    renderSidebar();

    await user.click(
      await screen.findByRole("button", { name: "Account menu" }),
    );
    await user.click(await screen.findByTestId("trustee-network-link-mainnet"));

    expect(assignSpy).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId("network-switch-dialog"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("network-switch-confirm"));
    expect(assignSpy).toHaveBeenCalledWith("https://dashboard.pipeline.one");
  });

  it("cancelling the mainnet dialog does not navigate and closes it", async () => {
    mockNetworkSwitcherState.otherNetworks = [
      {
        id: "mainnet",
        label: "Mainnet",
        url: "https://dashboard.pipeline.one",
      },
    ];
    const assignSpy = mockLocationAssign();

    const user = userEvent.setup();
    renderSidebar();

    await user.click(
      await screen.findByRole("button", { name: "Account menu" }),
    );
    await user.click(await screen.findByTestId("trustee-network-link-mainnet"));
    await user.click(screen.getByTestId("network-switch-cancel"));

    expect(
      screen.queryByTestId("network-switch-dialog"),
    ).not.toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
