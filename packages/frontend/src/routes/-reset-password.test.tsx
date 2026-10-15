import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/api";
import { readSession, saveSession } from "@/auth/session";

const mockResetPassword = vi.fn();
const mockNavigate = vi.fn();
const mockOpenAuthFlow = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    resetPassword: (...args: unknown[]) => mockResetPassword(...args),
  };
});

vi.mock("@/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth")>();
  return {
    ...actual,
    useAuthFlow: () => ({
      open: mockOpenAuthFlow,
      close: vi.fn(),
      lpRead: "unknown" as const,
      openAccountSetup: vi.fn(),
      openAddEmail: vi.fn(),
    }),
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...original, useNavigate: () => mockNavigate };
});

import { Route } from "./reset-password";
import { readResetToken } from "@/components/useResetPasswordFlow";

const TOKEN = "ab".repeat(32);

function renderRoute(hash: string) {
  window.location.hash = hash;
  const Component = Route.options.component as React.ComponentType;
  return render(<Component />);
}

beforeEach(() => {
  localStorage.clear();
  mockResetPassword.mockReset();
  mockNavigate.mockReset();
  mockOpenAuthFlow.mockReset();
});

afterEach(() => {
  document.body.style.overflow = "";
  window.history.replaceState(null, "", "/");
});

describe("readResetToken", () => {
  it("accepts a 64-hex token in the fragment and rejects everything else", () => {
    expect(readResetToken(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(readResetToken(`#token=${TOKEN.toUpperCase()}`)).toBe(
      TOKEN.toUpperCase(),
    );
    expect(readResetToken("")).toBeUndefined();
    expect(readResetToken("#token=")).toBeUndefined();
    expect(readResetToken("#token=abc")).toBeUndefined();
    expect(readResetToken(`#token=${"zz".repeat(32)}`)).toBeUndefined();
    expect(readResetToken(`#other=${TOKEN}`)).toBeUndefined();
  });
});

describe("/reset-password route", () => {
  it("no fragment → expired view, no request", () => {
    renderRoute("");
    expect(
      screen.getByRole("dialog", { name: "This link has expired" }),
    ).toBeInTheDocument();
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("malformed token → expired view", () => {
    renderRoute("#token=nope");
    expect(
      screen.getByRole("dialog", { name: "This link has expired" }),
    ).toBeInTheDocument();
  });

  it("well-formed token → form view and the fragment is stripped from the URL", async () => {
    renderRoute(`#token=${TOKEN}`);
    expect(
      screen.getByRole("dialog", { name: "Set a new password" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("204 → done view, local session cleared, Sign in navigates home and opens sign-in", async () => {
    const user = userEvent.setup();
    saveSession({ token: "stale", expires_in: 3600, email: "lp@example.com" });
    mockResetPassword.mockResolvedValue(undefined);
    renderRoute(`#token=${TOKEN}`);

    await user.type(screen.getByPlaceholderText("New password"), "P@ssw0rd!");
    await user.click(screen.getByRole("button", { name: "Save new password" }));

    expect(mockResetPassword).toHaveBeenCalledWith({
      token: TOKEN,
      password: "P@ssw0rd!",
    });
    expect(
      await screen.findByRole("dialog", { name: "Password updated" }),
    ).toBeInTheDocument();
    expect(readSession()).toBeNull();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(mockOpenAuthFlow).toHaveBeenCalledWith("sign-in");
  });

  it("401 → expired view; Request a new link navigates home and opens forgot-password", async () => {
    const user = userEvent.setup();
    mockResetPassword.mockRejectedValue(
      new ApiError(401, "invalid or expired reset link"),
    );
    renderRoute(`#token=${TOKEN}`);

    await user.type(screen.getByPlaceholderText("New password"), "P@ssw0rd!");
    await user.click(screen.getByRole("button", { name: "Save new password" }));

    expect(
      await screen.findByRole("dialog", { name: "This link has expired" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Request a new link" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(mockOpenAuthFlow).toHaveBeenCalledWith("forgot-password");
  });

  it("400 → the backend message under the field, cleared on edit; stays on the form", async () => {
    const user = userEvent.setup();
    mockResetPassword.mockRejectedValue(
      new ApiError(400, "password must contain a digit"),
    );
    renderRoute(`#token=${TOKEN}`);

    await user.type(screen.getByPlaceholderText("New password"), "P@ssw0rd!");
    await user.click(screen.getByRole("button", { name: "Save new password" }));

    expect(
      await screen.findByText("password must contain a digit"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Set a new password" }),
    ).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("New password"), "x");
    expect(
      screen.queryByText("password must contain a digit"),
    ).not.toBeInTheDocument();
  });

  it("network failure → generic alert, stays on the form", async () => {
    const user = userEvent.setup();
    mockResetPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    renderRoute(`#token=${TOKEN}`);

    await user.type(screen.getByPlaceholderText("New password"), "P@ssw0rd!");
    await user.click(screen.getByRole("button", { name: "Save new password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network error — check your connection and try again.",
    );
  });

  it("× navigates home without opening the auth flow", async () => {
    const user = userEvent.setup();
    renderRoute(`#token=${TOKEN}`);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(mockOpenAuthFlow).not.toHaveBeenCalled();
  });
});
