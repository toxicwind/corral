#!/usr/bin/env bash
# claude shim wrapper — portable version
# Routes all model traffic through local proxy, with ReAct loop for MCP tool support
# 
# Original hardcoded ~[old-ranch-path]/.secrets and ~[old-ranch-path]/estate paths.
# This version uses env vars and $HOME, works for any user.
#
# Install: symlink to ~/.local/bin/claude
#   ln -sf $(pwd)/bin/claude-shim-wrapper.sh ~/.local/bin/claude

set -euo pipefail

# Smithers preflight: claude auth status expecting JSON with loggedIn
if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then
  echo '{"loggedIn":true,"method":"nim-proxy"}'
  exit 0
fi

# Preserve caller-provided proxy ROUTING over secrets file.
# Credential vars are the reverse: the secrets file is the source of truth.
# (2026-10-10: a stale inherited NVIDIA_API_KEY -- dead npk_ea key lingering
# in the systemd user env -- shadowed the good key in ~/.secrets and 401'd
# every super-ralph agent call, slashing bidders for infra faults.)
_keep_nim_base_url="${NIM_BASE_URL:-}"
_keep_nim_model="${NIM_MODEL:-}"
_keep_anthropic_base_url="${ANTHROPIC_BASE_URL:-}"
_keep_nvidia_api_key="${NVIDIA_API_KEY:-}"  # fallback only: used iff secrets file lacks it

# Load secrets from standard locations (first found wins)
# Order: CORRAL_SECRETS_PATH > ~/.secrets > ~/.config/corral/secrets
_secrets_path="${CORRAL_SECRETS_PATH:-}"
if [[ -z "$_secrets_path" ]]; then
  for candidate in "$HOME/.secrets" "$HOME/.config/corral/secrets" ".env"; do
    if [[ -f "$candidate" ]]; then
      _secrets_path="$candidate"
      break
    fi
  done
fi

if [[ -n "${_secrets_path:-}" && -f "$_secrets_path" ]]; then
  set -a
  set +u
  # shellcheck disable=SC1090
  source "$_secrets_path"
  set -u
  set +a
fi

[[ -n "$_keep_nim_base_url" ]] && export NIM_BASE_URL="$_keep_nim_base_url"
[[ -n "$_keep_nim_model" ]] && export NIM_MODEL="$_keep_nim_model"
# Default NIM_MODEL from CLAUDE_CODE_SUBAGENT_MODEL if not set
if [[ -z "${NIM_MODEL:-}" && -n "${CLAUDE_CODE_SUBAGENT_MODEL:-}" ]]; then
  export NIM_MODEL="$CLAUDE_CODE_SUBAGENT_MODEL"
fi
[[ -n "$_keep_anthropic_base_url" ]] && export ANTHROPIC_BASE_URL="$_keep_anthropic_base_url"
# Credentials: the secrets file wins. An inherited NVIDIA_API_KEY is only a
# fallback when the file did not define one.
if [[ -z "${NVIDIA_API_KEY:-}" && -n "$_keep_nvidia_api_key" ]]; then
  export NVIDIA_API_KEY="$_keep_nvidia_api_key"
fi
unset _keep_nim_base_url _keep_nvidia_api_key _keep_nim_model _keep_anthropic_base_url

export NIM_BASE_URL="${NIM_BASE_URL:-http://127.0.0.1:25193/v1}"

# Fallback mapping: NIM_PROXY_API_KEY -> NVIDIA_API_KEY only if latter unset
if [[ -z "${NVIDIA_API_KEY:-}" && -n "${NIM_PROXY_API_KEY:-}" ]]; then
  export NVIDIA_API_KEY="$NIM_PROXY_API_KEY"
fi

# For --version/--help, pass through to real binary
REAL_BIN="${CLAUDE_REAL_BIN:-$HOME/.local/bin/claude.nim-shim-real}"
if [[ "${1:-}" == "--version" || "${1:-}" == "--help" ]]; then
  exec "$REAL_BIN" "$@"
fi

# Resolve react-loop script relative to this script's location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REACT_LOOP="${CORRAL_REACT_LOOP:-$SCRIPT_DIR/claude-react-loop.py}"

# Extract prompt: last non-flag argument
_prompt=""
for arg in "$@"; do
  case "$arg" in
    -*) ;;
    *) _prompt="$arg" ;;
  esac
done

if [[ -n "$_prompt" && -f "$REACT_LOOP" ]]; then
  exec /usr/bin/python3 "$REACT_LOOP" "$_prompt"
else
  exec "$REAL_BIN" "$@"
fi
