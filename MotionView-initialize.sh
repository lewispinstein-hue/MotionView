#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/MotionView"
VENV_DIR="$APP_DIR/.venv"

BUILD_SIDECARS=0
SKIP_NODE=0
SKIP_PYTHON=0
NODE_BIN="${NODE:-node}"

usage() {
  cat <<'USAGE'
Usage: ./MotionView-initialize.sh [options]

Prepares a source checkout for launching MotionView.

Options:
  --build-sidecars  Also run pnpm py:build after dependencies are installed.
  --skip-node       Skip pnpm dependency installation.
  --skip-python     Skip Python virtual environment setup.
  -h, --help        Show this help.

After this finishes, launch the app with:
  cd MotionView
  pnpm dev
USAGE
}

log() {
  printf '\033[1;34m==>\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2
}

die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

for arg in "$@"; do
  case "$arg" in
    --build-sidecars)
      BUILD_SIDECARS=1
      ;;
    --skip-node)
      SKIP_NODE=1
      ;;
    --skip-python)
      SKIP_PYTHON=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown option: $arg"
      ;;
  esac
done

[ -d "$APP_DIR" ] || die "MotionView directory not found at $APP_DIR"

PYTHON_BIN="${PYTHON:-}"
if [ "$SKIP_PYTHON" -eq 0 ] && [ -z "$PYTHON_BIN" ]; then
  if command_exists python3; then
    PYTHON_BIN="python3"
  elif command_exists python; then
    PYTHON_BIN="python"
  else
    die "Python is required. Install Python 3, then rerun this script."
  fi
fi

if [ "$SKIP_NODE" -eq 0 ] || [ "$BUILD_SIDECARS" -eq 1 ]; then
  if ! command_exists "$NODE_BIN"; then
    die "Node.js 20 or newer is required. Install Node.js, then rerun this script."
  fi

  if ! NODE_VERSION_OUTPUT="$("$NODE_BIN" --version 2>&1)"; then
    if printf '%s\n' "$NODE_VERSION_OUTPUT" | grep -q 'GLIBC_'; then
      die "Node.js failed to start because its binary requires a newer glibc than this Linux system provides. Update the Linux system packages together, or install a distro-compatible Node.js 20+ binary from a source such as your package manager, nvm, fnm, or Volta, then rerun this script. Details: $NODE_VERSION_OUTPUT"
    fi
    die "Node.js is installed but failed to run: $NODE_VERSION_OUTPUT"
  fi

  NODE_VERSION="${NODE_VERSION_OUTPUT#v}"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  case "$NODE_MAJOR" in
    ''|*[!0-9]*)
      warn "Could not parse Node.js version: $NODE_VERSION_OUTPUT"
      ;;
    *)
      if [ "$NODE_MAJOR" -lt 20 ]; then
        die "Node.js 20 or newer is required. Found $NODE_VERSION_OUTPUT."
      fi
      ;;
  esac
fi

PNPM_BIN="${PNPM:-}"
if [ "$SKIP_NODE" -eq 0 ] || [ "$BUILD_SIDECARS" -eq 1 ]; then
  if [ -z "$PNPM_BIN" ]; then
    if command_exists pnpm; then
      PNPM_BIN="pnpm"
    elif command_exists corepack; then
      log "pnpm not found; enabling Corepack shims"
      corepack enable
      PNPM_BIN="pnpm"
    else
      die "pnpm is required. Install Node.js with Corepack or install pnpm, then rerun this script."
    fi
  fi
else
  PNPM_BIN="${PNPM_BIN:-pnpm}"
fi

if [ "$BUILD_SIDECARS" -eq 1 ]; then
  command_exists rustc || die "Rust is required for --build-sidecars because the build needs rustc to determine the Tauri target triple."
fi

if [ "$SKIP_PYTHON" -eq 0 ]; then
  log "Creating Python virtual environment at $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"

  if [ -x "$VENV_DIR/bin/python" ]; then
    VENV_PYTHON="$VENV_DIR/bin/python"
  elif [ -x "$VENV_DIR/Scripts/python.exe" ]; then
    VENV_PYTHON="$VENV_DIR/Scripts/python.exe"
  else
    die "virtual environment was created, but its Python executable was not found"
  fi

  log "Installing MotionView Python dependencies"
  "$VENV_PYTHON" -m pip install --upgrade pip setuptools wheel
  "$VENV_PYTHON" -m pip install -r "$APP_DIR/requirements.txt"
  "$VENV_PYTHON" -m pip install -r "$APP_DIR/src/pros-cli/requirements.txt"
else
  warn "Skipping Python setup"
fi

if [ "$SKIP_NODE" -eq 0 ]; then
  log "Installing MotionView Node dependencies with pnpm"
  cd "$APP_DIR"
  "$PNPM_BIN" install
else
  warn "Skipping Node dependency setup"
fi

if [ "$BUILD_SIDECARS" -eq 1 ]; then
  log "Building Python sidecars for Tauri"
  cd "$APP_DIR"
  "$PNPM_BIN" py:clean
  "$PNPM_BIN" py:build
else
  log "Skipping sidecar build. pnpm dev will build them before launching."
fi

log "MotionView source checkout is initialized."
printf '\nNext steps:\n'
printf '  cd %q\n' "$APP_DIR"
printf '  %s dev\n' "$PNPM_BIN"
