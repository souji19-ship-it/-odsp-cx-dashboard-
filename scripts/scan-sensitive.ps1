<#
  scan-sensitive.ps1 - Defense-in-depth content scan for the Risk-2 gap (classification is by folder,
  not enforced). Catches a sensitive file MISFILED outside Data-Private regardless of folder, by
  file-type + a few high-signal keywords, across the TRACKED files only (git ls-files - so the
  gitignored Data-Public/ and Data-Private/ are already excluded). Run before a push; the
  backup-to-github.ps1 safety gate calls it. Exit 1 (block) with -Block if a high-confidence
  sensitive file is tracked; otherwise exit 0.

  Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\scan-sensitive.ps1 [-Block]
#>
param([switch]$Block)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$tracked = git ls-files
$findings = @()

# 1) File-type heuristic - human documents / decks / spreadsheets / emails belong in Data-Private,
#    never tracked. These are the highest-signal misfiles.
$docExt = '\.(docx?|pptx?|xlsx?|pdf|eml|msg|pst|one|onetoc2|vsdx|key|numbers|pages)$'
$tracked | Where-Object { $_ -match $docExt } | ForEach-Object {
  $findings += [pscustomobject]@{ file = $_; why = 'document/deck/spreadsheet/email file-type (belongs in Data-Private)' }
}

# 2) Keyword heuristic - in-document confidentiality STAMPS that appear inside genuinely sensitive
#    content. Deliberately NOT category labels (e.g. "meeting recap", "1:1 notes") - those match the
#    governance docs/memos that merely DESCRIBE the Data-Private taxonomy (false positives). Actual
#    misfiled recap/note FILES are caught by the file-type net above.
$kw = 'do not share|under nda|attorney.client privileged|strictly confidential'
$tracked | Where-Object { $_ -match '\.(md|txt|csv)$' } | ForEach-Object {
  $p = Join-Path $root $_
  if (Test-Path $p) {
    $hit = Select-String -Path $p -Pattern $kw -EA SilentlyContinue | Select-Object -First 1
    if ($hit) { $findings += [pscustomobject]@{ file = $_; why = ('keyword: "' + $hit.Matches[0].Value + '"') } }
  }
}

if ($findings.Count) {
  Write-Host "[scan-sensitive] FLAGGED $($findings.Count) possibly-sensitive tracked file(s):"
  $findings | ForEach-Object { Write-Host ('   ' + $_.file + '  <- ' + $_.why) }
  Write-Host "[scan-sensitive] Move them under Data-Private/ (gitignored) or confirm they are safe before pushing."
  if ($Block) { exit 1 }
} else {
  Write-Host "[scan-sensitive] clean - no sensitive file-types or keywords found in tracked files."
}
