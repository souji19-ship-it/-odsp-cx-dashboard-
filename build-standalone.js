'use strict';
const fs   = require('fs');
const path = require('path');

const dir = __dirname;

const chartJs     = fs.readFileSync(path.join(dir, 'chart.umd.min.js'), 'utf8');
const datalabels  = fs.readFileSync(path.join(dir, 'chartjs-plugin-datalabels.min.js'), 'utf8');
const dataJson    = fs.readFileSync(path.join(dir, 'dashboard-data.json'), 'utf8');
const dashHtml    = fs.readFileSync(path.join(dir, 'dashboard.html'), 'utf8');

// Pull custom CSS from the <style> block in head
const customCss   = dashHtml.match(/<style>([\s\S]*?)<\/style>/)[1];

// Pull the body's HTML content (everything between <body...> and the final <script>)
const bodyRaw     = dashHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
const splitAt     = bodyRaw.lastIndexOf('\n<script>');
const bodyHtml    = bodyRaw.slice(0, splitAt);
const appScript   = bodyRaw.match(/<script>([\s\S]*?)<\/script>\s*$/)[1];

const tailwindCSS = `
*,*::before,*::after{box-sizing:border-box}
/* Layout */
.flex{display:flex}.flex-col{flex-direction:column}
.flex-1{flex:1 1 0%;min-width:0;min-height:0}
.h-screen{height:100vh}.overflow-hidden{overflow:hidden}
.overflow-y-auto{overflow-y:auto}.shrink-0{flex-shrink:0}
.items-center{align-items:center}.justify-center{justify-content:center}
.justify-between{justify-content:space-between}.ml-auto{margin-left:auto}
/* Grid */
.grid{display:grid}
.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.grid-cols-5{grid-template-columns:repeat(5,minmax(0,1fr))}
.grid-cols-6{grid-template-columns:repeat(6,minmax(0,1fr))}
/* Gap */
.gap-2{gap:0.5rem}.gap-2\\.5{gap:0.625rem}.gap-4{gap:1rem}
/* Padding */
.p-3{padding:0.75rem}.p-4{padding:1rem}.p-5{padding:1.25rem}
.px-3{padding-left:0.75rem;padding-right:0.75rem}
.px-5{padding-left:1.25rem;padding-right:1.25rem}
.px-6{padding-left:1.5rem;padding-right:1.5rem}
.py-5{padding-top:1.25rem;padding-bottom:1.25rem}
/* Margin */
.mb-0\\.5{margin-bottom:0.125rem}.mb-2{margin-bottom:0.5rem}
.mb-3{margin-bottom:0.75rem}.mb-4{margin-bottom:1rem}
.mt-1{margin-top:0.25rem}.mt-1\\.5{margin-top:0.375rem}
.mt-2{margin-top:0.5rem}.mt-3{margin-top:0.75rem}.mt-4{margin-top:1rem}
/* Typography */
.text-xs{font-size:0.75rem;line-height:1rem}
.text-sm{font-size:0.875rem;line-height:1.25rem}
.text-xl{font-size:1.25rem;line-height:1.75rem}
.font-medium{font-weight:500}.font-semibold{font-weight:600}
.font-bold{font-weight:700}
.uppercase{text-transform:uppercase}.tracking-widest{letter-spacing:0.1em}
/* Colors */
.bg-slate-100{background-color:#f1f5f9}.bg-slate-900{background-color:#0f172a}
.bg-white{background-color:#fff}
.text-white{color:#fff}.text-slate-400{color:#94a3b8}
.text-slate-500{color:#64748b}.text-slate-600{color:#475569}
.text-slate-700{color:#334155}.text-slate-800{color:#1e293b}
/* Borders */
.border-b{border-bottom:1px solid}.border-t{border-top:1px solid}
.border-slate-200{border-color:#e2e8f0}.border-slate-700{border-color:#334155}
.rounded-md{border-radius:0.375rem}.rounded-sm{border-radius:0.125rem}
/* Space-y */
.space-y-1\\.5>*+*{margin-top:0.375rem}
.space-y-3>*+*{margin-top:0.75rem}
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI in SharePoint \u2014 Growth Dashboard</title>
  <style>${tailwindCSS}${customCss}</style>
</head>
<body class="bg-slate-100 overflow-hidden" style="height:100vh">
${bodyHtml}
<script>${chartJs}</script>
<script>${datalabels}</script>
<script>window.DASHBOARD_DATA = ${dataJson};</script>
<script>${appScript}</script>
</body>
</html>`;

fs.writeFileSync(path.join(dir, 'dashboard-sharepoint.html'), html, 'utf8');
const kb = Math.round(fs.statSync(path.join(dir, 'dashboard-sharepoint.html')).size / 1024);
console.log(`\u2705 dashboard-sharepoint.html written (${kb} KB, fully self-contained)`);
