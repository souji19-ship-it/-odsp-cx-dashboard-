# ============================================================================
# Hourly backup of the ODSP-AW repo to OneDrive for Business.
# Keeps internal data inside the Microsoft tenant (NOT public GitHub).
# Resolves the repo root from the script location.
# Mirrors the repo, excluding node_modules (huge + regenerable).
# ============================================================================
$ErrorActionPreference = 'Continue'

# 1. the repo root (this script lives in scripts/)
$src = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path $src)) { Write-Host 'Repo not found'; exit 1 }

# 2. find the OneDrive for Business folder
$od = $env:OneDriveCommercial; if (-not $od) { $od = $env:OneDrive }
if (-not $od -or -not (Test-Path $od)) { Write-Host 'OneDrive folder not found'; exit 1 }

$backupRoot = Join-Path $od 'ODSP-AW-Repo-Backup'
$dest = Join-Path $backupRoot 'repo'
New-Item -ItemType Directory -Path $dest -Force | Out-Null

# 3. mirror (deletes dest files no longer in source), excluding node_modules; keep .git history
robocopy $src $dest /MIR /XD node_modules /R:1 /W:1 /NFL /NDL /NP /NJH /NJS > $null
$code = $LASTEXITCODE   # robocopy 0-7 == success, 8+ == error

# 4. log the run with an exact timestamp
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$status = if ($code -lt 8) { 'OK' } else { "ERROR(exit $code)" }
Add-Content (Join-Path $backupRoot 'backup-log.txt') "$stamp  $status  $src -> $dest  (robocopy exit $code)"
Write-Host "Backup $status at $stamp : $src -> $dest"
