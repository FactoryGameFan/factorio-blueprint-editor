#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Exercise the actual workflow predicate, without copying its path rules.
classifier=$(sed -n '/if grep --quiet --invert-match/,/echo "web=$web"/p' .github/workflows/ci.yml | sed '$d')
test -n "$classifier"
check() {
    local files="$1" web
    eval "$classifier"
    if [ "$web" != "$2" ]; then
        printf 'Expected web=%s for %s, got %s\n' "$2" "$files" "$web" >&2
        exit 1
    fi
}

check 'packages/exporter/data/output/data.json' true
check 'packages/exporter/data/output/base/graphics/entity.png' true
check $'packages/exporter/README.md\npackages/exporter/data/output/data.json' true
check 'packages/exporter/src/main.rs' false
check 'packages/exporter/Cargo.lock' false
check 'README.md' true
check "$(printf 'packages/exporter/data/output/%s.png\n' {1..6000})" true
echo 'CI web classification checks passed'
