/**
 * Tests for the /withdraw → /deposit redirect contract (Issue #359).
 *
 * The /withdraw route file now contains only a `beforeLoad` that throws a
 * `redirect(...)`. These tests verify the redirect payload directly by
 * invoking the `beforeLoad` function extracted from the route options.
 *
 * TanStack Router's `redirect()` returns an object with shape:
 *   { options: { to, search, replace, statusCode } }
 *
 * Cases:
 *   1. /withdraw redirects to /deposit?direction=withdraw with replace: true.
 *   2. /withdraw?foo=bar preserves other search params, sets direction=withdraw.
 */
import { describe, it, expect, vi } from "vitest";
import { Route } from "./withdraw";

// ── TanStack Router mock ──────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    createFileRoute: original.createFileRoute,
    redirect: original.redirect,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

type RedirectObject = {
  options: {
    to: string;
    search: Record<string, unknown>;
    replace?: boolean;
    statusCode?: number;
  };
};

function captureRedirect(search: Record<string, unknown>): RedirectObject {
  const beforeLoad = Route.options.beforeLoad;
  if (!beforeLoad)
    throw new Error("beforeLoad is not defined on /withdraw route");

  let thrown: unknown;
  try {
    beforeLoad({ search } as Parameters<typeof beforeLoad>[0]);
  } catch (e) {
    thrown = e;
  }

  if (!thrown) throw new Error("beforeLoad did not throw");
  return thrown as RedirectObject;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("/withdraw route — redirect contract", () => {
  it("redirects to /deposit?direction=withdraw with replace: true", () => {
    const r = captureRedirect({});

    expect(r.options.to).toBe("/deposit");
    expect(r.options.replace).toBe(true);
    expect(r.options.search.direction).toBe("withdraw");
  });

  it("preserves other search params when redirecting from /withdraw?foo=bar", () => {
    const r = captureRedirect({ foo: "bar" });

    expect(r.options.to).toBe("/deposit");
    expect(r.options.search.direction).toBe("withdraw");
    expect(r.options.search.foo).toBe("bar");
  });
});
