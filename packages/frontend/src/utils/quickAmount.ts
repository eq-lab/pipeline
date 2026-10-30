// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
export const BALANCE_PERCENT_CHIPS = [25n, 50n, 75n, 100n] as const;

export function balanceChipAmount(
  balance: bigint,
  chipIndex: number,
): bigint | undefined {
  const percent = BALANCE_PERCENT_CHIPS[chipIndex];
  return percent === undefined ? undefined : (balance * percent) / 100n;
}
