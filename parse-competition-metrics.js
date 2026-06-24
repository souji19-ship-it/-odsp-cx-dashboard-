const fs = require('fs');
const csv = require('csv-parse/sync');

const filename = process.argv[2];
if (!filename) {
  console.error('Usage: node parse-competition-metrics.js <csv-file>');
  process.exit(1);
}

const data = csv.parse(fs.readFileSync(filename, 'utf8'), { relax_column_count: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

const metricRows = {
  'DAU': 2,
  'WAU': 3,
  'MAU': 4,
  'DAU/MAU': 5,
  'Extension-User Pairs': 6,
  'Weekly Return Rate': 21,
  '% Thumbs Down': 19
};
const allUpColumnIdx = 10;

const extractedMetrics = {};
for (const [metricName, rowIdx] of Object.entries(metricRows)) {
  if (rowIdx < data.length) {
    const row = data[rowIdx];
    const value = row[allUpColumnIdx] || 'N/A';
    extractedMetrics[metricName] = value.toString().replace(/\d{1,2}\/\d{1,2}\/\d{4}/, '').trim();
  }
}

let csvOutput = 'Metric,Value\n';
for (const [metric, value] of Object.entries(extractedMetrics)) {
  csvOutput += `"${metric}","${value}"\n`;
}

const outFile = `copilot-competition-summary-${timestamp}.csv`;
fs.writeFileSync(outFile, csvOutput);
console.log(`[INFO] Competition summary saved: ${outFile}`);
