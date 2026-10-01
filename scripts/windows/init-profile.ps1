$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$McpProjectDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$NodeBin = (Get-Command node.exe -ErrorAction Stop).Source
$TunnelClientBin = (Get-Command tunnel-client.exe -ErrorAction Stop).Source
$ProfileDir = Join-Path $McpProjectDir "profiles"
$ProfileFile = Join-Path $ProfileDir "feishu-universal.yaml"
if (Test-Path -LiteralPath $ProfileFile) {
  throw "Profile already exists at $ProfileFile. Back it up or move it before continuing."
}

$TunnelId = (Read-Host "Paste the OpenAI Tunnel ID (tunnel_...)").Trim()

if (-not $TunnelId.StartsWith("tunnel_")) {
  throw "Invalid Tunnel ID. It must start with tunnel_."
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
$McpServerPath = Join-Path $McpProjectDir "src\server.mjs"
$McpCommand = ('"{0}" "{1}"' -f $NodeBin, $McpServerPath)

& $TunnelClientBin init `
  --sample sample_mcp_stdio_local `
  --profile feishu-universal `
  --profile-dir $ProfileDir `
  --tunnel-id $TunnelId `
  --mcp-command $McpCommand `
  --health-listen-addr "127.0.0.1:0"

if ($LASTEXITCODE -ne 0) {
  throw "tunnel-client init failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $ProfileFile)) {
  throw "tunnel-client exited without creating $ProfileFile."
}

Write-Host "Created $ProfileFile"
Write-Host "Next: .\scripts\windows\run.ps1"
