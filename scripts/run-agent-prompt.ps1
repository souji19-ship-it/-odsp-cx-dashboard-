<#
  run-agent-prompt.ps1 — runs a Copilot CLI prompt NON-INTERACTIVELY (headless) so the
  agent-judgment cadences (morning memo, EOD close-out, weekly reflection) run reliably as
  Windows Scheduled Tasks, not only when an interactive CLI happens to be open + idle.

  Usage (from a Scheduled Task):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-agent-prompt.ps1 -PromptFile automation\prompts\eod-closeout.txt -Name eod

  Security: invokes copilot with --allow-all-tools --allow-all-paths --no-ask-user, i.e. the
  agent runs autonomously with full tool access. The prompt files are trusted + repo-scoped.
#>
param(
  [Parameter(Mandatory = $true)][string]$PromptFile,
  [string]$Name = 'agent-task'
)
$ErrorActionPreference = 'Continue'
$copilot = 'C:\Users\ambalb\AppData\Local\Microsoft\WinGet\Packages\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\copilot.exe'
$repo    = 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work'
$logDir  = Join-Path $repo 'automation\agent-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$log = Join-Path $logDir ("{0}-{1}.log" -f $Name, (Get-Date -Format 'yyyy-MM-dd_HHmm'))
function Log($m) { ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) | Out-File $log -Append -Encoding utf8 }

if (-not (Test-Path $PromptFile)) { $PromptFile = Join-Path $repo $PromptFile }
if (-not (Test-Path $PromptFile)) { Log "Prompt file not found: $PromptFile"; exit 1 }
if (-not (Test-Path $copilot))    { Log "copilot.exe not found at $copilot"; exit 1 }

$prompt = Get-Content $PromptFile -Raw -Encoding utf8
Set-Location $repo
Log "Pull latest (rebase, autostash) to reduce conflicts with an open session"
git -C $repo pull --rebase --autostash 2>&1 | Out-File $log -Append -Encoding utf8
Log "Running '$Name' headless via copilot -p"
& $copilot -p $prompt --allow-all-tools --allow-all-paths --no-ask-user -s -C $repo 2>&1 | Out-File $log -Append -Encoding utf8
Log "Agent finished (exit $LASTEXITCODE)"

# Safety net: persist + push anything the agent left uncommitted.
git -C $repo add -A 2>&1 | Out-File $log -Append -Encoding utf8
git -C $repo commit -q -m "$Name (automated agent task)" 2>&1 | Out-File $log -Append -Encoding utf8
# Risk-2 content scan before any push to GitHub. If it flags, keep the local commit (+ OneDrive mirror), skip the push.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'scan-sensitive.ps1') -Block 2>&1 | Out-File $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  Log "PUSH BLOCKED by scan-sensitive (a sensitive file is tracked) - committed locally only, not pushed."
} else {
  git -C $repo push origin main 2>&1 | Out-File $log -Append -Encoding utf8
  if ($LASTEXITCODE -ne 0) {
    Log "Push rejected; pull --rebase --autostash + retry once"
    git -C $repo pull --rebase --autostash 2>&1 | Out-File $log -Append -Encoding utf8
    git -C $repo push origin main 2>&1 | Out-File $log -Append -Encoding utf8
  }
}
Log "Committed + pushed; complete."

# Prune logs older than 30 days.
Get-ChildItem $logDir -Filter *.log -EA SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -EA SilentlyContinue
