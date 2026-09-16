import { describe, it, expect, vi } from "vitest";
import { Route } from "./dashboard";

const { mockIsMainnet } = vi.hoisted(() => ({
  mockIsMainnet: { value: false },
}));

vi.mock("@/wallet/networkSwitcher", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/wallet/networkSwitcher")>();
  return {
    ...original,
    isMainnetDeployment: () => mockIsMainnet.value,
  };
});

type RedirectObject = { options: { to: string } };

function captureBeforeLoad(): RedirectObject | undefined {
  const beforeLoad = Route.options.beforeLoad as
    | ((ctx: unknown) => unknown)
    | undefined;
  if (!beforeLoad)
    throw new Error("beforeLoad is not defined on /dashboard route");

  let thrown: unknown;
  try {
    beforeLoad({});
  } catch (e) {
    thrown = e;
  }
  return thrown as RedirectObject | undefined;
}

describe("/dashboard route — mainnet redirect guard (#1243)", () => {
  it("redirects to / on mainnet", () => {
    mockIsMainnet.value = true;
    const redirected = captureBeforeLoad();
    expect(redirected?.options.to).toBe("/");
  });

  it("does not redirect on testnet", () => {
    mockIsMainnet.value = false;
    const redirected = captureBeforeLoad();
    expect(redirected).toBeUndefined();
  });
});
