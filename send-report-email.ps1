# Send SharePoint AI Report via Local Outlook
# Uses COM automation - no OAuth required

param(
    [string]$To = $env:USERNAME + "@microsoft.com",
    [switch]$Test
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Email Report Sender" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$reportTxt = Get-ChildItem "sharepoint-ai-report-*.txt" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$reportJson = Get-ChildItem "sharepoint-ai-report-*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $reportJson) { Write-Host "ERROR: No report files found." -ForegroundColor Red; exit 1 }

Write-Host "  Found: $($reportJson.Name)" -ForegroundColor Green

$report        = Get-Content $reportJson.FullName -Raw | ConvertFrom-Json
$timestamp     = $reportTxt.LastWriteTime.ToString("yyyy-MM-dd")
$timestampFull = $reportTxt.LastWriteTime.ToString("MMM d, yyyy  HH:mm")
$p1 = $report.part1_sharepoint_ai_analysis
$p2 = $report.part2_competitive_comparison

# ── Helpers ──────────────────────────────────────────────────────────────────

function ValColor($v) {
    if ($v -match '^-') { return "#EF4444" } else { return "#111827" }
}

function ValTd($v, $extra = "") {
    $s = if ($null -eq $v) { "N/A" } else { $v.ToString() }
    $c = ValColor $s
    return "<td style='text-align:right;font-weight:700;color:$c;white-space:nowrap;padding:9px 20px 9px 12px;font-size:13px;font-family:Segoe UI,sans-serif;$extra'>$s</td>"
}

function FormatInsight($raw) {
    if ($raw -match '^\*\*\s*(.+)$') { return @{ bullet="#22C55E"; text=$Matches[1] } }
    elseif ($raw -match '^!!\s*(.+)$') { return @{ bullet="#F97316"; text=$Matches[1] } }
    else { return @{ bullet="#94A3B8"; text=$raw } }
}

function RankColor($r) {
    if ($r -eq 1) { return "#D97706" } elseif ($r -eq 2) { return "#64748B" }
    elseif ($r -eq 3) { return "#92400E" } else { return "#CBD5E1" }
}

# Render ranking rows: top 3 + ellipsis + SharePoint AI
function RankingRows($items, $valField = "value") {
    $html     = ""
    $total    = @($items).Count
    $lastRank = 0

    foreach ($item in $items) {
        $isSP = $item.name -match "SharePoint AI"
        $show = ($item.rank -le 3) -or $isSP
        if (-not $show) { continue }

        if ($item.rank -gt ($lastRank + 1) -and $lastRank -gt 0) {
            $html += "  <tr><td colspan='3' style='text-align:center;color:#CBD5E1;font-size:11px;letter-spacing:4px;padding:3px 0;border-bottom:1px solid #F1F5F9;'>&#183;&#183;&#183;</td></tr>`n"
        }

        $rc    = RankColor $item.rank
        $badge = if ($isSP) { "<span class='you'>YOU</span>" } else { "" }
        $of    = if ($isSP -and $item.rank -gt 3) { "<span style='color:#CBD5E1;font-size:10px;font-weight:400;margin-left:6px;'>#$($item.rank) of $total</span>" } else { "" }
        $ns    = if ($isSP) { "<span style='color:#166534;font-weight:700;font-family:Segoe UI,sans-serif;'>$($item.name)</span>" } else { "<span style='color:#4B5563;font-family:Segoe UI,sans-serif;'>$($item.name)</span>" }
        $tr    = if ($isSP) { "<tr style='background-color:#F0FDF4;'>" } else { "<tr>" }
        $val   = if ($valField -eq "thumbs_down") { if ($item.thumbs_down) { $item.thumbs_down } else { "&mdash;" } } else { $item.value }

        $html += "  $tr<td class='rk-num' style='color:$rc;'>$($item.rank)</td><td class='rk-name'>$ns$badge$of</td><td class='rk-val'>$val</td></tr>`n"
        $lastRank = $item.rank
    }
    return $html
}

# ── KPI values ───────────────────────────────────────────────────────────────
$kpiDAU  = $p1.adoption_metrics.kav2_specific.daily_active_usage
$kpiWAU  = $p1.adoption_metrics.weekly_active_users
$kpiRR   = "$($p1.engagement_patterns.kav2_weekly_return_rate)%"
$kpiWoW  = "$($p1.adoption_metrics.kav2_specific.active_users_wow)%"
$wowColor = ValColor $kpiWoW
$rrNum   = [double]($p1.engagement_patterns.kav2_weekly_return_rate -replace '[^0-9.]','')
$rrColor = if ($rrNum -gt 40) { "#4ADE80" } else { "#FB923C" }

# ── Common style strings ──────────────────────────────────────────────────────
$L  = "padding:9px 20px;font-size:13px;color:#6B7280;border-bottom:1px solid #F1F5F9;font-family:'Segoe UI',sans-serif;"
$LG = "padding:5px 20px 3px;font-size:10px;color:#9CA3AF;letter-spacing:0.8px;text-transform:uppercase;font-weight:700;border-bottom:1px solid #F1F5F9;font-family:'Segoe UI',sans-serif;"
$VX = "border-bottom:1px solid #F1F5F9;"

Write-Host "INFO: Creating HTML email..." -ForegroundColor Cyan

try {
    $outlook = New-Object -ComObject Outlook.Application
    $mail    = $outlook.CreateItem(0)
    $mail.To = $To
    $mail.Subject = "SharePoint AI Report - $timestamp"

    $htmlBody = @"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0D1B2A; -webkit-text-size-adjust: 100%; }
/* Rank rows */
.rk-num  { width: 36px; text-align: center; font-size: 13px; font-weight: 800; padding: 9px 0 9px 20px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
.rk-name { font-size: 13px; padding: 9px 8px; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
.rk-val  { font-size: 13px; font-weight: 700; text-align: right; padding: 9px 20px 9px 8px; white-space: nowrap; border-bottom: 1px solid #F1F5F9; vertical-align: middle; color: #111827; }
.you { display: inline-block; background: #BBF7D0; color: #166534; border-radius: 20px; padding: 1px 7px; font-size: 9px; font-weight: 700; margin-left: 6px; vertical-align: middle; line-height: 2; font-family: 'Segoe UI', sans-serif; }
/* FAB funnel */
.fab-cell { text-align: center; vertical-align: top; padding: 14px 8px; }
.fab-lbl  { font-size: 8px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #94A3B8; padding-bottom: 6px; font-family: 'Segoe UI', sans-serif; }
.fab-val  { font-size: 22px; font-weight: 800; color: #111827; letter-spacing: -0.5px; line-height: 1; font-family: 'Segoe UI', sans-serif; }
.fab-rate { font-size: 12px; font-weight: 700; margin-top: 4px; font-family: 'Segoe UI', sans-serif; }
.fab-arr  { text-align: center; vertical-align: middle; padding: 0 4px; color: #CBD5E1; font-size: 18px; }
/* Retention */
.ret-th   { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: #9CA3AF; padding: 7px 20px; border-bottom: 1px solid #E5E7EB; text-align: left; font-family: 'Segoe UI', sans-serif; }
.ret-thr  { font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: #9CA3AF; padding: 7px 12px; border-bottom: 1px solid #E5E7EB; text-align: right; font-family: 'Segoe UI', sans-serif; }
.ret-td   { padding: 8px 20px; border-bottom: 1px solid #F1F5F9; color: #6B7280; font-size: 12px; font-family: 'Segoe UI', sans-serif; }
.ret-tdr  { padding: 8px 12px; border-bottom: 1px solid #F1F5F9; font-weight: 700; color: #111827; font-size: 12px; text-align: right; font-family: 'Segoe UI', sans-serif; }
.ret-hl .ret-td  { background: #F0FDF4; color: #166534; }
.ret-hl .ret-tdr { background: #F0FDF4; color: #166534; }
</style>
</head>
<body>
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0D1B2A" style="background-color:#0D1B2A;min-width:100%;">
<tr><td align="center" style="padding:24px 12px 40px;">

<table width="560" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

<!-- ══ HEADER ═══════════════════════════════════════════════════════════════ -->
<tr>
  <td bgcolor="#0D1B2A" style="background-color:#0D1B2A;padding:0 0 20px;">
    <p style="color:#4ADE80;font-size:8px;font-weight:700;letter-spacing:3.5px;text-transform:uppercase;margin:0 0 8px;font-family:'Segoe UI',sans-serif;">MICROSOFT COPILOT &nbsp;&#8231;&nbsp; EXECUTIVE REPORT</p>
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="color:#FFFFFF;font-size:34px;font-weight:800;letter-spacing:-1px;line-height:1;font-family:'Segoe UI',sans-serif;">SharePoint&nbsp;</td>
      <td style="color:#4ADE80;font-size:34px;font-weight:800;letter-spacing:-1px;line-height:1;font-family:'Segoe UI',sans-serif;">AI</td>
    </tr></table>
    <p style="color:#475569;font-size:11px;margin:8px 0 0;font-family:'Segoe UI',sans-serif;">$timestampFull</p>
  </td>
</tr>

<!-- ══ KPI HERO ══════════════════════════════════════════════════════════════ -->
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;border-radius:8px 8px 0 0;padding:22px 22px 6px;">
    <table width="100%" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50%" style="padding:0 16px 16px 0;border-right:1px solid #263446;vertical-align:top;">
          <table border="0" cellpadding="0" cellspacing="0">
            <tr><td style="color:#64748B;font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding-bottom:6px;font-family:'Segoe UI',sans-serif;">Daily Active</td></tr>
            <tr><td style="color:#4ADE80;font-size:30px;font-weight:800;letter-spacing:-1px;line-height:1;font-family:'Segoe UI',sans-serif;">$kpiDAU</td></tr>
          </table>
        </td>
        <td width="50%" style="padding:0 0 16px 16px;vertical-align:top;">
          <table border="0" cellpadding="0" cellspacing="0">
            <tr><td style="color:#64748B;font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding-bottom:6px;font-family:'Segoe UI',sans-serif;">Weekly Active</td></tr>
            <tr><td style="color:#FFFFFF;font-size:30px;font-weight:800;letter-spacing:-1px;line-height:1;font-family:'Segoe UI',sans-serif;">$kpiWAU</td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td width="50%" style="padding:16px 16px 16px 0;border-right:1px solid #263446;border-top:1px solid #263446;vertical-align:top;">
          <table border="0" cellpadding="0" cellspacing="0">
            <tr><td style="color:#64748B;font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding-bottom:6px;font-family:'Segoe UI',sans-serif;">Return Rate</td></tr>
            <tr><td style="color:$rrColor;font-size:30px;font-weight:800;letter-spacing:-1px;line-height:1;font-family:'Segoe UI',sans-serif;">$kpiRR</td></tr>
          </table>
        </td>
        <td width="50%" style="padding:16px 0 16px 16px;border-top:1px solid #263446;vertical-align:top;">
          <table border="0" cellpadding="0" cellspacing="0">
            <tr><td style="color:#64748B;font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding-bottom:6px;font-family:'Segoe UI',sans-serif;">WoW Growth</td></tr>
            <tr><td style="color:$wowColor;font-size:30px;font-weight:800;letter-spacing:-1px;line-height:1;font-family:'Segoe UI',sans-serif;">$kpiWoW</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>

<!-- ══ WHITE CONTENT CARD ════════════════════════════════════════════════════ -->
<tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-radius:0 0 8px 8px;overflow:hidden;">
<table width="100%" border="0" cellpadding="0" cellspacing="0">

<!-- ─ SECTION: INSIGHTS ─────────────────────────────────────────────────── -->
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#107C10;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">INSIGHTS</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">Key Takeaways</td>
    </tr></table>
  </td>
</tr>
"@

    foreach ($raw in $p1.insights) {
        $fi = FormatInsight $raw
        $htmlBody += "  <tr><td style='padding:9px 20px;border-bottom:1px solid #F1F5F9;font-size:13px;color:#374151;line-height:1.6;font-family:Segoe UI,sans-serif;'><span style='color:$($fi.bullet);margin-right:7px;font-size:9px;'>&#9654;</span>$($fi.text)</td></tr>`n"
    }

    $htmlBody += @"

<!-- CALLOUT -->
<tr>
  <td bgcolor="#F0FDF4" style="background-color:#F0FDF4;padding:10px 20px;border-left:3px solid #22C55E;border-bottom:1px solid #DCFCE7;">
    <p style="color:#166534;font-size:13px;font-weight:600;margin:0;font-family:'Segoe UI',sans-serif;">&#9733;&nbsp; SharePoint AI ranks <strong>#1</strong> in DAU/MAU (<strong>$($p2.sharepoint_ai.dau_mau)</strong>) across all Copilot agents.</p>
  </td>
</tr>

<!-- ─ SECTION: ADOPTION ─────────────────────────────────────────────────── -->
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#059669;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">ADOPTION</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">Adoption Metrics</td>
    </tr></table>
  </td>
</tr>
<tr><td style="$LG">Overall</td></tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td style="$L">Weekly Active Users</td>$(ValTd $p1.adoption_metrics.weekly_active_users $VX)</tr>
  <tr><td style="$L">Weekly Active Users WoW</td>$(ValTd "$($p1.adoption_metrics.weekly_active_users_wow)%" $VX)</tr>
  <tr><td style="$L">Opt-in Tenants</td>$(ValTd $p1.adoption_metrics.opt_in_tenants $VX)</tr>
</table></td></tr>
<tr><td style="$LG">KAv2 Specific</td></tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td style="$L">Daily Active Usage</td>$(ValTd $p1.adoption_metrics.kav2_specific.daily_active_usage $VX)</tr>
  <tr><td style="$L">Weekly Active Usage</td>$(ValTd $p1.adoption_metrics.kav2_specific.weekly_active_usage $VX)</tr>
  <tr><td style="$L">Monthly Active Usage</td>$(ValTd $p1.adoption_metrics.kav2_specific.monthly_active_usage $VX)</tr>
  <tr><td style="$L">Weekly Query Volume</td>$(ValTd $p1.adoption_metrics.kav2_specific.weekly_query_volume $VX)</tr>
  <tr><td style="$L">Weekly Conversation Volume</td>$(ValTd $p1.adoption_metrics.kav2_specific.weekly_conversation_volume $VX)</tr>
  <tr><td style="$L">Active Users WoW</td>$(ValTd "$($p1.adoption_metrics.kav2_specific.active_users_wow)%" $VX)</tr>
</table></td></tr>

<!-- ─ SECTION: ENGAGEMENT ───────────────────────────────────────────────── -->
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#2563EB;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">ENGAGEMENT</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">Engagement Patterns</td>
    </tr></table>
  </td>
</tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td style="$L">KAv2 Weekly Return Rate</td>$(ValTd "$($p1.engagement_patterns.kav2_weekly_return_rate)%" $VX)</tr>
  <tr><td style="$L">Overall Weekly Return Rate</td>$(ValTd "$($p1.engagement_patterns.weekly_return_rate)%" $VX)</tr>
  <tr><td style="$L">Weekly Kept Rate</td>$(ValTd "$($p1.engagement_patterns.weekly_kept_rate)%" $VX)</tr>
  <tr><td style="$L">Monthly Return (Builders)</td>$(ValTd "$($p1.engagement_patterns.monthly_return_rate_builders)%" $VX)</tr>
</table></td></tr>

<!-- ─ SECTION: PERSONAS ─────────────────────────────────────────────────── -->
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#7C3AED;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">PERSONAS</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">User Segments &mdash; Active Users</td>
    </tr></table>
  </td>
</tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td style="$L">Content Creator</td>$(ValTd $p1.user_personas.content_creator.active_users $VX)</tr>
  <tr><td style="$L">Content Consumer</td>$(ValTd $p1.user_personas.content_consumer.active_users $VX)</tr>
  <tr><td style="$L">Content Manager</td>$(ValTd $p1.user_personas.content_manager.active_users $VX)</tr>
  <tr><td style="$L">Site Manager</td>$(ValTd $p1.user_personas.site_manager.active_users $VX)</tr>
</table></td></tr>

<!-- ─ SECTION: TOP ACTIONS ──────────────────────────────────────────────── -->
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#D97706;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">TOP ACTIONS</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">Most Used Features</td>
    </tr></table>
  </td>
</tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
"@

    $topActions = $p1.top_actions | Select-Object -First 8
    foreach ($action in $topActions) {
        $htmlBody += "  <tr><td style='padding:8px 20px;font-size:12.5px;color:#6B7280;border-bottom:1px solid #F1F5F9;font-family:Segoe UI,sans-serif;'>$($action.action)</td>$(ValTd $action.count $VX)</tr>`n"
    }

    $htmlBody += @"
</table></td></tr>

<!-- ─ SECTION: COMPETITIVE RANKINGS ────────────────────────────────────── -->
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#DC2626;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">COMPETITIVE</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">Rankings vs. Copilot Agents</td>
    </tr></table>
  </td>
</tr>

<!-- Ranking sub-label: WAU -->
<tr><td style="padding:8px 20px 3px;font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;border-bottom:1px solid #F1F5F9;">
  <table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;">Weekly Active Users</td>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;text-align:right;padding-right:0;">WAU</td>
  </tr></table>
</td></tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
"@
    $htmlBody += (RankingRows $p2.rankings.by_wau)
    $htmlBody += @"
</table></td></tr>

<!-- Ranking sub-label: Engagement -->
<tr><td style="padding:10px 20px 3px;border-top:2px solid #F1F5F9;border-bottom:1px solid #F1F5F9;">
  <table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;">Engagement &mdash; DAU/MAU Ratio</td>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;text-align:right;">DAU/MAU</td>
  </tr></table>
</td></tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
"@
    $htmlBody += (RankingRows $p2.rankings.by_engagement)
    $htmlBody += @"
</table></td></tr>

<!-- Ranking sub-label: Return Rate -->
<tr><td style="padding:10px 20px 3px;border-top:2px solid #F1F5F9;border-bottom:1px solid #F1F5F9;">
  <table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;">Weekly Return Rate &mdash; Higher is Better</td>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;text-align:right;">Rate</td>
  </tr></table>
</td></tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
"@
    $htmlBody += (RankingRows $p2.rankings.by_return_rate)
    $htmlBody += @"
</table></td></tr>

<!-- Ranking sub-label: Thumbs Down -->
<tr><td style="padding:10px 20px 3px;border-top:2px solid #F1F5F9;border-bottom:1px solid #F1F5F9;">
  <table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;">% Thumbs Down &mdash; Lower is Better</td>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;text-align:right;">% Down</td>
  </tr></table>
</td></tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
"@
    $htmlBody += (RankingRows $p2.rankings.by_satisfaction 'thumbs_down')
    $htmlBody += @"
</table></td></tr>

<!-- ─ SECTION: COMPETITIVE POSITION ────────────────────────────────────── -->
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#475569;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">POSITION</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">Competitive Analysis</td>
    </tr></table>
  </td>
</tr>
<tr><td><table width="100%" border="0" cellpadding="0" cellspacing="0">
"@

    foreach ($insight in $p2.competitive_position) {
        $cat = ($insight.category -replace '_', ' ').ToUpper()
        $htmlBody += "  <tr><td style='padding:9px 20px;font-size:9px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#9CA3AF;white-space:nowrap;width:26%;border-bottom:1px solid #F1F5F9;vertical-align:top;font-family:Segoe UI,sans-serif;'>$cat</td><td style='padding:9px 20px 9px 12px;font-size:13px;color:#4B5563;line-height:1.55;border-bottom:1px solid #F1F5F9;font-family:Segoe UI,sans-serif;'>$($insight.finding)</td></tr>`n"
    }

    $htmlBody += @"
</table></td></tr>

"@

    # ── FAB ─────────────────────────────────────────────────────────────────
    $fabReportJson = Get-ChildItem "fab-report-*.json" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if ($fabReportJson) {
        try {
            $fabReport    = Get-Content $fabReportJson.FullName -Raw | ConvertFrom-Json
            $fabSummary   = $fabReport.summary
            $fabRetention = $fabReport.retention_table
            $hasSaw       = ($null -ne $fabSummary.saw_fab -and $fabSummary.saw_fab -ne "")

            $htmlBody += @"
<!-- ─ SECTION: FAB ─────────────────────────────────────────────────────── -->
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#0891B2;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">FAB</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">Floating Action Button &mdash; User Funnel</td>
    </tr></table>
  </td>
</tr>
<tr>
  <td bgcolor="#F8FAFC" style="background-color:#F8FAFC;padding:16px 20px;border-bottom:1px solid #F1F5F9;">
    <table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
"@

            if ($hasSaw) {
                $orPct = if ($fabSummary.open_rate -match '^[0-9]') { [double]($fabSummary.open_rate -replace '[^0-9.]','') } else { 100 }
                $orColor = if ($orPct -lt 10) { "#EF4444" } elseif ($orPct -lt 20) { "#F97316" } else { "#059669" }
                $htmlBody += @"
      <td class="fab-cell" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:6px;width:30%;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr><td class="fab-lbl" style="text-align:center;">Saw FAB</td></tr>
          <tr><td class="fab-val" style="text-align:center;">$($fabSummary.saw_fab)</td></tr>
        </table>
      </td>
      <td class="fab-arr">&#8594;</td>
      <td class="fab-cell" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:6px;width:30%;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr><td class="fab-lbl" style="text-align:center;">Opened FAB</td></tr>
          <tr><td class="fab-val" style="text-align:center;">$($fabSummary.opened_fab)</td></tr>
          <tr><td class="fab-rate" style="color:$orColor;text-align:center;">$($fabSummary.open_rate)</td></tr>
        </table>
      </td>
      <td class="fab-arr">&#8594;</td>
      <td class="fab-cell" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:6px;width:30%;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr><td class="fab-lbl" style="text-align:center;">Acted on FAB</td></tr>
          <tr><td class="fab-val" style="text-align:center;">$($fabSummary.acted_fab)</td></tr>
          <tr><td class="fab-rate" style="color:#059669;text-align:center;">$($fabSummary.action_rate)</td></tr>
        </table>
      </td>
"@
            } else {
                $htmlBody += @"
      <td class="fab-cell" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:6px;width:44%;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr><td class="fab-lbl" style="text-align:center;">Opened FAB</td></tr>
          <tr><td class="fab-val" style="text-align:center;">$($fabSummary.opened_fab)</td></tr>
        </table>
      </td>
      <td class="fab-arr" style="width:12%;">&#8594;</td>
      <td class="fab-cell" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:6px;width:44%;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr><td class="fab-lbl" style="text-align:center;">Acted on FAB</td></tr>
          <tr><td class="fab-val" style="text-align:center;">$($fabSummary.acted_fab)</td></tr>
          <tr><td class="fab-rate" style="color:#059669;text-align:center;">$($fabSummary.action_rate)</td></tr>
        </table>
      </td>
"@
                $htmlBody += "    </tr></table>`n<p style='font-size:10px;color:#CBD5E1;margin-top:10px;font-family:Segoe UI,sans-serif;'>&#9432; &ldquo;Saw FAB&rdquo; metric not yet captured &mdash; open rate available next scrape</p>`n"
            }

            if ($hasSaw) { $htmlBody += "    </tr></table>`n" }
            $htmlBody += "  </td>`n</tr>`n"

            # Retention table
            $htmlBody += @"
<tr><td style="padding:8px 20px 3px;border-bottom:1px solid #F1F5F9;">
  <table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;font-family:'Segoe UI',sans-serif;">Action Retention (R28)</td>
    <td style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9CA3AF;text-align:right;font-family:'Segoe UI',sans-serif;">Week 1: <strong style="color:#166534;">$($fabSummary.week1_retention)</strong></td>
  </tr></table>
</td></tr>
<tr><td>
<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr>
    <td class="ret-th">Start Date</td>
    <td class="ret-thr">Wk&nbsp;0</td>
    <td class="ret-thr">Wk&nbsp;1</td>
    <td class="ret-thr">Wk&nbsp;2</td>
    <td class="ret-thr">Wk&nbsp;3</td>
    <td class="ret-thr">Wk&nbsp;4</td>
  </tr>
"@
            $dataRows = $fabRetention | Where-Object { $_ -and $_[0] -notmatch '(?i)start\s*date' }
            $hlIdx = -1
            for ($ri = $dataRows.Count - 1; $ri -ge 0; $ri--) {
                $row = $dataRows[$ri]
                if ($row.Count -ge 3 -and $row[2] -match '(\d+)%' -and [int]$Matches[1] -gt 0) { $hlIdx = $ri; break }
            }
            for ($ri = 0; $ri -lt $dataRows.Count; $ri++) {
                $row = $dataRows[$ri]
                $cells = @($row[0],$row[1],$row[2],$row[3],$row[4],$row[5]) | ForEach-Object { if ($null -ne $_) { $_ } else { "" } }
                $hlClass = if ($ri -eq $hlIdx) { " class='ret-hl'" } else { "" }
                $htmlBody += "  <tr$hlClass><td class='ret-td'>$($cells[0])</td>"
                for ($ci = 1; $ci -lt 6; $ci++) { $htmlBody += "<td class='ret-tdr'>$($cells[$ci])</td>" }
                $htmlBody += "</tr>`n"
            }
            $htmlBody += "</table>`n</td></tr>`n"

        } catch {
            Write-Host "  WARNING: FAB report could not be parsed: $($_.Exception.Message)" -ForegroundColor Yellow
            $htmlBody += @"
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#0891B2;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">FAB</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">Floating Action Button</td>
    </tr></table>
  </td>
</tr>
<tr><td style="padding:14px 20px;font-size:13px;color:#9CA3AF;font-family:'Segoe UI',sans-serif;">FAB data could not be loaded for this run.</td></tr>
"@
        }
    } else {
        Write-Host "  INFO: No FAB report found" -ForegroundColor Cyan
        $htmlBody += @"
<tr>
  <td bgcolor="#1B2A3B" style="background-color:#1B2A3B;padding:11px 20px;">
    <table border="0" cellpadding="0" cellspacing="0"><tr>
      <td style="background-color:#0891B2;color:#FFFFFF;font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:3px 9px;border-radius:3px;font-family:'Segoe UI',sans-serif;line-height:1.8;">FAB</td>
      <td style="color:#64748B;font-size:12px;font-weight:600;padding-left:10px;font-family:'Segoe UI',sans-serif;">Floating Action Button</td>
    </tr></table>
  </td>
</tr>
<tr><td style="padding:14px 20px;font-size:13px;color:#9CA3AF;font-family:'Segoe UI',sans-serif;">FAB data was not available for this run.</td></tr>
"@
    }

    $htmlBody += @"

</table><!-- /white card inner -->
</td></tr><!-- /white card -->

<!-- ══ FOOTER ════════════════════════════════════════════════════════════════ -->
<tr>
  <td bgcolor="#0D1B2A" style="background-color:#0D1B2A;padding:20px 0 4px;">
    <p style="color:#334155;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;font-family:'Segoe UI',sans-serif;">Source Dashboards</p>
    <table border="0" cellpadding="0" cellspacing="0">
      <tr><td style="padding:3px 0;font-size:12px;font-family:'Segoe UI',sans-serif;"><a href="https://www.microsoftnezha.com/nezha/dashboard/a82f4c8e-6f29-4402-8fa1-c0af49a5132d/?native_filters_key=6FKzlayTLsMAna0Kh_gql5i4DVdcXJS7vhW3VXfxq3IM0tsi495GLon-BzHFEWYV" style="color:#4ADE80;text-decoration:none;">KAv2 Dashboard</a> <span style="color:#334155;">&mdash; Executive Summary &amp; Growth</span></td></tr>
      <tr><td style="padding:3px 0;font-size:12px;font-family:'Segoe UI',sans-serif;"><a href="https://askideas.microsoft.net/dashboard/CopilotExtensibilityDashboard/copilotCommercial" style="color:#4ADE80;text-decoration:none;">Copilot Extensibility Dashboard</a> <span style="color:#334155;">&mdash; Competition Metrics</span></td></tr>
      <tr><td style="padding:3px 0;font-size:12px;font-family:'Segoe UI',sans-serif;"><a href="https://www.microsoftnezha.com/nezha/dashboard/4315/" style="color:#4ADE80;text-decoration:none;">FAB Dashboard</a> <span style="color:#334155;">&mdash; Floating Action Button Metrics</span></td></tr>
    </table>
    <p style="color:#1E3148;font-size:10px;margin:16px 0 0;font-family:'Segoe UI',sans-serif;">Automated scraping runs Mon/Tue/Thu at 7:00 AM</p>
  </td>
</tr>

</table><!-- /content wrapper -->

</td></tr>
</table><!-- /outer bg -->
</body>
</html>
"@

    $mail.HTMLBody = $htmlBody
    Write-Host "  HTML email created" -ForegroundColor Green

    if ($Test) {
        Write-Host "TEST MODE: Opening draft..." -ForegroundColor Yellow
        $mail.Display()
    } else {
        Write-Host "INFO: Sending to $To..." -ForegroundColor Cyan
        $mail.Send()
        Write-Host "SUCCESS: Email sent!" -ForegroundColor Green
    }

    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($outlook) | Out-Null

} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`nComplete!" -ForegroundColor Green
