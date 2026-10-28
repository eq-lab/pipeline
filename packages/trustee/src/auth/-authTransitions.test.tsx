// spec: docs/frontend/trustee-flows.md#render-level-auth-gate-1008-1749
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { Route as AppRoot } from "@/routes/__root";
import {
  _resetSessionStoreForTests,
  getSessionState,
  setSession,
  setSessionStatus,
} from "./sessionStore";

const mockEvmDisconnect = vi.fn();
const mockStellarDisconnect = vi.fn();

vi.mock("@pipeline/wallet-connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pipeline/wallet-connect")>()),
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

function HomePage() {
  return <div data-testid="home" />;
}

function LoanPage() {
  return <div data-testid="loan" />;
}

function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute({
    component: AppRoot.options.component,
    notFoundComponent: AppRoot.options.notFoundComponent,
  });
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomePage,
  });
  const loan = createRoute({
    getParentRoute: () => rootRoute,
    path: "/loans/$id",
    component: LoanPage,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([home, loan]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

async function renderApp(initialPath: string) {
  const router = buildRouter(initialPath);
  const result = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  await waitFor(() => expect(router.state.status).toBe("idle"));
  const authed = getSessionState().status === "authenticated";
  const testId = !authed
    ? "sign-in-overlay"
    : initialPath.startsWith("/loans/")
      ? "loan"
      : "home";
  await screen.findByTestId(testId);
  const navigate = vi.spyOn(router, "navigate");
  return { router, navigate, ...result };
}

async function signOutFromMenu() {
  fireEvent.click(await screen.findByRole("button", { name: "Account menu" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
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
  it("sign-in on / keeps the URL and renders the app without navigating", async () => {
    const { router, navigate, container } = await renderApp("/");

    act(() => authenticate());

    expect(await screen.findByTestId("home")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(navigate).not.toHaveBeenCalled();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("deep link signed out shows the overlay on the same URL, then the page after sign-in", async () => {
    const { router, navigate } = await renderApp("/loans/123");
    expect(router.state.location.pathname).toBe("/loans/123");
    expect(screen.queryByTestId("loan")).not.toBeInTheDocument();

    act(() => authenticate());

    expect(await screen.findByTestId("loan")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/loans/123");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sign-out click on /loans/123 replaces the URL with / and renders the overlay", async () => {
    authenticate();
    const { router, navigate, container } = await renderApp("/loans/123");

    await signOutFromMenu();

    expect(await screen.findByTestId("sign-in-overlay")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(router.history.length).toBe(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/", replace: true }),
    );
    expect(screen.queryByTestId("loan")).not.toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("sign-out click on / stays on / and renders the overlay", async () => {
    authenticate();
    const { router, navigate, container } = await renderApp("/");

    await signOutFromMenu();

    expect(await screen.findByTestId("sign-in-overlay")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(container).not.toBeEmptyDOMElement();
  });

  it("a session status change to unauthenticated alone does not navigate", async () => {
    authenticate();
    const { router, navigate } = await renderApp("/loans/123");

    act(() => setSessionStatus("unauthenticated"));

    expect(await screen.findByTestId("sign-in-overlay")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/loans/123");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("token expiry on /loans/123 keeps the URL and renders the overlay", async () => {
    authenticate(Date.now() + 700);
    const { router, navigate, container } = await renderApp("/loans/123");

    expect(await screen.findByTestId("sign-in-overlay")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/loans/123");
    expect(screen.queryByTestId("loan")).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(container).not.toBeEmptyDOMElement();
  });

  it("unauthorized reset does not navigate", async () => {
    const { router, navigate } = await renderApp("/loans/123");

    act(() => setSessionStatus("unauthorized", "Not allowed"));
    act(() => screen.getByText("Try a different wallet").click());

    expect(navigate).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/loans/123");
    expect(screen.getByTestId("sign-in-overlay")).toBeInTheDocument();
  });

  it("an unknown path such as a stale /sign-in lands on / once authenticated", async () => {
    authenticate();
    const { router } = await renderApp("/sign-in");

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByTestId("home")).toBeInTheDocument();
  });
});
