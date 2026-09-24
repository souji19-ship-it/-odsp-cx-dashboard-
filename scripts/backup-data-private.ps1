<#
  backup-data-private.ps1 - Independent OFF-OneDrive backup of the non-regenerable Data-Private set
  (recaps, notes, decks, grounding + the Command Center / Dashboard / Records). This is the "true second net" from the data-split risk memo
  (M00054): every other copy (the live folder, the OneDrive mirror, the frozen EOD archive) is tied
  to this machine + OneDrive; this one is NOT in the OneDrive sync folder and NOT in the repo.

  Default dest: %USERPROFILE%\ODSP-AW-Backups  (outside OneDrive + outside the repo, no admin needed).
  Keeps a live /MIR mirror (latest) + content-change-gated dated .zip snapshots (14 kept).

  HONEST LIMIT: with no USB/second drive plugged in, this lands on the SAME physical disk (C:), so it
  protects against OneDrive sync loss, accidental repo deletion + git mishaps - but NOT a full C:
  failure. For a true off-MACHINE net, run with -Dest pointing at a USB/external drive, or copy the
  dest folder there periodically:  powershell -File scripts\backup-data-private.ps1 -Dest E:\Backups
#>
param([string]$Dest = (Join-Path $env:USERPROFILE 'ODSP-AW-Backups'))
$ErrorActionPreference = 'Continue'
$repo = 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work'
$src  = Join-Path $repo 'Data-Private'
if (-not (Test-Path $src)) { Write-Host "Data-Private not found at $src - nothing to back up."; return }

$mirror = Join-Path $Dest 'Data-Private'   # live mirror (latest)
$snaps  = Join-Path $Dest 'snapshots'      # dated zips (history)
New-Item -ItemType Directory -Path $mirror, $snaps -Force | Out-Null

# 1) Live mirror - an independent, browsable copy not managed by OneDrive.
robocopy $src $mirror /MIR /R:1 /W:1 /NFL /NDL /NP /NJH /NJS > $null

# 2) Content-change-gated dated zip (per-file SHA256 signature - don't re-zip unchanged content).
$sig = (Get-ChildItem $src -Recurse -File -EA SilentlyContinue | Sort-Object FullName |
  ForEach-Object { '{0}|{1}|{2}' -f $_.FullName.Substring($src.Length), $_.Length, (Get-FileHash $_.FullName -Algorithm SHA256).Hash }) -join "`n"
$hash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes([string]$sig))).Replace('-', '')
$sigFile = Join-Path $Dest 'data-private.sig'
$prev = if (Test-Path $sigFile) { (Get-Content $sigFile -Raw).Trim() } else { '' }
$date = Get-Date -Format 'yyyy-MM-dd'
if ($hash -ne $prev) {
  $zip = Join-Path $snaps "data-private-$date.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path (Join-Path $src '*') -DestinationPath $zip -Force
  Set-Content -Path $sigFile -Value $hash
  Write-Host "  Data-Private changed -> new snapshot data-private-$date.zip"
} else {
  Write-Host "  Data-Private unchanged -> mirror refreshed, no new snapshot"
}

# 3) Retention: keep the latest 14 dated zips.
Get-ChildItem $snaps -Filter 'data-private-*.zip' -EA SilentlyContinue | Sort-Object Name -Descending | Select-Object -Skip 14 | Remove-Item -Force -EA SilentlyContinue

# 4) Stamp a human-readable status file.
$files = Get-ChildItem $src -Recurse -File -EA SilentlyContinue
$mb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)
$onSameDisk = $Dest.Substring(0, 1) -eq 'C'
Set-Content -Path (Join-Path $Dest 'last-backup.txt') -Value @(
  "Last off-OneDrive Data-Private backup: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') CST"
  "Source: $src"
  "Files:  $($files.Count)  ($mb MB)"
  "Dest:   $Dest  (mirror + dated zip snapshots)"
  if ($onSameDisk) { "NOTE: same physical disk (C:). For a true off-MACHINE net, copy this folder to a USB/external drive, or re-run with -Dest <USB path>." }
)
Write-Host "Off-OneDrive Data-Private backup complete -> $Dest ($($files.Count) files, $mb MB)"
