// spec: docs/frontend/auth-components.md#companydocsmodal (row composition,
// rejection recolor; Figma nodes 6486:81679 / 6486:81817)
import { useRef } from "react";
import { Button } from "@pipeline/ui";
import { FileUploadIcon, UploadedFileRow } from "@/components/UploadedFileRow";

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

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (picked) onSelect(picked);
  }

  if (file) {
    return <UploadedFileRow file={file} onRemove={onRemove} />;
  }

  return (
    <li className="flex h-10 items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-brand-secondary)] text-[color:var(--color-pipeline-brand)]">
        <FileUploadIcon />
      </div>

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
          {label}
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
          pdf, jpg, png files up to 10MB
        </p>
      </div>

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
    </li>
  );
}

export default DocumentUploadRow;
