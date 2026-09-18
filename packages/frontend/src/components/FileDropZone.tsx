// spec: docs/frontend/auth-components.md#ownersmodal (drag-and-drop + picker,
// drag-over/rejection recolor; Figma node 6486:81710)
import { useRef, useState } from "react";
import { Button } from "@pipeline/ui";

// ── Icons ─────────────────────────────────────────────────────────────────────

function FileUploadGlyph() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M11.9645 2.00033C12.6274 2.00034 13.2633 2.26313 13.7321 2.73177L19.2682 8.2679C19.7369 8.7367 19.9997 9.3726 19.9997 10.0355V19.5003C19.9995 20.8809 18.8803 22.0003 17.4997 22.0003H6.49967C5.11922 22.0001 3.99985 20.8808 3.99967 19.5003V4.50033C3.99967 3.11972 5.11911 2.0005 6.49967 2.00033H11.9645ZM6.49967 3.50033C5.94754 3.5005 5.49967 3.94815 5.49967 4.50033V19.5003C5.49985 20.0524 5.94765 20.5001 6.49967 20.5003H17.4997C18.0519 20.5003 18.4995 20.0525 18.4997 19.5003V10.7503H12.9997C12.0334 10.7501 11.2499 9.96657 11.2497 9.00033V3.50033H6.49967ZM11.4694 12.4701C11.7623 12.1772 12.2371 12.1772 12.5299 12.4701L14.5299 14.4701C14.8228 14.7629 14.8228 15.2377 14.5299 15.5306C14.237 15.8232 13.7622 15.8234 13.4694 15.5306L12.7497 14.8109V18.0003C12.7495 18.4144 12.4138 18.7503 11.9997 18.7503C11.5857 18.7502 11.2499 18.4143 11.2497 18.0003V14.8109L10.5299 15.5306C10.237 15.8232 9.76219 15.8234 9.4694 15.5306C9.17662 15.2378 9.17683 14.763 9.4694 14.4701L11.4694 12.4701ZM12.7497 9.00033C12.7499 9.13814 12.8619 9.25015 12.9997 9.25033H18.1286L12.7497 3.87142V9.00033Z" />
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface FileDropZoneProps {
  rejected: boolean;
  onFiles: (files: File[]) => void;
}

// ── Drop-zone component ──────────────────────────────────────────────────────

export function FileDropZone({ rejected, onFiles }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length > 0) onFiles(picked);
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) onFiles(dropped);
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={[
        "flex w-full flex-col items-center gap-4 p-6",
        "rounded-[var(--radius-pipeline-card-xs)]",
        "border border-dashed",
        dragActive
          ? "border-[color:var(--color-pipeline-ink)]"
          : "border-[color:var(--color-pipeline-ink-subtle)]",
      ].join(" ")}
    >
      <span className="text-[color:var(--color-pipeline-ink-muted)]">
        <FileUploadGlyph />
      </span>

      <div className="flex w-full flex-col gap-1 text-center">
        <p
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "text-[color:var(--color-pipeline-ink)]",
          ].join(" ")}
        >
          Drag and drop your files
        </p>
        <p
          role={rejected ? "alert" : undefined}
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body-s)]",
            "leading-[var(--text-pipeline-body-s--line-height)]",
            rejected
              ? "text-[color:var(--color-pipeline-negative-strong)]"
              : "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          pdf, jpg, png files up to 10MB
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleChange}
      />
      <Button
        variant="secondary"
        size="m"
        className="border border-[color:var(--color-pipeline-line)]"
        onClick={() => inputRef.current?.click()}
      >
        Select files
      </Button>
    </div>
  );
}

export default FileDropZone;
