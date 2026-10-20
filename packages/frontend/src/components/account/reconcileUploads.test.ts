// spec: docs/frontend/account-page.md#production-actions-and-remaining-seams (uncertain-upload reconciliation, #1572).
import { describe, expect, it } from "vitest";
import {
  reconcileUploadedDocuments,
  reconciliationMessage,
} from "./reconcileUploads";

const file = (name: string) => new File(["x"], name);
const doc = (original_filename: string) => ({ original_filename });

describe("reconcileUploadedDocuments", () => {
  it("matches each added document to one staged file of that name, by position", () => {
    const files = [file("a.pdf"), file("b.pdf"), file("c.pdf")];
    expect(
      reconcileUploadedDocuments([doc("c.pdf"), doc("a.pdf")], files),
    ).toEqual({
      matched: [2, 0],
      ambiguousNames: [],
    });
  });

  it("ignores added documents that match no staged file", () => {
    expect(reconcileUploadedDocuments([doc("z.pdf")], [file("a.pdf")])).toEqual(
      {
        matched: [],
        ambiguousNames: [],
      },
    );
  });

  it("keeps every copy when two staged files share a name and only one came back (BUG-23)", () => {
    const files = [file("same.pdf"), file("same.pdf"), file("other.pdf")];
    expect(reconcileUploadedDocuments([doc("same.pdf")], files)).toEqual({
      matched: [],
      ambiguousNames: ["same.pdf"],
    });
  });

  it("treats two added documents of one name as ambiguous even against a single staged copy", () => {
    expect(
      reconcileUploadedDocuments(
        [doc("same.pdf"), doc("same.pdf")],
        [file("same.pdf")],
      ),
    ).toEqual({ matched: [], ambiguousNames: ["same.pdf"] });
  });

  it("still matches the unambiguous names in a mixed batch", () => {
    const files = [file("same.pdf"), file("same.pdf"), file("ok.pdf")];
    expect(
      reconcileUploadedDocuments([doc("same.pdf"), doc("ok.pdf")], files),
    ).toEqual({
      matched: [2],
      ambiguousNames: ["same.pdf"],
    });
  });
});

describe("reconciliationMessage", () => {
  it("prefers the ambiguity message, then the partial-upload message with the caller's verb, then the nothing-found message", () => {
    expect(
      reconciliationMessage({ matched: [0], ambiguousNames: ["x"] }, "submit"),
    ).toMatch(/cannot tell which copy uploaded/);
    expect(
      reconciliationMessage({ matched: [0], ambiguousNames: [] }, "submit"),
    ).toMatch(/submit again\.$/);
    expect(
      reconciliationMessage({ matched: [0], ambiguousNames: [] }, "save"),
    ).toMatch(/save again\.$/);
    expect(
      reconciliationMessage({ matched: [], ambiguousNames: [] }, "save"),
    ).toBe("No new files were found. You can retry the upload.");
  });
});
