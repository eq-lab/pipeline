import { LOAN_TABS, type LoanTab } from "./-useLoansTable";

export type LoanBookSearch = {
  tab?: LoanTab;
  chain?: number;
};

let lastSearch: LoanBookSearch = {};

export function parseLoanBookSearch(
  s: Record<string, unknown>,
): LoanBookSearch {
  const chain = Number(s.chain);
  return {
    tab: LOAN_TABS.find((t) => t === s.tab),
    chain: Number.isInteger(chain) && chain > 0 ? chain : undefined,
  };
}

export function rememberLoanBookSearch(search: LoanBookSearch): void {
  lastSearch = search;
}

export function lastLoanBookSearch(): LoanBookSearch {
  return lastSearch;
}
