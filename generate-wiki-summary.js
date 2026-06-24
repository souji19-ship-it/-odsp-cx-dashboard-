'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = __dirname;
const DATA_FILE = path.join(ROOT, 'dashboard-data.json');
const OUT_FILE  = path.join(ROOT, 'wiki-usage-summary.md');

function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function pct(v) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  const decimals = Math.abs(n) < 1 ? 3 : 1;
  return n.toFixed(decimals) + '%';
}

function chg(v, suffix = '%') {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}${suffix}`;
}

function wowBadge(v) {
  if (v == null || isNaN(v)) return '';
  const n = Number(v);
  const sign = n >= 0 ? '+' : '';
  return ` (${sign}${n.toFixed(1)}% WoW)`;
}

// imageUrls: optional map of section key → uploaded image URL
// Keys: 'overview', 'm365', 'subproducts', 'agents'
function generate(imageUrls = {}) {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('ERROR: dashboard-data.json not found — run: node generate-dashboard-data.js');
    process.exit(1);
  }

  const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const now = new Date().toISOString().slice(0, 10);
  const dataDate = d.kav2?.latestDate || d.agentsIO?.latestDate || now;

  const img = (key) => imageUrls[key] ? `\n![${key} chart](${imageUrls[key]})\n\n` : '';

  let md = '';

  // ── Header ──────────────────────────────────────────────────────────────────
  md += `# Copilot in SharePoint — Weekly Status\n\n`;
  md += `*Generated: ${now} · Data through: ${dataDate}*\n\n`;
  md += `[Full dashboard](https://microsoft.sharepoint-df.com/teams/SPAI/Shared%20Documents/Stats/dashboard-sharepoint.html)\n\n`;
  md += `---\n\n`;

  // ── KAv2 Core ───────────────────────────────────────────────────────────────
  const k = d.kav2;
  const kh = k.headline;

  md += `## KAv2 Core\n\n`;
  md += img('overview');
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| WAU | ${fmt(kh.wau)}${wowBadge(k.growth?.wow)} |\n`;
  md += `| — Prod WAU | ${fmt(kh.wauProd)} |\n`;
  md += `| — MSIT WAU | ${fmt(kh.wauMsit)} |\n`;
  md += `| DAU | ${fmt(kh.dau)} |\n`;
  md += `| Weekly Queries | ${fmt(kh.weeklyQueries)} |\n`;
  md += `| Weekly Retention | ${pct(kh.retentionRate)} |\n`;
  md += `| Active Tenants | ${fmt(kh.activeTenants)} |\n`;
  if (k.penetration?.pct) {
    md += `| M365 All-Up Penetration | ${pct(k.penetration.pct)} |\n`;
  }
  md += `\n`;
  if (k.growth) {
    md += `**Growth:** ${chg(k.growth.wow)} WoW · ${chg(k.growth.mom)} MoM · +${k.growth.launch}% since launch (${k.launchDate})\n\n`;
  }

  // ── AI All-Up ───────────────────────────────────────────────────────────────
  if (d.aiAllUp?.hasData) {
    const au = d.aiAllUp.headline;
    md += `## AI All-Up\n\n`;
    md += `*As of ${au.latestDate || dataDate}*\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total WAU | ${fmt(Number(au.totalWau))} |\n`;
    md += `| — 1P Features | ${fmt(Number(au.firstPartyWau))} |\n`;
    md += `| — Custom Agents | ${fmt(Number(au.customAgentsWau))} |\n`;
    md += `| — AI Intranet | ${fmt(Number(au.aiIntranetWau))} |\n`;
    md += `| MAU | ${au.mau || '—'} |\n`;
    md += `| WoW Retention | ${au.wowRetention ? pct(Number(au.wowRetention)) : '—'} |\n`;
    md += `\n`;
  }

  // ── M365 Comparison ─────────────────────────────────────────────────────────
  if (d.m365?.workloads?.length) {
    md += `## M365 Copilot Comparison\n\n`;
    md += img('m365');
    md += `| Product | WAU | MoM |\n`;
    md += `|---------|-----|-----|\n`;
    for (const w of d.m365.workloads) {
      const isSP = w.slug === 'copilot-in-sharepoint';
      const name = isSP ? `**${w.label}**` : w.label;
      md += `| ${name} | ${fmt(w.latestWau)} | ${w.mom != null ? chg(w.mom) : '—'} |\n`;
    }
    md += `\n`;
    if (d.m365.spRank && d.m365.rankedCount) {
      md += `SharePoint ranks **#${d.m365.spRank}** of ${d.m365.rankedCount} M365 workloads by WAU.\n\n`;
    }
  }

  // ── SP/OD Sub-products ───────────────────────────────────────────────────────
  if (d.m365?.spSubproducts?.length) {
    md += `## SP/OD Sub-products\n\n`;
    md += img('subproducts');
    md += `| Product | WAU | MoM | QoQ |\n`;
    md += `|---------|-----|-----|-----|\n`;
    for (const sp of d.m365.spSubproducts) {
      const wauVal = sp.wau?.latest;
      md += `| ${sp.label} | ${wauVal != null ? fmt(wauVal) : '—'} | ${sp.mom != null ? chg(sp.mom) : '—'} | ${sp.qoq != null ? chg(sp.qoq) : '—'} |\n`;
    }
    md += `\n`;
  }

  // ── Custom Agents ────────────────────────────────────────────────────────────
  if (d.agentsIO?.hasData) {
    const a = d.agentsIO.headline;
    md += `## Custom Agents\n\n`;
    md += img('agents');
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| WAU | ${fmt(a.wau)}${wowBadge(a.wowPct)} |\n`;
    md += `| DAU | ${fmt(a.dau)} |\n`;
    md += `| MAU | ${fmt(a.mau)} |\n`;
    md += `| % Users Querying | ${pct(a.pctQuerying * 100)} |\n`;
    md += `| Queries/User | ${Number(a.queriesPerUser).toFixed(2)} |\n`;
    md += `| Frequently Querying Users | ${fmt(a.fquCount)} (${pct(a.fquPct)} of WAU) |\n`;
    md += `\n`;
  }

  // ── Skills ───────────────────────────────────────────────────────────────────
  if (d.skills?.hasData) {
    const s = d.skills.headline;
    md += `## Skills\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Skills Created (lifetime) | ${fmt(s.skillsCreatedTotal)} |\n`;
    md += `| Skills Used (lifetime) | ${fmt(s.skillsUsedTotal)} |\n`;
    md += `| Active Users | ${fmt(s.activeUsers)} |\n`;
    md += `\n`;
  }

  // ── Makers ───────────────────────────────────────────────────────────────────
  if (d.makers?.hasData) {
    const m = d.makers.headline;
    md += `## Makers\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| SP Makers R28 | ${fmt(m.spMakersR28)}${m.spMakersWow != null ? ` (${chg(m.spMakersWow)} WoW)` : ''} |\n`;
    md += `| Automation Creator MAU | ${fmt(m.automationCreatorMau)} |\n`;
    md += `| Automations Created | ${fmt(m.automationsCreated)} |\n`;
    md += `| Lists MAU | ${fmt(m.listsMau)} |\n`;
    md += `| Lists Engaged | ${fmt(m.listsEngaged)} |\n`;
    md += `| Quick Steps MAU | ${fmt(m.quickStepsMau)} |\n`;
    md += `| PowerApps Forms MAU | ${fmt(m.powerAppsMauLatest)} |\n`;
    md += `\n`;
  }

  // ── Autofill ─────────────────────────────────────────────────────────────────
  if (d.autofill?.hasData) {
    const af = d.autofill.kpis;
    md += `## Autofill\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| R28 Pages (all) | ${fmt(af.grandTotalR28)} |\n`;
    md += `| — PAYG Pages | ${fmt(af.paygPages)} |\n`;
    md += `| — KA Pages | ${fmt(af.kaPages)} |\n`;
    md += `| Total Tenants | ${fmt(af.totalTenants)} |\n`;
    md += `| — PAYG Tenants | ${fmt(af.paygTenants)} |\n`;
    md += `| — KA Tenants | ${fmt(af.kaTenants)} |\n`;
    md += `\n`;
  }

  md += `---\n\n`;
  md += `*Auto-generated by the MSFT Reporting publish workflow. Do not edit manually.*\n`;

  fs.writeFileSync(OUT_FILE, md, 'utf8');
  console.log(`Generated: ${OUT_FILE}`);
  return md;
}

module.exports = { generate };

if (require.main === module) {
  generate();
}
