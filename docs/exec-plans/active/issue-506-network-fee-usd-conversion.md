# Issue #506: Deposit network fee row missing USD conversion — Figma shows "~$0.00053 ETH ($1.20)"

Source: https://github.com/eq-lab/pipeline/issues/506

## Scope

The `/deposit` page network-fee row renders only the raw ETH estimate
(`~0.00033 ETH`). Figma (parent epic #498, node `1993:7932`) shows the ETH
estimate **with a USD equivalent suffix**: `~0.00053 ETH ($1.20)`. This applies
to both deposit and withdraw directions, mobile and desktop (the row is the
shared `InfoRow` inside `ConversionCard`).

In scope:

- Extend `useNetworkFeeEstimate` (`packages/frontend/src/wallet/evm/useNetworkFeeEstimate.ts`)
  to compute and append the USD equivalent: it must obtain an ETH→USD price,
  multiply by the ETH fee, and produce a value of the form `~0.00053 ETH ($1.20)`.
- Add an ETH→USD price source with a `pipeline.mock.wallet.*` mock key, matching
  the existing mock-layer pattern used throughout `src/wallet/`.
- Update unit tests for the hook and any rendering tests that assert the fee string.

Out of scope:

- Restyling the row (this is not a CSS fix — `InfoRow` already renders whatever
  string it is given; no UI-package change is expected).
- Changing the ETH fee estimation logic itself (gas estimation, buffering,
  fallback constants) — only the USD suffix is added.
- Any backend/worker price-feed work.

### Exact display format

Figma literally shows `~$0.00053 ETH ($1.20)` (a stray `$` before the ETH
amount — treated as a Figma artifact). The issue body normalizes the intended
output to `~0.00053 ETH ($1.20)`, i.e. the existing `formatFeeEth` output
(`~0.00053 ETH`) with a ` ($X.XX)` suffix appended. Implement the normalized
form: `<existing ETH string> ($<usd>.XX)`, USD shown to 2 decimal places.

When the USD price is unavailable (mock unset + no price source, or price
fetch fails), render the ETH-only string with **no** suffix rather than a
broken `($—)` — i.e. degrade gracefully to today's behaviour.

## Assumptions and Risks

- **No ETH price source exists anywhere in the repo.** Confirmed: no
  `ethPrice`/`priceFeed`/Chainlink/coingecko references in `packages/`, and the
  API client (`packages/frontend/src/api/`) exposes no price endpoint
  (`/v1/stats` returns vault `share_price` only, not ETH/USD). This is the core
  decision the plan cannot make unilaterally — see Open Questions.
- The mock-key fast path in `useNetworkFeeEstimate` currently returns a pinned
  ETH string verbatim (e.g. `~0.00053 ETH`). Existing QA/dev snippets and the
  hook's own tests rely on that shape. Appending a USD suffix must not break the
  pure-ETH mock path: the ETH fee mock and the USD price mock are independent —
  if only the ETH mock is set (no price), keep emitting the ETH-only string.
- Risk: an on-chain Chainlink read adds a second RPC round-trip per estimate.
  Mitigated by reusing the existing `useQuery` (60s `staleTime`/`refetchInterval`)
  — fold the price read into the same query function so it shares caching.
- Risk: Chainlink ETH/USD feed address is chain-specific. The target chain is
  Hoodi testnet (`EVM_CHAIN_ID` default `560048`); a Chainlink ETH/USD
  aggregator may not be deployed there, which is the dependency that makes the
  price-source choice non-trivial (see Open Questions).
- No blocking dependency on other open issues/PRs. The hook and its tests are
  self-contained.

## Open Questions

- **Which ETH→USD price source should the real (non-mock) path use?** The issue
  mandates "an ETH price source" but does not name one. Candidates: (a) on-chain
  Chainlink `AggregatorV3` ETH/USD feed via the existing `publicClient` — clean
  but requires a feed address that may not exist on Hoodi testnet; (b) a new
  backend `/v1/...` price endpoint served by the worker price feed
  (`ARCHITECTURE.md` notes the worker has a "price feed") — heavier, crosses the
  api boundary; (c) a third-party HTTP API (e.g. CoinGecko) called from the
  frontend — violates the "all blockchain/price access through a clear module"
  spirit and adds an external dependency. The manager/human must pick the
  source (and, for option a, supply the feed address per chain) before the coder
  can implement the real path. Until resolved, only the mock-key path is fully
  specified.
- Should the USD suffix appear on testnet at all if no reliable testnet ETH/USD
  feed exists, or is the mock-only path acceptable for now with the real path
  deferred to mainnet config? (Depends on the answer above.)

## Implementation Steps

> The mock-key path below is fully specified and can be built immediately. The
> real-price path is gated on the Open Questions; build it once the source is
> chosen.

1. **Add a USD-price mock key + helper** in
   `packages/frontend/src/wallet/evm/useNetworkFeeEstimate.ts`:
   - Add `MOCK_KEYS.ethUsdPrice = "pipeline.mock.wallet.ethUsdPrice"` (a plain
     numeric string, e.g. `"2264.15"`, JSON-encoded like the existing keys).
   - Read it via `useMock(MOCK_KEYS.ethUsdPrice, parseJson<string>)` (reactive)
     and `readMock(...)` inside the query function (non-reactive), mirroring the
     existing `mockRaw` handling.

2. **Add a USD-suffix formatter** alongside `formatFeeEth`:
   - `export function formatFeeEthWithUsd(feeWei: bigint, ethUsdPrice: number | undefined): string`
   - Returns `formatFeeEth(feeWei)` unchanged when `ethUsdPrice` is undefined or
     non-finite/≤0.
   - Otherwise computes `usd = Number(formatEther(feeWei)) * ethUsdPrice`,
     formats to 2 decimals via `Intl.NumberFormat("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})`,
     and returns `` `${formatFeeEth(feeWei)} ($${usd})` ``.
   - Keep `formatFeeEth` as-is (still exported) — `formatFeeEthWithUsd` composes it.

3. **Thread the price through the query function** (`queryFn` in
   `useNetworkFeeEstimate`):
   - After computing `feeWei`, resolve the ETH/USD price: prefer the mock value
     (`Number(mockPrice)`); otherwise call the chosen real price source (gated
     on Open Questions). Fold any RPC read into this same `queryFn` so it shares
     the existing `useQuery` cache window.
   - Return `formatFeeEthWithUsd(feeWei, price)`.
   - Include the price mock value (and feed address, if option (a)) in the
     `queryKey` so the query re-runs when it changes.

4. **Handle the ETH-fee mock fast path** (the early `if (mockRaw !== undefined)`
   block and the `queryFn` mock short-circuit): when an ETH-fee mock is set,
   still apply the USD suffix **only if** an `ethUsdPrice` mock is also present;
   otherwise return the ETH-only string (current behaviour). This keeps existing
   ETH-only mock snippets working unchanged.

5. **No change required in `routes/deposit.tsx`** — it already passes
   `networkFee={networkFee ?? "—"}` to `ConversionCard`, and `networkFee` is the
   hook's `feeEth` string. The suffix flows through transparently. Verify no
   caller slices/parses the ETH string in a way the suffix would break (grep
   shows only display usage).

6. **No change required in `packages/ui` `InfoRow`/`ConversionCard`** — they
   render the provided string verbatim. Confirm `whitespace-nowrap` on the value
   still fits the longer string on mobile; if it overflows, that becomes a
   follow-up styling issue (log in `known-bugs.md`, do not fix inline).

7. **Update the hook doc-comment** (top of `useNetworkFeeEstimate.ts`) to
   document the new `ethUsdPrice` mock key and the `~X ETH ($Y.YY)` output shape.

8. **Update `packages/frontend/src/wallet/README.md`** mock-key schema with the
   new `pipeline.mock.wallet.ethUsdPrice` key and a worked DevTools snippet.

## Test Strategy

Update `packages/frontend/src/wallet/evm/useNetworkFeeEstimate.test.tsx`:

- **`formatFeeEthWithUsd` unit cases**: price undefined → ETH-only string; price
  provided → correct `($X.XX)` suffix with 2-decimal rounding; price ≤0 or
  non-finite → ETH-only string; large/small fees round correctly (e.g.
  0.00053 ETH × 2264.15 → `($1.20)`).
- **Mock-key path with price mock set**: both ETH-fee mock and `ethUsdPrice`
  mock set → returns `~0.00053 ETH ($1.20)`, no RPC.
- **Mock-key path without price mock**: ETH-fee mock set, no price mock →
  returns `~0.00053 ETH` (regression guard for existing behaviour).
- **Real path** (using the chosen price source, mocked): gas mock + price mock
  → formatted string includes the USD suffix.
- **Price-source failure**: when the price read rejects/returns undefined →
  ETH-only string (graceful degradation), no thrown error.
- **Direction toggle**: suffix applies in both deposit and withdraw directions.

Also update any rendering test that asserts the network-fee string. Confirmed
`packages/frontend/src/components/ConversionCard.test.tsx` asserts only `"—"`
(no real fee string), so no change expected there — re-verify after edit.

Run `npx vitest run packages/frontend/src/wallet/evm/useNetworkFeeEstimate.test.tsx`
and the frontend lint/type checks. Per `AGENTS.md`, run
`npx tsx scripts/lint-docs.ts` after the README/doc edits.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — add the `ethUsdPrice` mock key to
  the schema and a console snippet.
- Hook doc-comment in `useNetworkFeeEstimate.ts` (covered in step 7).
- No product-spec change: this is a `fix` restoring the designed display; it
  does not introduce new user-facing behaviour beyond what Figma already
  specifies. If the real price source chosen in Open Questions introduces a new
  backend endpoint, that endpoint must be spec'd separately (out of this issue's
  scope).
