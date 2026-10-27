// spec: docs/frontend/ui-components.md#combobox
import { useCombobox } from "./useCombobox";
import type { ComboboxOption } from "./filterOptions";

export interface ComboboxProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly ComboboxOption[];
  placeholder?: string;
  emptyText?: string;
  clearLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  error?: string;
  className?: string;
}

const FLAG_CLASSES = "h-[15px] w-5 shrink-0 rounded-[2px] object-cover";

export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  emptyText = "No results",
  clearLabel = "Clear",
  disabled,
  invalid,
  error,
  className,
}: ComboboxProps) {
  const c = useCombobox({ value, onChange, options, disabled });
  const showFlag = Boolean(c.selected?.iconUrl) && !c.searching;

  return (
    <div
      ref={c.rootRef}
      onBlur={c.onBlur}
      className={["relative w-full", className].filter(Boolean).join(" ")}
    >
      <div
        className={[
          "flex h-14 w-full items-center gap-1",
          "rounded-[var(--radius-pipeline-card)] px-3",
          "border border-transparent",
          "focus-within:border-[color:var(--color-pipeline-ink-subtle)]",
          invalid
            ? "bg-[var(--color-pipeline-negative-secondary)]"
            : "bg-[var(--color-pipeline-surface)]",
        ].join(" ")}
      >
        {showFlag ? (
          <img
            src={c.selected?.iconUrl}
            alt=""
            aria-hidden="true"
            width={20}
            height={15}
            referrerPolicy="no-referrer"
            className={FLAG_CLASSES}
          />
        ) : null}
        <input
          ref={c.inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={c.open}
          aria-controls={c.listId}
          aria-activedescendant={
            c.open && c.activeIndex >= 0 ? c.optionId(c.activeIndex) : undefined
          }
          aria-invalid={invalid || undefined}
          aria-describedby={error ? c.errorId : undefined}
          autoComplete="off"
          spellCheck={false}
          value={c.query}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => c.onInputChange(e.target.value)}
          onKeyDown={c.onKeyDown}
          onFocus={c.onInputFocus}
          onClick={c.onInputClick}
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
        />
        {value !== "" && !disabled ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={clearLabel}
            onMouseDown={(e) => e.preventDefault()}
            onClick={c.clear}
            className={[
              "flex size-8 shrink-0 items-center justify-center",
              "rounded-[var(--radius-pipeline-card)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
              "cursor-pointer bg-transparent",
            ].join(" ")}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 1L11 11M11 1L1 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show options"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={c.toggle}
          className={[
            "flex size-8 shrink-0 items-center justify-center",
            "rounded-[var(--radius-pipeline-card)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
            "cursor-pointer bg-transparent",
          ].join(" ")}
        >
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            aria-hidden="true"
            className={c.open ? "rotate-180" : undefined}
          >
            <path
              d="M1 1L5 5L9 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {c.open ? (
        <ul
          role="listbox"
          id={c.listId}
          aria-label={placeholder}
          className={[
            "absolute top-full right-0 left-0 z-40 mt-1 max-h-72 overflow-y-auto",
            "rounded-[var(--radius-pipeline-card)] border border-[color:var(--color-pipeline-line)]",
            "bg-[var(--color-pipeline-surface)] py-1.5",
            "shadow-[0px_8px_28px_0px_rgba(0,0,40,0.14)]",
          ].join(" ")}
        >
          {c.filtered.length === 0 ? (
            <li
              role="option"
              aria-disabled="true"
              aria-selected="false"
              className={[
                "px-4 py-2.5",
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
              ].join(" ")}
            >
              {emptyText}
            </li>
          ) : (
            c.filtered.map((option, index) => (
              <li
                key={option.value}
                id={c.optionId(index)}
                role="option"
                aria-selected={option.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => c.setActiveIndex(index)}
                onClick={() => c.commit(option)}
                className={[
                  "flex cursor-pointer items-center gap-2 px-4 py-2.5",
                  "font-[family-name:var(--font-body)]",
                  "text-[length:var(--text-pipeline-body)]",
                  "leading-[var(--text-pipeline-body--line-height)]",
                  "text-[color:var(--color-pipeline-ink)]",
                  index === c.activeIndex
                    ? "bg-[color:var(--color-pipeline-line)]/30"
                    : "",
                  option.value === value
                    ? "font-[var(--font-weight-medium)]"
                    : "font-[var(--font-weight-regular)]",
                ].join(" ")}
              >
                {option.iconUrl ? (
                  <img
                    src={option.iconUrl}
                    alt=""
                    aria-hidden="true"
                    width={20}
                    height={15}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className={FLAG_CLASSES}
                  />
                ) : (
                  <span aria-hidden="true" className="h-[15px] w-5 shrink-0" />
                )}
                <span>{option.label}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {error ? (
        <p
          id={c.errorId}
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
}
