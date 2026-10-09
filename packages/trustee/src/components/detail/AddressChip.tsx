// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import { useEffect, useState } from "react";
import { INK_MUTED, LINE_COLOR } from "./detailTokens";

const TAIL_LENGTH = 5;
const COPIED_MS = 1600;

export function shortAddress(value: string): string {
  return value.length > TAIL_LENGTH ? `…${value.slice(-TAIL_LENGTH)}` : value;
}

export async function copyAddress(value: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function AddressChip({
  value,
  testId,
}: {
  value: string;
  testId?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function toggle() {
    if (revealed) {
      setRevealed(false);
      setCopied(false);
      return;
    }
    setRevealed(true);
    void copyAddress(value).then(setCopied);
  }

  return (
    <span className="inline-flex max-w-full items-center gap-[6px] align-middle">
      <button
        type="button"
        data-testid={testId}
        data-revealed={revealed ? "true" : "false"}
        title={value}
        onClick={toggle}
        className="inline-flex max-w-full items-center rounded-[4px] border border-solid bg-white px-[7px] py-[3px] text-left font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] break-all text-[#262524]"
        style={{ borderColor: LINE_COLOR }}
      >
        {revealed ? value : shortAddress(value)}
      </button>
      {copied && (
        <span
          aria-live="polite"
          className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] whitespace-nowrap"
          style={{ color: INK_MUTED }}
        >
          Copied
        </span>
      )}
    </span>
  );
}
