// spec: docs/frontend/trustee-flows.md#app-bootstrap--providers
import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimAppBoot } from "./bootGuard";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  delete window.__PIPELINE_BOOTED__;
  delete window.__PIPELINE_URL_CANONICALISING__;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("claimAppBoot", () => {
  it("allows the first boot and sets the flag", () => {
    expect(claimAppBoot(document.createElement("div"))).toBe(true);
    expect(window.__PIPELINE_BOOTED__).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("refuses a second boot and logs once", () => {
    claimAppBoot(document.createElement("div"));
    expect(claimAppBoot(document.createElement("div"))).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("[trustee] duplicate boot");
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain("pass");
  });

  it("refuses when the root already has a React container", () => {
    const root = document.createElement("div");
    (root as unknown as Record<string, unknown>)["__reactContainer$abc"] = {};
    expect(claimAppBoot(root)).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("skips silently while the URL is being canonicalised", () => {
    window.__PIPELINE_URL_CANONICALISING__ = true;
    expect(claimAppBoot(document.createElement("div"))).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(window.__PIPELINE_BOOTED__).toBeUndefined();
  });
});
