/**
 * Thin re-exports of viem's unit-conversion helpers.
 *
 * External modules (e.g. `src/lib/usdc.ts`) cannot import from `viem` directly
 * due to the `no-restricted-imports` ESLint rule that scopes viem to
 * `src/wallet/**`. This file lives inside the wallet module boundary and
 * re-exports the pure utility functions so they can be consumed via
 * `@/wallet` without needing a wagmi/viem direct import.
 */
export { parseUnits, formatUnits } from "viem";
