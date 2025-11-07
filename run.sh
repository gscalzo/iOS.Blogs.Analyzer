#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage: ./run.sh [command] [-- ...args]

Commands:
  run [-- args]      Run the analyzer CLI with optional arguments forwarded after --.
  test               Execute the Vitest test suite.
  build              Compile the TypeScript source to dist/.
  install            Install npm dependencies.
  help               Show this message.

If no command is provided, "run" is used by default.
USAGE
}

ensure_dependencies() {
  if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
    echo "Installing npm dependencies..."
    npm install --ignore-scripts --loglevel warn
  fi
}

run_cli() {
  ensure_dependencies
  if [[ $# -gt 0 && $1 == "--" ]]; then
    shift
  fi
  npx ts-node "${ROOT_DIR}/src/index.ts" "$@"
}

run_tests() {
  ensure_dependencies
  npx vitest run
}

build_project() {
  ensure_dependencies
  npm run build
}

command="${1:-run}"
shift || true

case "${command}" in
  run)
    run_cli "$@"
    ;;
  test)
    run_tests
    ;;
  build)
    build_project
    ;;
  install)
    npm install --ignore-scripts --loglevel warn
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: ${command}" >&2
    usage
    exit 1
    ;;
esac