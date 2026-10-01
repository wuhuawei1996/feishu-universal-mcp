# Feishu Universal MCP

通过 OpenAI Secure MCP Tunnel，让 ChatGPT 以当前登录的飞书用户身份调用官方 `lark-cli`，读取和操作飞书数据。

```text
ChatGPT → OpenAI Secure MCP Tunnel → 本机 MCP 适配层 → 官方 lark-cli → 飞书 OpenAPI
```
这是一个私有本地集成：`tunnel-client` 只向 OpenAI 发起出站 HTTPS 连接，不需要公网 IP。实际能力取决于飞书应用的权限、用户授权、资源自身权限以及 ChatGPT workspace 的 MCP 能力。

## 能力与边界

- 覆盖文档、云盘、消息、日历、任务、审批、邮箱、通讯录、电子表格、多维表格、知识库、演示文稿、会议和 OKR 等已开通业务域。
- 所有业务调用固定使用本机 `lark-cli` 的 `user` 身份，不使用 bot 身份绕过个人权限。
- 普通写入需要明确确认；删除、权限变更等高风险操作必须先预览，再使用一次性确认令牌执行。
- 本地上传和下载只能使用 `workspace/` 内的文件，不会任意访问电脑其他路径。

## 开始使用

首次配置请以[完整安装与使用指南](docs/getting-started.md)为准。它包含飞书应用、`lark-cli` 登录、OpenAI Tunnel、macOS/Windows 脚本和 ChatGPT 连接的完整步骤。

```text
git clone https://github.com/wuhuawei1996/feishu-universal-mcp.git
cd feishu-universal-mcp
```

完成首次配置后，每次使用只需启动本地 Tunnel：

macOS：

```zsh
./scripts/macos/run.zsh
```

Windows PowerShell：

```powershell
.\scripts\windows\run.ps1
```

终端需保持运行。之后在 ChatGPT 中启用已创建的连接即可。

## 文档

- [完整安装与使用指南](docs/getting-started.md)
- [实现原理与安全边界](docs/architecture.md)
- [故障排查](docs/troubleshooting.md)
- [安全说明](SECURITY.md)
- [开发与贡献](CONTRIBUTING.md)

## 仓库结构

```text
src/                 MCP 适配层实现
scripts/macos/       macOS 初始化、启动脚本
scripts/windows/     Windows 初始化、启动脚本
workspace/           本地文件上传/下载工作区，内容不提交
profiles/            本机 Tunnel profile，不提交
docs/                使用、架构与排障文档
docs/assets/screenshots/
                     文档用截图；提交前移除个人信息与凭据
test/                开发者测试
```

## 安全提示

不要提交 `profiles/*.yaml`、Runtime API Key、飞书 App Secret、访问令牌、日志或 `workspace/` 中的个人文件。更完整的威胁模型和发布检查清单请查阅 [SECURITY.md](SECURITY.md)。
