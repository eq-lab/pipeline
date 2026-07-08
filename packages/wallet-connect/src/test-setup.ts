import "@testing-library/jest-dom";
import { setWalletConnectConfig } from "./config";

// Every test in this package needs a config in place before `./evm/chain`,
// `./evm/config`, or `./stellar/chain` are imported (they read
// `getWalletConnectConfig()` at module scope). Individual test files mock
// `./config` (EVM) or `./config` (Stellar, the kit singleton module) directly
// where they need to intercept SDK calls; this default keeps `./chain`
// (unmocked in most tests) from throwing on import.
setWalletConnectConfig({
  evmChainId: 560048,
  evmRpcUrl: "https://ethereum-hoodi-rpc.publicnode.com",
  walletConnectProjectId: "test-project-id",
  stellarNetworkPassphrase: "Test SDF Network ; September 2015",
  appName: "Pipeline (test)",
  appDescription: "Pipeline (test)",
});
