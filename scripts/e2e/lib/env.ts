// The generated env of a local stack: every variable api, worker and the apps read; see docs/e2e.md "Local stack".

import { E2E_DATABASE, EVM_CHAIN_ID, STANDALONE_PASSPHRASE, STELLAR_CHAIN_ID as ID } from "./guard";

export const PORTS = { postgres: 54329, minio: 59000, stellar: 58000, fakes: 58090, api: 58080, lp: 55173, trustee: 55174, evm: 58545 };
export type Ports = typeof PORTS;

export const SPACES = { key: "e2eminio", secret: "e2eminiosecret", bucket: "pipeline-e2e", region: "us-east-1" };

export interface Addresses {
  usdc: string;
  plusd: string;
  access_manager: string;
  deposit_manager: string;
  withdrawal_queue: string;
  staked_pl_usd: string;
  pocket: string;
  loan_registry: string;
  collateral_registry: string;
  deal_token_factory: string;
  minter: string;
}

export interface Accounts {
  issuer: string;
  verifierSecret: string;
  relayerSecret: string;
  depositCustodian: string;
  withdrawalCustodian: string;
  capitalWallet: string;
  browserLpSecret: string;
}

export interface StellarDeployment {
  addresses: Addresses;
  accounts: Accounts;
  /** A ledger the local RPC still holds, taken before the deploy: getEvents refuses a startLedger below its oldest ledger, and 0 always is. */
  startLedger: number;
}

/** Keys of pipeline-contracts' deployments/anvil-<tag>.json, plus the mock USDC. */
export const EVM_CONTRACTS = [
  "AccessManager",
  "WhitelistRegistry",
  "PipelineUSD",
  "StakedPipelineUSD",
  "PipelinePocket",
  "PipelineLoanRegistry",
  "PipelineCollateralRegistry",
  "PipelineDealTokenFactory",
  "PipelineMinter",
  "PipelineDepositManager",
  "PipelineWithdrawalQueue",
] as const;
export type EvmAddresses = Record<(typeof EVM_CONTRACTS)[number] | "USDC", string>;

export interface EvmDeployment {
  addresses: EvmAddresses;
  /** Private keys of the relayer (whitelist manager) and the verifier; the capital wallet's address. */
  accounts: { relayerKey: string; verifierKey: string; capitalWallet: string };
  /** The last deploy block: from block 0 the price poller would retry a block without sPLUSD until block 300 exists. */
  pricePollerStartBlock: number;
}

export interface EnvInput {
  ports: Ports;
  jwt: { privatePem: string; publicPem: string };
  stellar?: StellarDeployment;
  evm?: EvmDeployment;
}

export function generateEnv({ ports: p, jwt, stellar, evm }: EnvInput): Record<string, string> {
  if (!stellar && !evm) throw new Error("generateEnv needs at least one chain");
  const fakes = `http://localhost:${p.fakes}`;
  const db = `postgres://pipeline:pipeline@localhost:${p.postgres}/${E2E_DATABASE}`;
  const chains = [...(stellar ? [ID] : []), ...(evm ? [EVM_CHAIN_ID] : [])];
  return {
    DATABASE_URL: db,
    POSTGRES_URL: db,
    RUST_LOG: "info",
    CRYSTAL_ENABLED: "false",
    CRYSTAL_BASE_URL: `${fakes}/crystal`,
    ELLIPTIC_ENABLED: "false",
    ELLIPTIC_BASE_URL: `${fakes}/elliptic`,
    SUMSUB_APP_TOKEN: "e2e-app-token",
    SUMSUB_SECRET_KEY: "e2e-secret-key",
    SUMSUB_BASE_URL: `${fakes}/sumsub`,
    SUMSUB_VERIFICATION_LEVEL: "e2e-level",
    SUMSUB_WEBHOOK_SECRET_KEY: "e2e-webhook-secret",
    SUMSUB_SANDBOX: "true",
    API_PORT: String(p.api),
    IPFS_GATEWAY_URL: `${fakes}/ipfs/`,
    JOB_INDEXER_IPFS_GATEWAY_URL: `${fakes}/ipfs/`,
    // Real newlines: the env goes straight to the process, and JwtKeys::from_pem does not unescape "\n".
    JWT_ES256_PRIVATE_KEY_PEM: jwt.privatePem.trim(),
    JWT_ES256_PUBLIC_KEY_PEM: jwt.publicPem.trim(),
    EMAIL_DEV_LOG: "true",
    SENDGRID_BASE_URL: `${fakes}/sendgrid`,
    APP_BASE_URL: `http://localhost:${p.lp}`,
    CHAINS: chains.join(","),
    DEFAULT_CHAIN_ID: chains[0],
    JOB_INDEXER_ENABLED: "true",
    JOB_PRICE_POLLER_ENABLED: "true",
    JOB_RELAYER_ENABLED: "true",
    JOB_KYC_ENABLED: "false",
    JOB_ASSET_PRICE_COLLECTOR_ENABLED: "true",
    JOB_ASSET_PRICE_COLLECTOR_INTERVAL: "DAYS",
    JOB_ASSET_PRICE_COLLECTOR_RETENTION: "90",
    JOB_INDEXER_POLLING_INTERVAL_MS: "500",
    JOB_RELAYER_INTERVAL_SECS: "5",
    JOB_RELAYER_SUMSUB_ENABLED: "true",
    PRICE_PROVIDER_ALLOW_NON_MARKET: "true",
    METALPRICE_API_KEY: "e2e",
    METALPRICE_BASE_URL: `${fakes}/metalprice`,
    SPACES_ACCESS_KEY_ID: SPACES.key,
    SPACES_SECRET_ACCESS_KEY: SPACES.secret,
    SPACES_ENDPOINT: `http://localhost:${p.minio}`,
    SPACES_REGION: SPACES.region,
    SPACES_BUCKET: SPACES.bucket,
    VITE_API_BASE_URL: `http://localhost:${p.api}`,
    VITE_WALLETCONNECT_PROJECT_ID: "e2e",
    // Without the EVM chain a dead local port, so the apps never fall back to the public Hoodi node.
    VITE_EVM_RPC_URL: `http://localhost:${p.evm}`,
    // Likewise without the Stellar chain: the apps would otherwise default to the public Stellar testnet.
    VITE_STELLAR_NETWORK_PASSPHRASE: STANDALONE_PASSPHRASE,
    VITE_STELLAR_CHAIN_ID: ID,
    VITE_STELLAR_HORIZON_URL: `http://localhost:${p.stellar}`,
    VITE_STELLAR_RPC_URL: `http://localhost:${p.stellar}/rpc`,
    ...(stellar && stellarEnv(p, stellar)),
    ...(evm && evmEnv(p, evm)),
  };
}

function stellarEnv(p: Ports, { addresses: a, accounts: k, startLedger }: StellarDeployment): Record<string, string> {
  if (!Number.isInteger(startLedger) || startLedger < 1) throw new Error(`startLedger must be a positive ledger, got ${startLedger}`);
  const rpc = `http://localhost:${p.stellar}/rpc`;
  const S = `CHAIN_${ID}_STELLAR`;
  return {
    JOB_INDEXER_STELLAR_ASSET_ID: a.usdc,
    [`CHAIN_${ID}_TYPE`]: "stellar",
    [`${S}_RPC_URL`]: rpc,
    [`${S}_NETWORK_PASSPHRASE`]: STANDALONE_PASSPHRASE,
    [`${S}_START_BLOCK`]: String(startLedger),
    [`${S}_INDEXER_DEPOSIT_MANAGER_ADDRESS`]: a.deposit_manager,
    [`${S}_INDEXER_WITHDRAWAL_QUEUE_ADDRESS`]: a.withdrawal_queue,
    [`${S}_INDEXER_WITHDRAWAL_QUEUE_WALLET_ADDRESS`]: k.withdrawalCustodian,
    [`${S}_INDEXER_STAKED_PLUSD_ADDRESS`]: a.staked_pl_usd,
    [`${S}_INDEXER_LOAN_REGISTRY_ADDRESS`]: a.loan_registry,
    [`${S}_INDEXER_MINTER_ADDRESS`]: a.minter,
    [`${S}_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS`]: a.deal_token_factory,
    [`${S}_INDEXER_POCKET_ADDRESS`]: a.pocket,
    [`${S}_INDEXER_SECURITY_REGISTRY_ADDRESS`]: a.collateral_registry,
    [`${S}_INDEXER_PLUSD_ADDRESS`]: a.plusd,
    [`${S}_INDEXER_ACCESS_MANAGER_ADDRESS`]: a.access_manager,
    [`${S}_INDEXER_POLLING_INTERVAL_MS`]: "500",
    [`${S}_PRICE_POLLER_STAKED_PLUSD_ADDRESS`]: a.staked_pl_usd,
    [`${S}_PRICE_POLLER_RPC_URL`]: rpc,
    [`${S}_PRICE_POLLER_NETWORK_PASSPHRASE`]: STANDALONE_PASSPHRASE,
    [`${S}_PRICE_POLLER_POLL_INTERVAL_SECS`]: "10",
    [`CHAIN_${ID}_RELAYER_STELLAR_ACCESS_MANAGER_ID`]: a.access_manager,
    [`CHAIN_${ID}_RELAYER_STELLAR_PLUSD_SAC_ID`]: a.plusd,
    [`CHAIN_${ID}_RELAYER_STELLAR_SIGNER_SECRET`]: k.relayerSecret,
    [`CHAIN_${ID}_RELAYER_STELLAR_RPC_URL`]: rpc,
    [`CHAIN_${ID}_RELAYER_STELLAR_NETWORK_PASSPHRASE`]: STANDALONE_PASSPHRASE,
    STELLAR_VERIFIER_SECRET: k.verifierSecret,
    [`CHAIN_${ID}_API_STELLAR_DM_CONTRACT_ID`]: a.deposit_manager,
    [`CHAIN_${ID}_API_STELLAR_WQ_CONTRACT_ID`]: a.withdrawal_queue,
    [`CHAIN_${ID}_API_STELLAR_NETWORK_PASSPHRASE`]: STANDALONE_PASSPHRASE,
    [`CHAIN_${ID}_API_STELLAR_WITHDRAWAL_QUEUE_WALLET_ID`]: k.withdrawalCustodian,
    [`${S}_API_LOAN_REGISTRY_ADDRESS`]: a.loan_registry,
    [`${S}_API_POCKET_ADDRESS`]: a.pocket,
    [`${S}_API_SECURITY_REGISTRY_ADDRESS`]: a.collateral_registry,
    [`${S}_API_PLUSD_ADDRESS`]: a.plusd,
    [`${S}_API_MINTER_ADDRESS`]: a.minter,
    E2E_WALLET_SECRET: k.browserLpSecret,
    VITE_STELLAR_DEPOSIT_MANAGER_ID: a.deposit_manager,
    VITE_STELLAR_WITHDRAWAL_QUEUE_ID: a.withdrawal_queue,
    VITE_STELLAR_STAKED_PLUSD_ID: a.staked_pl_usd,
    VITE_STELLAR_PLUSD_ISSUER_ID: k.issuer,
    VITE_STELLAR_USDC_ID: a.usdc,
    VITE_STELLAR_USDC_CUSTODY_ID: k.depositCustodian,
    VITE_STELLAR_LOAN_REGISTRY_ID: a.loan_registry,
    VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID: a.access_manager,
    VITE_STELLAR_SECURITY_REGISTRY_ID: a.collateral_registry,
    VITE_STELLAR_YIELD_MINTER_ID: a.minter,
    VITE_STELLAR_DEAL_TOKEN_FACTORY_ID: a.deal_token_factory,
    VITE_STELLAR_CAPITAL_WALLET_ID: k.capitalWallet,
    VITE_E2E_WALLET: "1",
  };
}

function evmEnv(p: Ports, { addresses: a, accounts: k, pricePollerStartBlock }: EvmDeployment): Record<string, string> {
  const C = `CHAIN_${EVM_CHAIN_ID}`;
  const E = `${C}_EVM`;
  return {
    [`${E}_RPC_URL`]: `http://localhost:${p.evm}`,
    [`${E}_INDEXER_DEPOSIT_MANAGER_ADDRESS`]: a.PipelineDepositManager,
    [`${E}_INDEXER_WITHDRAWAL_QUEUE_ADDRESS`]: a.PipelineWithdrawalQueue,
    [`${E}_INDEXER_STAKED_PLUSD_ADDRESS`]: a.StakedPipelineUSD,
    [`${E}_INDEXER_LOAN_REGISTRY_ADDRESS`]: a.PipelineLoanRegistry,
    [`${E}_INDEXER_MINTER_ADDRESS`]: a.PipelineMinter,
    [`${E}_INDEXER_COLLATERAL_REGISTRY_ADDRESS`]: a.PipelineCollateralRegistry,
    [`${E}_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS`]: a.PipelineDealTokenFactory,
    [`${E}_INDEXER_PLUSD_ADDRESS`]: a.PipelineUSD,
    [`${E}_INDEXER_LOG_CONFIRMATIONS_DELAY`]: "0",
    [`${E}_PRICE_POLLER_STAKED_PLUSD_ADDRESS`]: a.StakedPipelineUSD,
    [`${E}_PRICE_POLLER_POLL_INTERVAL_SECS`]: "10",
    [`${E}_PRICE_POLLER_START_BLOCK`]: String(pricePollerStartBlock),
    [`${C}_RELAYER_SIGNER_KEY`]: k.relayerKey,
    [`${C}_RELAYER_REGISTRY_ADDRESS`]: a.WhitelistRegistry,
    [`${C}_SIGNER_KEY`]: k.verifierKey,
    [`${C}_DM_ADDRESS`]: a.PipelineDepositManager,
    [`${C}_WQ_ADDRESS`]: a.PipelineWithdrawalQueue,
    [`${E}_API_LOAN_REGISTRY_ADDRESS`]: a.PipelineLoanRegistry,
    VITE_EVM_CHAIN_ID: EVM_CHAIN_ID,
    VITE_DEPOSIT_MANAGER_ADDRESS: a.PipelineDepositManager,
    VITE_WITHDRAWAL_QUEUE_ADDRESS: a.PipelineWithdrawalQueue,
    VITE_STAKED_PLUSD_ADDRESS: a.StakedPipelineUSD,
    VITE_EVM_LOAN_REGISTRY_ADDRESS: a.PipelineLoanRegistry,
    VITE_EVM_MINTER_ADDRESS: a.PipelineMinter,
    VITE_EVM_CAPITAL_WALLET_ADDRESS: k.capitalWallet,
  };
}
