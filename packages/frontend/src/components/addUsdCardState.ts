// spec: docs/frontend/bank-transfers.md#addusdcard
export type AddUsdCardVariant =
  | "locked"
  | "verify"
  | "verifying"
  | "unlocked"
  | "funded";

export const ADD_USD_CARD_VARIANTS: ReadonlyArray<AddUsdCardVariant> = [
  "locked",
  "verify",
  "verifying",
  "unlocked",
  "funded",
];
