// spec: docs/frontend/auth-components.md#shared-file-validation (shared by
// CompanyDocsModal and OwnersModal; Figma nodes 6486:81679 / 6486:81710)

export const ACCEPTED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function inferTypeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    default:
      return "";
  }
}

export function isAcceptedFile(file: File): boolean {
  const type = file.type || inferTypeFromName(file.name);
  return (ACCEPTED_FILE_TYPES as readonly string[]).includes(type);
}
