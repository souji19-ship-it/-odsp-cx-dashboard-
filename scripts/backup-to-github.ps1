<#
  backup-to-github.ps1
  Safely push the repo to the PRIVATE GitHub backup repo
  (ambalb_microsoft/OneDrive-SharePoint-in-Agentic-Work, origin/main).

  History note: the local history was purged of pre-lean-archival CoWork telemetry with
  git filter-branch on 2026-06-24, so the full commit history is safe to push. It STAYS
  clean because Data-Public/, Data-Private/, node_modules/ are gitignored (the Command
  Center + all telemetry live under those gitignored folders).

  This wrapper is a SAFETY GATE: it aborts the push if any sensitive path is tracked, so a
  future accidental commit of telemetry/PII can never reach GitHub. Plain `git push` also works.

  Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-to-github.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Say($m) { Write-Host ("[backup-to-github] " + $m) }

# Guard: never push sensitive data. Block if any tracked path looks like telemetry / PII / secrets.
$bad = git ls-files | Where-Object {
  $_ -match '^Data-Public/|^Data-Private/|/node_modules/|feedback.*\.json$|tools.*\.json$|\.env$|\.pem$|\.pfx$|\.key$'
}
if ($bad) {
  Say 'ABORT: sensitive paths are tracked and would be pushed:'
  $bad | ForEach-Object { Write-Host ('   ' + $_) }
  Say 'Remove/gitignore them before pushing.'
  exit 1
}

# Defense-in-depth content scan (Risk 2): catches a misfiled sensitive doc by file-type +
# confidentiality stamps, regardless of folder. Runs in a child process so we can read its exit code.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'scan-sensitive.ps1') -Block
if ($LASTEXITCODE -ne 0) {
  Say 'ABORT: content scan flagged a possibly-sensitive tracked file (see above). Move it under Data-Private/ or confirm it is safe before pushing.'
  exit 1
}

# Make sure gh's credential helper is wired up, then push the current clean history.
gh auth setup-git 2>$null | Out-Null
git push origin HEAD
Say 'Pushed -> https://github.com/ambalb_microsoft/OneDrive-SharePoint-in-Agentic-Work'
