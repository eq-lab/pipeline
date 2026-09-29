import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
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
    document
      .querySelector(
        'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]',
      )
      ?.remove();
    vi.useRealTimers();
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

  it("reports script failure and renders after retry", async () => {
    delete window.turnstile;
    const onStatusChange = vi.fn();
    const ref = createRef<TurnstileHandle>();
    render(
      <Turnstile ref={ref} onToken={vi.fn()} onStatusChange={onStatusChange} />,
    );
    const script = document.querySelector(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]',
    );
    expect(script).not.toBeNull();

    await act(async () => fireEvent.error(script!));
    expect(onStatusChange).toHaveBeenLastCalledWith("error");
    expect(script?.isConnected).toBe(false);

    window.turnstile = {
      render: renderMock,
      reset: resetMock,
      remove: removeMock,
    };
    act(() => ref.current?.retry());
    await vi.waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    expect(onStatusChange).toHaveBeenCalledWith("loading");
  });

  it("times out a script that never settles", async () => {
    vi.useFakeTimers();
    delete window.turnstile;
    const onStatusChange = vi.fn();
    render(<Turnstile onToken={vi.fn()} onStatusChange={onStatusChange} />);

    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    expect(onStatusChange).toHaveBeenLastCalledWith("error");
    expect(
      document.querySelector(
        'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]',
      ),
    ).toBeNull();
  });

  it("reports render failure, expiry, and widget challenge failure", async () => {
    const onToken = vi.fn();
    const onStatusChange = vi.fn();
    renderMock.mockImplementationOnce(() => {
      throw new Error("render failed");
    });
    const ref = createRef<TurnstileHandle>();
    render(
      <Turnstile ref={ref} onToken={onToken} onStatusChange={onStatusChange} />,
    );
    await vi.waitFor(() =>
      expect(onStatusChange).toHaveBeenLastCalledWith("error"),
    );

    act(() => ref.current?.retry());
    await vi.waitFor(() => expect(renderMock).toHaveBeenCalledTimes(2));
    const options = renderMock.mock.calls[1]![1];
    act(() => options.callback("fresh-token"));
    expect(onStatusChange).toHaveBeenLastCalledWith("ready");
    act(() => options["expired-callback"]());
    expect(onToken).toHaveBeenLastCalledWith("");
    expect(onStatusChange).toHaveBeenLastCalledWith("expired");
    act(() => ref.current?.retry());
    await vi.waitFor(() => expect(renderMock).toHaveBeenCalledTimes(3));
    act(() => options["error-callback"]());
    expect(onStatusChange).not.toHaveBeenLastCalledWith("error");
    act(() => renderMock.mock.calls[2]![1]["error-callback"]());
    expect(onStatusChange).toHaveBeenLastCalledWith("error");
  });
});
