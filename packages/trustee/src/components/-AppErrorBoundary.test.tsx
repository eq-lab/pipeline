// spec: docs/frontend/trustee-flows.md#app-bootstrap--providers
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppErrorBoundary, AppErrorView } from "./AppErrorBoundary";

function Thrower({ value }: { value: unknown }): never {
  throw value;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("renders the error view for a thrown undefined instead of an empty tree", () => {
    const { container } = render(
      <AppErrorBoundary>
        <Thrower value={undefined} />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("Non-error value thrown: undefined"),
    ).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
    expect(consoleError).toHaveBeenCalledWith(
      "[trustee] render",
      expect.objectContaining({ type: "undefined" }),
    );
  });

  it("shows the message and stack for a thrown Error", () => {
    const { container } = render(
      <AppErrorBoundary>
        <Thrower value={new Error("boom")} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(container.querySelector("pre")).toHaveTextContent("boom");
    expect(screen.getByText(/Path: /)).toBeInTheDocument();
  });

  it("renders children when nothing throws", () => {
    render(
      <AppErrorBoundary>
        <p>fine</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Reload calls window.location.reload", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload, pathname: original.pathname },
    });
    render(<AppErrorView error={new Error("x")} />);
    screen.getByRole("button", { name: "Reload" }).click();
    expect(reload).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: original,
    });
  });
});

describe("AppErrorView as defaultErrorComponent", () => {
  it("renders for a route component that throws an Error", async () => {
    const rootRoute = createRootRoute({
      component: () => <Thrower value={new Error("route boom")} />,
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
      defaultErrorComponent: AppErrorView,
    });
    render(<RouterProvider router={router} />);
    await waitFor(() =>
      expect(screen.getByText("route boom")).toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
