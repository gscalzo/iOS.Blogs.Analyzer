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

ensure_blogs_file() {
  if [[ -n "${IOS_BLOGS_SKIP_DOWNLOAD:-}" ]]; then
    return
  fi

  if [[ -x "${ROOT_DIR}/scripts/download-blogs.mjs" ]]; then
    node "${ROOT_DIR}/scripts/download-blogs.mjs"
  fi
}

run_cli() {
  ensure_dependencies
  ensure_blogs_file
  if [[ $# -gt 0 && $1 == "--" ]]; then
    shift
  fi
  echo "Building TypeScript..." >&2
  npm run build --silent >/dev/null
  echo "Executing dist/index.js" >&2
  node "${ROOT_DIR}/dist/index.js" "$@"
}

run_tests() {
  ensure_dependencies
  ensure_blogs_file
  npx vitest run
}

build_project() {
  ensure_dependencies
  ensure_blogs_file
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
