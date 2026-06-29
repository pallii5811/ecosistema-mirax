# Deploy worker staging (116:8002) da Windows
# Richiede chiave SSH configurata per worker@116.203.137.39
# NON tocca produzione 178:8001

$ErrorActionPreference = "Stop"
$HostTarget = if ($args[0]) { $args[0] } else { "root@116.203.137.39" }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BashScript = Join-Path $ScriptDir "deploy-staging.sh"
$LocalDir = Split-Path -Parent $ScriptDir
$IdentityFile = if ($env:MIRAX_SSH_IDENTITY) { $env:MIRAX_SSH_IDENTITY } else { "$env:USERPROFILE\.ssh\id_ed25519" }
$SshArgs = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15")
if (Test-Path $IdentityFile) { $SshArgs = @("-i", $IdentityFile) + $SshArgs }

Write-Host "==> MIRAX staging deploy -> $HostTarget"
Write-Host "    (produzione 178 NON viene toccata)"

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
  Write-Host "  3. Manuale: scp backend_mirror/*.py su /home/worker/app/backend-staging + systemctl restart mirax-worker-staging"
  exit 1
}

$bashOk = $false
if (Get-Command bash -ErrorAction SilentlyContinue) {
  $bashJob = Start-Job { bash -lc "exit 0" 2>$null }
  if (Wait-Job $bashJob -Timeout 5) {
    Receive-Job $bashJob | Out-Null
    if ($bashJob.State -eq 'Completed') { $bashOk = $true }
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

Write-Host "    Git Bash/WSL assente - deploy via scp+ssh"
$Ts = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = "/home/worker/backups/staging_$Ts"
Invoke-Ssh "mkdir -p $Backup; cp -a /home/worker/app/backend-staging/*.py $Backup/ 2>/dev/null; true"
Write-Host "    Backup remoto: $Backup"

Get-ChildItem "$LocalDir\*.py" -File | ForEach-Object {
  & scp @SshArgs $_.FullName "${HostTarget}:/home/worker/app/backend-staging/"
  if ($LASTEXITCODE -ne 0) { throw "scp failed: $($_.Name)" }
}
if (Test-Path "$LocalDir\universe") {
  Invoke-Ssh "mkdir -p /home/worker/app/backend-staging/universe"
  Get-ChildItem "$LocalDir\universe\*.py" -File | ForEach-Object {
    & scp @SshArgs $_.FullName "${HostTarget}:/home/worker/app/backend-staging/universe/"
    if ($LASTEXITCODE -ne 0) { throw "scp failed universe: $($_.Name)" }
  }
  Write-Host "    universe/ package uploaded"
}
& scp @SshArgs "$LocalDir\main.py" "$LocalDir\audit_engine.py" "${HostTarget}:/home/worker/app/backend/"

$EnvPatch = @'
ENV=/home/worker/app/backend-staging/.env
grep -q '^ENRICH_BUSINESS_EVENTS=' "$ENV" 2>/dev/null || echo 'ENRICH_BUSINESS_EVENTS=1' >> "$ENV"
grep -q '^ENRICH_BUSINESS_EVENTS_MAX=' "$ENV" 2>/dev/null || echo 'ENRICH_BUSINESS_EVENTS_MAX=12' >> "$ENV"
grep -q '^UNIVERSE_ENABLED=' "$ENV" 2>/dev/null || echo 'UNIVERSE_ENABLED=0' >> "$ENV"
grep -q '^ORGANIC_DISCOVERY_ENABLED=' "$ENV" 2>/dev/null || echo 'ORGANIC_DISCOVERY_ENABLED=0' >> "$ENV"
sed -i 's/^ORGANIC_DISCOVERY_ENABLED=.*/ORGANIC_DISCOVERY_ENABLED=0/' "$ENV" 2>/dev/null || true
pip3 install httpx beautifulsoup4 -q 2>/dev/null || pip install httpx beautifulsoup4 -q 2>/dev/null || true
chown -R worker:worker /home/worker/app/backend-staging /home/worker/app/backend/main.py /home/worker/app/backend/audit_engine.py
systemctl restart mirax-audit-api-staging mirax-worker-staging
sleep 2
systemctl is-active mirax-worker-staging
curl -sf http://127.0.0.1:8002/health
'@
Invoke-Ssh $EnvPatch
Write-Host '==> Deploy staging completato (PowerShell fallback)'
