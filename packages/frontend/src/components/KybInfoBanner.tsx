// spec: docs/frontend/auth-components.md#ownersmodal
import { useId, useState } from "react";

// ── Icons ─────────────────────────────────────────────────────────────────────

function InfoIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M10 18.3333C14.6024 18.3333 18.3333 14.6024 18.3333 10C18.3333 5.39763 14.6024 1.66667 10 1.66667C5.39763 1.66667 1.66667 5.39763 1.66667 10C1.66667 14.6024 5.39763 18.3333 10 18.3333ZM11.0417 6.25C11.0417 6.94031 10.482 7.5 9.79167 7.5C9.10136 7.5 8.54167 6.94031 8.54167 6.25C8.54167 5.55969 9.10136 5 9.79167 5C10.482 5 11.0417 5.55969 11.0417 6.25ZM7.91667 9.16667C7.91667 8.82151 8.19641 8.54167 8.54167 8.54167H10C10.3453 8.54167 10.625 8.82151 10.625 9.16667V13.125H11.6667C12.0119 13.125 12.2917 13.4048 12.2917 13.75C12.2917 14.0952 12.0119 14.375 11.6667 14.375H8.33333C7.98808 14.375 7.70833 14.0952 7.70833 13.75C7.70833 13.4048 7.98808 13.125 8.33333 13.125H9.375V9.79167H8.54167C8.19641 9.79167 7.91667 9.51182 7.91667 9.16667Z" />
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface KybInfoBannerProps {
  children: React.ReactNode;
  tooltip?: string;
}

// ── Banner component ──────────────────────────────────────────────────────────

export function KybInfoBanner({ children, tooltip }: KybInfoBannerProps) {
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div
      className={[
        "flex min-h-[56px] w-full items-center",
        "rounded-[var(--radius-pipeline-card)]",
        "bg-[color:var(--color-pipeline-surface)]",
        "p-4",
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-1 items-center justify-center pr-12">
        <p
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          {children}
        </p>
      </div>

      {tooltip ? (
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="More information"
            aria-describedby={tooltipId}
            onMouseEnter={() => setVisible(true)}
            onMouseLeave={() => setVisible(false)}
            className="flex items-center justify-center text-[color:var(--color-pipeline-ink-subtle)]"
          >
            <InfoIcon />
          </button>
          {visible ? (
            <div
              role="tooltip"
              id={tooltipId}
              className={[
                "absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2",
                "w-60",
                "rounded-[var(--radius-pipeline-card)]",
                "bg-[color:var(--color-pipeline-cta)]",
                "p-2",
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "text-[color:var(--color-pipeline-on-dark)]",
              ].join(" ")}
            >
              {tooltip}
            </div>
          ) : null}
        </div>
      ) : (
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center justify-center text-[color:var(--color-pipeline-ink-subtle)]"
        >
          <InfoIcon />
        </span>
      )}
    </div>
  );
}

export default KybInfoBanner;
