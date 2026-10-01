import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_CLI = path.join(ROOT, "test", "fixtures", "fake-lark-cli.mjs");
const WORKSPACE = path.join(ROOT, "workspace");

function waitFor(messages, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const existing = messages.find(predicate);
    if (existing) return resolve(existing);
    const interval = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(found);
      }
    }, 10);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("等待 MCP 响应超时"));
    }, timeoutMs);
  });
}

function rpc(child, messages, id, name, args) {
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    })}\n`,
  );
  return waitFor(messages, (message) => message.id === id);
}

test("exposes a guarded lark-cli adapter", async (t) => {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  const child = spawn(process.execPath, [path.join(ROOT, "src", "server.mjs")], {
    cwd: WORKSPACE,
    env: { ...process.env, LARK_CLI_PATH: FAKE_CLI },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));

  const messages = [];
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => messages.push(JSON.parse(line)));

  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    })}\n`,
  );
  const initialized = await waitFor(messages, (message) => message.id === 1);
  assert.equal(initialized.result.serverInfo.name, "feishu-lark-cli-mcp");
  assert.equal(initialized.result.serverInfo.version, "0.1.0");

  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
  );
  const listed = await waitFor(messages, (message) => message.id === 2);
  assert.deepEqual(
    listed.result.tools.map((tool) => tool.name),
    [
      "feishu_auth_status",
      "feishu_command_help",
      "feishu_command_read",
      "feishu_command_write",
      "feishu_high_risk_preview",
      "feishu_high_risk_execute",
    ],
  );

  const authStatus = await rpc(child, messages, 21, "feishu_auth_status", {});
  assert.equal(authStatus.result.isError, false);
  assert.equal(authStatus.result.structuredContent.ok, true);
  assert.equal(authStatus.result.structuredContent.data.verified, true);
  assert.equal(authStatus.result.structuredContent.data.identity, "user");

  const redactedFailure = await rpc(child, messages, 23, "feishu_command_read", {
    argv: ["docs", "+redaction-check"],
  });
  assert.equal(redactedFailure.result.isError, true);
  assert.match(redactedFailure.result.content[0].text, /\[REDACTED\]/);
  assert.doesNotMatch(redactedFailure.result.content[0].text, /credential-should-not-reach-chatgpt/);
  assert.doesNotMatch(redactedFailure.result.content[0].text, /access_token=private/);

  const unexpectedField = await rpc(child, messages, 22, "feishu_auth_status", {
    ignored: true,
  });
  assert.equal(unexpectedField.result.isError, true);
  assert.match(unexpectedField.result.structuredContent.error.message, /未允许的字段/);

  const help = await rpc(child, messages, 3, "feishu_command_help", {
    command: ["docs", "+update"],
  });
  assert.equal(help.result.structuredContent.ok, true);
  assert.match(help.result.structuredContent.data.help, /Risk: write/);

  const read = await rpc(child, messages, 4, "feishu_command_read", {
    argv: ["docs", "+fetch", "--doc", "https://example.test/docx/abc"],
  });
  assert.equal(read.result.structuredContent.ok, true);
  assert.deepEqual(read.result.structuredContent.data.argv.slice(-4), [
    "--as",
    "user",
    "--format",
    "json",
  ]);

  const wrongRisk = await rpc(child, messages, 5, "feishu_command_write", {
    argv: ["docs", "+fetch", "--doc", "abc"],
    confirmed: true,
  });
  assert.equal(wrongRisk.result.isError, true);
  assert.match(wrongRisk.result.structuredContent.error.message, /风险等级为 read/);

  const write = await rpc(child, messages, 6, "feishu_command_write", {
    argv: ["task", "+create", "--summary", "测试任务"],
    confirmed: true,
  });
  assert.equal(write.result.structuredContent.ok, true);

  const blocked = await rpc(child, messages, 7, "feishu_command_write", {
    argv: ["drive", "+delete", "--file-token", "abc", "--yes"],
    confirmed: true,
  });
  assert.equal(blocked.result.isError, true);
  assert.match(blocked.result.structuredContent.error.message, /--yes/);

  const identityOverride = await rpc(child, messages, 70, "feishu_command_read", {
    argv: ["docs", "+fetch", "--doc", "abc", "--as", "bot"],
  });
  assert.equal(identityOverride.result.isError, true);
  assert.match(identityOverride.result.structuredContent.error.message, /--as/);

  const unconfirmedWrite = await rpc(child, messages, 73, "feishu_command_write", {
    argv: ["task", "+create", "--summary", "未确认任务"],
    confirmed: false,
  });
  assert.equal(unconfirmedWrite.result.isError, true);
  assert.match(unconfirmedWrite.result.structuredContent.error.message, /confirmed=true/);

  const jsonBusinessArgument = await rpc(child, messages, 76, "feishu_command_write", {
    argv: [
      "base",
      "+field-create",
      "--base-token",
      "bas_test",
      "--table-id",
      "tbl_test",
      "--json",
      '{"name":"Status","type":"text"}',
    ],
    confirmed: true,
  });
  assert.equal(jsonBusinessArgument.result.structuredContent.ok, true);

  const rawWrite = await rpc(child, messages, 71, "feishu_command_write", {
    argv: ["api", "POST", "/open-apis/example/v1/actions", "--data", "{}"],
    confirmed: true,
  });
  assert.equal(rawWrite.result.isError, true);
  assert.match(rawWrite.result.structuredContent.error.message, /高风险写入/);

  const externalApi = await rpc(child, messages, 74, "feishu_command_read", {
    argv: ["api", "GET", "https://example.test/open-apis/example/v1/items"],
  });
  assert.equal(externalApi.result.isError, true);
  assert.match(externalApi.result.structuredContent.error.message, /\/open-apis\//);

  const unsafePath = await rpc(child, messages, 72, "feishu_command_read", {
    argv: ["api", "GET", "/open-apis/example/v1/files", "--output", "../secret"],
  });
  assert.equal(unsafePath.result.isError, true);
  assert.match(unsafePath.result.structuredContent.error.message, /相对路径/);

  const absolutePath = await rpc(child, messages, 75, "feishu_command_read", {
    argv: ["api", "GET", "/open-apis/example/v1/files", "--output", "/tmp/secret"],
  });
  assert.equal(absolutePath.result.isError, true);
  assert.match(absolutePath.result.structuredContent.error.message, /相对路径/);

  const windowsAbsolutePath = await rpc(child, messages, 77, "feishu_command_read", {
    argv: ["sheets", "+cells-get", "--output-path", "C:\\Temp\\secret.json"],
  });
  assert.equal(windowsAbsolutePath.result.isError, true);
  assert.match(windowsAbsolutePath.result.structuredContent.error.message, /相对路径/);

  const attachedShortOutput = await rpc(child, messages, 82, "feishu_command_read", {
    argv: ["docs", "+fetch", "-o/etc/passwd"],
  });
  assert.equal(attachedShortOutput.result.isError, true);
  assert.match(attachedShortOutput.result.structuredContent.error.message, /相对路径/);

  const attachedShortFilter = await rpc(child, messages, 83, "feishu_command_read", {
    argv: ["docs", "+fetch", "-q.data"],
  });
  assert.equal(attachedShortFilter.result.isError, true);
  assert.match(attachedShortFilter.result.structuredContent.error.message, /-q/);

  const indirectAbsolutePath = await rpc(child, messages, 78, "feishu_command_write", {
    argv: ["base", "+field-create", "--json=@/etc/passwd"],
    confirmed: true,
  });
  assert.equal(indirectAbsolutePath.result.isError, true);
  assert.match(indirectAbsolutePath.result.structuredContent.error.message, /相对路径/);

  const localFileUrl = await rpc(child, messages, 84, "feishu_command_write", {
    argv: ["drive", "+upload", "--file", "file:///etc/passwd"],
    confirmed: true,
  });
  assert.equal(localFileUrl.result.isError, true);
  assert.match(localFileUrl.result.structuredContent.error.message, /file: URL/);

  const clipboardRead = await rpc(child, messages, 79, "feishu_command_write", {
    argv: ["docs", "+media-insert", "--from-clipboard"],
    confirmed: true,
  });
  assert.equal(clipboardRead.result.isError, true);
  assert.match(clipboardRead.result.structuredContent.error.message, /--from-clipboard/);

  const localOverwrite = await rpc(child, messages, 80, "feishu_command_read", {
    argv: ["docs", "+media-download", "--output", "result.png", "--overwrite"],
  });
  assert.equal(localOverwrite.result.isError, true);
  assert.match(localOverwrite.result.structuredContent.error.message, /--overwrite/);

  if (process.platform !== "win32") {
    const linkName = `.outside-${process.pid}`;
    const linkPath = path.join(WORKSPACE, linkName);
    fs.symlinkSync(os.tmpdir(), linkPath, "dir");
    t.after(() => fs.rmSync(linkPath, { force: true }));
    const symlinkEscape = await rpc(child, messages, 81, "feishu_command_write", {
      argv: ["drive", "+upload", "--file", `${linkName}/secret.txt`],
      confirmed: true,
    });
    assert.equal(symlinkEscape.result.isError, true);
    assert.match(symlinkEscape.result.structuredContent.error.message, /符号链接/);
  }

  const preview = await rpc(child, messages, 8, "feishu_high_risk_preview", {
    argv: ["drive", "+delete", "--file-token", "abc", "--type", "file"],
  });
  assert.equal(preview.result.structuredContent.ok, true);
  assert.match(preview.result.structuredContent.confirmation_token, /^[0-9a-f-]{36}$/);

  const executed = await rpc(child, messages, 9, "feishu_high_risk_execute", {
    confirmation_token: preview.result.structuredContent.confirmation_token,
    confirmed: true,
  });
  assert.equal(executed.result.structuredContent.ok, true);
  assert(executed.result.structuredContent.data.argv.includes("--yes"));

  const replay = await rpc(child, messages, 10, "feishu_high_risk_execute", {
    confirmation_token: preview.result.structuredContent.confirmation_token,
    confirmed: true,
  });
  assert.equal(replay.result.isError, true);
  assert.match(replay.result.structuredContent.error.message, /已使用或已过期/);
});
