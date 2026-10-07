// spec: docs/product-specs/home-screen-states.md
export type HomeState = "zero" | "unverified" | "legacy";
export type LpReadState = "unknown" | "absent" | "loaded" | "error";

export interface DeriveHomeStateInput {
  hasSession: boolean;
  isConnected: boolean;
  lpRead?: LpReadState;
  kybStatus?: string;
}

export function deriveHomeState(input: DeriveHomeStateInput): HomeState {
  const { hasSession, isConnected, lpRead = "unknown", kybStatus } = input;
  if (!hasSession) return "zero";
  const unverified =
    lpRead === "absent" || (lpRead === "loaded" && kybStatus === "NotStarted");
  if (!isConnected && unverified) return "unverified";
  return "legacy";
}
