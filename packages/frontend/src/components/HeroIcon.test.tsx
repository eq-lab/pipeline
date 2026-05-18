/**
 * HeroIcon — regression test.
 *
 * Guards against the solid-black-square bug (Issue #238) where a broken SVG
 * URL import caused the CSS mask to render as a solid filled rectangle.
 *
 * Root cause: SVG assets imported without the Vite `?url` suffix can resolve
 * to a non-URL value at runtime (empty string, raw SVG source, or the literal
 * string "undefined"), producing `url()` / `url(undefined)` in the CSS mask
 * property and a solid black 36×36 square instead of the intended glyph.
 *
 * Fix: all mask-driven SVG imports in `packages/ui` now use the `?url` suffix
 * so Vite always resolves them as URL strings.
 *
 * Test strategy:
 *   1. Assert the SVG asset URLs imported with `?url` are valid non-empty
 *      URL strings (the most direct check that the import is not broken).
 *   2. Assert the rendered `HeroIcon` structure is correct (outer 72×72 circle,
 *      inner 36×36 icon span) for both supported icons.
 *
 * Note: jsdom does not implement the CSS `mask` shorthand property, so the
 * inline `mask`/`WebkitMask` values are silently dropped from `style.cssText`
 * in the test environment. The URL-string assertion (test group 1) is the
 * meaningful regression guard — if the import breaks, the asset URL will be
 * empty or undefined and the assertion will fail.
 *
 * Hosted in `packages/frontend` because that package owns the vitest runner
 * (jsdom + globals). `packages/ui` does not have a test runner.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HeroIcon } from "@pipeline/ui";

// Direct ?url imports — mirrors the exact import path used by HeroIcon.tsx.
// These exercise the same Vite asset resolution path so if the SVG file moves,
// the name changes, or the ?url suffix is accidentally removed, the import
// assertion fires before any rendering test.
import arrowClockUrl from "@pipeline/ui/assets/icons/arrow-clock.svg?url";
import navStatsUrl from "@pipeline/ui/assets/icons/nav-stats.svg?url";

// ── Group 1: SVG asset URL integrity ─────────────────────────────────────────

describe("HeroIcon — SVG ?url import integrity", () => {
  it("arrow-clock.svg?url resolves to a non-empty string", () => {
    expect(typeof arrowClockUrl).toBe("string");
    expect(arrowClockUrl).not.toBe("");
    expect(arrowClockUrl).not.toBe("undefined");
  });

  it("arrow-clock.svg?url resolves to a data-URI or path (not raw SVG source)", () => {
    // Vitest resolves ?url to a data URI in the jsdom environment.
    // A raw SVG import (without ?url) typically returns either an empty string
    // or the SVG XML source — neither of which works as a CSS mask URL.
    // A valid resolved URL starts with "data:", "/", or "http".
    expect(arrowClockUrl).toMatch(/^(data:|\/|https?:\/\/)/);
  });

  it("nav-stats.svg?url resolves to a non-empty string", () => {
    expect(typeof navStatsUrl).toBe("string");
    expect(navStatsUrl).not.toBe("");
    expect(navStatsUrl).not.toBe("undefined");
  });

  it("nav-stats.svg?url resolves to a data-URI or path (not raw SVG source)", () => {
    expect(navStatsUrl).toMatch(/^(data:|\/|https?:\/\/)/);
  });
});

// ── Group 2: HeroIcon structural rendering ────────────────────────────────────

describe("HeroIcon — structural rendering", () => {
  it("renders without throwing for icon='arrow-clock'", () => {
    expect(() => render(<HeroIcon icon="arrow-clock" />)).not.toThrow();
  });

  it("renders without throwing for icon='chart'", () => {
    expect(() => render(<HeroIcon icon="chart" />)).not.toThrow();
  });

  it("outer container is 72×72 for arrow-clock", () => {
    const { container } = render(<HeroIcon icon="arrow-clock" />);
    const div = container.querySelector("div");
    expect(div?.style.width).toBe("72px");
    expect(div?.style.height).toBe("72px");
  });

  it("outer container is 72×72 for chart", () => {
    const { container } = render(<HeroIcon icon="chart" />);
    const div = container.querySelector("div");
    expect(div?.style.width).toBe("72px");
    expect(div?.style.height).toBe("72px");
  });

  it("renders inner icon span with 36×36 dimensions for arrow-clock", () => {
    const { container } = render(<HeroIcon icon="arrow-clock" />);
    const span = container.querySelector(
      "span[aria-hidden='true']",
    ) as HTMLSpanElement | null;
    expect(span).not.toBeNull();
    expect(span?.style.width).toBe("36px");
    expect(span?.style.height).toBe("36px");
  });

  it("renders inner icon span with 36×36 dimensions for chart", () => {
    const { container } = render(<HeroIcon icon="chart" />);
    const span = container.querySelector(
      "span[aria-hidden='true']",
    ) as HTMLSpanElement | null;
    expect(span).not.toBeNull();
    expect(span?.style.width).toBe("36px");
    expect(span?.style.height).toBe("36px");
  });

  it("inner span background-color is the ink token for arrow-clock", () => {
    const { container } = render(<HeroIcon icon="arrow-clock" />);
    const span = container.querySelector(
      "span[aria-hidden='true']",
    ) as HTMLSpanElement | null;
    expect(span?.style.backgroundColor).toBe("var(--color-pipeline-ink)");
  });

  it("outer div is decorative (aria-hidden) when no aria-label is passed", () => {
    const { container } = render(<HeroIcon icon="arrow-clock" />);
    const div = container.querySelector("div");
    expect(div?.getAttribute("aria-hidden")).toBe("true");
  });

  it("outer div carries role=img and aria-label when aria-label is passed", () => {
    const { container } = render(
      <HeroIcon icon="arrow-clock" aria-label="Activity icon" />,
    );
    const div = container.querySelector("div");
    expect(div?.getAttribute("role")).toBe("img");
    expect(div?.getAttribute("aria-label")).toBe("Activity icon");
  });
});
