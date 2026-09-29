// spec: docs/frontend/auth-components.md#turnstile
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ENV } from "@/lib/env";

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_TIMEOUT_MS = 10000;

export type TurnstileStatus =
  | "loading"
  | "ready"
  | "error"
  | "expired"
  | "unavailable";

interface TurnstileRenderOptions {
  sitekey: string;
  size: "flexible";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
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
let scriptLoaded = false;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoaded) {
    document
      .querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
      ?.remove();
    scriptLoaded = false;
    scriptLoadPromise = undefined;
  }
  if (scriptLoadPromise) return scriptLoadPromise;

  const attempt = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    const created = !script;
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
    }
    const activeScript = script;
    const cleanup = () => {
      window.clearTimeout(timeout);
      activeScript.removeEventListener("load", onLoad);
      activeScript.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      if (window.turnstile) {
        scriptLoaded = true;
        resolve();
      } else {
        activeScript.remove();
        reject(new Error("Turnstile did not initialize"));
      }
    };
    const onError = () => {
      cleanup();
      activeScript.remove();
      scriptLoaded = false;
      reject(new Error("Turnstile failed to load"));
    };
    const timeout = window.setTimeout(onError, SCRIPT_TIMEOUT_MS);
    activeScript.addEventListener("load", onLoad, { once: true });
    activeScript.addEventListener("error", onError, { once: true });
    if (created) document.head.appendChild(activeScript);
  });
  scriptLoadPromise = attempt.catch((error: unknown) => {
    scriptLoadPromise = undefined;
    throw error;
  });
  return scriptLoadPromise;
}

export interface TurnstileHandle {
  reset: () => void;
  retry: () => void;
}

export interface TurnstileProps {
  onToken: (token: string) => void;
  onStatusChange?: (status: TurnstileStatus) => void;
}

export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(
  function Turnstile({ onToken, onStatusChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | undefined>(undefined);
    const onTokenRef = useRef(onToken);
    const onStatusChangeRef = useRef(onStatusChange);
    const [attempt, setAttempt] = useState(0);
    onTokenRef.current = onToken;
    onStatusChangeRef.current = onStatusChange;

    useEffect(() => {
      if (!ENV.TURNSTILE_SITE_KEY) {
        onStatusChangeRef.current?.("unavailable");
        return;
      }
      let cancelled = false;
      onStatusChangeRef.current?.("loading");

      void loadScript().then(
        () => {
          if (cancelled || !containerRef.current) return;
          try {
            if (!window.turnstile) throw new Error("Turnstile unavailable");
            widgetIdRef.current = window.turnstile.render(
              containerRef.current,
              {
                sitekey: ENV.TURNSTILE_SITE_KEY,
                size: "flexible",
                callback: (token) => {
                  if (cancelled) return;
                  onTokenRef.current(token);
                  onStatusChangeRef.current?.("ready");
                },
                "expired-callback": () => {
                  if (cancelled) return;
                  onTokenRef.current("");
                  onStatusChangeRef.current?.("expired");
                },
                "error-callback": () => {
                  if (cancelled) return;
                  onTokenRef.current("");
                  onStatusChangeRef.current?.("error");
                },
              },
            );
          } catch {
            scriptLoadPromise = undefined;
            onTokenRef.current("");
            onStatusChangeRef.current?.("error");
          }
        },
        () => {
          if (cancelled) return;
          onTokenRef.current("");
          onStatusChangeRef.current?.("error");
        },
      );

      return () => {
        cancelled = true;
        if (widgetIdRef.current !== undefined) {
          window.turnstile?.remove(widgetIdRef.current);
          widgetIdRef.current = undefined;
        }
      };
    }, [attempt]);

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetIdRef.current !== undefined) {
          onStatusChangeRef.current?.("loading");
          window.turnstile?.reset(widgetIdRef.current);
        }
      },
      retry: () => {
        onTokenRef.current("");
        setAttempt((current) => current + 1);
      },
    }));

    if (!ENV.TURNSTILE_SITE_KEY) return null;
    return <div ref={containerRef} data-testid="turnstile-widget" />;
  },
);

export default Turnstile;
