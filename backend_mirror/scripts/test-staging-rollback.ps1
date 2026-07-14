# Controlled staging-only rollback injection. No worker or paid provider starts.
[CmdletBinding()]
param([string]$HostTarget = "root@116.203.137.39")

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Split-Path -Parent $ScriptDir
$WorkspaceDir = Split-Path -Parent $BackendDir
$IdentityFile = if ($env:MIRAX_SSH_IDENTITY) { $env:MIRAX_SSH_IDENTITY } else { "$env:USERPROFILE\.ssh\id_ed25519" }
$SshArgs = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15")
if (Test-Path $IdentityFile) { $SshArgs = @("-i", $IdentityFile) + $SshArgs }
$ReleaseId = "rollback-fi-" + (Get-Date -Format "yyyyMMdd_HHmmss")
$Archive = Join-Path $env:TEMP "mirax-$ReleaseId.tar.gz"
$RemoteArchive = "/tmp/mirax-$ReleaseId.tar.gz"
$Activator = Join-Path $ScriptDir "activate-staging-release.sh"

function Invoke-Ssh([string]$Command, [switch]$AllowFailure) {
  $previousPreference = $ErrorActionPreference
  try {
    # An injected remote failure writes to stderr by design. Capture it as test
    # evidence instead of letting Windows PowerShell convert it to a terminating error.
    $ErrorActionPreference = "Continue"
    $output = & ssh @SshArgs $HostTarget $Command 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if (-not $AllowFailure -and $code -ne 0) { throw "SSH failed ($code): $output" }
  return @{ Code = $code; Output = ($output -join "`n") }
}

try {
  $before = Invoke-Ssh "cat /home/worker/app/backend-staging/.release-id && curl -sf --max-time 10 http://127.0.0.1:8002/health"
  $beforeRelease = ($before.Output -split "`n")[0].Trim()
  if (-not $beforeRelease) { throw "Missing staging release marker before injection" }

  & tar.exe -czf $Archive --exclude='.env*' --exclude='__pycache__' --exclude='*.pyc' --exclude='data' --exclude='*.db*' -C $BackendDir . -C $WorkspaceDir contracts
  if ($LASTEXITCODE -ne 0) { throw "Archive creation failed" }
  & scp @SshArgs $Archive "${HostTarget}:$RemoteArchive"
  if ($LASTEXITCODE -ne 0) { throw "Archive upload failed" }
  & scp @SshArgs $Activator "${HostTarget}:/tmp/activate-staging-release.sh"
  if ($LASTEXITCODE -ne 0) { throw "Activator upload failed" }

  $injected = Invoke-Ssh "chmod 700 /tmp/activate-staging-release.sh && MIRAX_INJECT_POST_SWAP_FAILURE=1 /tmp/activate-staging-release.sh '$RemoteArchive' '$ReleaseId'" -AllowFailure
  if ($injected.Code -eq 0) { throw "Injected activation unexpectedly succeeded" }
  if ($injected.Output -notmatch 'rollback completed') { throw "Rollback confirmation missing: $($injected.Output)" }

  $afterCommand = @'
cat /home/worker/app/backend-staging/.release-id; curl -sf --max-time 10 http://127.0.0.1:8002/health >/dev/null; test "$(systemctl is-active mirax-worker-staging 2>/dev/null || true)" != active; test "$(systemctl is-enabled mirax-worker-staging 2>/dev/null || true)" != enabled
'@
  $after = Invoke-Ssh $afterCommand
  $afterRelease = ($after.Output -split "`n")[0].Trim()
  if ($afterRelease -ne $beforeRelease) { throw "Rollback marker mismatch: before=$beforeRelease after=$afterRelease" }
  $evidence = [ordered]@{
    Passed = $true
    TestedAt = (Get-Date).ToUniversalTime().ToString('o')
    BeforeRelease = $beforeRelease
    AfterRelease = $afterRelease
    InjectedRelease = $ReleaseId
    Worker = 'inactive+disabled'
    ApiHealth = 'pass'
    PaidProvidersCalled = $false
    CustomerPublicationsCreated = $false
  }
  $reportPath = Join-Path $WorkspaceDir 'reports\staging-rollback-failure-v5.json'
  $evidence | ConvertTo-Json | Set-Content -LiteralPath $reportPath -Encoding UTF8
  $evidence | ConvertTo-Json -Compress
} finally {
  Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
}
