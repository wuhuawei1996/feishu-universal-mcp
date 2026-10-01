#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h:h}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
TUNNEL_CLIENT_BIN="${TUNNEL_CLIENT_BIN:-$(command -v tunnel-client)}"
PROFILE_DIR="$ROOT/profiles"
PROFILE_FILE="$PROFILE_DIR/feishu-universal.yaml"

if [[ -e "$PROFILE_FILE" ]]; then
  echo "已存在 $PROFILE_FILE。为避免覆盖，请先备份或移走它。" >&2
  exit 1
fi

read "TUNNEL_ID?粘贴 OpenAI Tunnel ID（tunnel_...）："
if [[ "$TUNNEL_ID" != tunnel_* ]]; then
  echo "Tunnel ID 格式不正确，应以 tunnel_ 开头。" >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"
MCP_COMMAND="\"$NODE_BIN\" \"$ROOT/src/server.mjs\""

"$TUNNEL_CLIENT_BIN" init \
  --sample sample_mcp_stdio_local \
  --profile feishu-universal \
  --profile-dir "$PROFILE_DIR" \
  --tunnel-id "$TUNNEL_ID" \
  --mcp-command "$MCP_COMMAND" \
  --health-listen-addr "127.0.0.1:0"

if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "tunnel-client 已退出，但没有生成 $PROFILE_FILE。" >&2
  exit 1
fi

echo "已生成 $PROFILE_FILE"
echo "下一步运行：$ROOT/scripts/macos/run.zsh"
