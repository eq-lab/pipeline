/**
 * Native XLM balance + funded-account discriminator (Horizon 404 →
 * `accountExists: false`, not "zero") for the connected Stellar wallet.
 * spec: docs/frontend/wallet-flows.md#xlm-funding-rule
 */

import { useQuery } from "@tanstack/react-query";
import { Horizon } from "@stellar/stellar-sdk";
import { horizonUrl } from "./chain";
import { useMock, readMock } from "../evm/mock";
import { useStellarWallet } from "./useStellarWallet";
import { STELLAR_MOCK_KEYS } from "./mock";

function parseString(raw: string): string {
  return raw;
}

export interface UseStellarXlmBalanceResult {
  xlmBalance: string | undefined;
  accountExists: boolean | undefined;
  refetchBalance: () => void;
  isLoading: boolean;
  error: Error | null;
}

export function useStellarXlmBalance(): UseStellarXlmBalanceResult {
  const { address, isConnected } = useStellarWallet();

  const mockBalance = useMock(STELLAR_MOCK_KEYS.balanceXlm, parseString);

  const queryFn = async (): Promise<{
    balance: string;
    accountExists: boolean;
  }> => {
    const mockVal = readMock(STELLAR_MOCK_KEYS.balanceXlm, parseString);
    if (mockVal !== undefined) {
      return { balance: mockVal, accountExists: true };
    }

    if (!address) return { balance: "0", accountExists: false };

    let balances: Horizon.HorizonApi.BalanceLine[];
    try {
      const server = new Horizon.Server(horizonUrl);
      const account = await server.loadAccount(address);
      balances = account.balances;
    } catch (err) {
      if (isNotFoundError(err)) {
        return { balance: "0", accountExists: false };
      }
      throw err;
    }

    for (const b of balances) {
      if (b.asset_type === "native") {
        return { balance: b.balance, accountExists: true };
      }
    }
    return { balance: "0", accountExists: true };
  };

  const shouldRunQuery = mockBalance === undefined && isConnected && !!address;

  const query = useQuery({
    queryKey: ["stellarXlmBalance", address, horizonUrl],
    queryFn,
    enabled: shouldRunQuery,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  if (mockBalance !== undefined) {
    return {
      xlmBalance: mockBalance,
      accountExists: true,
      refetchBalance: () => {},
      isLoading: false,
      error: null,
    };
  }

  if (!isConnected || !address) {
    return {
      xlmBalance: undefined,
      accountExists: undefined,
      refetchBalance: query.refetch as () => void,
      isLoading: false,
      error: null,
    };
  }

  return {
    xlmBalance: query.data?.balance,
    accountExists: query.data?.accountExists,
    refetchBalance: query.refetch as () => void,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const anyErr = err as Record<string, unknown>;
  if (typeof anyErr.status === "number" && anyErr.status === 404) return true;
  const response = anyErr.response as Record<string, unknown> | undefined;
  if (
    response &&
    typeof response.status === "number" &&
    response.status === 404
  )
    return true;
  return false;
}
