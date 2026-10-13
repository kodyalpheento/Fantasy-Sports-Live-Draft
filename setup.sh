#!/usr/bin/env sh
# Live Draft local setup for macOS / Linux:  ./setup.sh [--start]
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get it from https://nodejs.org"; exit 1; }
exec node "$(dirname "$0")/scripts/setup-local.mjs" "$@"
