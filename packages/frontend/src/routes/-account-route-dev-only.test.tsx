import { describe, it, expect, vi, afterEach } from "vitest";
import { Route } from "./account";
import { saveSession, clearSession } from "@/auth/session";

const { mockIsDev } = vi.hoisted(() => ({
  mockIsDev: { value: true },
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  const env = { ...original.ENV };
  Object.defineProperty(env, "IS_DEV", { get: () => mockIsDev.value });
  return { ...original, ENV: env };
});

type RedirectObject = { options: { to: string } };

function captureBeforeLoad(): RedirectObject | undefined {
  const beforeLoad = Route.options.beforeLoad as
    | ((ctx: unknown) => unknown)
    | undefined;
  if (!beforeLoad)
    throw new Error("beforeLoad is not defined on /account route");

  let thrown: unknown;
  try {
    beforeLoad({});
  } catch (e) {
    thrown = e;
  }
  return thrown as RedirectObject | undefined;
}

describe("/account route — auth guard (#1284, #1362)", () => {
  afterEach(() => {
    clearSession();
  });

  it("redirects to / in production builds with no session", () => {
    mockIsDev.value = false;
    const redirected = captureBeforeLoad();
    expect(redirected?.options.to).toBe("/");
  });

  it("does not redirect under the dev server (no session)", () => {
    mockIsDev.value = true;
    const redirected = captureBeforeLoad();
    expect(redirected).toBeUndefined();
  });

  it("does not redirect in production builds with an authenticated session", () => {
    mockIsDev.value = false;
    saveSession({ token: "t", expires_in: 3600 });
    const redirected = captureBeforeLoad();
    expect(redirected).toBeUndefined();
  });
});
