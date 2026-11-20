// spec: docs/frontend/trustee-flows.md#match-an-incoming-wire-by-reference
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ApiError } from "@/api/client";
import { useFindLpByPaymentDetails } from "@/api/useLps";

export type LookupResult = "idle" | "not-found" | "found" | "error";

export function lookupError(error: Error | null) {
  if (!error) return null;
  const status = error instanceof ApiError ? error.status : undefined;
  const message =
    status === 400
      ? "This is not a valid LP payment reference."
      : status === 401
        ? "Your session expired. Sign in again."
        : status === 403
          ? "Your trustee account is not authorized to look up LPs."
          : "Could not look up this reference. Check your connection and try again.";
  return { message, details: error.message };
}

export function usePaymentReferenceLookup() {
  const navigate = useNavigate();
  const lookup = useFindLpByPaymentDetails();
  const [value, setValue] = useState("");
  const [result, setResult] = useState<LookupResult>("idle");
  const trimmed = value.trim();
  const canSubmit = trimmed !== "" && !lookup.isPending;

  async function submit() {
    if (!canSubmit) return;
    setResult("idle");
    lookup.reset();
    try {
      const response = await lookup.mutateAsync(trimmed);
      const [owner] = response.lps;
      if (!owner) {
        setResult("not-found");
        return;
      }
      if (response.lps.length > 1) {
        setResult("error");
        return;
      }
      setResult("found");
      await navigate({
        to: "/lp-counterparties/$id",
        params: { id: String(owner.id) },
        search: { paymentDetails: trimmed },
      });
    } catch {
      setResult("error");
    }
  }

  return {
    value,
    setValue,
    submit,
    canSubmit,
    pending: lookup.isPending,
    result,
    error:
      result === "error"
        ? (lookupError(lookup.error) ?? {
            message:
              "Could not look up this reference. Check your connection and try again.",
            details: undefined,
          })
        : null,
  };
}
