#!/bin/sh
set -eu

env_file="/usr/share/nginx/html/__env.js"
tmp_file="${env_file}.tmp"

{
  printf 'window.__ENV__ = '
  jq -n \
    --arg VITE_API_BASE_URL "${VITE_API_BASE_URL:-}" \
    '{
      VITE_API_BASE_URL: $VITE_API_BASE_URL
    }'
  printf ';\n'
} > "$tmp_file"

mv "$tmp_file" "$env_file"
