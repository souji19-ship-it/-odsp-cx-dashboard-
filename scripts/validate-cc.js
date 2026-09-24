// Validates the inline <script> blocks of an HTML file by parsing each for syntax errors.
// Usage: node scripts/validate-cc.js [path-to-html]   (defaults to the Command Center file)
// Exits non-zero if any inline script has a syntax error, so it can gate the hourly/EOD jobs.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const target = process.argv[2] || path.join(ROOT, 'Data-Private', 'Data-Created', 'ODSP-AW-CC.html');

const html = fs.readFileSync(target, 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
let ok = true;
scripts.forEach((m, i) => {
  try { new Function(m[1]); }
  catch (e) { ok = false; console.error('Inline script #' + (i + 1) + ' SYNTAX ERROR: ' + e.message); }
});

if (ok) console.log('OK \u2014 ' + scripts.length + ' inline script(s) valid in ' + path.basename(target));
else { console.error('VALIDATION FAILED for ' + target); process.exit(1); }
