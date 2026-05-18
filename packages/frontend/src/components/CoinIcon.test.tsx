/**
 * CoinIcon — regression test.
 *
 * Guards against re-introducing the stale base64-PNG embed for USDC (Issue #246).
 *
 * Root cause: USDC was previously rendered from a `data:image/png;base64,…`
 * data URI, which is blurry/aliased at 40 px (lg size). The fix in Issue #246
 * replaces the base64 constant with a real vector SVG imported via Vite's
 * `?url` suffix (matching the pattern established for HeroIcon in Issue #238).
 *
 * Test strategy:
 *   1. Assert the coin-usdc.svg?url import resolves to a valid non-base64-PNG
 *      URL string.
 *   2. Assert the rendered <img> for token="usdc" carries that URL as its src
 *      at all three sizes (sm / md / lg).
 *   3. Assert PLUSD and sPLUSD still render a valid <img> element with correct
 *      width/height (non-regression for the unchanged PNG paths).
 *
 * Hosted in `packages/frontend` because that package owns the vitest runner
 * (jsdom + globals). `packages/ui` does not have a test runner.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CoinIcon } from "@pipeline/ui";

// Direct ?url import — mirrors the exact import path used by CoinIcon.tsx.
import usdcUrl from "@pipeline/ui/assets/icons/coin-usdc.svg?url";

// ── Group 1: SVG asset URL integrity ─────────────────────────────────────────

describe("CoinIcon — coin-usdc.svg ?url import integrity", () => {
  it("coin-usdc.svg?url resolves to a non-empty string", () => {
    expect(typeof usdcUrl).toBe("string");
    expect(usdcUrl).not.toBe("");
    expect(usdcUrl).not.toBe("undefined");
  });

  it("coin-usdc.svg?url is NOT a data:image/png;base64,… URI", () => {
    expect(usdcUrl).not.toMatch(/^data:image\/png;base64,/);
  });

  it("coin-usdc.svg?url resolves to a data-URI or path (not raw SVG source)", () => {
    // Vitest resolves ?url to a data URI in the jsdom environment.
    // A valid resolved URL starts with "data:", "/", or "http".
    expect(usdcUrl).toMatch(/^(data:|\/|https?:\/\/)/);
  });
});

// ── Group 2: USDC render check ────────────────────────────────────────────────

describe("CoinIcon — USDC renders SVG URL at all sizes", () => {
  it("sm (20 px) renders <img> with src=usdcUrl and width/height=20", () => {
    const { container } = render(<CoinIcon token="usdc" size="sm" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(usdcUrl);
    expect(img?.getAttribute("src")).not.toMatch(/^data:image\/png;base64,/);
    expect(img?.getAttribute("width")).toBe("20");
    expect(img?.getAttribute("height")).toBe("20");
  });

  it("md (24 px) renders <img> with src=usdcUrl and width/height=24", () => {
    const { container } = render(<CoinIcon token="usdc" size="md" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(usdcUrl);
    expect(img?.getAttribute("src")).not.toMatch(/^data:image\/png;base64,/);
    expect(img?.getAttribute("width")).toBe("24");
    expect(img?.getAttribute("height")).toBe("24");
  });

  it("lg (40 px) renders <img> with src=usdcUrl and width/height=40", () => {
    const { container } = render(<CoinIcon token="usdc" size="lg" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(usdcUrl);
    expect(img?.getAttribute("src")).not.toMatch(/^data:image\/png;base64,/);
    expect(img?.getAttribute("width")).toBe("40");
    expect(img?.getAttribute("height")).toBe("40");
  });

  it("default size (md) renders src=usdcUrl", () => {
    const { container } = render(<CoinIcon token="usdc" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(usdcUrl);
  });
});

// ── Group 3: PLUSD / sPLUSD non-regression ────────────────────────────────────

describe("CoinIcon — PLUSD and sPLUSD still render (non-regression)", () => {
  it("plusd sm renders <img> with width/height=20", () => {
    const { container } = render(<CoinIcon token="plusd" size="sm" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("width")).toBe("20");
    expect(img?.getAttribute("height")).toBe("20");
  });

  it("plusd md renders <img> with width/height=24", () => {
    const { container } = render(<CoinIcon token="plusd" size="md" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("width")).toBe("24");
    expect(img?.getAttribute("height")).toBe("24");
  });

  it("plusd lg renders <img> with width/height=40", () => {
    const { container } = render(<CoinIcon token="plusd" size="lg" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("width")).toBe("40");
    expect(img?.getAttribute("height")).toBe("40");
  });

  it("splusd renders <img> with correct dimensions", () => {
    const { container } = render(<CoinIcon token="splusd" size="md" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("width")).toBe("24");
    expect(img?.getAttribute("height")).toBe("24");
  });
});

// ── Group 4: Accessibility ────────────────────────────────────────────────────

describe("CoinIcon — accessibility", () => {
  it("is decorative by default (aria-hidden=true)", () => {
    const { container } = render(<CoinIcon token="usdc" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
  });

  it("carries role=img and aria-label when aria-label is provided", () => {
    const { container } = render(
      <CoinIcon token="usdc" aria-label="USDC coin" />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("role")).toBe("img");
    expect(img?.getAttribute("aria-label")).toBe("USDC coin");
  });
});
