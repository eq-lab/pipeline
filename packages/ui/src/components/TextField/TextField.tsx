import React from "react";
import { useTextField } from "./useTextField";

/**
 * TextField — Pipeline UI text/email/password input primitive.
 * spec: docs/frontend/ui-components.md#textfield (Figma → token mapping, Figma node 6486:81613).
 */
export interface TextFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange"
> {
  value: string;
  onChange: (next: string) => void;
  /** "password" renders the eye show/hide toggle. */
  type?: "text" | "email" | "password";
  /** Paints the error fill + red text and wires aria-invalid. */
  invalid?: boolean;
  /** Error line rendered below the field, right-aligned, without shifting layout. */
  error?: string;
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <path
        d="M11 8.25C12.5188 8.25 13.75 9.48122 13.75 11C13.75 12.5188 12.5188 13.75 11 13.75C9.48122 13.75 8.25 12.5188 8.25 11C8.25 9.48122 9.48122 8.25 11 8.25Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11 4.125C15.276 4.125 18.9696 6.60636 20.7335 10.2069C20.8504 10.4456 20.9088 10.5649 20.9431 10.7508C20.9681 10.8865 20.9681 11.1135 20.9431 11.2492C20.9088 11.4351 20.8504 11.5544 20.7335 11.7931C18.9696 15.3936 15.276 17.875 11 17.875C6.72397 17.875 3.03038 15.3936 1.26655 11.7931C1.14963 11.5544 1.09117 11.4351 1.05691 11.2492C1.03192 11.1135 1.03192 10.8865 1.05691 10.7508C1.09117 10.5649 1.14963 10.4456 1.26655 10.2069C3.03038 6.60636 6.72397 4.125 11 4.125ZM11 6.875C8.72182 6.875 6.875 8.72183 6.875 11C6.875 13.2782 8.72182 15.125 11 15.125C13.2782 15.125 15.125 13.2782 15.125 11C15.125 8.72183 13.2782 6.875 11 6.875Z"
        fill="currentColor"
      />
    </svg>
  );
}

function EyeSlashedIcon() {
  return (
    <svg
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.09735 4.0973C4.36583 3.82884 4.80104 3.82882 5.06951 4.0973L18.0326 17.0604C18.3011 17.3289 18.3011 17.765 18.0326 18.0335C17.7641 18.3015 17.3288 18.3018 17.0605 18.0335L15.7857 16.7579C14.3427 17.4717 12.7191 17.875 11.0001 17.8751C6.72414 17.8751 3.03065 15.3936 1.26678 11.7932C1.14987 11.5545 1.09157 11.4348 1.05731 11.2489C1.03237 11.1133 1.03238 10.8868 1.05731 10.7512C1.09157 10.5652 1.14986 10.4456 1.26678 10.2069C2.11164 8.48234 3.39952 7.01522 4.98179 5.95391L4.09735 5.06947C3.82886 4.80098 3.82886 4.36579 4.09735 4.0973ZM7.63869 8.61081C7.15843 9.28503 6.8751 10.1092 6.8751 11.0001C6.87512 13.2782 8.72194 15.1251 11.0001 15.1251C11.8907 15.125 12.7144 14.8414 13.3884 14.3615L12.3939 13.3669C11.9848 13.6084 11.5095 13.75 11.0001 13.7501C9.48133 13.7501 8.25012 12.5188 8.2501 11.0001C8.2501 10.4903 8.39146 10.0146 8.63323 9.60536L7.63869 8.61081Z"
        fill="currentColor"
      />
      <path
        d="M11.0001 4.12505C15.276 4.12513 18.9696 6.60646 20.7334 10.2069C20.8503 10.4455 20.9086 10.5653 20.9429 10.7512C20.9678 10.8868 20.9678 11.1134 20.9429 11.2489C20.9086 11.4348 20.8503 11.5545 20.7334 11.7932C20.0367 13.2154 19.0372 14.461 17.8214 15.45L14.8503 12.4789C15.0268 12.0197 15.1251 11.5214 15.1251 11.0001C15.1251 8.72194 13.2782 6.87516 11.0001 6.87505C10.4786 6.87505 9.97969 6.97239 9.52036 7.14898L7.18751 4.81613C8.37316 4.3694 9.65805 4.12505 11.0001 4.12505Z"
        fill="currentColor"
      />
      <path
        d="M11.0001 8.25005C12.5188 8.25016 13.7501 9.48133 13.7501 11.0001C13.7501 11.1202 13.7409 11.2384 13.7259 11.3545L10.6447 8.27333C10.761 8.25832 10.8797 8.25005 11.0001 8.25005Z"
        fill="currentColor"
      />
    </svg>
  );
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    { value, onChange, type = "text", invalid, error, className, ...rest },
    ref,
  ) {
    const { inputType, showPassword, toggleShowPassword, errorId } =
      useTextField({ type });
    const isPassword = type === "password";

    return (
      <div className={["relative w-full", className].filter(Boolean).join(" ")}>
        <div
          className={[
            "flex h-14 w-full items-center gap-1",
            "rounded-[var(--radius-pipeline-card)] px-3",
            invalid
              ? "bg-[var(--color-pipeline-negative-secondary)]"
              : "bg-[var(--color-pipeline-surface)]",
          ].join(" ")}
        >
          <input
            ref={ref}
            type={inputType}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={error ? errorId : undefined}
            className={[
              "min-w-0 flex-1 bg-transparent outline-none",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "font-[var(--font-weight-regular)]",
              "placeholder:text-[color:var(--color-pipeline-ink-muted)]",
              invalid
                ? "text-[color:var(--color-pipeline-negative-strong)]"
                : "text-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
            {...rest}
          />
          {isPassword ? (
            <button
              type="button"
              onClick={toggleShowPassword}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className={[
                "flex size-8 shrink-0 items-center justify-center",
                "rounded-[var(--radius-pipeline-card)]",
                "text-[color:var(--color-pipeline-ink)]",
                "cursor-pointer bg-transparent",
              ].join(" ")}
            >
              {showPassword ? <EyeSlashedIcon /> : <EyeIcon />}
            </button>
          ) : null}
        </div>
        {error ? (
          <p
            id={errorId}
            role="alert"
            className={[
              "absolute top-full right-0 mt-0.5",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "text-right text-[color:var(--color-pipeline-negative-strong)]",
            ].join(" ")}
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);

TextField.displayName = "TextField";

export default TextField;
