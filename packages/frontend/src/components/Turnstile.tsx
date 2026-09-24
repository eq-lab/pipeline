// spec: docs/frontend/auth-components.md#turnstile
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { ENV } from "@/lib/env";

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileRenderOptions {
  sitekey: string;
  size: "flexible";
  callback: (token: string) => void;
  "expired-callback"?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoadPromise: Promise<void> | undefined;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoadPromise ??= new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export interface TurnstileHandle {
  reset: () => void;
}

export interface TurnstileProps {
  onToken: (token: string) => void;
}

export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(
  function Turnstile({ onToken }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | undefined>(undefined);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useEffect(() => {
      if (!ENV.TURNSTILE_SITE_KEY) return;
      let cancelled = false;

      void loadScript().then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: ENV.TURNSTILE_SITE_KEY,
          // Visibility is set by the widget mode in the Cloudflare dashboard, not
          // here — "invisible" is not a valid `size` and makes render() throw.
          size: "flexible",
          callback: (token) => onTokenRef.current(token),
        });
      });

      return () => {
        cancelled = true;
        if (widgetIdRef.current !== undefined) {
          window.turnstile?.remove(widgetIdRef.current);
          widgetIdRef.current = undefined;
        }
      };
    }, []);

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetIdRef.current !== undefined) {
          window.turnstile?.reset(widgetIdRef.current);
        }
      },
    }));

    if (!ENV.TURNSTILE_SITE_KEY) return null;
    return <div ref={containerRef} data-testid="turnstile-widget" />;
  },
);

export default Turnstile;
