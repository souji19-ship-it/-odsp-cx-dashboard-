const fs = require('fs');
const csv = require('csv-parse/sync');

/**
 * FAB (Floating Action Button) Report Generator
 *
 * Reads the latest fab-metrics-*.csv and fab-retention-*.csv scraped from
 * the FAB Nezha dashboard and produces a JSON report + console summary.
 */

function generateFabReport() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  FAB (Floating Action Button) Report Generator');
  console.log('═══════════════════════════════════════════════════════════\n');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

  // ========== Load Data ==========
  console.log('→ Loading latest FAB data files...');

  const metricsFile = findLatestFile('fab-metrics-*.csv');
  const retentionFile = findLatestFile('fab-retention-*.csv');

  if (!metricsFile || !retentionFile) {
    console.error('❌ Missing required FAB data files. Run scraper first.');
    if (!metricsFile) console.error('   Missing: fab-metrics-*.csv');
    if (!retentionFile) console.error('   Missing: fab-retention-*.csv');
    process.exit(1);
  }

  // Reject stale data (older than 4 hours)
  const MAX_AGE_HOURS = 4;
  for (const [label, file] of [['FAB Metrics', metricsFile], ['FAB Retention', retentionFile]]) {
    const ageHours = (Date.now() - fs.statSync(file).mtimeMs) / (1000 * 60 * 60);
    if (ageHours > MAX_AGE_HOURS) {
      console.error(`❌ ${label} data is stale (${ageHours.toFixed(1)}h old). Run scraper first to get fresh data.`);
      process.exit(1);
    }
  }

  console.log(`  ✓ FAB Metrics: ${metricsFile}`);
  console.log(`  ✓ FAB Retention: ${retentionFile}`);

  // ========== Parse Data ==========
  const metrics = parseMetricsCSV(metricsFile);
  const retentionTable = parseRetentionCSV(retentionFile);

  // ========== Calculate Metrics ==========
  const openedRaw = metrics['Unique Users Opened FAB (WoW R28)'] || null;
  const actedRaw  = metrics['Unique Users Acted on FAB (WoW R28)'] || null;
  const sawRaw    = metrics['Unique Users Seen FAB'] || null;

  const sawFab    = sawRaw    || null;   // null = not captured by scraper yet
  const openedFab = openedRaw || 'N/A';
  const actedFab  = actedRaw  || 'N/A';

  const sawNum    = parseNumber(sawRaw);
  const openedNum = parseNumber(openedRaw);
  const actedNum  = parseNumber(actedRaw);

  // Saw → Opened rate (the big initial falloff)
  let openRate = null;
  if (sawNum && openedNum && sawNum > 0) {
    openRate = ((openedNum / sawNum) * 100).toFixed(1) + '%';
  }

  // Opened → Acted rate (engagement quality)
  let actionRate = 'N/A';
  if (openedNum && actedNum && openedNum > 0) {
    actionRate = ((actedNum / openedNum) * 100).toFixed(1) + '%';
  }

  // Retention: find the most recent complete week's Week 1 retention %
  // "Complete" = the row where week 1 column has a non-zero value (last few weeks
  // may be incomplete since users haven't had time to return yet).
  // The table rows are data rows (skip header if present). Each row:
  //   [START DATE, Week 0 (100%), Week 1 %, Week 2 %, Week 3 %, Week 4 %]
  let week1Retention = 'N/A';
  let week1RetentionDate = 'N/A';
  const dataRows = retentionTable.filter(row => {
    // Skip header rows (first cell is "START DATE" or similar)
    return row.length > 1 && !/start\s*date/i.test(row[0]);
  });

  // Walk rows from most recent to oldest, find first row where week 1 is non-zero
  for (let i = dataRows.length - 1; i >= 0; i--) {
    const row = dataRows[i];
    const week1Cell = row[2] || ''; // index 2 = week 1 column (0-indexed after date col + week0 col)
    const pctMatch = week1Cell.match(/(\d+)%/);
    if (pctMatch && parseInt(pctMatch[1], 10) > 0) {
      week1Retention = week1Cell;
      week1RetentionDate = row[0];
      break;
    }
  }

  // ========== Build Report ==========
  console.log('\n→ Generating FAB report...\n');

  const report = {
    metadata: {
      generated: new Date().toISOString(),
      title: 'FAB (Floating Action Button) Report',
      data_sources: {
        fab_metrics: metricsFile,
        fab_retention: retentionFile
      }
    },
    summary: {
      saw_fab: sawFab,          // null if not captured by scraper
      opened_fab: openedFab,
      acted_fab: actedFab,
      open_rate: openRate,      // saw → opened (null if saw_fab not available)
      action_rate: actionRate,  // opened → acted
      week1_retention: week1Retention,
      week1_retention_date: week1RetentionDate
    },
    all_metrics: metrics,
    retention_table: retentionTable
  };

  // ========== Save Output ==========
  const jsonFile = `fab-report-${timestamp}.json`;
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
  console.log(`✓ Saved JSON: ${jsonFile}`);

  // ========== Print Summary ==========
  const summary = buildTextSummary(report);
  console.log('\n' + summary);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ FAB report generated successfully!');
  console.log('═══════════════════════════════════════════════════════════\n');
}

function buildTextSummary(report) {
  const s = report.summary;
  let text = '';

  text += '=======================================================================\n';
  text += '                    FAB (FLOATING ACTION BUTTON) REPORT\n';
  text += '=======================================================================\n';
  text += `Generated: ${new Date(report.metadata.generated).toLocaleString()}\n`;
  text += '=======================================================================\n\n';

  text += '-- KEY METRICS\n';
  text += `  ${'Unique Users Opened FAB (WoW R28):'.padEnd(40)} ${s.opened_fab}\n`;
  text += `  ${'Unique Users Acted on FAB (WoW R28):'.padEnd(40)} ${s.acted_fab}\n`;
  text += `  ${'Action Rate (Acted / Opened):'.padEnd(40)} ${s.action_rate}\n`;
  text += `  ${'Week 1 Retention (most recent complete):'.padEnd(40)} ${s.week1_retention}`;
  if (s.week1_retention_date && s.week1_retention_date !== 'N/A') {
    text += ` (week of ${s.week1_retention_date})`;
  }
  text += '\n\n';

  text += '-- ACTION RETENTION TABLE (R28)\n';
  if (report.retention_table && report.retention_table.length > 0) {
    report.retention_table.forEach(row => {
      text += '  ' + row.join(' | ') + '\n';
    });
  } else {
    text += '  (no retention data)\n';
  }
  text += '\n';

  text += '=======================================================================\n';

  return text;
}

function parseMetricsCSV(filename) {
  const fileContent = fs.readFileSync(filename, 'utf8');
  const records = csv.parse(fileContent, {
    skip_empty_lines: true,
    columns: ['metric', 'value']
  });

  const result = {};
  records.forEach(record => {
    if (record.metric && record.value && record.metric !== 'Metric') {
      result[record.metric] = record.value;
    }
  });

  return result;
}

function parseRetentionCSV(filename) {
  const fileContent = fs.readFileSync(filename, 'utf8');
  const records = csv.parse(fileContent, {
    skip_empty_lines: true,
    relax_column_count: true
  });
  return records;
}

function parseNumber(value) {
  if (!value || value === 'N/A') return null;

  const str = value.toString().toLowerCase().trim();

  // Handle percentages
  if (str.includes('%')) {
    return parseFloat(str.replace('%', ''));
  }

  // Handle K (thousands)
  if (str.endsWith('k')) {
    return parseFloat(str.replace('k', '')) * 1000;
  }

  // Handle M (millions)
  if (str.endsWith('m')) {
    return parseFloat(str.replace('m', '')) * 1000000;
  }

  // Remove commas and parse
  return parseFloat(str.replace(/,/g, '')) || null;
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
generateFabReport();
