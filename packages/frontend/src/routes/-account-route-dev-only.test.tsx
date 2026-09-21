import { describe, it, expect, vi } from "vitest";
import { Route } from "./account";

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

describe("/account route — dev-only guard (#1284)", () => {
  it("redirects to / in production builds", () => {
    mockIsDev.value = false;
    const redirected = captureBeforeLoad();
    expect(redirected?.options.to).toBe("/");
  });

  it("does not redirect under the dev server", () => {
    mockIsDev.value = true;
    const redirected = captureBeforeLoad();
    expect(redirected).toBeUndefined();
  });
});
