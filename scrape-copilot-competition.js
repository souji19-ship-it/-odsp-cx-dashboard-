const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeCopilotCompetition() {
  try {
    console.log('Connecting to Edge...\n');
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    const context = contexts[0];
    const pages = context.pages();
    const page = pages[0] || await context.newPage();

    const dashboardUrl = 'https://askideas.microsoft.net/dashboard/CopilotExtensibilityDashboard/copilotCommercial';

    console.log('Navigating to Copilot Extensibility Dashboard...');
    await page.goto(dashboardUrl, { waitUntil: 'networkidle', timeout: 60000 });

    console.log('Waiting for data to load...');
    await page.waitForTimeout(10000); // Give dashboard time to load

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

    console.log('Extracting competition metrics...\n');

    // Extract all metrics from the page
    const metrics = await page.evaluate(() => {
      const results = {};
      const allElements = document.querySelectorAll('*');

      // Look for metric cards and values
      allElements.forEach(el => {
        const text = el.textContent?.trim();

        // Match metric values (numbers with k/M suffix, percentages, ratios)
        if (/^[-+]?[\d,\.]+[kKmM]?%?$/.test(text) && text.length < 20) {
          let context = '';

          // Look for context in previous siblings
          let prev = el.previousElementSibling;
          let attempts = 0;
          while (prev && !context && attempts < 3) {
            const prevText = prev.textContent?.trim();
            if (prevText && prevText.length < 100 && prevText.length > 2 && prevText !== text) {
              context = prevText;
              break;
            }
            prev = prev.previousElementSibling;
            attempts++;
          }

          // Try parent's previous sibling
          if (!context) {
            const parent = el.parentElement;
            const parentPrev = parent?.previousElementSibling;
            if (parentPrev) {
              const ppText = parentPrev.textContent?.trim();
              if (ppText && ppText.length < 100 && ppText !== text) {
                context = ppText;
              }
            }
          }

          // Try parent's text
          if (!context) {
            const parent = el.parentElement;
            const parentText = parent?.textContent?.trim();
            if (parentText && parentText.length < 100 && parentText !== text) {
              context = parentText.split(text)[0].trim();
            }
          }

          if (context && !results[context]) {
            results[context] = text;
          }
        }
      });

      return results;
    });

    console.log('=== All Metrics Found ===\n');
    Object.entries(metrics)
      .filter(([k]) => k.length < 80)
      .forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });

    // Look for specific metrics
    const targetMetrics = {
      'DAU': null,
      'WAU': null,
      'MAU': null,
      'DAU/MAU': null,
      'Extension-User Pairs': null,
      '% Thumbs Down': null,
      'Thumbs Down %': null,
      '% Thumbs that are down': null
    };

    // Search for target metrics in extracted data
    for (const [key, value] of Object.entries(metrics)) {
      const lowerKey = key.toLowerCase();

      if (lowerKey.includes('dau/mau') || lowerKey.includes('dau / mau')) {
        targetMetrics['DAU/MAU'] = value;
      } else if (lowerKey.includes('dau') && !lowerKey.includes('mau')) {
        targetMetrics['DAU'] = value;
      } else if (lowerKey.includes('wau')) {
        targetMetrics['WAU'] = value;
      } else if (lowerKey.includes('mau') && !lowerKey.includes('dau')) {
        targetMetrics['MAU'] = value;
      } else if (lowerKey.includes('extension') && lowerKey.includes('user')) {
        targetMetrics['Extension-User Pairs'] = value;
      } else if (lowerKey.includes('thumbs') && (lowerKey.includes('down') || lowerKey.includes('%'))) {
        targetMetrics['% Thumbs Down'] = value;
      }
    }

    console.log('\n=== Target Metrics ===\n');
    let foundCount = 0;
    for (const [key, value] of Object.entries(targetMetrics)) {
      if (value) {
        console.log(`  ✓ ${key}: ${value}`);
        foundCount++;
      } else {
        console.log(`  ✗ ${key}: NOT FOUND`);
      }
    }

    console.log(`\nFound ${foundCount} of 6 target metrics\n`);

    // Extract tables
    const tables = await page.$$('table');
    console.log(`=== Found ${tables.length} table(s) ===\n`);

    const allData = {
      timestamp: new Date().toISOString(),
      url: dashboardUrl,
      target_metrics: targetMetrics,
      all_metrics: metrics,
      tables: []
    };

    for (let i = 0; i < tables.length; i++) {
      const tableData = await extractTableData(tables[i]);
      if (tableData.length > 0) {
        const filename = `copilot-competition-table${i + 1}-${timestamp}.csv`;
        saveAsCSV(tableData, filename);
        console.log(`✓ Table ${i + 1}: ${filename} (${tableData.length} rows)`);
        allData.tables.push({
          filename,
          rows: tableData.length,
          data: tableData
        });
      }
    }

    // Save complete JSON
    const jsonFilename = `copilot-competition-${timestamp}.json`;
    fs.writeFileSync(jsonFilename, JSON.stringify(allData, null, 2));
    console.log(`\n✓ Complete data: ${jsonFilename}`);

    // Save target metrics CSV
    const targetMetricsCSV = 'Metric,Value\n' +
      Object.entries(targetMetrics)
        .map(([k, v]) => `"${k}","${v || 'NOT FOUND'}"`)
        .join('\n');
    const metricsFilename = `copilot-competition-metrics-${timestamp}.csv`;
    fs.writeFileSync(metricsFilename, targetMetricsCSV);
    console.log(`✓ Target metrics: ${metricsFilename}`);

    // Save all metrics CSV
    const allMetricsCSV = 'Metric,Value\n' +
      Object.entries(metrics)
        .filter(([k]) => k.length < 80)
        .map(([k, v]) => `"${k}","${v}"`)
        .join('\n');
    const allMetricsFilename = `copilot-competition-all-metrics-${timestamp}.csv`;
    fs.writeFileSync(allMetricsFilename, allMetricsCSV);
    console.log(`✓ All metrics: ${allMetricsFilename}`);

    // Screenshot
    await page.screenshot({ path: `copilot-competition-${timestamp}.png`, fullPage: true });
    console.log(`✓ Screenshot: copilot-competition-${timestamp}.png`);

    console.log('\n✅ Competition metrics scraped!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

async function extractTableData(table) {
  return await table.evaluate((tableElement) => {
    const rows = [];
    const rowElements = tableElement.querySelectorAll('tr');

    rowElements.forEach((row) => {
      const cells = [];
      const cellElements = row.querySelectorAll('td, th');

      cellElements.forEach((cell) => {
        cells.push(cell.textContent.trim());
      });

      if (cells.length > 0) {
        rows.push(cells);
      }
    });

    return rows;
  });
}

function saveAsCSV(data, filename) {
  const csvContent = data
    .map(row =>
      row.map(cell => {
        const cellStr = String(cell);
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',')
    )
    .join('\n');
  fs.writeFileSync(filename, csvContent, 'utf8');
}

scrapeCopilotCompetition();
