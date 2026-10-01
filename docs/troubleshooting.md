# 故障排查

先从项目根目录运行基础检查：

```text
node --version
lark-cli --version
lark-cli auth status --json --verify
npm test
tunnel-client --version
```

然后在已设置 `CONTROL_PLANE_API_KEY` 的终端中运行：

```text
tunnel-client doctor --profile feishu-universal --profile-dir ./profiles --explain
```

## Runtime API Key 格式错误

错误：

```text
configure tunnel-client: control plane API key is malformed
```

常见原因：

- 使用了普通 OpenAI Project API Key，而不是 Tunnel Runtime API Key；
- Key 前后包含空格、引号或换行；
- 复制了终端提示文字；
- Runtime API Key 已撤销或不完整。

回到 [OpenAI Platform Tunnels](https://platform.openai.com/settings/organization/tunnels) 为对应 Tunnel 获取 Runtime API Key。若本机保存的是旧 Key，先清除后再启动并输入新 Key：

```zsh
./scripts/macos/run.zsh --forget-runtime-key
```

```powershell
.\scripts\windows\run.ps1 -ForgetRuntimeKey
```

不要把 Key 写进 profile。

## Tunnel 已 ready 但 ChatGPT 无法创建连接

依次检查：

1. Tunnel 是否关联了目标 ChatGPT workspace；
2. 当前 Platform Organization 是否正确；
3. 操作者是否有 `Tunnels Read + Use`；
4. ChatGPT 是否具备创建自定义 MCP 连接的权限；若已经能创建并使用 Tunnel 连接，则此项已满足；
5. `scripts/macos/run.zsh` 或 `scripts/windows/run.ps1` 是否仍在运行；
6. `doctor --explain` 是否通过；
7. 删除失败的旧连接后重新创建。

OpenAI 将 Platform Tunnel 权限和 ChatGPT 的自定义 MCP 访问权限分开管理；官方文档将后者归入开发者模式。[Tunnel 权限与关联说明](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#permissions-and-access)

## ChatGPT 显示 `Session terminated`

这通常发生在调用过程中关闭或重启了本机 `tunnel-client`。本项目的 MCP 由 `tunnel-client` 启动，不要单独重启 `src/server.mjs`。

1. 在旧终端按 `Ctrl+C`；
2. 从仓库根目录重新运行 `./scripts/macos/run.zsh` 或 `./scripts/windows/run.ps1`；
3. 保持终端运行，确认没有持续出现网络或认证错误；
4. 新建 ChatGPT 对话，在加号菜单中选择已有的“飞书助手”，然后重试。

不需要重新创建 MCP 应用。新对话中选择已有插件只是启用该对话的工具；停止本地服务前的旧对话会话无法继续使用。若新对话仍失败，再到 [ChatGPT Plugins](https://chatgpt.com/plugins) 打开现有应用并使用页面提供的 Refresh 或 Reconnect 操作（名称可能因界面版本而异）。

## 网络连接超时

错误可能包含：

```text
dial tcp ...:443: i/o timeout
poll timed out
```

这是本机到 `api.openai.com:443` 的出站网络问题。检查：

- DNS 和系统网络；
- 公司防火墙；
- IPv4 或 IPv6 路由；
- 可信本地代理是否正在运行；
- 启动脚本是否配置了正确的 HTTP 代理端口。

为避免每次启动重复配置，可将代理保存一次；脚本会在之后的启动中自动将其传给 Tunnel 控制平面：

```zsh
./scripts/macos/run.zsh --set-proxy "http://127.0.0.1:7897"
```

```powershell
.\scripts\windows\run.ps1 -SetProxy "http://127.0.0.1:7897"
```

如果使用 Clash Verge，通常可先尝试 `http://127.0.0.1:7897`；若软件中显示的 HTTP / Mixed Port 不同，以实际端口为准。macOS 的代理保存在当前用户钥匙串，Windows 的代理保存在仅当前用户可解密的 `profiles/tunnel-http-proxy.dpapi`。

如需删除已保存的代理：

```zsh
./scripts/macos/run.zsh --forget-proxy
```

```powershell
.\scripts\windows\run.ps1 -ForgetProxy
```

只想临时覆盖保存的代理时，在启动前设置 `TUNNEL_HTTP_PROXY` 即可；这个环境变量关闭终端后失效。

不要把飞书 OpenAPI 的网络问题与 OpenAI Tunnel 控制平面的网络问题混为一谈。网络恢复后重启 `tunnel-client`。

## base URL must use https

如果同时看到了 `--embedded-stateless-mcp-stub`，说明启动的是 `tunnel-client` 内置 HTTP 演示 MCP。

本项目通过 stdio 启动 `src/server.mjs`，不需要 `--harpoon.allow-plaintext-http`。停止旧进程，重新运行项目的 `run` 脚本。

## 只看到三个演示工具

如果 ChatGPT 只显示：

```text
server_info
echo
uppercase
```

连接的是演示 MCP。检查实际进程和 profile，确认启动命令不包含：

```text
--embedded-stateless-mcp-stub
```

重新启动真实 profile 后，在 ChatGPT Plugins 中刷新或重建连接。

## 飞书缺少权限

错误可能包含：

```text
missing_scope
need_user_authorization
```

处理顺序：

1. 查看错误返回的 `missing_scopes`；
2. 在飞书应用后台开通对应 scope；
3. 创建并发布新应用版本；
4. 等待组织审批完成；
5. 重新运行相应业务域的 `lark-cli auth login`；
6. 再运行 `lark-cli auth status --json --verify`。

应用后台权限和用户 OAuth 授权缺一不可。

## 能登录但看不到个人资源

检查身份：

```text
lark-cli whoami
```

本项目强制使用 `--as user`。如果直接测试 CLI，也应在访问个人资源时显式使用用户身份。

还要确认当前用户本来就有权访问目标文档、群、日历、邮箱或其他资源。

## ChatGPT 显示旧工具或旧描述

修改 `src/server.mjs` 的工具名称、描述、schema 或 annotation 后：

1. 停止旧 Tunnel；
2. 运行 `npm test`；
3. 重新启动；
4. 在 ChatGPT Plugins 中打开连接；
5. 点击 Refresh；
6. 新建对话重试。

OpenAI 官方建议 MCP 元数据变化后刷新连接，并在新对话中重新运行测试。[刷新连接元数据](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata)

## 启动了旧目录或旧 profile

macOS：

```zsh
pgrep -af 'tunnel-client|server.mjs'
```

Windows PowerShell：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match 'tunnel-client|node' -and $_.CommandLine -match 'server\.mjs|feishu-universal' } |
  Select-Object ProcessId, Name, CommandLine
```

在对应终端按 `Ctrl+C` 停止旧进程，再从当前仓库目录运行启动脚本。不要使用模糊的批量强杀命令，以免结束无关进程。

## 飞书登录状态没有保存

先更新并重新登录：

```text
lark-cli update
lark-cli auth login --domain all
lark-cli auth status --json --verify
```

仍然失败时：

- macOS 检查钥匙串权限，并在普通 Terminal 中完成首次登录；
- Windows 检查“凭据管理器 → Windows 凭据”，并在普通 PowerShell 中完成首次登录；
- 不要把 App Secret、access token 或 refresh token 明文写进代码绕过凭据存储。

## macOS 找不到命令

检查：

```zsh
command -v node
command -v npm
command -v lark-cli
command -v tunnel-client
```

如果刚完成安装，先关闭并重新打开 Terminal。使用 Homebrew、nvm 或其他版本管理器时，确保非交互 shell 也能找到相同的 Node.js 和 npm 全局目录。

## Windows 找不到 lark-cli 或多行文本被截断

确认官方 npm 包存在：

```powershell
$NpmGlobalRoot = (& npm.cmd root -g).Trim()
$LarkPackage = Join-Path $NpmGlobalRoot "@larksuite\cli"
Test-Path (Join-Path $LarkPackage "scripts\run.js")
Test-Path (Join-Path $LarkPackage "bin\lark-cli.exe")
```

两项都应返回 `True`。否则重新安装：

```powershell
npm install -g @larksuite/cli@latest
lark-cli --version
```

不要把 `LARK_CLI_PATH` 指向 `lark-cli.cmd`。仓库的 `scripts\windows\run.ps1` 会定位官方 `scripts\run.js`，适配层使用 Node.js 和独立 argv 调用它，以保留多行文本和引号。

## Windows 拒绝运行 PowerShell 脚本

先确认脚本来自当前仓库并检查内容，然后：

```powershell
Unblock-File -LiteralPath ".\scripts\windows\init-profile.ps1"
Unblock-File -LiteralPath ".\scripts\windows\run.ps1"
```

如果组织策略仍阻止运行，可只对当前 PowerShell 进程临时放行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

关闭窗口后设置自动恢复。不要永久关闭系统执行策略或 Defender。

## profile 不存在

错误：

```text
未找到 profiles/feishu-universal.yaml
```

这是预期保护。profile 含个人 Tunnel ID 和绝对路径，不随 Git 仓库分发。运行：

macOS：

```zsh
./scripts/macos/init-profile.zsh
```

Windows：

```powershell
.\scripts\windows\init-profile.ps1
```

## 继续报告问题前需要提供什么

可以提供：

- 操作系统和 CPU 架构；
- Node.js、`lark-cli` 和 `tunnel-client` 版本；
- `npm test` 结果；
- 脱敏后的错误类型和退出码；
- 问题发生在登录、Tunnel、工具发现还是具体飞书命令阶段。

不要公开提供：

- Runtime API Key；
- App Secret；
- access token 或 refresh token；
- 完整 profile；
- 包含 Tunnel ID、OpenID、企业域名或敏感文档链接的截图。
