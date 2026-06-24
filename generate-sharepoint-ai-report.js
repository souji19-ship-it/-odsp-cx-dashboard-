const fs = require('fs');
const csv = require('csv-parse/sync');

/**
 * SharePoint AI (KAv2) Executive Report Generator
 *
 * Creates comprehensive report with:
 * - Part 1: SharePoint AI adoption, patterns, and changes
 * - Part 2: Competitive comparison to other agents
 */

function generateReport() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SharePoint AI Executive Report Generator');
  console.log('═══════════════════════════════════════════════════════════\n');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

  // ========== Load Data ==========
  console.log('→ Loading latest data files...');

  // Find latest files
  const kav2ExecutiveFile = findLatestFile('kav2-executive-summary-metrics-*.csv');
  const kav2GrowthFile = findLatestFile('kav2-growth-analytics-metrics-*.csv');

  // Try new competition file format first, fall back to old extensibility format
  let competitionGridFile = findLatestFile('copilot-competition-grid-*.csv');
  if (!competitionGridFile) {
    competitionGridFile = findLatestFile('copilot-extensibility-grid1-*.csv');
  }

  if (!kav2ExecutiveFile || !kav2GrowthFile || !competitionGridFile) {
    console.error('❌ Missing required data files. Run scraper first.');
    process.exit(1);
  }

  // Reject stale data - files must be from the current run (within 4 hours)
  const MAX_AGE_HOURS = 4;
  for (const [label, file] of [['KAv2 Executive', kav2ExecutiveFile], ['KAv2 Growth', kav2GrowthFile], ['Competition Grid', competitionGridFile]]) {
    const ageHours = (Date.now() - fs.statSync(file).mtimeMs) / (1000 * 60 * 60);
    if (ageHours > MAX_AGE_HOURS) {
      console.error(`❌ ${label} data is stale (${ageHours.toFixed(1)}h old). Run scraper first to get fresh data.`);
      process.exit(1);
    }
  }

  console.log(`  ✓ KAv2 Executive: ${kav2ExecutiveFile}`);
  console.log(`  ✓ KAv2 Growth: ${kav2GrowthFile}`);
  console.log(`  ✓ Competition Grid: ${competitionGridFile}`);

  const kav2Executive = parseMetricsCSV(kav2ExecutiveFile);
  const kav2Growth = parseMetricsCSV(kav2GrowthFile);
  const competitionData = parseCompetitionGrid(competitionGridFile);

  // Validate required fields — fail fast rather than send a useless report
  const requiredFields = [
    { source: kav2Executive, key: 'Weekly Active Users',          label: 'KAv2 WAU' },
    { source: kav2Executive, key: 'Weekly Retention',             label: 'KAv2 weekly return rate' },
    { source: kav2Growth,    key: '[KAv2] Weekly Active Usage',   label: 'KAv2 WAU (growth tab)' },
  ];
  const missing = requiredFields.filter(f => !f.source[f.key] || f.source[f.key] === 'N/A');
  if (missing.length > 0) {
    console.error(`❌ Incomplete data — missing required fields: ${missing.map(f => f.label).join(', ')}`);
    console.error('   Dashboards may not have fully loaded. Report not generated.');
    process.exit(1);
  }

  // ========== Generate Report ==========
  console.log('\n→ Generating report...\n');

  const report = {
    metadata: {
      generated: new Date().toISOString(),
      title: 'SharePoint AI Executive Report',
      data_sources: {
        kav2_executive: kav2ExecutiveFile,
        kav2_growth: kav2GrowthFile,
        competition: competitionGridFile
      }
    },
    part1_sharepoint_ai_analysis: generatePart1(kav2Executive, kav2Growth),
    part2_competitive_comparison: generatePart2(kav2Executive, kav2Growth, competitionData)
  };

  // ========== Save Outputs ==========
  const jsonFile = `sharepoint-ai-report-${timestamp}.json`;
  const txtFile = `sharepoint-ai-report-${timestamp}.txt`;
  const csvFile = `sharepoint-ai-comparison-${timestamp}.csv`;

  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
  console.log(`✓ Saved JSON: ${jsonFile}`);

  const textReport = generateTextReport(report);
  fs.writeFileSync(txtFile, textReport);
  console.log(`✓ Saved Text: ${txtFile}`);

  const comparisonCSV = generateComparisonCSV(report);
  fs.writeFileSync(csvFile, comparisonCSV);
  console.log(`✓ Saved CSV: ${csvFile}`);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ Report generated successfully!');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Print summary to console
  console.log(textReport);
}

function generatePart1(kav2Executive, kav2Growth) {
  return {
    title: 'SharePoint AI (KAv2) - Adoption & Patterns Analysis',

    // Core adoption metrics
    adoption_metrics: {
      weekly_active_users: kav2Executive['Weekly Active Users'] || 'N/A',
      weekly_active_users_wow: kav2Executive['Weekly active users WOW%'] || 'N/A',
      opt_in_tenants: kav2Executive['Opt-in Tenants'] || 'N/A',

      kav2_specific: {
        daily_active_usage: kav2Growth['[KAv2] Daily Active Usage'] || kav2Executive['[KAv2] Daily Active Usage'] || 'N/A',
        weekly_active_usage: kav2Growth['[KAv2] Weekly Active Usage'] || kav2Executive['[KAv2] Weekly Active Usage'] || kav2Executive['[KAv2] Weekly Active Users'] || 'N/A',
        monthly_active_usage: kav2Growth['[KAv2] Monthly Active Usage'] || kav2Executive['[KAv2] Monthly Active Usage'] || 'N/A',
        weekly_query_volume: kav2Growth['[KAv2] Weekly Query Volume'] || kav2Executive['[KAv2] Weekly Query Volume'] || 'N/A',
        weekly_conversation_volume: kav2Growth['[KAv2] Weekly Conversation Volume'] || kav2Executive['[KAv2] Weekly Conversation Volume'] || 'N/A',
        active_users: kav2Executive['[KAv2] Active Users'] || kav2Executive['[KAv2] Weekly Active Users'] || 'N/A',
        active_users_wow: kav2Executive['[KAv2] Active Users WoW%'] || kav2Executive['[KAv2] Weekly Active Users WoW%'] || 'N/A'
      }
    },

    // Engagement patterns
    engagement_patterns: {
      weekly_return_rate: kav2Executive['KA weekly return rate'] || 'N/A',
      weekly_kept_rate: kav2Executive['Weekly kept rate'] || 'N/A',
      monthly_return_rate_builders: kav2Executive['Monthly Return Rate (For Builders)'] || 'N/A',
      kav2_weekly_return_rate: kav2Executive['Weekly Retention'] || kav2Executive['[KAv2] Weekly return rate %'] || kav2Growth['[KAv2] Weekly return rate %'] || 'N/A'
    },

    // User persona breakdown
    user_personas: {
      content_creator: {
        active_users: kav2Executive['Content Creator'] || 'N/A'
      },
      content_manager: {
        active_users: kav2Executive['Content Manager'] || 'N/A'
      },
      site_manager: {
        active_users: kav2Executive['Site Manager'] || 'N/A'
      },
      content_consumer: {
        active_users: kav2Executive['Content Consumer'] || 'N/A'
      }
    },

    // Top actions/features
    top_actions: extractTopActions(kav2Executive),

    // Key insights
    insights: generateInsights(kav2Executive, kav2Growth)
  };
}

function generatePart2(kav2Executive, kav2Growth, competitionData) {
  const sharePointAI = {
    name: 'SharePoint AI (KAv2)',
    dau: parseNumber(kav2Growth['[KAv2] Daily Active Usage']) || parseNumber(kav2Executive['[KAv2] Daily Active Usage']) || null,
    wau: parseNumber(kav2Executive['Weekly Active Users']) || parseNumber(kav2Executive['[KAv2] Weekly Active Users']) || null,
    mau: parseNumber(kav2Growth['[KAv2] Monthly Active Usage']) || parseNumber(kav2Executive['[KAv2] Monthly Active Usage']) || null,
    return_rate: parseNumber(kav2Executive['Weekly Retention']) || parseNumber(kav2Executive['[KAv2] Weekly return rate %']) || parseNumber(kav2Growth['[KAv2] Weekly return rate %']) || null,
    wow_growth: parseNumber(kav2Executive['[KAv2] Active Users WoW%']) || parseNumber(kav2Executive['[KAv2] Weekly Active Users WoW%']) || null
  };

  // Calculate DAU/MAU ratio
  if (sharePointAI.dau && sharePointAI.mau) {
    sharePointAI.dau_mau = ((sharePointAI.dau / sharePointAI.mau) * 100).toFixed(1) + '%';
  }

  return {
    title: 'Competitive Landscape - SharePoint AI vs. Other Agents',

    sharepoint_ai: sharePointAI,

    competition: competitionData,

    rankings: generateRankings(sharePointAI, competitionData),

    competitive_position: generateCompetitivePosition(sharePointAI, competitionData)
  };
}

function generateRankings(sharePointAI, competition) {
  const agents = [
    {
      name: 'SharePoint AI (KAv2)',
      dau: sharePointAI.dau,
      wau: sharePointAI.wau,
      mau: sharePointAI.mau,
      dau_mau: parseNumber(sharePointAI.dau_mau),
      weekly_return_rate: sharePointAI.return_rate,
      thumbs_down: null  // SharePoint AI doesn't have thumbs down data
    },
    ...Object.entries(competition).map(([name, data]) => ({
      name,
      dau: parseNumber(data.dau),
      wau: parseNumber(data.wau),
      mau: parseNumber(data.mau),
      dau_mau: parseNumber(data.dau_mau),
      weekly_return_rate: parseNumber(data.weekly_return_rate),
      thumbs_down: parseNumber(data.thumbs_down)
    }))
  ];

  return {
    by_dau: agents
      .filter(a => a.dau)
      .sort((a, b) => (b.dau || 0) - (a.dau || 0))
      .map((a, i) => ({ rank: i + 1, name: a.name, value: formatNumber(a.dau) })),

    by_wau: agents
      .filter(a => a.wau)
      .sort((a, b) => (b.wau || 0) - (a.wau || 0))
      .map((a, i) => ({ rank: i + 1, name: a.name, value: formatNumber(a.wau) })),

    by_mau: agents
      .filter(a => a.mau)
      .sort((a, b) => (b.mau || 0) - (a.mau || 0))
      .map((a, i) => ({ rank: i + 1, name: a.name, value: formatNumber(a.mau) })),

    by_engagement: agents
      .filter(a => a.dau_mau)
      .sort((a, b) => (b.dau_mau || 0) - (a.dau_mau || 0))
      .map((a, i) => ({ rank: i + 1, name: a.name, value: a.dau_mau.toFixed(1) + '%' })),

    by_return_rate: agents
      .filter(a => a.weekly_return_rate)
      .sort((a, b) => (b.weekly_return_rate || 0) - (a.weekly_return_rate || 0))
      .map((a, i) => ({ rank: i + 1, name: a.name, value: a.weekly_return_rate.toFixed(1) + '%' })),

    by_satisfaction: agents
      .filter(a => a.thumbs_down)
      .sort((a, b) => (a.thumbs_down || 100) - (b.thumbs_down || 100))
      .map((a, i) => ({ rank: i + 1, name: a.name, thumbs_down: a.thumbs_down.toFixed(1) + '%' }))
  };
}

function generateCompetitivePosition(sharePointAI, competition) {
  const insights = [];

  // Compare to SPO Agents (separate competing product)
  if (competition['SharePoint Agents (SPO)']) {
    const spoDAU = parseNumber(competition['SharePoint Agents (SPO)'].dau);
    const kav2DAU = sharePointAI.dau;

    if (spoDAU && kav2DAU) {
      const ratio = (kav2DAU / spoDAU).toFixed(2);
      const comparison = kav2DAU > spoDAU ? 'ahead of' : 'behind';
      insights.push({
        category: 'vs_sharepoint_agents',
        finding: `SharePoint AI (KAv2) vs SharePoint Agents (SPO) - competing products`,
        kav2_dau: formatNumber(kav2DAU),
        spo_dau: competition['SharePoint Agents (SPO)'].dau,
        comparison: `KAv2: ${formatNumber(kav2DAU)} DAU, SPO: ${competition['SharePoint Agents (SPO)'].dau} DAU`
      });
    }
  }

  // Calculate position vs All Agents
  if (competition['All Up (Agents + Connectors)']) {
    const allUpDAU = parseNumber(competition['All Up (Agents + Connectors)'].dau);
    const kav2DAU = sharePointAI.dau;

    if (allUpDAU && kav2DAU) {
      const pctOfAllUp = ((kav2DAU / allUpDAU) * 100).toFixed(2);
      insights.push({
        category: 'vs_all_copilot_extensibility',
        finding: `SharePoint AI (KAv2) represents ${pctOfAllUp}% of total Copilot Extensibility DAU`,
        kav2_dau: formatNumber(kav2DAU),
        all_up_dau: competition['All Up (Agents + Connectors)'].dau
      });
    }
  }

  // Engagement comparison
  const kav2Engagement = sharePointAI.return_rate;
  const thumbsDownValues = Object.values(competition)
    .map(c => parseNumber(c.thumbs_down))
    .filter(val => val !== null && !isNaN(val) && val >= 0 && val <= 100);

  if (thumbsDownValues.length > 0) {
    const avgThumbsDown = thumbsDownValues.reduce((sum, val) => sum + val, 0) / thumbsDownValues.length;
    insights.push({
      category: 'engagement_quality',
      finding: `SharePoint AI has ${kav2Engagement}% weekly return rate`,
      comparison: `Average thumbs down across competition: ${avgThumbsDown.toFixed(1)}%`
    });
  } else {
    insights.push({
      category: 'engagement_quality',
      finding: `SharePoint AI has ${kav2Engagement}% weekly return rate`,
      comparison: 'Competition thumbs down data not available'
    });
  }

  return insights;
}

function extractTopActions(kav2Executive) {
  // Try reading from the table CSV files (Top 10 Tools chains chart renders as a table)
  const tableFiles = fs.readdirSync('.')
    .filter(f => /^kav2-executive-summary-table\d+-\d{4}-\d{2}-\d{2}T/.test(f))
    .sort()
    .reverse();

  for (const tableFile of tableFiles) {
    // Only accept files from current run (within 4 hours)
    const ageHours = (Date.now() - fs.statSync(tableFile).mtimeMs) / (1000 * 60 * 60);
    if (ageHours > 4) continue;

    try {
      const fileContent = fs.readFileSync(tableFile, 'utf8');
      const records = csv.parse(fileContent, { skip_empty_lines: true, relax_column_count: true });
      // Look for a table where first column contains known action names (e.g. invoke_sydney)
      const knownActions = ['invoke_sydney', 'update_outline', 'create_or_update_list', 'search_enterprise', 'get_list', 'discover_sharepoint', 'qna_on_list', 'fetch_file', 'read_from_workspace'];
      const hasActions = records.some(row => row[0] && knownActions.some(a => row[0].includes(a)));
      if (!hasActions) continue;

      // Skip header row(s) — find first data row that matches
      return records
        .filter(row => row[0] && row[1] && knownActions.some(a => row[0].includes(a)))
        .map(row => ({ action: row[0], count: row[1] }));
    } catch (e) {
      // malformed table file — skip
    }
  }

  // Fallback: look for action names as metric keys (legacy format)
  const legacyActions = [
    'invoke_sydney', 'update_outline_v2', 'create_or_update_list',
    'discover_sharepoint_lists', 'get_list_data',
    'get_list_schema,get_list_data,suggest_new_columns', 'get_list_schema',
    'read_from_workspace,apply_json_patch_to_workspace,review_workspace',
    'search_enterprise_files'
  ];
  return legacyActions
    .filter(action => kav2Executive[action])
    .map(action => ({ action: action, count: kav2Executive[action] }));
}

function generateInsights(kav2Executive, kav2Growth) {
  const insights = [];

  // Growth trend
  const wow = parseNumber(kav2Executive['[KAv2] Active Users WoW%']);
  if (wow) {
    if (wow > 100) {
      insights.push(`** Exceptional growth: ${wow}% WoW increase in KAv2 active users`);
    } else if (wow > 20) {
      insights.push(`** Strong growth: ${wow}% WoW increase in KAv2 active users`);
    } else if (wow > 0) {
      insights.push(`** Positive growth: ${wow}% WoW increase in KAv2 active users`);
    } else {
      insights.push(`!! Declining: ${wow}% WoW change in KAv2 active users`);
    }
  }

  // Engagement quality
  const returnRate = parseNumber(kav2Executive['[KAv2] Weekly return rate %']);
  if (returnRate) {
    if (returnRate > 50) {
      insights.push(`** Excellent retention: ${returnRate}% weekly return rate`);
    } else if (returnRate > 30) {
      insights.push(`** Good retention: ${returnRate}% weekly return rate`);
    } else {
      insights.push(`!! Low retention: ${returnRate}% weekly return rate`);
    }
  }

  // Persona dominance
  const contentCreator = parseNumber(kav2Executive['Content Creator']);
  const contentConsumer = parseNumber(kav2Executive['Content Consumer']);
  const totalWAU = parseNumber(kav2Executive['Weekly Active Users']);

  if (contentCreator && totalWAU) {
    const creatorPct = ((contentCreator / totalWAU) * 100).toFixed(1);
    insights.push(`** Content Creators represent ${creatorPct}% of weekly active users`);
  }

  return insights;
}

function parseCompetitionGrid(filename) {
  const fileContent = fs.readFileSync(filename, 'utf8');
  const records = csv.parse(fileContent, {
    skip_empty_lines: true,
    relax_column_count: true
  });

  const agents = {
    'Researcher': { column: 0 },
    'Analyst': { column: 1 },
    'Word Agent': { column: 3 },
    'Excel Agent': { column: 4 },
    'PowerPoint Agent': { column: 5 },
    'Declarative Agents (DA)': { column: 6 },
    'SharePoint Agents (SPO)': { column: 7 },
    'Custom Engine Agents (CEA)': { column: 8 },
    'Connectors': { column: 9 },
    'All Up (Agents + Connectors)': { column: 10 }
  };

  const result = {};

  for (const [agentName, config] of Object.entries(agents)) {
    const col = config.column;

    // Extract metrics from specific rows
    // Note: csv-parse reads the multi-line header in a non-sequential way
    result[agentName] = {
      dau: cleanValue(records[2]?.[col]),           // DAU row
      wau: cleanValue(records[3]?.[col]),           // WAU row
      mau: cleanValue(records[4]?.[col]),           // MAU row
      dau_mau: cleanValue(records[5]?.[col]),       // DAU/MAU row
      extension_user_pairs: cleanValue(records[6]?.[col]), // Extension-User Pairs row
      weekly_return_rate: cleanValue(records[21]?.[col]),  // Weekly Return Rate row (51.6%, 28.8%, etc.)
      thumbs_down: cleanValue(records[19]?.[col])   // % Thumbs Down row (42.74%, 47.27%, etc.)
    };
  }

  return result;
}

function parseMetricsCSV(filename) {
  const fileContent = fs.readFileSync(filename, 'utf8');
  const records = csv.parse(fileContent, {
    skip_empty_lines: true,
    columns: ['metric', 'value']
  });

  const result = {};
  records.forEach(record => {
    if (record.metric && record.value) {
      result[record.metric] = record.value;
    }
  });

  return result;
}

function cleanValue(value) {
  if (!value) return 'N/A';
  // Remove date suffixes like "2/12/2026"
  return value.toString().replace(/\d{1,2}\/\d{1,2}\/\d{4}/, '').trim();
}

function parseNumber(value) {
  if (!value || value === 'N/A') return null;

  const str = value.toString().toLowerCase();

  // Handle percentages
  if (str.includes('%')) {
    return parseFloat(str.replace('%', ''));
  }

  // Handle K (thousands)
  if (str.includes('k')) {
    return parseFloat(str.replace('k', '')) * 1000;
  }

  // Handle M (millions)
  if (str.includes('m')) {
    return parseFloat(str.replace('m', '')) * 1000000;
  }

  // Remove commas and parse
  return parseFloat(str.replace(/,/g, ''));
}

function formatNumber(num) {
  if (!num && num !== 0) return 'N/A';

  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  } else {
    return num.toString();
  }
}

function generateTextReport(report) {
  let text = '';

  text += '=======================================================================\n';
  text += '                    SHAREPOINT AI EXECUTIVE REPORT\n';
  text += '=======================================================================\n';
  text += `Generated: ${new Date(report.metadata.generated).toLocaleString()}\n`;
  text += '=======================================================================\n\n';

  // ========== PART 1 ==========
  const p1 = report.part1_sharepoint_ai_analysis;

  text += '+---------------------------------------------------------------------+\n';
  text += '| PART 1: SharePoint AI (KAv2) - Adoption & Patterns                 |\n';
  text += '+---------------------------------------------------------------------+\n\n';

  text += '-- KEY INSIGHTS\n';
  p1.insights.forEach(insight => {
    text += `  ${insight}\n`;
  });
  text += '\n';

  text += '-- ADOPTION METRICS\n';
  text += `  ${'Weekly Active Users:'.padEnd(35)} ${p1.adoption_metrics.weekly_active_users}\n`;
  text += `  ${'Weekly Active Users WoW:'.padEnd(35)} ${p1.adoption_metrics.weekly_active_users_wow}%\n`;
  text += `  ${'Opt-in Tenants:'.padEnd(35)} ${p1.adoption_metrics.opt_in_tenants}\n\n`;

  text += '  KAv2 Specific:\n';
  text += `    ${'Daily Active Usage:'.padEnd(33)} ${p1.adoption_metrics.kav2_specific.daily_active_usage}\n`;
  text += `    ${'Weekly Active Usage:'.padEnd(33)} ${p1.adoption_metrics.kav2_specific.weekly_active_usage}\n`;
  text += `    ${'Monthly Active Usage:'.padEnd(33)} ${p1.adoption_metrics.kav2_specific.monthly_active_usage}\n`;
  text += `    ${'Weekly Query Volume:'.padEnd(33)} ${p1.adoption_metrics.kav2_specific.weekly_query_volume}\n`;
  text += `    ${'Weekly Conversation Volume:'.padEnd(33)} ${p1.adoption_metrics.kav2_specific.weekly_conversation_volume}\n`;
  text += `    ${'Active Users WoW:'.padEnd(33)} ${p1.adoption_metrics.kav2_specific.active_users_wow}%\n\n`;

  text += '-- ENGAGEMENT PATTERNS\n';
  text += `  ${'KAv2 Weekly Return Rate:'.padEnd(35)} ${p1.engagement_patterns.kav2_weekly_return_rate}%\n`;
  text += `  ${'Overall Weekly Return Rate:'.padEnd(35)} ${p1.engagement_patterns.weekly_return_rate}%\n`;
  text += `  ${'Weekly Kept Rate:'.padEnd(35)} ${p1.engagement_patterns.weekly_kept_rate}%\n`;
  text += `  ${'Monthly Return (Builders):'.padEnd(35)} ${p1.engagement_patterns.monthly_return_rate_builders}%\n\n`;

  text += '-- USER PERSONA BREAKDOWN\n';
  text += `  ${'Content Creator:'.padEnd(35)} ${p1.user_personas.content_creator.active_users}\n`;
  text += `  ${'Content Consumer:'.padEnd(35)} ${p1.user_personas.content_consumer.active_users}\n`;
  text += `  ${'Content Manager:'.padEnd(35)} ${p1.user_personas.content_manager.active_users}\n`;
  text += `  ${'Site Manager:'.padEnd(35)} ${p1.user_personas.site_manager.active_users}\n\n`;

  text += '-- TOP ACTIONS / FEATURES\n';
  p1.top_actions.slice(0, 8).forEach(action => {
    text += `  ${action.action.padEnd(60)} ${action.count}\n`;
  });
  text += '\n';

  // ========== PART 2 ==========
  const p2 = report.part2_competitive_comparison;

  text += '+---------------------------------------------------------------------+\n';
  text += '| PART 2: Competitive Landscape - SharePoint AI vs Other Agents      |\n';
  text += '+---------------------------------------------------------------------+\n\n';

  text += '** RANKINGS - DAILY ACTIVE USERS (DAU)\n';
  p2.rankings.by_dau.forEach(item => {
    const marker = item.name.includes('SharePoint AI') ? '>>' : '  ';
    text += `  ${marker} ${item.rank}. ${item.name.padEnd(40)} ${item.value}\n`;
  });
  text += '\n';

  text += '** RANKINGS - WEEKLY ACTIVE USERS (WAU)\n';
  p2.rankings.by_wau.forEach(item => {
    const marker = item.name.includes('SharePoint AI') ? '>>' : '  ';
    text += `  ${marker} ${item.rank}. ${item.name.padEnd(40)} ${item.value}\n`;
  });
  text += '\n';

  text += '** RANKINGS - MONTHLY ACTIVE USERS (MAU)\n';
  p2.rankings.by_mau.forEach(item => {
    const marker = item.name.includes('SharePoint AI') ? '>>' : '  ';
    text += `  ${marker} ${item.rank}. ${item.name.padEnd(40)} ${item.value}\n`;
  });
  text += '\n';

  text += '** RANKINGS - ENGAGEMENT (DAU/MAU RATIO)\n';
  p2.rankings.by_engagement.forEach(item => {
    const marker = item.name.includes('SharePoint AI') ? '>>' : '  ';
    text += `  ${marker} ${item.rank}. ${item.name.padEnd(40)} ${item.value}\n`;
  });
  text += '\n';

  text += '** COMPETITIVE POSITION\n';
  p2.competitive_position.forEach(insight => {
    text += `\n  ${insight.category.toUpperCase().replace(/_/g, ' ')}\n`;
    text += `  ${insight.finding}\n`;
    if (insight.kav2_dau) {
      text += `    - SharePoint AI DAU:  ${insight.kav2_dau}\n`;
    }
    if (insight.spo_total_dau) {
      text += `    - SPO Total DAU:      ${insight.spo_total_dau}\n`;
    }
    if (insight.all_up_dau) {
      text += `    - All Extensibility:  ${insight.all_up_dau}\n`;
    }
    if (insight.comparison) {
      text += `    - ${insight.comparison}\n`;
    }
  });
  text += '\n';

  text += '=======================================================================\n';
  text += 'END OF REPORT\n';
  text += '=======================================================================\n';

  return text;
}

function generateComparisonCSV(report) {
  const p2 = report.part2_competitive_comparison;

  let csv = 'Agent,DAU,WAU,MAU,DAU/MAU,Thumbs Down %\n';

  // SharePoint AI first
  const spa = p2.sharepoint_ai;
  csv += `"SharePoint AI (KAv2)",${spa.dau || 'N/A'},${formatNumber(spa.wau) || 'N/A'},${formatNumber(spa.mau) || 'N/A'},${spa.dau_mau || 'N/A'},-\n`;

  // Competition
  for (const [name, data] of Object.entries(p2.competition)) {
    csv += `"${name}",${data.dau},${data.wau},${data.mau},${data.dau_mau},${data.thumbs_down}\n`;
  }

  return csv;
}

function findLatestFile(pattern) {
  const files = fs.readdirSync('.')
    .filter(f => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(f);
    })
    .sort()
    .reverse();

  return files[0] || null;
}

// Run the report generator
generateReport();
