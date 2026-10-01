# 安全说明

本项目把 ChatGPT 的工具调用转发给本机飞书用户身份。部署者应把它视为能够读取和修改业务数据的本地集成，而不是普通聊天脚本。

## 支持边界

项目支持的安全目标：

- 不开放任意 Shell；
- 只允许明确列出的飞书业务域；
- 强制使用当前 `lark-cli` 用户身份；
- 在服务端验证命令风险等级和保留参数；
- 高风险操作必须先预览，再使用一次性令牌执行；
- 限制 MCP 工作目录之外的本地文件访问；
- 对常见 token 和 Secret 字段做返回前脱敏；
- 限制参数大小、输出大小和运行时间。

项目不能替代：

- 飞书后台的 scope 管理和资源权限；
- ChatGPT 或 OpenAI Platform 的组织权限管理；
- 操作系统账号隔离、磁盘加密和终端安全；
- 对真实业务场景的人工复核；
- 受监管数据所需的正式安全评审和审计制度。

OpenAI 建议把 MCP 工具视为生产软件，对输入进行服务端验证，为不可逆操作要求人工确认，并遵循最小权限原则。[OpenAI 插件安全与隐私指南](https://developers.openai.com/plugins/guides/security-privacy)

## 必须保护的秘密和标识

不得提交、公开或粘贴到 Issue：

- OpenAI Runtime API Key；
- 飞书 App Secret；
- 飞书 access token 和 refresh token；
- `profiles/*.yaml`；
- `.env`；
- 未脱敏日志；
- 包含个人 Tunnel ID、OpenID、企业域名或敏感资源链接的截图。

Tunnel ID 不是 Runtime API Key，但它属于部署标识，公开仓库不应内置任何个人 Tunnel ID。

## 本地凭据

- 首次启动时，Runtime API Key 由启动脚本在终端中隐藏读取并持久保存：macOS 写入当前用户的钥匙串；Windows 写入仅当前用户可解密的 DPAPI 加密文件 `profiles/runtime-api-key.dpapi`；
- 可选的 Tunnel HTTP 代理同样只保存在本机：macOS 写入当前用户的钥匙串；Windows 写入仅当前用户可解密的 `profiles/tunnel-http-proxy.dpapi`；
- 启动时才会把该 Key 读入 `tunnel-client` 所在进程环境；它不会写入 YAML、代码或 Git 可跟踪文件；
- 飞书登录态由官方 `lark-cli` 管理；
- 项目代码不保存 App Secret、access token 或 refresh token。

不要为了绕过登录问题，把长期凭据写进 `src/server.mjs`、启动脚本或 profile。

## 最小权限

方便起见，常规登录命令默认请求所有受支持业务域。生产或企业环境应优先：

1. 只在飞书应用后台开通必要 scope；
2. 只授权实际使用的业务域；
3. 限制飞书应用可用范围；
4. 限制 Tunnel 可见的 Platform Organization 和 ChatGPT workspace；
5. 定期撤销不再使用的权限和 Runtime API Key。

即使调用通过适配层，使用者原本对资源的权限仍然是最终边界。

## 写入和删除

普通写入只有在请求中包含明确确认时才执行。高风险写入采用两阶段流程：

1. `feishu_high_risk_preview` 使用 `--dry-run` 生成请求预览；
2. 使用者检查目标和影响；
3. 服务签发十分钟有效、只能使用一次的确认令牌；
4. `feishu_high_risk_execute` 使用该令牌执行原参数。

确认令牌不能授权不同目标或不同命令。第一次测试写入、删除、成员管理和权限变更时，应只使用临时测试资源。

## 本地文件

启动脚本把仓库中的 `workspace/` 设为 MCP 工作目录。工具只接受该目录中的相对路径，拒绝绝对路径、`..`、`file:` URL 和符号链接。系统剪贴板读取、本地文件删除和覆盖参数也被禁用。

只把确实需要上传的文件临时放入 `workspace/`，并及时移走下载结果。该目录的内容已被 `.gitignore` 排除，但这不能替代本地磁盘权限和加密。

## 网络和管理界面

- `tunnel-client` 只需要到 OpenAI 的出站 HTTPS；
- 健康检查和管理界面应保持监听 `127.0.0.1`；
- 不要把本地 admin UI 暴露到公网；
- 只配置自己信任的代理和 CA；
- 不要使用 `--harpoon.allow-plaintext-http` 连接不受信任的远程服务。

OpenAI 官方说明 Tunnel 不需要入站互联网访问，并建议保持本地管理界面仅限 loopback。[Tunnel 网络和安全说明](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#security-and-networking)

## 日志

发布问题报告前应删除或替换：

- Authorization 头；
- token、Secret 和 Key；
- Tunnel ID；
- OpenID、User ID、Chat ID；
- 企业域名；
- 文档、群、邮箱和会议内容；
- 本地用户名和绝对路径。

服务会遮蔽常见敏感字段，但不能保证识别所有业务数据。不要默认认为完整工具输出适合公开。

## 公开仓库检查清单

发布或创建 release 前确认：

- [ ] `git status --ignored` 显示个人 profile 已被忽略；
- [ ] 仓库中没有 `.env`、日志或系统凭据导出；
- [ ] 搜索不到真实 `tunnel_...`、Runtime API Key 或 App Secret；
- [ ] 启动脚本不含用户名、个人绝对路径和代理地址；
- [ ] 示例只使用明显的占位符；
- [ ] `npm test` 通过；
- [ ] macOS 和 Windows 启动流程均已验证；
- [ ] 文档明确要求每位使用者创建自己的飞书应用和 Tunnel；
- [ ] release 压缩包与 Git tag 内容一致。

## 报告安全问题

不要通过公开 Issue 披露可被利用的安全问题或真实凭据。仓库启用 GitHub Private Vulnerability Reporting 后，优先使用 Security 页面中的私密报告入口。若尚未启用，维护者应在发布仓库前配置一个私密安全联系渠道。
