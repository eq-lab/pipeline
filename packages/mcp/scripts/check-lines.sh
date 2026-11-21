#!/usr/bin/env bash
# Fails when a source file in packages/mcp (outside vendor/) has more than 300 lines.
cd "$(dirname "$0")/.." || exit 1
bad=$(find . \( -name node_modules -o -name vendor -o -name dist \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.js' -o -name '*.sh' \) -print0 |
    xargs -0 wc -l | awk '$2 != "total" && $1 > 300 { print $2 " (" $1 " lines)" }')
if [ -n "$bad" ]; then
    echo "files over 300 lines:" >&2
    echo "$bad" >&2
    exit 1
fi
