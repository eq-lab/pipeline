// spec: docs/frontend/account-page.md#production-actions-and-remaining-seams (uncertain-upload reconciliation, #1373/#1572).
import type { LpDocument } from "@/api";

export interface UploadReconciliation {
  matched: number[];
  ambiguousNames: string[];
}

export function reconcileUploadedDocuments(
  added: ReadonlyArray<Pick<LpDocument, "original_filename">>,
  files: ReadonlyArray<File>,
): UploadReconciliation {
  const stagedCounts = new Map<string, number>();
  const addedCounts = new Map<string, number>();
  files.forEach((file) =>
    stagedCounts.set(file.name, (stagedCounts.get(file.name) ?? 0) + 1),
  );
  added.forEach((document) =>
    addedCounts.set(
      document.original_filename,
      (addedCounts.get(document.original_filename) ?? 0) + 1,
    ),
  );
  const ambiguousNames = [...stagedCounts.keys()].filter(
    (name) =>
      (addedCounts.get(name) ?? 0) > 0 &&
      ((stagedCounts.get(name) ?? 0) > 1 || (addedCounts.get(name) ?? 0) > 1),
  );
  const matched: number[] = [];
  for (const document of added) {
    if (ambiguousNames.includes(document.original_filename)) continue;
    const index = files.findIndex(
      (file, i) =>
        !matched.includes(i) && file.name === document.original_filename,
    );
    if (index >= 0) matched.push(index);
  }
  return { matched, ambiguousNames };
}

export function reconciliationMessage(
  result: UploadReconciliation,
  retryVerb: "save" | "submit",
): string {
  if (result.ambiguousNames.length > 0)
    return "New uploaded documents match staged files with duplicate names. We cannot tell which copy uploaded. Discard the uncertain staged files, review the uploaded list, then select any missing files again.";
  if (result.matched.length > 0)
    return `Some files were uploaded before the connection failed. Review the remaining files and ${retryVerb} again.`;
  return "No new files were found. You can retry the upload.";
}
