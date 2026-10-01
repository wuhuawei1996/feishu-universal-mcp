# 开发与贡献

项目刻意保持小型化：运行时核心位于 `src/server.mjs`，不依赖第三方 npm 包。提交改动时，应优先保持工具契约稳定和安全边界可审计。

## 开发环境

需要 Node.js 20 或更高版本。

```text
git clone https://github.com/wuhuawei1996/feishu-universal-mcp.git
cd feishu-universal-mcp
npm test
```

不需要真实飞书账号即可运行单元测试。测试通过假的 `lark-cli` 进程验证 MCP 协议和安全限制。

## 修改前先阅读

- [实现原理与安全边界](docs/architecture.md)
- [安全说明](SECURITY.md)
- [完整安装与使用指南](docs/getting-started.md)

## 本地检查

提交前运行：

```text
npm run check
```

macOS 或 Linux 还应检查 shell 语法：

```zsh
zsh -n scripts/macos/*.zsh
```

Windows 脚本应在 Windows PowerShell 5.1 和 PowerShell 7 中至少选择一个真实环境运行；涉及参数传递时，应同时测试中文、多行文本、双引号和反引号。

## 修改工具契约

改变工具名称、描述、input schema 或 annotation 时：

1. 更新 `src/server.mjs`；
2. 更新 `test/adapter.test.mjs`；
3. 更新 README 和架构文档；
4. 重新启动 Tunnel；
5. 在 ChatGPT Plugins 中刷新连接；
6. 用新对话运行直接、间接、越界和写入确认测试。

OpenAI 官方建议保留一组稳定的评测提示，并在 MCP 元数据变化后重新运行。[连接和测试插件](https://developers.openai.com/plugins/deploy/connect-chatgpt)

## 增加业务域

新增业务域不能只修改 `ALLOWED_DOMAINS`。还需要确认：

- 官方 `lark-cli` 确实支持该域；
- 叶子命令帮助提供可靠的 `Risk`；
- 是否包含应用管理、长期运行订阅或其他不适合一次 MCP 调用的能力；
- 文件参数是否需要加入路径检查；
- 原始写入是否必须走高风险流程；
- 返回结构是否可能包含新的敏感字段；
- 相关读取、写入和拒绝路径是否有测试。

无法可靠判断风险时，应拒绝执行，而不是默认按普通写入处理。

## 保持跨平台

- 不要在脚本中写死 `/usr/local/bin`、盘符、用户名或仓库绝对路径；
- macOS 使用脚本自身位置计算项目目录；
- Windows 使用 `$MyInvocation.MyCommand.Path` 计算项目目录；
- 不要在 Windows 上通过 `lark-cli.cmd` 转发 MCP 的多行参数；
- 不要用 Shell 字符串拼接用户提供的 argv；
- 新增文件名时避免 Windows 保留名称和仅大小写不同的文件。

## 处理秘密

提交前检查：

```text
git status --short --ignored
git diff --check
```

不得提交：

- `profiles/*.yaml`；
- `.env`；
- Runtime API Key；
- App Secret；
- access token 或 refresh token；
- 真实 Tunnel ID；
- 未脱敏的飞书业务数据或日志。

如果秘密已经进入 Git 历史，仅删除当前文件不够。应立即撤销凭据，并按组织流程清理历史。

## Pull Request 内容

Pull Request 应说明：

- 改动解决的问题；
- 对工具 schema 或安全边界的影响；
- 已运行的自动测试；
- 已完成的真实平台测试；
- macOS 和 Windows 是否均验证；
- 文档是否需要刷新。

不要为了让测试通过而放宽风险分类、关闭确认或跳过路径验证。

## 发布检查

1. 选择并确认版本号；
2. 更新 `package.json`、`package-lock.json` 和 `SERVER_VERSION`；
3. 运行 `npm run check`；
4. 在干净目录中重新克隆并完成快速开始；
5. 验证 release 不含被忽略文件；
6. 检查 README 内链接；
7. 在 macOS 和 Windows 至少完成一次启动；
8. 创建 tag 和 release notes。

版本更新后，使用者需要重启 Tunnel，并在 ChatGPT 中刷新连接才能获得新的 MCP 元数据。
