#!/usr/bin/env bash
# Brings up the local e2e stack: up.sh --tag <tag> [--chains stellar,evm] [--reclaim] | up.sh --prepare; see docs/e2e.md "Local stack".
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node node_modules/.bin/tsx scripts/e2e/stack.ts up "$@"
