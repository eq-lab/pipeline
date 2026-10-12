// spec: docs/frontend/ui-components.md#otpinput
import { forwardRef, useImperativeHandle, useRef } from "react";
import { useOtpInput } from "./useOtpInput";

export interface OtpInputProps {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  invalid?: boolean;
  "aria-label"?: string;
}

export interface OtpInputHandle {
  focus: () => void;
}

export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(
  function OtpInput(
    {
      value,
      onChange,
      length = 6,
      invalid,
      "aria-label": ariaLabel = "Verification code",
    },
    ref,
  ) {
    const { focused, onFocus, onBlur, sanitize } = useOtpInput();
    const inputRef = useRef<HTMLInputElement>(null);
    const boxes = Array.from({ length });
    const caretIndex = invalid
      ? Math.min(value.length, length - 1)
      : value.length;

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        },
      }),
      [],
    );

    return (
      <div
        className="relative flex w-full items-center gap-2"
        onClick={() => inputRef.current?.focus()}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => onChange(sanitize(e.target.value, length))}
          onFocus={onFocus}
          onBlur={onBlur}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          className="absolute inset-0 z-10 h-full w-full cursor-default opacity-0"
        />
        {boxes.map((_, index) => {
          const isActive = focused && index === caretIndex;
          return (
            <div
              key={index}
              aria-hidden="true"
              className={[
                "flex h-16 min-w-0 flex-1 items-center justify-center",
                "rounded-[var(--radius-pipeline-card)] px-3",
                invalid
                  ? "bg-[var(--color-pipeline-negative-secondary)]"
                  : "bg-[var(--color-pipeline-surface)]",
                isActive
                  ? "border border-solid border-[color:var(--color-pipeline-ink-subtle)]"
                  : "",
              ].join(" ")}
            >
              {value[index] ? (
                <span
                  className={[
                    "font-[family-name:var(--font-display)]",
                    "text-[24px] leading-[28px]",
                    "font-[var(--font-weight-regular)]",
                    invalid
                      ? "text-[color:var(--color-pipeline-negative-strong)]"
                      : "text-[color:var(--color-pipeline-ink)]",
                  ].join(" ")}
                >
                  {value[index]}
                </span>
              ) : isActive ? (
                <span className="h-7 w-px rounded-[1px] bg-[color:var(--color-pipeline-ink)]" />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  },
);

export default OtpInput;
