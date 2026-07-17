# Atomic production+staging backend activation on host 116 while workers stay frozen.
# Uses activate-frozen-release.sh — NO surgical file sync.
# Usage: CONFIRM_PROD=1 powershell -File backend_mirror/scripts/deploy-production-frozen.ps1

$ErrorActionPreference = "Stop"
if ($env:CONFIRM_PROD -ne "1") {
  throw "Imposta CONFIRM_PROD=1 per attivare il deploy production frozen"
}

$HostTarget = if ($args[0]) { $args[0] } else { "root@116.203.137.39" }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalDir = Split-Path -Parent $ScriptDir
$WorkspaceDir = Split-Path -Parent $LocalDir
$IdentityFile = if ($env:MIRAX_SSH_IDENTITY) { $env:MIRAX_SSH_IDENTITY } else { "$env:USERPROFILE\.ssh\id_ed25519" }
$SshArgs = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15")
if (Test-Path $IdentityFile) { $SshArgs = @("-i", $IdentityFile) + $SshArgs }

Write-Host "==> MIRAX PRODUCTION FROZEN deploy -> $HostTarget"
Write-Host "    live+staging stesso archivio; worker restano inactive+disabled"

& node (Join-Path $WorkspaceDir "scripts\assert-remote-checkpoint.mjs")
if ($LASTEXITCODE -ne 0) { throw "Deploy bloccato: HEAD locale non verificato sul branch remoto" }

function Invoke-Ssh([string]$Command) {
  & ssh @SshArgs $HostTarget $Command
  if ($LASTEXITCODE -ne 0) { throw "SSH failed: $Command" }
}

Invoke-Ssh "echo SSH OK"

$ReleaseId = Get-Date -Format "yyyyMMdd_HHmmss"
$Head = (& git -C $WorkspaceDir rev-parse HEAD).Trim()
$Archive = Join-Path $env:TEMP "mirax-prod-frozen-$ReleaseId.tar.gz"
$Activator = Join-Path $ScriptDir "activate-frozen-release.sh"
$RemoteArchive = "/tmp/mirax-prod-frozen-$ReleaseId.tar.gz"

if (Test-Path $Archive) { Remove-Item -LiteralPath $Archive -Force }
& tar.exe -czf $Archive --exclude='.env*' --exclude='__pycache__' --exclude='*.pyc' --exclude='data' --exclude='*.db*' -C $LocalDir . -C $WorkspaceDir contracts
if ($LASTEXITCODE -ne 0) { throw "tar archive failed" }

$Forbidden = & tar.exe -tzf $Archive | Select-String -Pattern '(^|/)\.env|__pycache__|\.db($|[-.])'
if ($Forbidden) { throw "Archive contiene runtime state/segreti: $Forbidden" }

& scp @SshArgs $Archive "${HostTarget}:$RemoteArchive"
& scp @SshArgs $Activator "${HostTarget}:/tmp/activate-frozen-release.sh"
Invoke-Ssh "chmod 700 /tmp/activate-frozen-release.sh && /tmp/activate-frozen-release.sh '$RemoteArchive' '$ReleaseId'"
Invoke-Ssh "printf '%s\n' '$Head' > /home/worker/app/backend/.release-sha && printf '%s\n' '$Head' > /home/worker/app/backend-staging/.release-sha && cat /home/worker/app/backend/.release-id && cat /home/worker/app/backend/.release-sha && curl -sf http://127.0.0.1:8001/health && echo && curl -sf http://127.0.0.1:8002/health"

Write-Host "==> Production frozen release $ReleaseId active (SHA $Head)"
