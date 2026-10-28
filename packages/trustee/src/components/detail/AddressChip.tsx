// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import { useState } from "react";
import { useCopyToClipboard } from "@pipeline/ui";
import { INK_MUTED, LINE_COLOR } from "./detailTokens";

const TAIL_LENGTH = 5;
const COPIED_MS = 1600;

export function shortAddress(value: string): string {
  return value.length > TAIL_LENGTH ? `…${value.slice(-TAIL_LENGTH)}` : value;
}

export function AddressChip({
  value,
  testId,
}: {
  value: string;
  testId?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const { copied, copy } = useCopyToClipboard(COPIED_MS);

  function toggle() {
    if (revealed) {
      setRevealed(false);
      return;
    }
    setRevealed(true);
    void copy(value);
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
      {revealed && copied && (
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
