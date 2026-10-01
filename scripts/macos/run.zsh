#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h:h}"
PROFILE_DIR="$ROOT/profiles"
PROFILE_FILE="$PROFILE_DIR/feishu-universal.yaml"
WORKSPACE_DIR="$ROOT/workspace"
TUNNEL_HTTP_PROXY="${TUNNEL_HTTP_PROXY:-}"
KEYCHAIN_SERVICE="feishu-universal-mcp"
KEYCHAIN_ACCOUNT="openai-runtime-api-key"
PROXY_KEYCHAIN_ACCOUNT="tunnel-control-plane-proxy"

case "${1:-}" in
  --forget-runtime-key)
    if (( $# != 1 )); then
      echo "--forget-runtime-key 不接受额外参数。" >&2
      exit 1
    fi
    if /usr/bin/security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" >/dev/null 2>&1; then
      echo "已从 macOS 钥匙串删除 Runtime API Key。"
    else
      echo "macOS 钥匙串中没有已保存的 Runtime API Key。"
    fi
    exit 0
    ;;
  --set-proxy)
    if (( $# != 2 )) || [[ -z "${2//[[:space:]]/}" ]]; then
      echo "用法：$0 --set-proxy \"http://127.0.0.1:7897\"" >&2
      exit 1
    fi
    if ! /usr/bin/security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$PROXY_KEYCHAIN_ACCOUNT" -w "$2" >/dev/null; then
      echo "无法将 Tunnel 代理保存到 macOS 钥匙串。请检查钥匙串访问权限后重试。" >&2
      exit 1
    fi
    echo "Tunnel 代理已保存到当前用户的 macOS 钥匙串；后续启动会自动使用。"
    exit 0
    ;;
  --forget-proxy)
    if (( $# != 1 )); then
      echo "--forget-proxy 不接受额外参数。" >&2
      exit 1
    fi
    if /usr/bin/security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$PROXY_KEYCHAIN_ACCOUNT" >/dev/null 2>&1; then
      echo "已从 macOS 钥匙串删除 Tunnel 代理。"
    else
      echo "macOS 钥匙串中没有已保存的 Tunnel 代理。"
    fi
    exit 0
    ;;
  "")
    ;;
  *)
    echo "未知参数：$1。可用参数：--forget-runtime-key、--set-proxy、--forget-proxy" >&2
    exit 1
    ;;
esac

LARK_CLI_BIN="${LARK_CLI_PATH:-$(command -v lark-cli)}"
TUNNEL_CLIENT_BIN="${TUNNEL_CLIENT_BIN:-$(command -v tunnel-client)}"

if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "未找到 $PROFILE_FILE，请先运行 $ROOT/scripts/macos/init-profile.zsh。" >&2
  exit 1
fi

if [[ -z "${CONTROL_PLANE_API_KEY:-}" ]] && CONTROL_PLANE_API_KEY="$(/usr/bin/security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null)"; then
  export CONTROL_PLANE_API_KEY
fi

if [[ -z "${CONTROL_PLANE_API_KEY:-}" ]]; then
  read -rs "CONTROL_PLANE_API_KEY?粘贴 OpenAI Runtime API Key（输入不会显示）："
  echo
  export CONTROL_PLANE_API_KEY

  if [[ -n "${CONTROL_PLANE_API_KEY//[[:space:]]/}" ]]; then
    if ! /usr/bin/security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$CONTROL_PLANE_API_KEY" >/dev/null; then
      unset CONTROL_PLANE_API_KEY
      echo "无法将 Runtime API Key 保存到 macOS 钥匙串。请检查钥匙串访问权限后重试。" >&2
      exit 1
    fi
    echo "Runtime API Key 已保存到当前用户的 macOS 钥匙串，后续启动无需再次输入。"
  fi
fi

if [[ -z "${CONTROL_PLANE_API_KEY//[[:space:]]/}" ]]; then
  unset CONTROL_PLANE_API_KEY
  echo "Runtime API Key 不能为空。" >&2
  exit 1
fi

if [[ -z "${TUNNEL_HTTP_PROXY//[[:space:]]/}" ]] && TUNNEL_HTTP_PROXY="$(/usr/bin/security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$PROXY_KEYCHAIN_ACCOUNT" -w 2>/dev/null)"; then
  :
fi

export LARK_CLI_PATH="$LARK_CLI_BIN"
export LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1
export LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1

if ! "$LARK_CLI_BIN" auth status --json --verify >/dev/null; then
  echo "lark-cli 用户登录无效。请先运行：lark-cli auth login --domain all" >&2
  exit 1
fi

mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"

TUNNEL_RUN_ARGS=(
  --profile feishu-universal
  --profile-dir "$PROFILE_DIR"
)

if [[ -n "${TUNNEL_HTTP_PROXY//[[:space:]]/}" ]]; then
  TUNNEL_RUN_ARGS+=(--control-plane.http-proxy "$TUNNEL_HTTP_PROXY")
fi

exec "$TUNNEL_CLIENT_BIN" run "${TUNNEL_RUN_ARGS[@]}"
