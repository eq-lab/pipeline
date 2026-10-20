/**
 * TopBar — unit tests.
 *
 * Tests route-derived active nav, the auth-state right slot (issue #1362 —
 * Sign In/Sign Up when signed out, account icon when signed in; issue #1458 —
 * account icon also shows for a connected wallet with no session), the
 * network switcher badge, the mainnet dashboard gate, mobile responsive
 * classes, and a smoke test that the header renders on non-`/` routes
 * (regression guard for the root-layout approach).
 *
 * `@/auth` (useAuthSession/useAuthFlow) and `@/wallet`'s `useWalletPresence`
 * are mocked at module level — TopBar reads no other wallet hook directly, so
 * no wagmi/AppKit/Stellar-wallets-kit scaffolding is needed here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRouter,
  createRoute,
  createRootRoute,
  RouterProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import { TopBar } from "./TopBar";

// ── Auth mock (issue #1362) ───────────────────────────────────────────────────

const { mockAuthState, mockAuthFlowOpen } = vi.hoisted(() => ({
  mockAuthState: { isAuthenticated: false },
  mockAuthFlowOpen: vi.fn(),
}));

vi.mock("@/auth", () => ({
  useAuthSession: () => ({
    token: undefined,
    expiresAt: undefined,
    isAuthenticated: mockAuthState.isAuthenticated,
    signOut: vi.fn(),
  }),
  useAuthFlow: () => ({ open: mockAuthFlowOpen, close: vi.fn() }),
}));

// ── Wallet presence mock (issue #1458) ────────────────────────────────────────

const { mockWalletPresenceState } = vi.hoisted(() => ({
  mockWalletPresenceState: { isAnyConnected: false },
}));

vi.mock("@/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet")>();
  return {
    ...actual,
    useWalletPresence: () => ({
      isAnyConnected: mockWalletPresenceState.isAnyConnected,
      isSettled: true,
      disconnectAll: vi.fn(),
    }),
  };
});

// ── Network switcher mock (issue #1032) ───────────────────────────────────────
// Only `useNetworkSwitcherState` is
// stubbed (controllable per test); `navigateToNetworkLink` stays real.

const { mockNetworkSwitcherState, mockIsMainnet } = vi.hoisted(() => ({
  mockNetworkSwitcherState: {
    currentNetwork: { id: "testnet", label: "Testnet" },
    otherNetworks: [] as { id: string; label: string; url: string }[],
  },
  mockIsMainnet: { value: false },
}));

vi.mock("@/wallet/useNetworkIdentity", () => ({
  useNetworkSwitcherState: () => mockNetworkSwitcherState,
  useIsMainnetNetwork: () => mockIsMainnet.value,
}));
const { guardState } = vi.hoisted(() => ({
  guardState: {
    value: {
      expectedChain: { id: 560048, name: "Hoodi" },
      currentChainId: 560048 as number | undefined,
      isWrongNetwork: false,
      switchNetwork: vi.fn(),
      isSwitching: false,
      switchError: null as Error | null,
    },
  },
}));

vi.mock("@/wallet/evm/useEvmNetworkGuard", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/wallet/evm/useEvmNetworkGuard")>();
  return { ...original, useEvmNetworkGuard: () => guardState.value };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal in-test router that renders <TopBar /> on every route. */
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute({
    component: () => <TopBar />,
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
  const stakeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/stake",
    component: () => null,
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/dashboard",
    component: () => null,
  });
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/account",
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([
    indexRoute,
    depositRoute,
    withdrawRoute,
    transactionsRoute,
    stakeRoute,
    dashboardRoute,
    accountRoute,
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

function renderTopBar(initialPath = "/") {
  const router = buildRouter(initialPath);
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, router };
}

function clearMocks() {
  mockNetworkSwitcherState.currentNetwork = { id: "testnet", label: "Testnet" };
  mockNetworkSwitcherState.otherNetworks = [];
  mockIsMainnet.value = false;
  mockAuthState.isAuthenticated = false;
  mockWalletPresenceState.isAnyConnected = false;
  mockAuthFlowOpen.mockClear();
}

// ── Tests: route-driven active nav ────────────────────────────────────────────

describe("TopBar — route-driven active state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    clearMocks();
  });

  it("highlights the account icon on /account and no nav item (#1556)", async () => {
    mockAuthState.isAuthenticated = true;
    renderTopBar("/account");
    await waitFor(() =>
      expect(screen.getByTestId("topbar-account-button")).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByTestId("topbar-account-button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("topbar-account-button").className).toContain(
      "text-[color:var(--color-pipeline-brand)]",
    );
    for (const name of ["Home", "Convert", "Earn", "Activity"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "data-active",
        "false",
      );
    }
  });

  it("the account icon is inactive on / (#1556)", async () => {
    mockAuthState.isAuthenticated = true;
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByTestId("topbar-account-button")).toHaveAttribute(
        "data-active",
        "false",
      ),
    );
    expect(screen.getByTestId("topbar-account-button")).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("highlights Home on /", async () => {
    renderTopBar("/");
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
    renderTopBar("/deposit");
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

  it("highlights Convert on /deposit?direction=withdraw (withdraw direction uses /deposit pathname)", async () => {
    renderTopBar("/deposit");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Convert" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
  });

  it("highlights Activity on /transactions", async () => {
    renderTopBar("/transactions");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activity" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("highlights Earn on /stake", async () => {
    renderTopBar("/stake");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Earn" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("highlights Dashboard on /dashboard", async () => {
    renderTopBar("/dashboard");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dashboard" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("renders the nav divider between Activity and Dashboard", async () => {
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByTestId("topbar-nav-divider")).toBeInTheDocument(),
    );
    const nav = screen.getByTestId("topbar-primary-nav");
    const children = Array.from(nav.children);
    const dividerIdx = children.indexOf(
      screen.getByTestId("topbar-nav-divider"),
    );
    expect(children[dividerIdx - 1]).toBe(
      screen.getByTestId("topbar-nav-history"),
    );
    expect(children[dividerIdx + 1]).toBe(
      screen.getByTestId("topbar-nav-overview"),
    );
  });

  it("navigates to /dashboard when Dashboard is clicked", async () => {
    const user = userEvent.setup();
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dashboard" })).toHaveAttribute(
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
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Convert" }));
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

  it("navigates to /transactions when Activity is clicked", async () => {
    const user = userEvent.setup();
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Activity" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activity" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
  });

  it("navigates to /stake when Earn is clicked", async () => {
    const user = userEvent.setup();
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Earn" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Earn" })).toHaveAttribute(
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

// ── Tests: auth state (issue #1362) ───────────────────────────────────────────

describe("TopBar — auth state (#1362)", () => {
  afterEach(() => {
    clearMocks();
    localStorage.clear();
  });

  it("shows Sign In and Sign Up when unauthenticated, no account button", async () => {
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByTestId("topbar-sign-in-button")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("topbar-sign-up-button")).toBeInTheDocument();
    expect(
      screen.queryByTestId("topbar-account-button"),
    ).not.toBeInTheDocument();
  });

  it("clicking Sign In opens the auth flow on the sign-in screen", async () => {
    const user = userEvent.setup();
    renderTopBar("/");
    await user.click(await screen.findByTestId("topbar-sign-in-button"));
    expect(mockAuthFlowOpen).toHaveBeenCalledWith("sign-in");
  });

  it("clicking Sign Up opens the auth flow on the create-account screen", async () => {
    const user = userEvent.setup();
    renderTopBar("/");
    await user.click(await screen.findByTestId("topbar-sign-up-button"));
    expect(mockAuthFlowOpen).toHaveBeenCalledWith("create-account");
  });

  it("shows the account icon button when authenticated, no Sign In/Sign Up", async () => {
    mockAuthState.isAuthenticated = true;
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByTestId("topbar-account-button")).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("topbar-sign-in-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("topbar-sign-up-button"),
    ).not.toBeInTheDocument();
  });

  it("clicking the account icon navigates to /account", async () => {
    mockAuthState.isAuthenticated = true;
    const user = userEvent.setup();
    const { router } = renderTopBar("/");
    await user.click(await screen.findByTestId("topbar-account-button"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/account"),
    );
  });
});

// ── Tests: wallet-only visitor, no session (issue #1458) ─────────────────────

describe("TopBar — wallet-connected, no session (#1458)", () => {
  afterEach(() => {
    clearMocks();
    localStorage.clear();
  });

  it("shows the account icon when a wallet is connected but there is no session", async () => {
    mockWalletPresenceState.isAnyConnected = true;
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByTestId("topbar-account-button")).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("topbar-sign-in-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("topbar-sign-up-button"),
    ).not.toBeInTheDocument();
  });

  it("shows the account icon when both a session and a wallet are present", async () => {
    mockAuthState.isAuthenticated = true;
    mockWalletPresenceState.isAnyConnected = true;
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByTestId("topbar-account-button")).toBeInTheDocument(),
    );
  });

  it("returns to Sign In / Sign Up when the wallet disconnects and there is no session (same-tab reactive)", async () => {
    mockWalletPresenceState.isAnyConnected = true;
    const { router } = renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByTestId("topbar-account-button")).toBeInTheDocument(),
    );
    mockWalletPresenceState.isAnyConnected = false;
    // A route change forces TopBar to re-render without remounting — the
    // same component instance picks up the updated wallet-presence mock.
    await router.navigate({ to: "/transactions" });
    await waitFor(() =>
      expect(screen.getByTestId("topbar-sign-in-button")).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("topbar-account-button"),
    ).not.toBeInTheDocument();
  });
});

// ── Smoke test: header on non-/ routes ───────────────────────────────────────

describe("TopBar — root layout smoke test", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the Pipeline logo and nav on /deposit (regression guard for root layout)", async () => {
    renderTopBar("/deposit");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
  });
});

// ── Tests: mobile responsive classes ─────────────────────────────────────────
//
// JSDOM has no real media-query engine, so we assert on CSS class presence
// rather than computed visibility — mirroring the "min-h-[274px]" class-based
// approach used in other component tests in this codebase.
//
// The mobile hamburger control is always present in the DOM but hidden above
// `md` via `md:hidden`.  The desktop nav is always present but hidden below
// `md` via `hidden md:flex`.  Asserting on the classes is the reliable,
// media-query-free way to verify the responsive contract.

describe("TopBar — mobile responsive classes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    clearMocks();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("header element has `p-2` (8px mobile padding) and `md:p-4` (16px desktop padding) classes", async () => {
    renderTopBar("/");

    // The <header> element is the landmark with role="banner".
    await waitFor(() => expect(screen.getByRole("banner")).toBeInTheDocument());
    const header = screen.getByRole("banner");
    // Mobile: 8px padding (Figma 1989:9052 — 56px total = 8+40+8).
    expect(header.className).toContain("p-2");
    // Desktop: restore 16px padding at md breakpoint.
    expect(header.className).toContain("md:p-4");
  });

  it("header is sticky at every breakpoint (#1238) — unprefixed classes apply to mobile too", async () => {
    renderTopBar("/");

    await waitFor(() => expect(screen.getByRole("banner")).toBeInTheDocument());
    const header = screen.getByRole("banner");
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("top-0");
    expect(header.className).toContain("z-40");
  });

  it("desktop nav wrapper has `hidden md:flex` class (invisible below md breakpoint)", async () => {
    renderTopBar("/");

    // The nav element rendered for desktop has `hidden md:flex` on its parent wrapper.
    // We target the nav itself — its parent div carries the responsive classes.
    await waitFor(() =>
      expect(
        screen.getByRole("navigation", { name: "Primary" }),
      ).toBeInTheDocument(),
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    // The nav element itself carries `hidden md:flex` per the implementation.
    expect(nav.className).toContain("hidden");
    expect(nav.className).toContain("md:flex");
  });

  it("hamburger button is present in the DOM and has `md:hidden` class", async () => {
    renderTopBar("/");

    await waitFor(() =>
      expect(screen.getByTestId("mobile-hamburger")).toBeInTheDocument(),
    );
    const hamburger = screen.getByTestId("mobile-hamburger");
    // The parent container carries `md:hidden`; the hamburger is inside it.
    const wrapper = hamburger.closest("div");
    expect(wrapper?.className).toContain("md:hidden");
  });

  it("clicking the hamburger opens the mobile nav menu", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    // Mobile nav menu is not in the DOM while closed.
    expect(screen.queryByTestId("mobile-nav-menu")).not.toBeInTheDocument();

    const hamburger = await screen.findByTestId("mobile-hamburger");
    await user.click(hamburger);

    await waitFor(() =>
      expect(screen.getByTestId("mobile-nav-menu")).toBeInTheDocument(),
    );
  });

  it("mobile menu lists four nav destinations", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    const hamburger = await screen.findByTestId("mobile-hamburger");
    await user.click(hamburger);

    await waitFor(() =>
      expect(screen.getByTestId("mobile-nav-menu")).toBeInTheDocument(),
    );

    // The mobile menu's nav section contains the four nav labels.
    expect(screen.getAllByText("Home").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Convert").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Earn").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Activity").length).toBeGreaterThanOrEqual(1);
  });

  it("mobile menu shows Sign In/Sign Up when unauthenticated (#1362)", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    const hamburger = await screen.findByTestId("mobile-hamburger");
    await user.click(hamburger);

    const menuPanel = await screen.findByTestId("mobile-nav-menu");
    expect(
      within(menuPanel).getByTestId("mobile-sign-in-button"),
    ).toBeInTheDocument();
    expect(
      within(menuPanel).getByTestId("mobile-sign-up-button"),
    ).toBeInTheDocument();
    expect(
      within(menuPanel).queryByTestId("mobile-account-button"),
    ).not.toBeInTheDocument();
  });

  it("mobile menu shows an Account row when authenticated (#1362)", async () => {
    mockAuthState.isAuthenticated = true;
    const user = userEvent.setup();
    renderTopBar("/");

    const hamburger = await screen.findByTestId("mobile-hamburger");
    await user.click(hamburger);

    const menuPanel = await screen.findByTestId("mobile-nav-menu");
    expect(
      within(menuPanel).getByTestId("mobile-account-button"),
    ).toBeInTheDocument();
    expect(
      within(menuPanel).queryByTestId("mobile-sign-in-button"),
    ).not.toBeInTheDocument();
  });

  it("mobile menu closes when the close button is clicked", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    const hamburger = await screen.findByTestId("mobile-hamburger");
    await user.click(hamburger);

    await waitFor(() =>
      expect(screen.getByTestId("mobile-nav-menu")).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("mobile-nav-menu-close"));

    await waitFor(() =>
      expect(screen.queryByTestId("mobile-nav-menu")).not.toBeInTheDocument(),
    );
  });
});

// ── Tests: network switcher static badge (Issue #1032) ────────────────────────

describe("TopBar — network switcher static badge", () => {
  afterEach(() => {
    clearMocks();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows the current network label even when unauthenticated (no menu needed)", async () => {
    renderTopBar("/");

    await waitFor(() =>
      expect(screen.getByTestId("topbar-network-badge")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("topbar-network-badge")).toHaveTextContent(
      "Testnet",
    );
  });

  it("shows the current network label when authenticated too", async () => {
    mockAuthState.isAuthenticated = true;
    renderTopBar("/");

    await waitFor(() =>
      expect(screen.getByTestId("topbar-network-badge")).toHaveTextContent(
        "Testnet",
      ),
    );
  });

  it("reflects a mainnet current-network deployment", async () => {
    mockNetworkSwitcherState.currentNetwork = {
      id: "mainnet",
      label: "Mainnet",
    };
    renderTopBar("/");

    await waitFor(() =>
      expect(screen.getByTestId("topbar-network-badge")).toHaveTextContent(
        "Mainnet",
      ),
    );
  });
});

// ── Tests: network pill wrong-network state (#1497) ───────────────────────────

describe("TopBar — network pill wrong-network state (#1497)", () => {
  beforeEach(() => {
    guardState.value = {
      ...guardState.value,
      isWrongNetwork: true,
      currentChainId: 1,
      switchNetwork: vi.fn(),
    };
  });

  afterEach(() => {
    clearMocks();
    guardState.value = {
      ...guardState.value,
      isWrongNetwork: false,
      currentChainId: 560048,
      isSwitching: false,
    };
    localStorage.clear();
  });

  it("shows the Wrong network label and state on the pill", async () => {
    renderTopBar("/");
    const badge = await screen.findByTestId("topbar-network-badge");
    expect(badge).toHaveTextContent("Wrong network");
    expect(badge).toHaveAttribute("data-state", "wrong-network");
  });

  it("offers a switch row that calls switchNetwork", async () => {
    const user = userEvent.setup();
    renderTopBar("/");
    await user.click(await screen.findByTestId("topbar-network-badge"));
    const row = screen.getByTestId("topbar-network-switch-chain");
    expect(row).toHaveTextContent("Switch to Hoodi");
    await user.click(row);
    expect(guardState.value.switchNetwork).toHaveBeenCalledTimes(1);
  });

  it("disables the switch row while switching", async () => {
    guardState.value = { ...guardState.value, isSwitching: true };
    const user = userEvent.setup();
    renderTopBar("/");
    await user.click(await screen.findByTestId("topbar-network-badge"));
    expect(screen.getByTestId("topbar-network-switch-chain")).toBeDisabled();
  });

  it("keeps the normal pill when the chain is right", async () => {
    guardState.value = { ...guardState.value, isWrongNetwork: false };
    renderTopBar("/");
    const badge = await screen.findByTestId("topbar-network-badge");
    expect(badge).toHaveTextContent("Testnet");
    expect(badge).not.toHaveAttribute("data-state");
  });
});

// ── Tests: mainnet dashboard gate (Issue #1243) ───────────────────────────────

describe("TopBar — mainnet dashboard gate (#1243)", () => {
  afterEach(() => {
    clearMocks();
    localStorage.clear();
  });

  it("hides the Dashboard nav slot and its divider on mainnet", async () => {
    mockIsMainnet.value = true;
    renderTopBar("/");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("topbar-nav-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("topbar-nav-divider")).not.toBeInTheDocument();
  });

  it("shows the Dashboard nav slot and its divider on testnet", async () => {
    renderTopBar("/");

    await waitFor(() =>
      expect(screen.getByTestId("topbar-nav-overview")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("topbar-nav-divider")).toBeInTheDocument();
  });
});
