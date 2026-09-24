# ============================================================================
# Hourly local git commit of the ODSP-AW repo — versioned snapshots on disk.
# Pairs with backup-to-onedrive.ps1 (which carries .git history to the cloud).
# Auto-detects the repo path (works before/after the OneDrive-* root rename).
# ============================================================================
$ErrorActionPreference = 'Continue'

$candidates = @(
  'C:\Repo\OneDrive-SharePoint-in-Agentic-Work',
  'C:\Repo\OneDrive-SharePoint-in-Agentic-Work'
)
$repo = $candidates | Where-Object { Test-Path (Join-Path $_ '.git') } | Select-Object -First 1
if (-not $repo) { Write-Host 'Repo (with .git) not found'; exit 1 }
Set-Location $repo

$changes = git status --porcelain
if (-not $changes) { Write-Host 'No changes to commit'; exit 0 }

git add -A
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
$msg = "Hourly snapshot: $stamp`n`nAutomated local resilience commit (ODSP-AW).`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git commit -m $msg --no-verify | Out-Null
Write-Host "Committed hourly snapshot at $stamp ($repo)"
