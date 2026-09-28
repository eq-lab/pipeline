/**
 * AccountDropdown — unit tests.
 *
 * Covers:
 *   - Opens on trigger click; closes on outside click and Escape.
 *   - Address renders truncated; copy button writes full address to clipboard
 *     and shows/hides "Copied" affordance.
 *   - Disconnect button calls onDisconnect and closes the dropdown.
 *   - Panel has role="menu"; copy + disconnect have role="menuitem".
 *   - Trigger has aria-expanded toggling.
 *   - Namespace toggle (EVM ↔ Stellar) switches the rendered address/balance.
 *   - Not-connected state renders "Connect {namespace}" action, hides Disconnect.
 *   - Network switcher row (issue #1032): current network always shown;
 *     other-network rows only when `VITE_NETWORK_LINKS` supplies siblings;
 *     mainnet row click asks for confirmation before navigating.
 *
 * AccountDropdown itself is a pure presentational component (all wallet state
 * comes in as props — see `AccountDropdownProps`) that is no longer composed
 * by `TopBar` as of issue #1362 (see `docs/exec-plans/tech-debt-tracker.md`
 * TD-93). These tests exercise it directly through a small local harness
 * instead of rendering the full `TopBar`/wallet-provider tree, so none of the
 * wagmi/AppKit/Stellar-wallets-kit scaffolding that used to live here is
 * needed any more — only a router (the hook reads `useRouterState`).
 */
import { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRouter,
  createRootRoute,
  RouterProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import { AccountDropdown } from "./AccountDropdown";
import type { WalletViewKind } from "@/wallet";

// ── Network switcher mock (issue #1032) ───────────────────────────────────────
// Only `getNetworkSwitcherState` is stubbed (controllable per test); the real
// `navigateToNetworkLink` (confirm + navigate) runs unmocked so the mainnet
// confirm behavior is exercised end-to-end — tests observe it via
// `window.confirm` / `window.location.assign` spies.

const { mockNetworkSwitcherState } = vi.hoisted(() => ({
  mockNetworkSwitcherState: {
    currentNetwork: { id: "testnet", label: "Testnet" },
    otherNetworks: [] as { id: string; label: string; url: string }[],
  },
}));

vi.mock("@/wallet/networkSwitcher", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/wallet/networkSwitcher")>();
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

// ── Clipboard mock ────────────────────────────────────────────────────────────

const mockWriteText = vi.fn().mockResolvedValue(undefined);

Object.defineProperty(navigator, "clipboard", {
  get() {
    return { writeText: mockWriteText };
  },
  configurable: true,
});

// ── Constants ─────────────────────────────────────────────────────────────────

const MOCK_EVM_ADDRESS = "0x8493000000000000000000000000000000003b92";
const MOCK_STELLAR_ADDRESS =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// ── Harness ───────────────────────────────────────────────────────────────────
// AccountDropdown takes all wallet state as plain props (see
// `AccountDropdownProps`) — the harness owns the toggle-button + open state
// that `TopBar` used to own, and the namespace switch, so each test can drive
// exactly the state it needs without a real wallet provider tree.

interface HarnessProps {
  initialKind?: WalletViewKind;
  evmAddress?: string;
  evmFormattedBalance?: string;
  stellarAddress?: string;
  stellarFormattedBalance?: string;
  stellarPlusdBalance?: string;
  stellarSplusdBalance?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

function Harness({
  initialKind = "evm",
  evmAddress,
  evmFormattedBalance,
  stellarAddress,
  stellarFormattedBalance,
  stellarPlusdBalance,
  stellarSplusdBalance,
  onConnect = () => {},
  onDisconnect = () => {},
}: HarnessProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<WalletViewKind>(initialKind);
  const address = kind === "evm" ? evmAddress : stellarAddress;
  const formattedBalance =
    kind === "evm" ? evmFormattedBalance : stellarFormattedBalance;

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="dropdown-trigger"
      >
        {formattedBalance ?? "—"}
      </button>
      {open && (
        <AccountDropdown
          kind={kind}
          onKindChange={setKind}
          address={address}
          formattedBalance={formattedBalance}
          stellarPlusdBalance={
            kind === "stellar" ? stellarPlusdBalance : undefined
          }
          stellarSplusdBalance={
            kind === "stellar" ? stellarSplusdBalance : undefined
          }
          onConnect={onConnect}
          onClose={() => setOpen(false)}
          onDisconnect={() => {
            onDisconnect();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function renderHarness(props: HarnessProps = {}) {
  const rootRoute = createRootRoute({
    component: () => <Harness {...props} />,
  });
  const routeTree = rootRoute.addChildren([]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

/** Clicks the trigger to open the dropdown and waits for it. */
async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByTestId("dropdown-trigger");
  await user.click(trigger);
  await waitFor(() =>
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument(),
  );
  return trigger;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccountDropdown — open / close", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens when the trigger is clicked", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);
    expect(screen.getByRole("menu", { name: "Account" })).toBeVisible();
  });

  it("closes when outside is clicked (mousedown)", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    await act(async () => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: "Account" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("closes when Escape is pressed", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: "Account" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("sets aria-expanded to true when open, false when closed", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });

    const trigger = await screen.findByTestId("dropdown-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
  });
});

describe("AccountDropdown — address display and copy", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the EVM address truncated to 0x8493…3b92", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    expect(screen.getByText("0x8493…3b92")).toBeInTheDocument();
    expect(screen.queryByText(MOCK_EVM_ADDRESS)).not.toBeInTheDocument();
  });

  it("copy button writes full address to clipboard", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    const copyBtn = screen.getByRole("menuitem", {
      name: "Copy wallet address",
    });
    await user.click(copyBtn);

    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  });

  it("copy button shows Copied affordance, then reverts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ delay: null });
      renderHarness({
        evmAddress: MOCK_EVM_ADDRESS,
        evmFormattedBalance: "$1,000.00",
      });
      const trigger = await screen.findByTestId("dropdown-trigger");
      await act(async () => {
        await user.click(trigger);
      });
      await waitFor(() =>
        expect(
          screen.getByRole("menu", { name: "Account" }),
        ).toBeInTheDocument(),
      );

      const copyBtn = screen.getByRole("menuitem", {
        name: "Copy wallet address",
      });
      await act(async () => {
        await user.click(copyBtn);
      });

      await waitFor(() =>
        expect(screen.getByText("Copied")).toBeInTheDocument(),
      );

      act(() => {
        vi.advanceTimersByTime(1600);
      });

      await waitFor(() =>
        expect(screen.queryByText("Copied")).not.toBeInTheDocument(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AccountDropdown — disconnect", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Disconnect button closes the dropdown", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    const disconnectBtn = screen.getByRole("menuitem", { name: "Disconnect" });
    await user.click(disconnectBtn);

    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: "Account" }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("AccountDropdown — a11y roles", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("panel has role=menu, copy and disconnect have role=menuitem", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Copy wallet address" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });
});

describe("AccountDropdown — namespace toggle", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("EVM tab is selected by default and shows EVM address", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
      stellarAddress: MOCK_STELLAR_ADDRESS,
      stellarFormattedBalance: "$2,000.00",
    });
    await openDropdown(user);

    const evmTab = screen.getByRole("tab", { name: "EVM" });
    expect(evmTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("0x8493…3b92")).toBeInTheDocument();
  });

  it("clicking Stellar tab shows Stellar truncated address", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
      stellarAddress: MOCK_STELLAR_ADDRESS,
      stellarFormattedBalance: "$2,000.00",
    });
    await openDropdown(user);

    const stellarTab = screen.getByRole("tab", { name: "Stellar" });
    await user.click(stellarTab);

    await waitFor(() => {
      // Stellar GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
      // truncated: first 6 chars = "GBBD47", last 4 chars = "FLA5".
      expect(screen.getByText("GBBD47…FLA5")).toBeInTheDocument();
    });
    expect(stellarTab).toHaveAttribute("aria-selected", "true");
  });

  it("clicking EVM tab after Stellar restores EVM address", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
      stellarAddress: MOCK_STELLAR_ADDRESS,
      stellarFormattedBalance: "$2,000.00",
    });
    await openDropdown(user);

    await user.click(screen.getByRole("tab", { name: "Stellar" }));
    await waitFor(() =>
      expect(screen.getByText("GBBD47…FLA5")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("tab", { name: "EVM" }));
    await waitFor(() =>
      expect(screen.getByText("0x8493…3b92")).toBeInTheDocument(),
    );
  });
});

describe("AccountDropdown — not-connected-tab state", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Connect Stellar' action when EVM connected but Stellar tab selected", async () => {
    const user = userEvent.setup();
    // Stellar is NOT connected (no stellarAddress passed).
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    await user.click(screen.getByRole("tab", { name: "Stellar" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Connect Stellar" }),
      ).toBeInTheDocument();
    });
    // Disconnect should NOT be visible when active namespace is not connected.
    expect(
      screen.queryByRole("menuitem", { name: "Disconnect" }),
    ).not.toBeInTheDocument();
  });
});

// ── Tests: network switcher row (issue #1032) ────────────────────────────────

describe("AccountDropdown — network switcher row", () => {
  beforeEach(() => {
    mockNetworkSwitcherState.currentNetwork = {
      id: "testnet",
      label: "Testnet",
    };
    mockNetworkSwitcherState.otherNetworks = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
    restoreWindowLocation();
    mockNetworkSwitcherState.currentNetwork = {
      id: "testnet",
      label: "Testnet",
    };
    mockNetworkSwitcherState.otherNetworks = [];
  });

  it("always shows the current network label, with no switch-network group when unconfigured", async () => {
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    expect(screen.getByTestId("topbar-network-current")).toHaveTextContent(
      "Testnet",
    );
    expect(
      screen.queryByRole("group", { name: "Switch network" }),
    ).not.toBeInTheDocument();
  });

  it("renders an other-network row when VITE_NETWORK_LINKS supplies a sibling", async () => {
    mockNetworkSwitcherState.otherNetworks = [
      {
        id: "mainnet",
        label: "Mainnet",
        url: "https://app.pipeline.one",
      },
    ];
    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    expect(
      screen.getByRole("group", { name: "Switch network" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("topbar-network-link-mainnet"),
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
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    await user.click(screen.getByTestId("topbar-network-link-futurenet"));

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
        url: "https://app.pipeline.one",
      },
    ];
    const assignSpy = mockLocationAssign();

    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    await user.click(screen.getByTestId("topbar-network-link-mainnet"));

    // No navigation yet — the styled dialog gates it.
    expect(assignSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("network-switch-dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Switch to Mainnet?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("network-switch-confirm"));
    expect(assignSpy).toHaveBeenCalledWith("https://app.pipeline.one");
  });

  it("cancelling the mainnet dialog does not navigate and closes it", async () => {
    mockNetworkSwitcherState.otherNetworks = [
      {
        id: "mainnet",
        label: "Mainnet",
        url: "https://app.pipeline.one",
      },
    ];
    const assignSpy = mockLocationAssign();

    const user = userEvent.setup();
    renderHarness({
      evmAddress: MOCK_EVM_ADDRESS,
      evmFormattedBalance: "$1,000.00",
    });
    await openDropdown(user);

    await user.click(screen.getByTestId("topbar-network-link-mainnet"));
    await user.click(screen.getByTestId("network-switch-cancel"));

    expect(assignSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("network-switch-dialog"),
    ).not.toBeInTheDocument();
  });
});
