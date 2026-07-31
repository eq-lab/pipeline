/**
 * Unit tests for the pure auth-gate decision (`authGate.ts`, #791/#921).
 *
 * This is the logic that used to live in `RouteGate`'s render-phase `<Navigate>`
 * (which raced in production, #921) and now drives the router's `beforeLoad`
 * guard. Testing it as a pure function keeps the redirect rules verified without
 * a router/DOM.
 */
import { describe, it, expect } from "vitest";
import { resolveAuthRedirect } from "./authGate";

describe("resolveAuthRedirect (#921)", () => {
  it("redirects an authenticated visitor OFF /sign-in to /", () => {
    expect(resolveAuthRedirect("authenticated", "/sign-in")).toBe("/");
  });

  it("redirects an unauthenticated visitor on a protected route to /sign-in", () => {
    expect(resolveAuthRedirect("unauthenticated", "/")).toBe("/sign-in");
    expect(resolveAuthRedirect("unauthenticated", "/loans")).toBe("/sign-in");
  });

  it("stays (no redirect) for an authenticated visitor on a protected route", () => {
    expect(resolveAuthRedirect("authenticated", "/")).toBeNull();
    expect(resolveAuthRedirect("authenticated", "/cash-management")).toBeNull();
  });

  it("stays on /sign-in while still connecting — not yet authenticated", () => {
    expect(resolveAuthRedirect("connecting", "/sign-in")).toBeNull();
  });

  it("keeps an unauthorized visitor on /sign-in (shows the error card, no loop)", () => {
    expect(resolveAuthRedirect("unauthorized", "/sign-in")).toBeNull();
  });

  it("sends a connecting/unauthorized visitor on a protected route to /sign-in", () => {
    expect(resolveAuthRedirect("connecting", "/")).toBe("/sign-in");
    expect(resolveAuthRedirect("unauthorized", "/loans")).toBe("/sign-in");
  });
});
