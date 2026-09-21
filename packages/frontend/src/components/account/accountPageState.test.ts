import { describe, it, expect } from "vitest";
import {
  deriveDocumentsState,
  parseAccountStatePreview,
  ACCOUNT_STATE_PREVIEWS,
  type AccountDocumentRecord,
} from "./accountPageState";

const VERIFIED: AccountDocumentRecord = { name: "a.pdf", status: "Verified" };
const REJECTED: AccountDocumentRecord = { name: "b.pdf", status: "Rejected" };
const NOT_PROVIDED: AccountDocumentRecord = {
  name: "c.pdf",
  status: "NotProvided",
};

describe("deriveDocumentsState", () => {
  it("returns verified when kybStatus is Passed, regardless of documents", () => {
    expect(
      deriveDocumentsState({
        kybStatus: "Passed",
        documents: [REJECTED],
        stagedCount: 0,
      }),
    ).toBe("verified");
  });

  it("returns invalid when any document is Rejected, even if kybStatus is Passed-adjacent", () => {
    expect(
      deriveDocumentsState({
        kybStatus: "InProgress",
        documents: [VERIFIED, REJECTED],
        stagedCount: 0,
      }),
    ).toBe("invalid");
  });

  it("Rejected takes precedence over NotProvided", () => {
    expect(
      deriveDocumentsState({
        kybStatus: "InProgress",
        documents: [REJECTED, NOT_PROVIDED],
        stagedCount: 0,
      }),
    ).toBe("invalid");
  });

  it("returns missing when a document is NotProvided (and none Rejected)", () => {
    expect(
      deriveDocumentsState({
        kybStatus: "InProgress",
        documents: [VERIFIED, NOT_PROVIDED],
        stagedCount: 0,
      }),
    ).toBe("missing");
  });

  it("NotProvided takes precedence over UnderReview", () => {
    expect(
      deriveDocumentsState({
        kybStatus: "UnderReview",
        documents: [NOT_PROVIDED],
        stagedCount: 0,
      }),
    ).toBe("missing");
  });

  it("returns under-review when kybStatus is UnderReview and no blocking documents", () => {
    expect(
      deriveDocumentsState({
        kybStatus: "UnderReview",
        documents: [VERIFIED],
        stagedCount: 3,
      }),
    ).toBe("under-review");
  });

  it("UnderReview takes precedence over staged", () => {
    expect(
      deriveDocumentsState({
        kybStatus: "UnderReview",
        documents: [],
        stagedCount: 2,
      }),
    ).toBe("under-review");
  });

  it("returns staged when stagedCount > 0 and nothing else applies", () => {
    expect(
      deriveDocumentsState({
        kybStatus: "NotStarted",
        documents: [],
        stagedCount: 1,
      }),
    ).toBe("staged");
  });

  it("returns verify as the default", () => {
    expect(
      deriveDocumentsState({
        kybStatus: "NotStarted",
        documents: [],
        stagedCount: 0,
      }),
    ).toBe("verify");
  });
});

describe("parseAccountStatePreview", () => {
  it.each(Object.keys(ACCOUNT_STATE_PREVIEWS))(
    "accepts the valid id %s",
    (id) => {
      expect(parseAccountStatePreview(id)).toBe(id);
    },
  );

  it("rejects undefined", () => {
    expect(parseAccountStatePreview(undefined)).toBeUndefined();
  });

  it("rejects an empty string", () => {
    expect(parseAccountStatePreview("")).toBeUndefined();
  });

  it("rejects an unknown string", () => {
    expect(parseAccountStatePreview("bogus")).toBeUndefined();
  });

  it("rejects a non-string value", () => {
    expect(parseAccountStatePreview(42)).toBeUndefined();
  });
});
