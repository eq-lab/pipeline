/**
 * Public surface of the API module.
 *
 * Only import from this barrel outside of `src/api/`.
 * Do NOT call `fetch` directly outside this module — the ESLint
 * `no-restricted-globals` rule enforces this boundary.
 *
 * See `src/api/README.md` for the full public API, mock-key schema,
 * and DevTools snippets.
 */
export { apiFetch } from "./client";
export { useRequests } from "./useRequests";
export type {
  RequestItem,
  RequestType,
  RequestStatus,
  RequestsResponse,
  UseRequestsResult,
} from "./useRequests";
export { useDepositVoucher } from "./useDepositVoucher";
export type {
  VoucherResponse,
  VoucherStatus,
  UseDepositVoucherResult,
} from "./useDepositVoucher";
export { useWithdrawalVoucher } from "./useWithdrawalVoucher";
export type {
  WithdrawalVoucherResponse,
  WithdrawalVoucherStatus,
  UseWithdrawalVoucherResult,
} from "./useWithdrawalVoucher";
export { useStats, formatApy } from "./useStats";
export type { VaultStatsItem, StatsResponse, UseStatsResult } from "./useStats";
export { useStatsPrices } from "./useStatsPrices";
export { usePositionsHistory, PERIOD_WINDOWS } from "./usePositionsHistory";
export type {
  PositionHistoryItem,
  PositionHistoryResponse,
  UsePositionsHistoryResult,
} from "./usePositionsHistory";
export type {
  StatsPriceItem,
  StatsPricesInterval,
  StatsPricesResponse,
  UseStatsPricesParams,
  UseStatsPricesResult,
} from "./useStatsPrices";
export { usePnl } from "./usePnl";
export type { PnlResponse, UsePnlResult, VaultPnl } from "./usePnl";
export { useLoanBook } from "./useLoanBook";
export type {
  LoanBookSummary,
  LoanBookEntry,
  LoanBookResponse,
  UseLoanBookResult,
} from "./useLoanBook";
export {
  useLoanSubmissions,
  normalizeOriginationSubmissionStatus,
} from "./useLoanSubmissions";
export type {
  EconomicsInput,
  LocationInput,
  OriginationSubmissionStatus,
  SubmitLoanRequest,
  SubmissionView,
  UseLoanSubmissionsResult,
} from "./useLoanSubmissions";
export { useStellarDepositVoucher } from "./useStellarDepositVoucher";
export type {
  UseStellarDepositVoucherResult,
  StellarVoucherResponse,
} from "./useStellarDepositVoucher";
export { useStellarWithdrawalVoucher } from "./useStellarWithdrawalVoucher";
export type {
  UseStellarWithdrawalVoucherResult,
  StellarWithdrawalVoucherResponse,
  StellarWithdrawalVoucherStatus,
} from "./useStellarWithdrawalVoucher";
export { useStatsYield } from "./useStatsYield";
export type {
  SampleYieldItem,
  UseStatsYieldParams,
  UseStatsYieldResult,
} from "./useStatsYield";
export { useWithdrawalQueue } from "./useWithdrawalQueue";
export type {
  WithdrawalQueueSummary,
  WithdrawalQueueItem,
  WithdrawalQueueResponse,
  UseWithdrawalQueueResult,
} from "./useWithdrawalQueue";
export { useFinancialPosition } from "./useFinancialPosition";
export type {
  LiquidAssets,
  DeployedAssets,
  FinancialAssets,
  SeniorClaims,
  SubordinatedCapital,
  FinancialLiabilities,
  FinancialPositionResponse,
  UseFinancialPositionResult,
} from "./useFinancialPosition";
export { useDashboardSummary } from "./useDashboardSummary";
export type {
  DashboardSummary,
  UseDashboardSummaryResult,
} from "./useDashboardSummary";
export { useDashboardTvlHistory } from "./useDashboardTvlHistory";
export type {
  TvlPoint,
  UseDashboardTvlHistoryParams,
  UseDashboardTvlHistoryResult,
} from "./useDashboardTvlHistory";
export { useDashboardYieldHistory } from "./useDashboardYieldHistory";
export type {
  YieldPoint,
  UseDashboardYieldHistoryParams,
  UseDashboardYieldHistoryResult,
} from "./useDashboardYieldHistory";
