#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

const SERVER_NAME = "feishu-lark-cli-mcp";
const SERVER_VERSION = "0.1.0";
const LARK_CLI =
  process.env.LARK_CLI_PATH || (process.platform === "win32" ? "lark-cli.exe" : "/usr/local/bin/lark-cli");
const CLI_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_ARG_BYTES = 1024 * 1024;
const HIGH_RISK_TOKEN_TTL_MS = 10 * 60 * 1000;

const ALLOWED_DOMAINS = new Set([
  "api",
  "approval",
  "attendance",
  "base",
  "calendar",
  "contact",
  "docs",
  "drive",
  "im",
  "mail",
  "markdown",
  "mindnotes",
  "minutes",
  "note",
  "okr",
  "sheets",
  "slides",
  "task",
  "vc",
  "whiteboard",
  "wiki",
]);

const BLOCKED_FLAGS = new Set([
  "--as",
  "--delete-local",
  "--dry-run",
  "--format",
  "--from-clipboard",
  "--help",
  "--jq",
  "--overwrite",
  "--profile",
  "--yes",
  "-h",
  "-q",
]);

const LOCAL_PATH_FLAGS = new Set([
  "--attach",
  "--audio",
  "--body-file",
  "--file",
  "--image",
  "--local-dir",
  "--output",
  "--output-dir",
  "--output-path",
  "--patch-file",
  "--set-template-content-file",
  "--template-content-file",
  "--video",
  "--video-cover",
  "-o",
]);
const pendingHighRisk = new Map();
let writeQueue = Promise.resolve();

const argvSchema = {
  type: "array",
  minItems: 1,
  maxItems: 128,
  items: { type: "string", maxLength: 200000 },
  description:
    "lark-cli 参数数组，不含 lark-cli 本身。示例：[\"docs\",\"+fetch\",\"--doc\",\"https://...\"]。不得传 --as、--yes、--dry-run、--format、--jq、--profile、--overwrite、--delete-local 或 --from-clipboard。",
};

const tools = [
  {
    name: "feishu_auth_status",
    title: "检查飞书登录状态",
    description:
      "检查本机 lark-cli 用户身份、登录状态、授权范围和令牌有效性；不会返回访问令牌。调用其他工具前可先使用它。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "feishu_command_help",
    title: "查看飞书命令帮助",
    description:
      "查看 lark-cli 业务域或具体命令的官方帮助、参数与风险等级。执行操作前，不确定参数时先调用。command 示例：[\"docs\"]、[\"docs\",\"+update\"]、[\"calendar\",\"events\",\"create\"]。",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "array",
          minItems: 0,
          maxItems: 6,
          items: { type: "string", maxLength: 128 },
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "feishu_command_read",
    title: "读取飞书数据",
    description:
      "以当前登录用户身份执行风险等级为 read 的 lark-cli 命令。服务会先读取官方 --help 并拒绝写命令。示例：[\"docs\",\"+fetch\",\"--doc\",\"https://...\",\"--doc-format\",\"markdown\"]。",
    inputSchema: {
      type: "object",
      properties: { argv: argvSchema },
      required: ["argv"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "feishu_command_write",
    title: "写入飞书数据",
    description:
      "以当前登录用户身份执行普通 write 命令，例如创建/更新文档、任务、日程、消息或表格记录。仅在用户已明确要求这项具体改动时设置 confirmed=true。高风险命令必须改用预览和确认工具。",
    inputSchema: {
      type: "object",
      properties: {
        argv: argvSchema,
        confirmed: {
          type: "boolean",
          const: true,
          description: "用户已经明确要求当前这项具体写入。",
        },
      },
      required: ["argv", "confirmed"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "feishu_high_risk_preview",
    title: "预览飞书高风险操作",
    description:
      "对 high-risk-write 命令执行 --dry-run，不修改飞书数据。成功后返回十分钟有效的一次性 confirmation_token 和请求预览；必须把具体影响展示给用户并取得明确同意。",
    inputSchema: {
      type: "object",
      properties: { argv: argvSchema },
      required: ["argv"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "feishu_high_risk_execute",
    title: "确认执行飞书高风险操作",
    description:
      "使用高风险预览返回的一次性 confirmation_token 执行原命令。只有在用户看过预览并明确同意后才能设置 confirmed=true。令牌十分钟失效且只能使用一次。",
    inputSchema: {
      type: "object",
      properties: {
        confirmation_token: { type: "string", minLength: 20, maxLength: 128 },
        confirmed: {
          type: "boolean",
          const: true,
          description: "用户已经看过预览并明确同意执行。",
        },
      },
      required: ["confirmation_token", "confirmed"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: "2.0", id, error });
}

function ensureObject(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("arguments 必须是对象");
  }
  if (allowedKeys) {
    const allowed = new Set(allowedKeys);
    const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
    if (unexpected.length) throw new Error(`arguments 包含未允许的字段: ${unexpected.join(", ")}`);
  }
  return value;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const SENSITIVE_FIELD_NAMES = new Set([
  "access_token",
  "api_key",
  "apikey",
  "app_secret",
  "appsecret",
  "authorization",
  "client_secret",
  "clientsecret",
  "id_token",
  "password",
  "refresh_token",
  "tenant_access_token",
  "user_access_token",
]);

function redactSensitiveText(value) {
  return value
    .replace(/(authorization\s*:\s*(?:bearer\s+)?)\S+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|rk)[_-][A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(
      /((?:["']?(?:access_token|api_key|apikey|app_secret|appsecret|authorization|client_secret|clientsecret|id_token|password|refresh_token|tenant_access_token|user_access_token)["']?)\s*[:=]\s*["']?)[^\s"',}\]]+/gi,
      "$1[REDACTED]",
    );
}

function redactSecrets(value) {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SENSITIVE_FIELD_NAMES.has(key.toLowerCase()) ? "[REDACTED]" : redactSecrets(child);
  }
  return output;
}

function toolResult(payload, isError = false) {
  const safePayload = redactSecrets(payload);
  return {
    content: [
      {
        type: "text",
        text: typeof safePayload === "string" ? safePayload : JSON.stringify(safePayload, null, 2),
      },
    ],
    structuredContent:
      safePayload && typeof safePayload === "object"
        ? safePayload
        : { result: String(safePayload) },
    isError,
  };
}

function normalizePathArgument(value, flag) {
  let candidate = value;
  if (flag === "--file" && value.includes("=")) candidate = value.slice(value.indexOf("=") + 1);
  if (candidate === "-") return;
  if (candidate.startsWith("@")) candidate = candidate.slice(1);
  if (candidate === "-") return;
  if (/^https?:\/\//i.test(candidate)) return;
  if (/^file:/i.test(candidate)) {
    throw new Error(`${flag} 不允许 file: URL`);
  }

  const segments = candidate.split(/[\\/]/);
  if (
    !candidate ||
    path.posix.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate) ||
    segments.includes("..")
  ) {
    throw new Error(`${flag} 只允许当前 MCP 工作目录下的相对路径`);
  }

  const cwd = process.cwd();
  const resolved = path.resolve(cwd, candidate);
  const relative = path.relative(cwd, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${flag} 只允许当前 MCP 工作目录下的相对路径`);
  }

  let cursor = cwd;
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    cursor = path.resolve(cursor, segment);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`${flag} 不允许经由符号链接访问本地文件`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
}

function validateArgv(rawArgv) {
  if (!Array.isArray(rawArgv) || rawArgv.length === 0 || rawArgv.length > 128) {
    throw new Error("argv 必须是包含 1 到 128 个元素的数组");
  }

  let totalBytes = 0;
  const argv = rawArgv.map((value, index) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`argv[${index}] 必须是非空字符串`);
    }
    if (value.includes("\0")) throw new Error(`argv[${index}] 包含非法字符`);
    totalBytes += Buffer.byteLength(value);
    if (value.length > 200000 || totalBytes > MAX_ARG_BYTES) {
      throw new Error("argv 超过长度限制");
    }
    return value;
  });

  if (!ALLOWED_DOMAINS.has(argv[0])) throw new Error(`不允许的业务域: ${argv[0]}`);

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (/^-q.+/.test(value)) {
      throw new Error("参数 -q 由 MCP 服务管理，调用方不能传入");
    }
    if (/^-o.+/.test(value) && !value.startsWith("--")) {
      const attachedPath = value.slice(2).replace(/^=/, "");
      if (!attachedPath) throw new Error("-o 缺少路径");
      normalizePathArgument(attachedPath, "-o");
    }

    const flag = value.includes("=") ? value.slice(0, value.indexOf("=")) : value;
    if (BLOCKED_FLAGS.has(flag)) {
      throw new Error(`参数 ${flag} 由 MCP 服务管理，调用方不能传入`);
    }

    if (LOCAL_PATH_FLAGS.has(flag)) {
      const inlineValue = value.includes("=") ? value.slice(value.indexOf("=") + 1) : argv[index + 1];
      if (inlineValue === undefined) throw new Error(`${flag} 缺少路径`);
      normalizePathArgument(inlineValue, flag);
    }

    const indirectPath = value.includes("=") ? value.slice(value.indexOf("=") + 1) : value;
    if (indirectPath.startsWith("@")) {
      normalizePathArgument(indirectPath, flag);
    }
  }

  if (argv[0] === "api") {
    if (argv.length < 3) throw new Error("api 调用必须提供 HTTP 方法和 /open-apis/ 路径");
    const method = argv[1].toUpperCase();
    if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new Error(`不允许的 HTTP 方法: ${argv[1]}`);
    }
    if (!argv[2].startsWith("/open-apis/")) {
      throw new Error("原始 API 只允许 /open-apis/ 下的飞书路径，不能传完整 URL");
    }
    argv[1] = method;
  }

  return argv;
}

function validateHelpCommand(rawCommand) {
  if (!Array.isArray(rawCommand) || rawCommand.length > 6) {
    throw new Error("command 必须是最多 6 个元素的数组");
  }
  if (rawCommand.length === 0) return [];
  const command = rawCommand.map((value, index) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_.+-]+$/.test(value)) {
      throw new Error(`command[${index}] 包含不允许的字符`);
    }
    return value;
  });
  if (!ALLOWED_DOMAINS.has(command[0])) throw new Error(`不允许的业务域: ${command[0]}`);
  return command;
}

function commandPath(argv) {
  if (argv[0] === "api") return ["api"];
  const output = [];
  for (const value of argv) {
    if (value.startsWith("-")) break;
    output.push(value);
  }
  return output;
}

function riskForRawApi(argv) {
  if (argv[0] !== "api") return null;
  if (["GET", "HEAD"].includes(argv[1])) return "read";
  // Raw OpenAPI calls carry no typed business-risk metadata. A POST may still
  // revoke access, transfer ownership, or trigger another irreversible action,
  // so every mutating raw request uses the high-risk two-step flow.
  return "high-risk-write";
}

function runCli(args) {
  return new Promise((resolve) => {
    // The npm-installed Windows `lark-cli.cmd` shim can reinterpret multiline
    // arguments. When LARK_CLI_PATH points at the official JS runner (or a JS
    // test double), invoke it with Node and keep every argument as a separate
    // argv element. Native lark-cli binaries are still spawned directly.
    const useNodeRunner = /\.(?:cjs|mjs|js)$/i.test(LARK_CLI);
    const command = useNodeRunner ? process.execPath : LARK_CLI;
    const commandArgs = useNodeRunner ? [LARK_CLI, ...args] : args;
    const child = spawn(command, commandArgs, {
      shell: false,
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let overflow = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, CLI_TIMEOUT_MS);

    const collect = (current, chunk) => {
      if (Buffer.byteLength(current) + chunk.length > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill("SIGTERM");
        return current;
      }
      return current + chunk.toString("utf8");
    };

    child.stdout.on("data", (chunk) => {
      stdout = collect(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = collect(stderr, chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout,
        stderr,
        parsedStdout: null,
        parsedStderr: null,
        processError: error.message,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        parsedStdout: parseJson(stdout.trim()),
        parsedStderr: parseJson(stderr.trim()),
        overflow,
        timedOut,
      });
    });
  });
}

function cliFailure(result) {
  if (result.processError) {
    return { ok: false, error: { type: "local_process", message: result.processError } };
  }
  if (result.overflow) {
    return { ok: false, error: { type: "output_limit", message: "lark-cli 输出超过 8 MiB" } };
  }
  if (result.timedOut) {
    return { ok: false, error: { type: "timeout", message: "lark-cli 执行超过 120 秒" } };
  }
  return (
    result.parsedStderr ||
    result.parsedStdout || {
      ok: false,
      error: {
        type: "lark_cli",
        message:
          result.stderr ||
          result.stdout ||
          `lark-cli 退出码 ${result.code}${result.signal ? ` (${result.signal})` : ""}`,
      },
    }
  );
}

async function commandRisk(argv) {
  const rawRisk = riskForRawApi(argv);
  if (rawRisk) return rawRisk;
  const help = await runCli([...commandPath(argv), "--help"]);
  if (help.code !== 0) {
    const failure = cliFailure(help);
    throw new Error(failure?.error?.message || "无法读取命令帮助");
  }
  const match = `${help.stdout}\n${help.stderr}`.match(
    /(?:^|\n)Risk:\s*(read|write|high-risk-write)\s*(?:\n|$)/i,
  );
  if (!match) {
    throw new Error("无法识别命令风险等级；请先调用 feishu_command_help 确认具体叶子命令");
  }
  return match[1].toLowerCase();
}

async function executeJson(argv, extraArgs = []) {
  const result = await runCli([...argv, "--as", "user", "--format", "json", ...extraArgs]);
  if (result.code === 0 && result.parsedStdout?.ok === true) return result.parsedStdout;
  return cliFailure(result);
}

function queueWrite(operation) {
  const pending = writeQueue.then(operation, operation);
  writeQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

function pruneHighRiskTokens() {
  const now = Date.now();
  for (const [token, item] of pendingHighRisk.entries()) {
    if (item.expiresAt <= now) pendingHighRisk.delete(token);
  }
}

async function authStatus(rawArgs) {
  ensureObject(rawArgs, []);
  const result = await runCli(["auth", "status", "--json", "--verify"]);
  if (result.code === 0 && result.parsedStdout) {
    // Unlike business commands, `auth status --json` returns the status object
    // directly rather than the usual `{ ok: true, data: ... }` envelope.
    return toolResult({ ok: true, data: result.parsedStdout });
  }
  return toolResult(cliFailure(result), true);
}

async function commandHelp(rawArgs) {
  const args = ensureObject(rawArgs, ["command"]);
  const command = validateHelpCommand(args.command);
  const result = await runCli([...command, "--help"]);
  if (result.code !== 0) return toolResult(cliFailure(result), true);
  return toolResult({ ok: true, data: { command, help: result.stdout || result.stderr } });
}

async function readCommand(rawArgs) {
  const args = ensureObject(rawArgs, ["argv"]);
  const argv = validateArgv(args.argv);
  const risk = await commandRisk(argv);
  if (risk !== "read") throw new Error(`该命令风险等级为 ${risk}，不能通过只读工具执行`);
  const result = await executeJson(argv);
  return toolResult(result, result?.ok !== true);
}

async function writeCommand(rawArgs) {
  const args = ensureObject(rawArgs, ["argv", "confirmed"]);
  if (args.confirmed !== true) throw new Error("用户明确要求当前具体写入后，才能传 confirmed=true");
  const argv = validateArgv(args.argv);
  const risk = await commandRisk(argv);
  if (risk === "high-risk-write") {
    throw new Error("这是高风险写入；请先调用 feishu_high_risk_preview，再在用户确认后执行");
  }
  if (risk !== "write") {
    throw new Error(`该命令风险等级为 ${risk}，不能通过普通写入工具执行`);
  }
  const result = await queueWrite(() => executeJson(argv));
  return toolResult(result, result?.ok !== true);
}

async function previewHighRisk(rawArgs) {
  const args = ensureObject(rawArgs, ["argv"]);
  const argv = validateArgv(args.argv);
  const risk = await commandRisk(argv);
  if (risk !== "high-risk-write") {
    throw new Error(`该命令风险等级为 ${risk}，不需要高风险确认流程`);
  }

  const preview = await executeJson(argv, ["--dry-run"]);
  if (preview?.ok !== true) return toolResult(preview, true);

  pruneHighRiskTokens();
  const confirmationToken = crypto.randomUUID();
  const expiresAt = Date.now() + HIGH_RISK_TOKEN_TTL_MS;
  pendingHighRisk.set(confirmationToken, { argv, expiresAt });
  return toolResult({
    ok: true,
    risk,
    action: commandPath(argv).join(" "),
    argv,
    preview: preview.data ?? preview,
    confirmation_token: confirmationToken,
    expires_at: new Date(expiresAt).toISOString(),
    instruction: "请向用户展示预览和影响；只有用户明确同意后才能执行。",
  });
}

async function executeHighRisk(rawArgs) {
  const args = ensureObject(rawArgs, ["confirmation_token", "confirmed"]);
  if (args.confirmed !== true) throw new Error("用户看过预览并明确同意后，才能传 confirmed=true");
  if (typeof args.confirmation_token !== "string") throw new Error("confirmation_token 无效");

  pruneHighRiskTokens();
  const pending = pendingHighRisk.get(args.confirmation_token);
  if (!pending) throw new Error("确认令牌无效、已使用或已过期；请重新预览");
  pendingHighRisk.delete(args.confirmation_token);

  const result = await queueWrite(() => executeJson(pending.argv, ["--yes"]));
  return toolResult(result, result?.ok !== true);
}

async function callTool(name, args) {
  switch (name) {
    case "feishu_auth_status":
      return authStatus(args);
    case "feishu_command_help":
      return commandHelp(args);
    case "feishu_command_read":
      return readCommand(args);
    case "feishu_command_write":
      return writeCommand(args);
    case "feishu_high_risk_preview":
      return previewHighRisk(args);
    case "feishu_high_risk_execute":
      return executeHighRisk(args);
    default:
      return toolResult(
        { ok: false, error: { type: "unknown_tool", message: `未知工具: ${name}` } },
        true,
      );
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");

  if (message.method === "initialize") {
    if (!hasId) return;
    const requested = message.params?.protocolVersion;
    const supported = new Set(["2026-07-28", "2025-06-18", "2025-03-26"]);
    const protocolVersion = supported.has(requested) ? requested : "2025-06-18";
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          "这是基于飞书官方 lark-cli 的本机通用 MCP。所有业务调用固定使用当前 user 登录态。参数不确定时先查 help；读取走 feishu_command_read，普通写入走 feishu_command_write；删除、权限转移等高风险操作必须先预览，再把预览展示给用户，得到明确同意后用一次性令牌执行。禁止尝试传入 --yes、--as 或其他由服务管理的参数。",
      },
    });
    return;
  }

  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") return;
  if (message.method === "ping") {
    if (hasId) send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "tools/list") {
    if (hasId) send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    if (!hasId) return;
    try {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {});
      send({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: toolResult(
          { ok: false, error: { type: "validation", message: error?.message || String(error) } },
          true,
        ),
      });
    }
    return;
  }
  if (hasId) jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = parseJson(line);
  if (!message) {
    jsonRpcError(null, -32700, "Parse error");
    return;
  }
  void handle(message).catch((error) => {
    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      jsonRpcError(message.id, -32603, "Internal error", error?.message || String(error));
    }
  });
});

rl.on("close", () => process.exit(0));
