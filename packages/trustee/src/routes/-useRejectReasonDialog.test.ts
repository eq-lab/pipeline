/**
 * Tests for `useRejectReasonDialog` (issue #829). Pure hook logic — no DOM.
 *
 * Covers:
 *   - A reason under 5 trimmed chars keeps `isValid` false + shows an error
 *     once touched.
 *   - Whitespace-only input is never valid.
 *   - A valid reason (>= 5 trimmed chars) is valid and `trimmedValue` is the
 *     trimmed string.
 *   - No validation error before any interaction (untouched state).
 *   - `reset()` clears the value and touched state.
 */
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRejectReasonDialog } from "./-useRejectReasonDialog";

describe("useRejectReasonDialog", () => {
  it("is invalid with no validation error shown before any interaction", () => {
    const { result } = renderHook(() => useRejectReasonDialog());
    expect(result.current.isValid).toBe(false);
    expect(result.current.validationError).toBeNull();
  });

  it("shows a validation error for a reason under 5 trimmed characters, once touched", () => {
    const { result } = renderHook(() => useRejectReasonDialog());
    act(() => result.current.setValue("Hi"));
    expect(result.current.isValid).toBe(false);
    expect(result.current.validationError).toMatch(/at least 5 characters/);
  });

  it("treats whitespace-only input as invalid (never submittable)", () => {
    const { result } = renderHook(() => useRejectReasonDialog());
    act(() => result.current.setValue("     "));
    expect(result.current.isValid).toBe(false);
    expect(result.current.trimmedValue).toBe("");
  });

  it("counts length AFTER trimming — 5 chars padded with spaces to look longer stays invalid if trimmed content is short", () => {
    const { result } = renderHook(() => useRejectReasonDialog());
    act(() => result.current.setValue("  Hi  "));
    expect(result.current.trimmedValue).toBe("Hi");
    expect(result.current.isValid).toBe(false);
  });

  it("is valid once trimmed length reaches 5, and exposes the trimmed value", () => {
    const { result } = renderHook(() => useRejectReasonDialog());
    act(() => result.current.setValue("  Missing permit  "));
    expect(result.current.isValid).toBe(true);
    expect(result.current.validationError).toBeNull();
    expect(result.current.trimmedValue).toBe("Missing permit");
  });

  it("reset() clears the value and touched state", () => {
    const { result } = renderHook(() => useRejectReasonDialog());
    act(() => result.current.setValue("Hi"));
    expect(result.current.validationError).not.toBeNull();

    act(() => result.current.reset());
    expect(result.current.value).toBe("");
    expect(result.current.validationError).toBeNull();
  });
});
