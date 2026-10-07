// spec: docs/product-specs/home-screen-states.md
export type HomeState = "zero" | "unverified" | "kyb-pending" | "legacy";
export type LpReadState = "unknown" | "absent" | "loaded" | "error";

export interface DeriveHomeStateInput {
  hasSession: boolean;
  isConnected: boolean;
  lpRead?: LpReadState;
  kybStatus?: string;
  plusdIsZero?: boolean;
  splusdIsZero?: boolean;
}

export function deriveHomeState(input: DeriveHomeStateInput): HomeState {
  const {
    hasSession,
    isConnected,
    lpRead = "unknown",
    kybStatus,
    plusdIsZero = false,
    splusdIsZero = false,
  } = input;
  if (!hasSession) return "zero";
  const unverified =
    lpRead === "absent" || (lpRead === "loaded" && kybStatus === "NotStarted");
  if (!isConnected && unverified) return "unverified";
  if (
    isConnected &&
    lpRead === "loaded" &&
    kybStatus === "UnderReview" &&
    plusdIsZero &&
    splusdIsZero
  ) {
    return "kyb-pending";
  }
  return "legacy";
}
