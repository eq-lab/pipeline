// spec: docs/frontend/auth-components.md#companydocsmodal (row composition,
// image-preview/glyph-tile split, rejection recolor; Figma nodes 6486:81679 / 6486:81817)
import { useEffect, useRef, useState } from "react";
import { Button } from "@pipeline/ui";

// ── Icons ─────────────────────────────────────────────────────────────────────

function FileUploadIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M9.97005 1.66667C10.5226 1.66667 11.053 1.88632 11.4437 2.27702L16.056 6.88932C16.4467 7.28002 16.6663 7.81042 16.6663 8.36296V16.2497C16.6663 17.4003 15.7339 18.3337 14.5833 18.3337H5.41634C4.2659 18.3335 3.33333 17.4002 3.33333 16.2497V3.74967C3.33351 2.59934 4.26601 1.66684 5.41634 1.66667H9.97005ZM5.41634 2.91667C4.95636 2.91684 4.58351 3.2897 4.58333 3.74967V16.2497C4.58333 16.7098 4.95625 17.0835 5.41634 17.0837H14.5833C15.0436 17.0837 15.4163 16.7099 15.4163 16.2497V8.95866H10.8333C10.0279 8.95866 9.37533 8.30509 9.37533 7.49967V2.91667H5.41634ZM9.55794 10.3913C9.80197 10.1473 10.1976 10.1474 10.4417 10.3913L12.1087 12.0583C12.3526 12.3024 12.3527 12.698 12.1087 12.9421C11.8647 13.1861 11.469 13.186 11.2249 12.9421L10.6253 12.3424V14.9997C10.6253 15.3447 10.3454 15.6245 10.0003 15.6247C9.65515 15.6247 9.37533 15.3449 9.37533 14.9997V12.3424L8.77572 12.9421C8.53164 13.1861 8.13503 13.1861 7.89095 12.9421C7.64714 12.6981 7.64725 12.3023 7.89095 12.0583L9.55794 10.3913ZM10.6253 7.49967C10.6253 7.61473 10.7183 7.70866 10.8333 7.70866H15.1068L10.6253 3.22624V7.49967Z" />
    </svg>
  );
}

function CrossCircleIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 22 22"
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M11 1.83333C16.0626 1.83333 20.1667 5.93739 20.1667 11C20.1667 16.0626 16.0626 20.1667 11 20.1667C5.93739 20.1667 1.83333 16.0626 1.83333 11C1.83333 5.93739 5.93739 1.83333 11 1.83333ZM14.6944 7.30558C14.4259 7.0371 13.9907 7.0371 13.7222 7.30558L11 10.0278L8.27775 7.30558C8.00926 7.0371 7.57407 7.0371 7.30558 7.30558C7.0371 7.57407 7.0371 8.00926 7.30558 8.27775L10.0278 11L7.30558 13.7222C7.0371 13.9907 7.0371 14.4259 7.30558 14.6944C7.57407 14.9629 8.00926 14.9629 8.27775 14.6944L11 11.9722L13.7222 14.6944C13.9907 14.9629 14.4259 14.9629 14.6944 14.6944C14.9629 14.4259 14.9629 13.9907 14.6944 13.7222L11.9722 11L14.6944 8.27775C14.9629 8.00926 14.9629 7.57407 14.6944 7.30558Z" />
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DocumentUploadRowProps {
  slotId: string;
  label: string;
  file: File | undefined;
  rejected: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
}

// ── Row component ─────────────────────────────────────────────────────────────

export function DocumentUploadRow({
  slotId,
  label,
  file,
  rejected,
  onSelect,
  onRemove,
}: DocumentUploadRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (
      file &&
      file.type.startsWith("image/") &&
      typeof URL.createObjectURL === "function"
    ) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
    setPreviewUrl(undefined);
    return undefined;
  }, [file]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (picked) onSelect(picked);
  }

  return (
    <li className="flex h-10 items-center gap-3">
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="size-10 shrink-0 rounded-[var(--radius-pipeline-card)] object-cover"
        />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-brand-secondary)] text-[color:var(--color-pipeline-brand)]">
          <FileUploadIcon />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p
          className={[
            "min-h-6 truncate",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          {file ? file.name : label}
        </p>
        <p
          role={rejected ? "alert" : undefined}
          className={[
            "truncate",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            rejected
              ? "text-[color:var(--color-pipeline-negative-strong)]"
              : "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          {file ? "Uploaded" : "pdf, jpg, png files up to 10MB"}
        </p>
      </div>

      {file ? (
        <button
          type="button"
          aria-label={`Remove ${file.name}`}
          onClick={onRemove}
          className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-pipeline-button)] text-[color:var(--color-pipeline-ink-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#262524]"
        >
          <CrossCircleIcon />
        </button>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid={`${slotId}-file-input`}
            onChange={handleChange}
          />
          <Button
            variant="secondary"
            size="compact"
            aria-label={`Upload ${label}`}
            className="border border-[color:var(--color-pipeline-line)]"
            onClick={() => inputRef.current?.click()}
          >
            Upload
          </Button>
        </>
      )}
    </li>
  );
}

export default DocumentUploadRow;
