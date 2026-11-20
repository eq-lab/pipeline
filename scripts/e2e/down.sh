#!/usr/bin/env bash
# Removes a local e2e stack (containers, volumes, processes, state): down.sh --tag <tag>; see docs/e2e.md "Local stack".
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node node_modules/.bin/tsx scripts/e2e/stack.ts down "$@"
