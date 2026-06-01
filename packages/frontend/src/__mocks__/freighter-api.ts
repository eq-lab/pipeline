/**
 * Stub for @stellar/freighter-api in the test environment.
 *
 * The real module ships as CJS with a UMD bundle that does not expose named
 * ESM exports, which causes "Named export '...' not found" errors in vitest's
 * ESM mode. This stub provides the minimum surface used by
 * @creit.tech/stellar-wallets-kit's freighter module so the test suite can
 * import the wallet module graph without errors.
 *
 * Tests that exercise Stellar wallet functionality mock `./config` (via
 * `vi.mock("./config", ...)`) to avoid touching this module graph entirely.
 */
export const getAddress = () => Promise.resolve({ address: "", error: null });
export const getNetwork = () =>
  Promise.resolve({ network: "", networkPassphrase: "", error: null });
export const isConnected = () => Promise.resolve({ isConnected: false });
export const requestAccess = () =>
  Promise.resolve({ address: "", error: null });
export const signTransaction = () =>
  Promise.resolve({ signedTxXdr: "", signerAddress: "", error: null });
export const signAuthEntry = () =>
  Promise.resolve({ signedAuthEntry: null, signerAddress: "", error: null });
export const signMessage = () =>
  Promise.resolve({ signedMessage: null, signerAddress: "", error: null });
