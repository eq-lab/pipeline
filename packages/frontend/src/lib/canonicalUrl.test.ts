// spec: docs/FRONTEND.md#page-url-canonicalisation-and-boot-guard
import { describe, it, expect, vi } from "vitest";
import html from "../../index.html?raw";

function scriptBody(source: string): string {
  const head = source.slice(0, source.indexOf("</head>"));
  const m = /<script>([\s\S]*?)<\/script>/.exec(head);
  if (!m) throw new Error("no inline script");
  return m[1] ?? "";
}

function run(url: string, replace: () => void = () => {}) {
  const win: Record<string, unknown> = {};
  const loc = { replace: vi.fn(replace) };
  new Function("document", "location", "window", scriptBody(html))(
    { URL: url },
    loc,
    win,
  );
  return { loc, win };
}

describe("inline URL canonicalisation script", () => {
  it("is the first script in head, before theme, env and module entry", () => {
    const body = scriptBody(html);
    const at = html.indexOf(body);
    expect(body).toContain("document.URL");
    expect(at).toBeLessThan(html.indexOf("pipeline-theme"));
    expect(at).toBeLessThan(html.indexOf("/__env.js"));
    expect(at).toBeLessThan(html.indexOf('type="module"'));
  });

  it("strips credentials and sets the flag", () => {
    const { loc, win } = run("https://user:pass@host.example/sign-in?x=1#h");
    expect(loc.replace).toHaveBeenCalledTimes(1);
    expect(loc.replace).toHaveBeenCalledWith(
      "https://host.example/sign-in?x=1#h",
    );
    expect(win.__PIPELINE_URL_CANONICALISING__).toBe(true);
  });

  it("handles username-only and password-only URLs", () => {
    expect(run("https://user@host.example/").loc.replace).toHaveBeenCalledWith(
      "https://host.example/",
    );
    expect(run("https://:pass@host.example/").loc.replace).toHaveBeenCalledWith(
      "https://host.example/",
    );
  });

  it("does nothing for a plain URL", () => {
    const { loc, win } = run("https://host.example/loans");
    expect(loc.replace).not.toHaveBeenCalled();
    expect(win.__PIPELINE_URL_CANONICALISING__).toBeUndefined();
  });

  it("does not throw on unparsable URLs", () => {
    for (const u of ["not a url", "about:blank"]) {
      const { loc } = run(u);
      expect(loc.replace).not.toHaveBeenCalled();
    }
  });

  it("does not throw or set the flag when replace throws", () => {
    const { win } = run("https://user:pass@host.example/", () => {
      throw new Error("boom");
    });
    expect(win.__PIPELINE_URL_CANONICALISING__).toBeUndefined();
  });
});
