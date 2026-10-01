#!/usr/bin/env node

const argv = process.argv.slice(2);
const command = argv.filter((value) => !value.startsWith("-")).slice(0, 4);

if (argv.includes("--help")) {
  let risk = "read";
  if (argv.some((value) => value.includes("update") || value.includes("create"))) {
    risk = "write";
  }
  if (argv.includes("+delete") || argv.includes("delete")) risk = "high-risk-write";
  process.stdout.write(`Fake help for ${command.join(" ")}\n\nRisk: ${risk}\n`);
  process.exit(0);
}

if (argv[0] === "auth" && argv[1] === "status") {
  process.stdout.write(
    `${JSON.stringify({
      identity: "user",
      verified: true,
      identities: { user: { status: "logged_in", tokenStatus: "valid", userName: "Test" } },
    })}\n`,
  );
  process.exit(0);
}

if (argv.includes("+redaction-check")) {
  process.stderr.write(
    "authorization: Bearer credential-should-not-reach-chatgpt\\naccess_token=private\\n",
  );
  process.exit(1);
}

if (argv.includes("+delete") && argv.includes("--dry-run")) {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      identity: "user",
      data: { method: "DELETE", path: "/open-apis/drive/v1/files/abc", argv },
    })}\n`,
  );
  process.exit(0);
}

if (argv.includes("+delete") && !argv.includes("--yes")) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      identity: "user",
      error: {
        type: "confirmation",
        subtype: "confirmation_required",
        risk: "high-risk-write",
        action: "drive +delete",
      },
    })}\n`,
  );
  process.exit(10);
}

process.stdout.write(`${JSON.stringify({ ok: true, identity: "user", data: { argv } })}\n`);
