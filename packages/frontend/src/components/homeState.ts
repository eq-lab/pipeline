// spec: docs/product-specs/home-screen-states.md
export type HomeState = "zero" | "legacy";

export interface DeriveHomeStateInput {
  hasSession: boolean;
  isConnected: boolean;
  kybStatus?: string;
}

export function deriveHomeState(input: DeriveHomeStateInput): HomeState {
  return input.hasSession ? "legacy" : "zero";
}
