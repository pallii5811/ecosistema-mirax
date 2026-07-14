# Deploy worker staging (116:8002) da Windows
# Richiede chiave SSH configurata per worker@116.203.137.39
# NON tocca produzione 178:8001

$ErrorActionPreference = "Stop"
$HostTarget = if ($args[0]) { $args[0] } else { "root@116.203.137.39" }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BashScript = Join-Path $ScriptDir "deploy-staging.sh"
$LocalDir = Split-Path -Parent $ScriptDir
$WorkspaceDir = Split-Path -Parent $LocalDir
$IdentityFile = if ($env:MIRAX_SSH_IDENTITY) { $env:MIRAX_SSH_IDENTITY } else { "$env:USERPROFILE\.ssh\id_ed25519" }
$SshArgs = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15")
if (Test-Path $IdentityFile) { $SshArgs = @("-i", $IdentityFile) + $SshArgs }

Write-Host "==> MIRAX staging deploy -> $HostTarget"
Write-Host "    (produzione 178 NON viene toccata)"

& node (Join-Path $WorkspaceDir "scripts\assert-remote-checkpoint.mjs")
if ($LASTEXITCODE -ne 0) { throw "Deploy bloccato: HEAD locale non verificato sul branch remoto" }

function Invoke-Ssh([string]$Command) {
  & ssh @SshArgs $HostTarget $Command
  if ($LASTEXITCODE -ne 0) { throw "SSH failed: $Command" }
}

Invoke-Ssh "echo SSH OK" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "SSH non disponibile da questa macchina." -ForegroundColor Yellow
  Write-Host "Opzioni:"
  Write-Host "  1. Imposta MIRAX_SSH_IDENTITY o aggiungi chiave in ~/.ssh/id_ed25519"
  Write-Host "  2. Da server con accesso: bash backend_mirror/scripts/deploy-staging.sh"
  Write-Host "  Il deploy manuale e il riavvio del worker sono vietati: usare soltanto l'attivazione atomica."
  exit 1
}

$bashOk = $false
# On Windows, `bash.exe` may be a WSL placeholder with no distro installed.
# Use Bash only when explicitly requested; the native PowerShell path is the
# reliable default and has the same backup/smoke/rollback guarantees.
if ($env:MIRAX_DEPLOY_USE_BASH -eq "1" -and (Get-Command bash -ErrorAction SilentlyContinue)) {
  $bashJob = Start-Job {
    bash -lc "exit 0" 2>$null
    if ($LASTEXITCODE -ne 0) { throw "bash unavailable" }
  }
  if (Wait-Job $bashJob -Timeout 5) {
    try {
      Receive-Job $bashJob -ErrorAction Stop | Out-Null
      if ($bashJob.State -eq 'Completed') { $bashOk = $true }
    } catch {
      $bashOk = $false
    }
  } else {
    Stop-Job $bashJob -Force | Out-Null
  }
  Remove-Job $bashJob -Force -ErrorAction SilentlyContinue | Out-Null
}

if ($bashOk) {
  $env:MIRAX_SSH_IDENTITY = $IdentityFile
  bash $BashScript $HostTarget
  exit $LASTEXITCODE
}

Write-Host "    Deploy atomico via archivio singolo"
$ReleaseId = Get-Date -Format "yyyyMMdd_HHmmss"
$Archive = Join-Path $env:TEMP "mirax-staging-$ReleaseId.tar.gz"
$Activator = Join-Path $ScriptDir "activate-staging-release.sh"
$RemoteArchive = "/tmp/mirax-staging-$ReleaseId.tar.gz"

try {
  if (Test-Path $Archive) { Remove-Item -LiteralPath $Archive -Force }
  & tar.exe -czf $Archive --exclude='.env*' --exclude='__pycache__' --exclude='*.pyc' --exclude='data' --exclude='*.db*' -C $LocalDir . -C $WorkspaceDir contracts
  if ($LASTEXITCODE -ne 0) { throw "tar archive failed" }

  $Forbidden = & tar.exe -tzf $Archive | Select-String -Pattern '(^|/)\.env|__pycache__|\.db($|[-.])'
  if ($Forbidden) { throw "Archive contiene runtime state/segreti: $Forbidden" }
  $RequiredFixture = & tar.exe -tzf $Archive | Select-String -SimpleMatch 'contracts/fixtures/commercial-search-plan.valid.json'
  if (-not $RequiredFixture) { throw "Archive privo della fixture canonical commercial plan" }
  foreach ($Contract in @('contracts/signal-ontology.v1.json','contracts/source-registry.v1.json','contracts/commercial-search-plan.schema.json')) {
    if (-not (& tar.exe -tzf $Archive | Select-String -SimpleMatch $Contract)) { throw "Archive privo del contratto $Contract" }
  }

  & scp @SshArgs $Archive "${HostTarget}:$RemoteArchive"
  if ($LASTEXITCODE -ne 0) { throw "archive upload failed" }
  & scp @SshArgs $Activator "${HostTarget}:/tmp/activate-staging-release.sh"
  if ($LASTEXITCODE -ne 0) { throw "activator upload failed" }
  Invoke-Ssh "chmod 700 /tmp/activate-staging-release.sh && /tmp/activate-staging-release.sh '$RemoteArchive' '$ReleaseId'"
} finally {
  Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue
}
Write-Host "==> Deploy staging completato: release $ReleaseId"
