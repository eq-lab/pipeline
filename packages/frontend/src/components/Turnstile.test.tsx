import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { render } from "@testing-library/react";
import { Turnstile, type TurnstileHandle } from "./Turnstile";

vi.mock("@/lib/env", () => ({
  ENV: { TURNSTILE_SITE_KEY: "test-site-key" },
}));

type RenderFn = NonNullable<typeof window.turnstile>["render"];
type ResetFn = NonNullable<typeof window.turnstile>["reset"];
type RemoveFn = NonNullable<typeof window.turnstile>["remove"];

describe("Turnstile", () => {
  let renderMock: ReturnType<typeof vi.fn<RenderFn>>;
  let resetMock: ReturnType<typeof vi.fn<ResetFn>>;
  let removeMock: ReturnType<typeof vi.fn<RemoveFn>>;

  beforeEach(() => {
    renderMock = vi.fn<RenderFn>().mockReturnValue("widget-1");
    resetMock = vi.fn<ResetFn>();
    removeMock = vi.fn<RemoveFn>();
    window.turnstile = {
      render: renderMock,
      reset: resetMock,
      remove: removeMock,
    };
  });

  afterEach(() => {
    delete window.turnstile;
  });

  it("renders a flexible-size widget and forwards the token via onToken", async () => {
    const onToken = vi.fn();
    render(<Turnstile onToken={onToken} />);

    await vi.waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const options = renderMock.mock.calls[0]![1] as {
      size: string;
      callback: (t: string) => void;
    };
    expect(options.size).toBe("flexible");
    options.callback("tok-123");

    expect(onToken).toHaveBeenCalledWith("tok-123");
  });

  it("reset() calls turnstile.reset with the rendered widget id", async () => {
    const ref = createRef<TurnstileHandle>();
    render(<Turnstile ref={ref} onToken={vi.fn()} />);

    await vi.waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    ref.current?.reset();

    expect(resetMock).toHaveBeenCalledWith("widget-1");
  });

  it("removes the widget on unmount", async () => {
    const { unmount } = render(<Turnstile onToken={vi.fn()} />);
    await vi.waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));

    unmount();

    expect(removeMock).toHaveBeenCalledWith("widget-1");
  });
});
