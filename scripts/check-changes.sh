#!/usr/bin/env bash
# Selective verification: runs only the checks that the changed paths require.
#
#   scripts/check-changes.sh     # changes since the merge-base with origin/main (+ staged and working-tree edits)
#   CODING_FLOW_BASE_SHA=<sha> CODING_FLOW_CHECK_STAGE=commit scripts/check-changes.sh
#
# Env:
#   CODING_FLOW_BASE_SHA     diff base (default: git merge-base origin/main HEAD)
#   CODING_FLOW_CHECK_STAGE  setup | commit | integration (default: commit);
#                            commit also considers staged files
#   CARGO_TARGET_DIR         respected as is (share it across worktrees to reuse builds)
#
# Selection: docs-only -> doc lint; Rust paths -> fmt, clippy, tests; JS packages
# -> build and tests along the dependency graph (ui -> wallet-connect -> frontend,
# trustee). Root config and unknown paths run everything. All selected steps run
# (no stop at the first failure); the exit code is 1 if any step failed.
# See docs/RELIABILITY.md, "Selective verification".
if [ -z "${BASH_VERSION:-}" ]; then
    exec bash "$0" "$@"
fi
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# `yarn install` runs `husky` (the prepare script), which rewrites core.hooksPath.
export HUSKY=0

STAGE="${CODING_FLOW_CHECK_STAGE:-commit}"
case "$STAGE" in
    setup | commit | integration) ;;
    *) echo "check-changes: invalid CODING_FLOW_CHECK_STAGE '$STAGE'" >&2; exit 1 ;;
esac

# `.yarnrc.yml` pins yarn via `yarnPath`; run it through node so a trimmed PATH works.
YARN_PATH=$(sed -n 's/^yarnPath: *//p' .yarnrc.yml 2>/dev/null | head -1)
if [ -n "${YARN_PATH:-}" ] && [ -f "$YARN_PATH" ]; then
    YARN=(node "$YARN_PATH")
else
    YARN=(yarn)
fi

install_deps() { "${YARN[@]}" install --immutable; }

if [ "$STAGE" = setup ]; then
    # Every check needs node_modules (tsx, tsc, vitest); prepare them once.
    echo "check-changes: setup -> yarn install --immutable"
    install_deps
    exit $?
fi

# ── Base and changed paths ──────────────────────────────────────────
BASE="${CODING_FLOW_BASE_SHA:-}"
if [ -z "$BASE" ]; then
    BASE=$(git merge-base origin/main HEAD 2>/dev/null) || {
        echo "check-changes: CODING_FLOW_BASE_SHA unset and no origin/main to merge-base with" >&2
        exit 1
    }
fi

names_of() { git diff --name-only --no-renames -z "$@" -- | tr '\0' '\n'; }

changed=$(names_of "$BASE" HEAD)
if [ "$STAGE" = commit ]; then
    changed=$(printf '%s\n%s\n' "$changed" "$(names_of --cached HEAD)")
fi
if [ -z "${CODING_FLOW_BASE_SHA:-}" ]; then
    # Human run: uncommitted edits of tracked files count too.
    changed=$(printf '%s\n%s\n' "$changed" "$(names_of HEAD)")
fi

rust=false ui=false wallet=false frontend=false trustee=false all=false docs_only=true
while IFS= read -r path; do
    case "$path" in
        '') continue ;;
        docs/* | *.md) ;; # docs only: doc lint always runs
        packages/api/* | packages/worker/* | packages/shared/* | Cargo.toml | Cargo.lock | \
            rust-toolchain | rust-toolchain.toml | rustfmt.toml | .rustfmt.toml | clippy.toml | .cargo/*)
            rust=true; docs_only=false ;;
        packages/ui/*) ui=true; docs_only=false ;;
        packages/wallet-connect/*) wallet=true; docs_only=false ;;
        packages/frontend/*) frontend=true; docs_only=false ;;
        packages/trustee/*) trustee=true; docs_only=false ;;
        *) all=true; docs_only=false ;; # package.json, yarn.lock, scripts/, .github/, .husky/, Dockerfile, unknown
    esac
done <<<"$changed"

if [ "$all" = true ]; then
    rust=true ui=true wallet=true frontend=true trustee=true
fi
# Dependency graph: ui -> wallet-connect -> frontend, trustee.
[ "$ui" = true ] && wallet=true
[ "$wallet" = true ] && { frontend=true; trustee=true; }

# ── Steps ───────────────────────────────────────────────────────────
new_migrations() {
    git diff --name-only --no-renames --diff-filter=A "$BASE" HEAD -- packages/shared/migrations/ \
        | grep -E '^packages/shared/migrations/[0-9]+_.*\.sql$' || true
}

# Same rule as .husky/pre-commit: new sqlx migrations must be newer than origin/main's latest.
migrations_check() {
    local new main_max bad="" f ver
    new=$(new_migrations)
    [ -z "$new" ] && return 0
    if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
        echo "origin/main not found locally, skipping (git fetch origin main)"
        return 0
    fi
    main_max=$(git ls-tree -r --name-only origin/main -- packages/shared/migrations/ \
        | grep -E '^packages/shared/migrations/[0-9]+_.*\.sql$' \
        | sed -E 's|^packages/shared/migrations/([0-9]+)_.*|\1|' | sort -n | tail -1) || true
    [ -z "$main_max" ] && return 0
    while IFS= read -r f; do
        ver=$(echo "$f" | sed -E 's|^packages/shared/migrations/([0-9]+)_.*|\1|')
        [ "$ver" -le "$main_max" ] && bad="${bad}  $f (version $ver <= origin/main max $main_max)\n"
    done <<<"$new"
    if [ -n "$bad" ]; then
        printf "new migrations must be newer than origin/main:\n%b" "$bad"
        return 1
    fi
}

rust_tests() {
    if command -v cargo-nextest >/dev/null 2>&1; then
        cargo nextest run --workspace --no-tests=pass
    else
        echo "WARNING: cargo-nextest not found, falling back to cargo test --all" >&2
        cargo test --all
    fi
}

yarn_ws() { "${YARN[@]}" workspace "@pipeline/$1" "$2"; }

names=() cmds=()
add() { names+=("$1"); cmds+=("$2"); }

add "yarn install" install_deps
if [ "$rust" = true ]; then
    [ -n "$(new_migrations)" ] && add "migration versions" migrations_check
    add "cargo fmt" "cargo fmt --all --check"
    add "cargo clippy" "cargo clippy --workspace --all-targets -- -D warnings"
    add "rust tests" rust_tests
fi
add "doc lint" "npx tsx scripts/lint-docs.ts"
if [ "$ui" = true ] || [ "$frontend" = true ] || [ "$trustee" = true ]; then
    add "comment lint" "npx tsx scripts/lint-comments.ts"
fi
[ "$frontend" = true ] && add "frontend build" "yarn_ws frontend build"
[ "$trustee" = true ] && add "trustee build" "yarn_ws trustee build"
[ "$frontend" = true ] && add "frontend tests" "yarn_ws frontend test"
[ "$wallet" = true ] && add "wallet-connect tests" "yarn_ws wallet-connect test"
[ "$trustee" = true ] && add "trustee tests" "yarn_ws trustee test"

kinds=()
[ "$all" = true ] && kinds+=("root/unknown")
[ "$rust" = true ] && kinds+=(rust)
[ "$ui" = true ] && kinds+=(ui)
[ "$wallet" = true ] && kinds+=(wallet-connect)
[ "$frontend" = true ] && kinds+=(frontend)
[ "$trustee" = true ] && kinds+=(trustee)
[ "$docs_only" = true ] && kinds+=(docs-only)
echo "check-changes: stage=$STAGE base=${BASE:0:10}"
echo "changed: ${kinds[*]}"
plan=""
for n in "${names[@]}"; do plan="$plan, $n"; done
echo "running: ${plan#, }"

# ── Run ─────────────────────────────────────────────────────────────
results=() failed=0
for i in "${!names[@]}"; do
    printf '\n▸ %s\n' "${names[$i]}"
    start=$(date +%s)
    (eval "${cmds[$i]}")
    rc=$?
    status=PASS
    if [ $rc -ne 0 ]; then status=FAIL; failed=1; fi
    results+=("$status ${names[$i]} ($(($(date +%s) - start))s)")
done

printf '\n── summary ──\n'
printf '%s\n' "${results[@]}"
if [ "$failed" -ne 0 ]; then
    echo "check-changes: FAILED"
    exit 1
fi
echo "check-changes: all passed"
