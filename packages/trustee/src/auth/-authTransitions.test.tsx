// spec: docs/frontend/trustee-flows.md#two-layer-gating-1008
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { Route as AppRoot } from "@/routes/__root";
import { useTrusteeSession } from "./TrusteeSessionProvider";
import {
  _resetSessionStoreForTests,
  setSession,
  setSessionStatus,
} from "./sessionStore";

const mockEvmDisconnect = vi.fn();
const mockStellarDisconnect = vi.fn();

vi.mock("@pipeline/wallet-connect", () => ({
  useEvmWallet: () => ({
    isConnected: false,
    address: undefined,
    signMessage: vi.fn(),
    disconnect: mockEvmDisconnect,
  }),
  useStellarWallet: () => ({
    isConnected: false,
    address: undefined,
    signMessage: vi.fn(),
    disconnect: mockStellarDisconnect,
  }),
  useConnectModal: () => ({
    open: vi.fn(),
    close: vi.fn(),
    onCancel: () => () => {},
    onWalletSelect: () => () => {},
  }),
}));

vi.mock("@/api/auth", () => ({
  getAuthChallenge: vi.fn(),
  postAuthVerify: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  ENV: { EVM_CHAIN_ID: 560048, STELLAR_CHAIN_ID: 99000001 },
}));

vi.mock("@/components/TrusteeSidebar", () => ({
  TrusteeSidebar: () => <nav data-testid="sidebar" />,
}));

function HomePage() {
  const { signOut } = useTrusteeSession();
  return (
    <div data-testid="home">
      <button onClick={signOut}>sign out</button>
    </div>
  );
}

function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute({
    beforeLoad: AppRoot.options.beforeLoad,
    component: AppRoot.options.component,
  });
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomePage,
  });
  const signIn = createRoute({
    getParentRoute: () => rootRoute,
    path: "/sign-in",
    component: () => <div data-testid="sign-in-page" />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([home, signIn]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return router;
}

async function renderApp(initialPath: string) {
  const router = buildRouter(initialPath);
  const result = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  await waitFor(() => expect(router.state.status).toBe("idle"));
  await screen.findByTestId(initialPath === "/" ? "home" : "sign-in-overlay");
  const navigate = vi.spyOn(router, "navigate");
  return { router, navigate, ...result };
}

function authenticate(expiresAt = Date.now() + 60_000) {
  setSession({ token: "t", address: "0xabc", chainId: 1, expiresAt });
}

beforeEach(() => {
  _resetSessionStoreForTests();
  mockEvmDisconnect.mockReset();
  mockStellarDisconnect.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("auth transitions on a real router", () => {
  it("sign-in on /sign-in navigates once to / and renders the app", async () => {
    const { router, navigate, container } = await renderApp("/sign-in");

    act(() => authenticate());

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await waitFor(() => expect(router.state.status).toBe("idle"));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(await screen.findByTestId("home")).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("sign-out on / navigates once to /sign-in and renders the overlay", async () => {
    authenticate();
    const { router, navigate, container } = await renderApp("/");

    act(() => screen.getByText("sign out").click());

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/sign-in"),
    );
    await waitFor(() => expect(router.state.status).toBe("idle"));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/sign-in", replace: true });
    expect(await screen.findByTestId("sign-in-overlay")).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("token expiry on / navigates once to /sign-in and renders the overlay", async () => {
    authenticate(Date.now() + 700);
    const { router, navigate, container } = await renderApp("/");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/sign-in"),
    );
    await waitFor(() => expect(router.state.status).toBe("idle"));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("sign-in-overlay")).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("unauthorized sign-out on /sign-in does not navigate", async () => {
    const { navigate } = await renderApp("/sign-in");

    act(() => setSessionStatus("unauthorized", "Not allowed"));
    act(() => screen.getByText("Try a different wallet").click());

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("sign-in-overlay")).toBeInTheDocument();
  });

  it("does not rewrite history while a navigation is pending", async () => {
    authenticate();
    const { router } = await renderApp("/");
    const replaceState = vi.spyOn(window.history, "replaceState");

    act(() => screen.getByText("sign out").click());
    while (router.state.status !== "idle") {
      expect(replaceState).not.toHaveBeenCalled();
      await act(async () => {
        await Promise.resolve();
      });
    }
    await waitFor(() => expect(router.state.status).toBe("idle"));
    expect(replaceState).not.toHaveBeenCalled();
  });
});
