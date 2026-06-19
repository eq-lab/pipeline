# User Story: Stellar Withdraw Network Fee Estimate (#660)

Epic: #498 — Deposit/withdraw page
Issue: https://github.com/eq-lab/pipeline/issues/660

## Background

The Stellar `useStellarNetworkFeeEstimate` hook's `queryFn` previously returned
`undefined` when the Soroban simulation failed. React Query forbids `undefined`
resolutions and logs `Query data cannot be undefined`, causing repeated console
errors on every 60 s refetch interval. The withdraw direction was particularly
affected because the Futurenet simulation was failing transiently.

The fix changes `queryFn`'s return type to `Promise<string>` and propagates
simulation failures as thrown errors (query errors) rather than `undefined`
resolutions. With `retry: false` and `staleTime: 60_000`, the error is cached
and not retried until the next 60 s interval.

## User Stories

### Story 1: Withdraw network fee renders when simulation succeeds

**Given** the user has a Stellar wallet connected on the withdraw page  
**And** the Soroban RPC simulation of `request_withdrawal` succeeds  
**When** the page loads  
**Then** the network fee row shows a formatted XLM fee string (e.g. `~0.0052 XLM`)  
**And** no `Query data cannot be undefined` error appears in the browser console

### Story 2: Withdraw network fee renders "—" gracefully when simulation fails

**Given** the user has a Stellar wallet connected on the withdraw page  
**And** the Soroban RPC simulation of `request_withdrawal` fails (transient RPC error)  
**When** the page loads  
**Then** the network fee row shows "—" (undefined → dash, per existing caller convention)  
**And** no `Query data cannot be undefined` error is logged  
**And** the hook's `error` field is non-null (the error is surfaced, not silenced)  
**And** no repeated console errors appear — the error is cached for 60 s before the next attempt

### Story 3: Disconnected wallet shows "—" for fee, no query runs

**Given** the user has no Stellar wallet connected  
**When** the withdraw page loads  
**Then** the network fee row shows "—"  
**And** no RPC call is made (query is disabled via `enabled: shouldRunQuery`)

## Acceptance Criteria

- `useStellarNetworkFeeEstimate("withdraw")` never resolves to `undefined` from `queryFn`.
- Simulation failure surfaces as `query.error` (non-null) with `feeXlm: undefined`.
- Console does not log `Query data cannot be undefined` for the withdraw key.
- `staleTime: 60_000` and `refetchInterval: 60_000` remain in place.
- Existing deposit, stake, and unstake directions are unaffected (same `queryFn`, same fix).
