// spec: docs/frontend/auth-components.md#session-module
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { AuthFlowProvider } from "@/auth";
import { saveSession, readSession } from "@/auth/session";

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
        <RouterProvider router={router} />
      </AuthFlowProvider>,
    );

    await waitFor(() => expect(readSession()).toBeNull());
    await screen.findByTestId("topbar-sign-in-button");
    expect(screen.getByTestId("topbar-sign-up-button")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("leaves the session intact for an unrelated 403", async () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    );
    const router = buildRouter();

    render(
      <AuthFlowProvider>
        <RouterProvider router={router} />
      </AuthFlowProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(readSession()).not.toBeNull();
  });
});
