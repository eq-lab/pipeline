// spec: docs/frontend/auth-components.md#session-module
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { AuthFlowProvider } from "@/auth";
import { saveSession, readSession } from "@/auth/session";
import { ToastProvider } from "@/lib/toast";
import { login } from "@/api";

const TOAST_TEXT = "Your session expired. Sign in again to continue.";

vi.mock("@/components/EmailAuthFlow", () => ({
  EmailAuthFlow: ({
    open,
    initialScreen,
  }: {
    open: boolean;
    initialScreen?: string;
  }) =>
    open ? (
      <div data-testid="email-auth-flow">
        <span data-testid="email-auth-flow-screen">{initialScreen}</span>
      </div>
    ) : null,
}));

vi.mock("@/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet")>();
  return {
    ...actual,
    useWalletPresence: () => ({
      isAnyConnected: false,
      isSettled: true,
      disconnectAll: vi.fn(),
    }),
    useConnectModal: () => ({ open: vi.fn(), close: vi.fn() }),
  };
});

vi.mock("@/wallet/networkSwitcher", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/wallet/networkSwitcher")>();
  return { ...actual, isMainnetDeployment: () => false };
});

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function buildRouter() {
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([indexRoute]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderRoot(router: ReturnType<typeof buildRouter>) {
  return render(
    <AuthFlowProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthFlowProvider>,
  );
}

describe("RootLayout — in-session forced sign-out (#1465)", () => {
  it("clears the session and reverts the header silently, with no modal or alert", async () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "account_suspended" }), {
        status: 403,
      }),
    );
    const router = buildRouter();

    render(
      <AuthFlowProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthFlowProvider>,
    );

    await waitFor(() => expect(readSession()).toBeNull());
    await screen.findByTestId("topbar-sign-in-button");
    expect(screen.getByTestId("topbar-sign-up-button")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByText(TOAST_TEXT)).not.toBeInTheDocument();
  });

  it("leaves the session intact for an unrelated 403", async () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    );
    const router = buildRouter();

    render(
      <AuthFlowProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthFlowProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(readSession()).not.toBeNull();
  });
});

describe("RootLayout — session end (#1473)", () => {
  it("signs out when the token lapses, shows the toast, and Sign in opens the sign-in screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    saveSession({ token: "jwt", expires_in: 60 });
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    const router = buildRouter();
    renderRoot(router);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      screen.queryByTestId("topbar-sign-in-button"),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    await screen.findByTestId("topbar-sign-in-button");
    expect(readSession()).toBeNull();
    expect(screen.getByTestId("topbar-sign-up-button")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(await screen.findByText(TOAST_TEXT)).toBeInTheDocument();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByTestId("email-auth-flow-screen"),
    ).toHaveTextContent("sign-in");
  });

  it("signs out with the toast on an authenticated 401", async () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }),
    );
    const router = buildRouter();
    renderRoot(router);

    await waitFor(() => expect(readSession()).toBeNull());
    await screen.findByTestId("topbar-sign-in-button");
    expect(screen.getByTestId("topbar-sign-up-button")).toBeInTheDocument();
    expect(await screen.findAllByText(TOAST_TEXT)).toHaveLength(1);
    expect(router.state.location.pathname).toBe("/");
  });

  it("does not sign out or toast on a login 401", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_credentials" }), {
        status: 401,
      }),
    );
    const router = buildRouter();
    renderRoot(router);
    await screen.findByTestId("topbar-sign-in-button");

    await act(async () => {
      await login({ email: "a@b.co", password: "pw" }).catch(() => {});
    });

    expect(screen.queryByText(TOAST_TEXT)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(screen.getByTestId("topbar-sign-in-button")).toBeInTheDocument();
  });
});
