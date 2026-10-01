param(
  [switch]$ForgetRuntimeKey,
  [string]$SetProxy,
  [switch]$ForgetProxy
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$McpProjectDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$ProfileDir = Join-Path $McpProjectDir "profiles"
$ProfileFile = Join-Path $ProfileDir "feishu-universal.yaml"
$RuntimeKeyFile = Join-Path $ProfileDir "runtime-api-key.dpapi"
$ProxyFile = Join-Path $ProfileDir "tunnel-http-proxy.dpapi"
$WorkspaceDir = Join-Path $McpProjectDir "workspace"

$ManagementActionCount = [int]$ForgetRuntimeKey + [int]$ForgetProxy + [int]($PSBoundParameters.ContainsKey("SetProxy"))
if ($ManagementActionCount -gt 1) {
  throw "Use only one of -ForgetRuntimeKey, -SetProxy, or -ForgetProxy at a time."
}

if ($ForgetRuntimeKey) {
  if (Test-Path -LiteralPath $RuntimeKeyFile) {
    Remove-Item -LiteralPath $RuntimeKeyFile -Force
    Write-Host "Removed the saved Runtime API Key."
  }
  else {
    Write-Host "No saved Runtime API Key was found."
  }
  exit 0
}
if ($PSBoundParameters.ContainsKey("SetProxy")) {
  if ([string]::IsNullOrWhiteSpace($SetProxy)) {
    throw "Usage: .\scripts\windows\run.ps1 -SetProxy 'http://127.0.0.1:7897'"
  }

  $PlainProxyBytes = [Text.Encoding]::UTF8.GetBytes($SetProxy.Trim())
  try {
    $ProtectedProxyBytes = [Security.Cryptography.ProtectedData]::Protect(
      $PlainProxyBytes,
      $null,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    [IO.File]::WriteAllText(
      $ProxyFile,
      [Convert]::ToBase64String($ProtectedProxyBytes),
      [Text.UTF8Encoding]::new($false)
    )
    Write-Host "Tunnel proxy saved for the current Windows user; future launches will use it automatically."
  }
  finally {
    if ($null -ne $PlainProxyBytes) {
      [Array]::Clear($PlainProxyBytes, 0, $PlainProxyBytes.Length)
    }
    if ($null -ne $ProtectedProxyBytes) {
      [Array]::Clear($ProtectedProxyBytes, 0, $ProtectedProxyBytes.Length)
    }
  }
  exit 0
}
if ($ForgetProxy) {
  if (Test-Path -LiteralPath $ProxyFile) {
    Remove-Item -LiteralPath $ProxyFile -Force
    Write-Host "Removed the saved Tunnel proxy."
  }
  else {
    Write-Host "No saved Tunnel proxy was found."
  }
  exit 0
}

$NodeBin = (Get-Command node.exe -ErrorAction Stop).Source
$TunnelClientBin = (Get-Command tunnel-client.exe -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $ProfileFile)) {
  throw "Tunnel profile not found at $ProfileFile. Run .\scripts\windows\init-profile.ps1 first."
}

$NpmGlobalRoot = (& npm.cmd root -g).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($NpmGlobalRoot)) {
  throw "Could not read the npm global module directory. Verify the Node.js installation."
}

$LarkCliRunner = Join-Path $NpmGlobalRoot "@larksuite\cli\scripts\run.js"
if (-not (Test-Path -LiteralPath $LarkCliRunner)) {
  throw "Official lark-cli runner not found at $LarkCliRunner. Run npx @larksuite/cli@latest install first."
}

$RuntimeKeyWasProvided = -not [string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_API_KEY)
$RuntimeKeyNeedsCleanup = -not $RuntimeKeyWasProvided
if (-not $RuntimeKeyWasProvided -and (Test-Path -LiteralPath $RuntimeKeyFile)) {
  try {
    $ProtectedKeyBytes = [Convert]::FromBase64String([IO.File]::ReadAllText($RuntimeKeyFile).Trim())
    $PlainKeyBytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $ProtectedKeyBytes,
      $null,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $env:CONTROL_PLANE_API_KEY = [Text.Encoding]::UTF8.GetString($PlainKeyBytes)
    $RuntimeKeyWasProvided = -not [string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_API_KEY)
  }
  catch {
    throw "Could not read the saved Runtime API Key. Run .\scripts\windows\run.ps1 -ForgetRuntimeKey, then start it again."
  }
  finally {
    if ($null -ne $ProtectedKeyBytes) {
      [Array]::Clear($ProtectedKeyBytes, 0, $ProtectedKeyBytes.Length)
    }
    if ($null -ne $PlainKeyBytes) {
      [Array]::Clear($PlainKeyBytes, 0, $PlainKeyBytes.Length)
    }
  }
}
if (-not $RuntimeKeyWasProvided) {
  $SecureKey = Read-Host "Paste the OpenAI Runtime API Key (input is hidden)" -AsSecureString
  $KeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
  try {
    $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($KeyPointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($KeyPointer)
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_API_KEY)) {
    $PlainKeyBytes = [Text.Encoding]::UTF8.GetBytes($env:CONTROL_PLANE_API_KEY)
    try {
      $ProtectedKeyBytes = [Security.Cryptography.ProtectedData]::Protect(
        $PlainKeyBytes,
        $null,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
      )
      [IO.File]::WriteAllText(
        $RuntimeKeyFile,
        [Convert]::ToBase64String($ProtectedKeyBytes),
        [Text.UTF8Encoding]::new($false)
      )
      Write-Host "Runtime API Key saved for the current Windows user; future launches will not prompt for it."
    }
    finally {
      if ($null -ne $PlainKeyBytes) {
        [Array]::Clear($PlainKeyBytes, 0, $PlainKeyBytes.Length)
      }
      if ($null -ne $ProtectedKeyBytes) {
        [Array]::Clear($ProtectedKeyBytes, 0, $ProtectedKeyBytes.Length)
      }
    }
  }
}
if ([string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_API_KEY)) {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
  throw "The Runtime API Key cannot be empty."
}

$TunnelHttpProxy = $env:TUNNEL_HTTP_PROXY
if ([string]::IsNullOrWhiteSpace($TunnelHttpProxy) -and (Test-Path -LiteralPath $ProxyFile)) {
  try {
    $ProtectedProxyBytes = [Convert]::FromBase64String([IO.File]::ReadAllText($ProxyFile).Trim())
    $PlainProxyBytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $ProtectedProxyBytes,
      $null,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $TunnelHttpProxy = [Text.Encoding]::UTF8.GetString($PlainProxyBytes)
  }
  catch {
    throw "Could not read the saved Tunnel proxy. Run .\scripts\windows\run.ps1 -ForgetProxy, then set it again."
  }
  finally {
    if ($null -ne $ProtectedProxyBytes) {
      [Array]::Clear($ProtectedProxyBytes, 0, $ProtectedProxyBytes.Length)
    }
    if ($null -ne $PlainProxyBytes) {
      [Array]::Clear($PlainProxyBytes, 0, $PlainProxyBytes.Length)
    }
  }
}

$env:LARK_CLI_PATH = $LarkCliRunner
$env:LARKSUITE_CLI_NO_UPDATE_NOTIFIER = "1"
$env:LARKSUITE_CLI_NO_SKILLS_NOTIFIER = "1"
$TunnelExitCode = 1

try {
  & $NodeBin $LarkCliRunner auth status --json --verify | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "The lark-cli user session is invalid. Run lark-cli auth login --domain all first."
  }

  New-Item -ItemType Directory -Force -Path $WorkspaceDir | Out-Null
  Set-Location -LiteralPath $WorkspaceDir

  $TunnelRunArgs = @(
    "run",
    "--profile", "feishu-universal",
    "--profile-dir", $ProfileDir
  )
  if (-not [string]::IsNullOrWhiteSpace($TunnelHttpProxy)) {
    $TunnelRunArgs += @("--control-plane.http-proxy", $TunnelHttpProxy)
  }

  & $TunnelClientBin @TunnelRunArgs
  $TunnelExitCode = $LASTEXITCODE
}
finally {
  if ($RuntimeKeyNeedsCleanup) {
    Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
  }
}

exit $TunnelExitCode
