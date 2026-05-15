/**
 * Shared wagmi query caching options.
 *
 * `CACHE_FOREVER` is the "fetch once per page lifetime" preset for on-chain
 * reads that are immutable in practice (contract addresses, token metadata,
 * etc.).  It is kept in its own module so multiple hooks can import the same
 * literal without duplicating it.
 *
 * See `docs/frontend/utils.md` for the catalogue entry.
 */

/** "Fetch once per page lifetime" caching — for immutable-in-practice reads. */
export const CACHE_FOREVER = {
  staleTime: Infinity,
  gcTime: Infinity,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: false as const,
};
