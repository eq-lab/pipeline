# Wallet flows

Architecture and behavior specs for the chain-agnostic deposit / withdraw / stake flows in
`packages/frontend/src/wallet/**`. This is the home for flow-shape knowledge that previously lived
as file-header docblocks inside the hooks — see [`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

The source hooks should carry only code-level comments plus a one-line pointer back to the relevant
section here.

> **Status:** scaffold. Sections are filled in as each hook's docblock is migrated under
> [issue #991](https://github.com/eq-lab/pipeline/issues/991). Do not delete a source comment until
> its content lives in a section below.

## Deposit adapter

_To be migrated from `packages/frontend/src/wallet/useDepositFlow.ts`._

## Stake flow

_To be migrated from `packages/frontend/src/wallet/useStakeFlow.ts`._

## EVM integration

_To be migrated from `packages/frontend/src/wallet/evm/**`._

## Stellar integration

_To be migrated from `packages/frontend/src/wallet/stellar/**`._
