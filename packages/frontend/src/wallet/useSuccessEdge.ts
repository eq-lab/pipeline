// spec: docs/frontend/wallet-flows.md#activity-refresh-after-a-confirmed-action
import { useEffect, useRef } from "react";

export function useSuccessEdge(isSuccess: boolean, onEdge: () => void): void {
  const prev = useRef(false);
  const cb = useRef(onEdge);
  cb.current = onEdge;
  useEffect(() => {
    if (isSuccess && !prev.current) cb.current();
    prev.current = isSuccess;
  }, [isSuccess]);
}
