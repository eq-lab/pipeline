import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAccountDocuments } from "./useAccountDocuments";

function makeFile(name: string, type: string, sizeBytes = 1024): File {
  return new File(["x".repeat(sizeBytes)], name, { type });
}

describe("useAccountDocuments", () => {
  it("accepts pdf, jpeg, and png files", () => {
    const { result } = renderHook(() => useAccountDocuments());
    act(() => {
      result.current.addFiles([
        makeFile("a.pdf", "application/pdf"),
        makeFile("b.jpg", "image/jpeg"),
        makeFile("c.png", "image/png"),
      ]);
    });
    expect(result.current.files).toHaveLength(3);
    expect(result.current.rejected).toBe(false);
  });

  it("rejects a wrong MIME type", () => {
    const { result } = renderHook(() => useAccountDocuments());
    act(() => {
      result.current.addFiles([makeFile("a.exe", "application/x-msdownload")]);
    });
    expect(result.current.files).toHaveLength(0);
    expect(result.current.rejected).toBe(true);
  });

  it("rejects an oversized file", () => {
    const { result } = renderHook(() => useAccountDocuments());
    const big = makeFile("big.pdf", "application/pdf", 11 * 1024 * 1024);
    act(() => {
      result.current.addFiles([big]);
    });
    expect(result.current.files).toHaveLength(0);
    expect(result.current.rejected).toBe(true);
  });

  it("infers type from extension when file.type is empty", () => {
    const { result } = renderHook(() => useAccountDocuments());
    const file = makeFile("a.pdf", "", 512);
    act(() => {
      result.current.addFiles([file]);
    });
    expect(result.current.files).toHaveLength(1);
    expect(result.current.rejected).toBe(false);
  });

  it("stages the good files from a mixed batch and still raises the rejection flag", () => {
    const { result } = renderHook(() => useAccountDocuments());
    act(() => {
      result.current.addFiles([
        makeFile("good.pdf", "application/pdf"),
        makeFile("bad.exe", "application/x-msdownload"),
      ]);
    });
    expect(result.current.files.map((f) => f.name)).toEqual(["good.pdf"]);
    expect(result.current.rejected).toBe(true);
  });

  it("removeFile removes the right index", () => {
    const { result } = renderHook(() => useAccountDocuments());
    act(() => {
      result.current.addFiles([
        makeFile("a.pdf", "application/pdf"),
        makeFile("b.pdf", "application/pdf"),
      ]);
    });
    act(() => {
      result.current.removeFile(0);
    });
    expect(result.current.files.map((f) => f.name)).toEqual(["b.pdf"]);
  });

  it("canSave flips on the first accepted file and back off when the last is removed", () => {
    const { result } = renderHook(() => useAccountDocuments());
    expect(result.current.canSave).toBe(false);
    act(() => {
      result.current.addFiles([makeFile("a.pdf", "application/pdf")]);
    });
    expect(result.current.canSave).toBe(true);
    act(() => {
      result.current.removeFile(0);
    });
    expect(result.current.canSave).toBe(false);
  });

  it("the rejection flag clears on the next accepted file", () => {
    const { result } = renderHook(() => useAccountDocuments());
    act(() => {
      result.current.addFiles([
        makeFile("bad.exe", "application/x-msdownload"),
      ]);
    });
    expect(result.current.rejected).toBe(true);
    act(() => {
      result.current.addFiles([makeFile("good.pdf", "application/pdf")]);
    });
    expect(result.current.rejected).toBe(false);
  });

  it("handleSave calls onSave with the staged files, and is a no-op when nothing is staged", () => {
    const onSave = vi.fn();
    const { result } = renderHook(() => useAccountDocuments({ onSave }));
    act(() => {
      result.current.handleSave();
    });
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      result.current.addFiles([makeFile("a.pdf", "application/pdf")]);
    });
    act(() => {
      result.current.handleSave();
    });
    expect(onSave).toHaveBeenCalledWith([expect.any(File)]);
  });

  it("seeds from initialFiles", () => {
    const seed = [makeFile("seed.pdf", "application/pdf")];
    const { result } = renderHook(() =>
      useAccountDocuments({ initialFiles: seed }),
    );
    expect(result.current.files).toEqual(seed);
    expect(result.current.canSave).toBe(true);
  });
});
