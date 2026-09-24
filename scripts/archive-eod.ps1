# Nightly close-out for the ODSP-AW Command Center (~1:00 AM CST). LEAN + FLAT:
# The Command Center (CC + Dashboard + Records) + data-provenance.txt now live UNDER Data-Private
# (Data-Private\Data-Created) -> they are OFF git. Their backup + point-in-time recovery is the Data-Private
# net: the OneDrive mirror of the live folder + the off-OneDrive backup (scripts\backup-data-private.ps1: a
# /MIR mirror + 14 content-gated dated zips outside the repo, which replace git history for these files).
# No dated snapshot copies are kept in the repo. data-provenance.txt is rewritten FLAT each night into
# Data-Private\Data-Created = latest Data-Public integrity manifest (per-file SHA256 - a verifiable record).
$ErrorActionPreference = 'Continue'
$cc = 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work\Data-Private\Data-Created'

# 1. Regenerate the Decisions + Activity Log export pages + the Records indexes (linked live from the CC).
#    These are the CURRENT full logs (git versions every prior state); no dated copies are kept.
node 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work\scripts\archive-decisions-activity.js'
node 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work\scripts\build-index.js'

# 2. Data-Public (regenerable telemetry) integrity manifest -> a single FLAT keep-latest file. Each file
#    carries a SHA256 so the manifest is a verifiable SYSTEM OF RECORD (a re-scrape does NOT rebuild
#    history); the dated Data-Private zips version this file, so its night-by-night history is recoverable off git.
$dataSrc = 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work\Data-Public'
if (Test-Path $dataSrc) {
  $dpFiles = Get-ChildItem $dataSrc -Recurse -File | Sort-Object FullName
  $manifest = @(
    "# ODSP-AW Data-Public provenance manifest - integrity SYSTEM OF RECORD (a re-scrape does NOT rebuild history)."
    "# Generated {0:yyyy-MM-dd HH:mm:ss} CST - {1} files, {2:N0} bytes. Columns: path | size | sha256 | source date+method." -f (Get-Date), $dpFiles.Count, (($dpFiles | Measure-Object Length -Sum).Sum)
  )
  $manifest += $dpFiles | ForEach-Object {
    "{0}`t{1:N0} bytes`tsha256 {2}`tscraped/ingested {3:yyyy-MM-dd HH:mm:ss} CST" -f $_.FullName.Replace($dataSrc,'data'), $_.Length, (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.LastWriteTime
  }
  Set-Content -Path (Join-Path $cc 'data-provenance.txt') -Value $manifest
}

# 3. Data-Private (sensitive, non-regenerable: recaps · notes · decks · grounding) - the ONLY off-git copy
#    is the off-OneDrive backup (a /MIR mirror + 14 content-gated dated zips outside the repo) plus the
#    OneDrive mirror of the live folder. We do NOT keep a duplicate copy inside Archive (dropped Jun 26 as
#    redundant). Same disk today; redirect its -Dest to a USB/external drive for a full off-machine net.
& 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work\scripts\backup-data-private.ps1'

# 4. Refresh the daily storage report in the live CC (end-of-day split + total).
node 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work\scripts\build-storage-report.js'

# 5. Stamp the audit re-verify date - the nightly close-out re-verifies the Data Health audit.
node 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work\scripts\stamp-data-health.js' --audit

Write-Host "Lean close-out complete -> Data-Private\Data-Created\data-provenance.txt (Data-Public integrity manifest); the CC + Data-Private are off git, backed by the OneDrive mirror + the off-OneDrive backup (/MIR + 14 dated zips); git holds code + docs"
