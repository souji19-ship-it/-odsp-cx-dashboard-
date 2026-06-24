const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeCopilotExtensibility() {
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

    console.log('Waiting for table data to load...');
    await page.waitForTimeout(15000);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

    console.log('Extracting table data...\n');

    // Extract all tables
    const tables = await page.$$('table');
    console.log(`Found ${tables.length} table(s)\n`);

    const allData = {
      timestamp: new Date().toISOString(),
      url: dashboardUrl,
      summary_metrics: {},
      tables: []
    };

    // Extract each table
    for (let i = 0; i < tables.length; i++) {
      console.log(`Extracting table ${i + 1}...`);
      const tableData = await tables[i].evaluate((tableElement) => {
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

      if (tableData.length > 0) {
        const filename = `copilot-extensibility-table${i + 1}-${timestamp}.csv`;
        saveAsCSV(tableData, filename);
        console.log(`  ✓ ${filename} (${tableData.length} rows, ${tableData[0]?.length || 0} columns)`);

        allData.tables.push({
          index: i + 1,
          filename,
          rows: tableData.length,
          columns: tableData[0]?.length || 0,
          headers: tableData[0] || [],
          data: tableData
        });

        // Look for target metrics in headers
        const headers = tableData[0] || [];
        const targetMetrics = ['DAU', 'WAU', 'MAU', 'DAU/MAU', 'Extension', 'Thumbs'];

        console.log(`  Headers (${headers.length}):`);
        headers.forEach((header, idx) => {
          const isTarget = targetMetrics.some(metric =>
            header.toUpperCase().includes(metric.toUpperCase())
          );
          if (isTarget) {
            console.log(`    ✓ [${idx}] ${header}`);
          }
        });

        // Calculate summary statistics
        if (tableData.length > 1) {
          headers.forEach((header, colIdx) => {
            // Check if this is a target metric column
            if (header.toUpperCase().includes('DAU') ||
                header.toUpperCase().includes('WAU') ||
                header.toUpperCase().includes('MAU') ||
                header.toUpperCase().includes('EXTENSION') ||
                header.toUpperCase().includes('THUMBS')) {

              // Get all values in this column (skip header row)
              const values = tableData.slice(1).map(row => row[colIdx]).filter(v => v);

              if (values.length > 0) {
                // Store first non-header value as sample
                if (!allData.summary_metrics[header]) {
                  allData.summary_metrics[header] = values[0];
                }
              }
            }
          });
        }
      }
    }

    console.log('\n=== Summary Metrics Found ===');
    if (Object.keys(allData.summary_metrics).length > 0) {
      Object.entries(allData.summary_metrics).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    } else {
      console.log('  No summary metrics extracted yet - check table data');
    }

    // Save complete JSON
    const jsonFilename = `copilot-extensibility-complete-${timestamp}.json`;
    fs.writeFileSync(jsonFilename, JSON.stringify(allData, null, 2));
    console.log(`\n✓ Complete data: ${jsonFilename}`);

    // Save summary metrics CSV
    if (Object.keys(allData.summary_metrics).length > 0) {
      const metricsCSV = 'Metric,Value\n' +
        Object.entries(allData.summary_metrics)
          .map(([k, v]) => `"${k}","${v}"`)
          .join('\n');
      const metricsFilename = `copilot-extensibility-metrics-${timestamp}.csv`;
      fs.writeFileSync(metricsFilename, metricsCSV);
      console.log(`✓ Summary metrics: ${metricsFilename}`);
    }

    // Screenshot
    await page.screenshot({
      path: `copilot-extensibility-${timestamp}.png`,
      fullPage: true,
      timeout: 60000
    });
    console.log(`✓ Screenshot: copilot-extensibility-${timestamp}.png`);

    console.log('\n✅ Copilot Extensibility data extracted!\n');

    // Print file summary
    console.log('=== Files Created ===');
    allData.tables.forEach(table => {
      console.log(`  ${table.filename}`);
    });
    console.log(`  ${jsonFilename}`);
    if (Object.keys(allData.summary_metrics).length > 0) {
      console.log(`  copilot-extensibility-metrics-${timestamp}.csv`);
    }
    console.log(`  copilot-extensibility-${timestamp}.png`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
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

scrapeCopilotExtensibility();
