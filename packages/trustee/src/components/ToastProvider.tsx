// spec: docs/frontend/trustee-flows.md#toasts
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Toast, type ToastTone } from "@pipeline/ui";

export const TOAST_TIMEOUT_MS = 2400;

export interface ToastApi {
  showToast: (title: string, tone?: ToastTone) => void;
}

interface ToastState {
  id: number;
  title: string;
  tone: ToastTone;
}

const ToastContext = createContext<ToastApi>({ showToast: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | null>(null);
  const nextId = useRef(0);

  const showToast = useCallback(
    (title: string, tone: ToastTone = "success") => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      nextId.current += 1;
      setToast({ id: nextId.current, title, tone });
      timer.current = window.setTimeout(() => setToast(null), TOAST_TIMEOUT_MS);
    },
    [],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo<ToastApi>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed right-[24px] bottom-[24px] z-[60] flex max-w-[calc(100vw-48px)] justify-end">
          <Toast
            key={toast.id}
            tone={toast.tone}
            title={toast.title}
            className="pointer-events-auto"
          />
        </div>
      )}
    </ToastContext.Provider>
  );
}
