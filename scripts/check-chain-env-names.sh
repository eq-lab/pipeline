#!/usr/bin/env bash
# Guards the mechanical half of the #1456 rename: no retired per-chain indexer or
# chain-wide spelling may survive in code, config or the example env file. The
# relayer, price-poller and API keep their own names until their follow-up issues,
# so only the suffixes renamed by #1456 are listed here.
#
# Historical records under docs/exec-plans/ and the design spec itself quote the old
# names deliberately and are not scanned.

set -euo pipefail
cd "$(dirname "$0")/.."

# A chain id as it is written in Rust format strings, in .env files and in docs.
id='(\{[a-z_]+\}|[0-9]+|<id>)'

retired=(
  'ETH_RPC_URL'
  'START_BLOCK'
  'INDEXER_'
  'DM_CONTRACTS'
  'WQ_CONTRACTS'
  'SPLUSD_CONTRACTS'
  'LOAN_REGISTRY_CONTRACTS'
  'YIELD_MINTER_CONTRACTS'
  'STELLAR_DEPOSIT_MANAGER_ID'
  'STELLAR_WITHDRAWAL_QUEUE_ID'
  'STELLAR_WITHDRAWAL_QUEUE_WALLET_ID'
  'STELLAR_STAKED_PLUSD_ID'
  'STELLAR_LOAN_REGISTRY_ID'
  'STELLAR_YIELD_MINTER_ID'
  'STELLAR_START_LEDGER'
)

pattern="CHAIN_${id}_($(IFS='|'; echo "${retired[*]}"))"

hits=$(grep -rnE "$pattern" \
  --include='*.rs' --include='*.ts' --include='*.tsx' \
  --include='*.yaml' --include='*.yml' --include='*.sh' \
  --include='.env.example' \
  packages scripts .env.example ARCHITECTURE.md 2>/dev/null \
  | grep -v '^scripts/check-chain-env-names.sh:' || true)

if [[ -n $hits ]]; then
  echo "retired per-chain env names survive (#1456):" >&2
  echo "$hits" >&2
  echo >&2
  echo "Rename them to the CHAIN_<id>_<EVM|STELLAR>_[<COMPONENT>_]<KEY> scheme." >&2
  exit 1
fi

echo "no retired per-chain env names found"
