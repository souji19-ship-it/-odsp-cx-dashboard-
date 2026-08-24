#!/usr/bin/env python3
# Build the "Trends" tab for the 2P Weekly Pulse dashboard.
# 4 metrics x 2 agents (Cowork + Copilot Studio), each with all-up (101 level) solid line
# and ODSP footprint dashed line. Source-derived canonical arrays (build-2p-trends.py). No fabrication.
# SPARK / Scout excluded (no per-week feed).
import os, math

# week-ending labels (consistent with rest of dashboard)
WEEKLAB = ["Jul 11", "Jul 18", "Jul 25", "Aug 1", "Aug 8", "Aug 15"]

COWORK = {
    "Active Users":  {"odsp":[88488,84368,86811,92373,107182,107159], "allup":[218493,199330,201005,204013,220132,221960]},
    "Active Tenants":{"odsp":[11171,8382,8579,9346,10867,10997],       "allup":[20557,14714,15040,15507,16980,17356]},
    "Tasks":         {"odsp":[216402,207406,239748,227624,263945,285878], "allup":[1044106,985180,1069876,1064187,1150058,1217699]},
    "Tool Calls":    {"odsp":[2124966,1876324,2113159,2332460,2927589,3090304], "allup":[12970200,12751501,15768371,17077483,22210522,22404416]},
}
STUDIO = {
    "Active Users":  {"odsp":[12227,13115,15585,16927,30257,24997], "allup":[40090,49392,56257,56681,76185,80378]},
    "Active Tenants":{"odsp":[3977,4282,4632,4888,7124,7068],       "allup":[9894,11371,10452,11351,15142,16939]},
    "Tasks":         {"odsp":[99795,135821,145148,217917,225802,203294], "allup":[713468,832592,1085293,2114293,2329336,2162976]},
    "Tool Calls":    {"odsp":[166895,202634,116929,145954,184031,209659], "allup":[3629388,3525222,5315625,7997052,7857160,7959753]},
}

METRICS = ["Active Users", "Active Tenants", "Tasks", "Tool Calls"]

# geometry
VBW, VBH = 640, 344
X0, X1 = 66, 560
YTOP, YBASE = 26, 280
N = len(WEEKLAB)
XS = [X0 + i*(X1-X0)/(N-1) for i in range(N)]

def fmt(v):
    if v >= 1_000_000: return f"{v/1_000_000:.1f}M"
    if v >= 1_000: return f"{v/1_000:.0f}K"
    return f"{v:.0f}"

def nice_max(m):
    if m <= 0: return 1.0
    exp = math.floor(math.log10(m))
    base = 10**exp
    for mult in (1,1.25,1.5,2,2.5,3,4,5,10):
        if base*mult >= m: return base*mult
    return base*10

def ymap(v, ymax):
    return YBASE - (v/ymax)*(YBASE-YTOP)

def series_svg(vals, ymax, cls, dashed):
    pts = " ".join(f"{XS[i]:.1f},{ymap(vals[i],ymax):.1f}" for i in range(N))
    dash = ' stroke-dasharray="6 5"' if dashed else ''
    dcls = f"{cls} dash" if dashed else cls
    dots = "".join(f'<circle cx="{XS[i]:.1f}" cy="{ymap(vals[i],ymax):.1f}" r="3.4" class="d {dcls}"/>' for i in range(N))
    return f'<polyline class="ln {dcls}" points="{pts}"{dash}/>{dots}'

def chart(metric):
    series = [
        ("Cowork all-up",        COWORK[metric]["allup"], "cw", False),
        ("ODSP in Cowork",       COWORK[metric]["odsp"],  "cw", True),
        ("Copilot Studio all-up",STUDIO[metric]["allup"], "cs", False),
        ("ODSP in Copilot Studio",STUDIO[metric]["odsp"], "cs", True),
    ]
    mx = max(max(s[1]) for s in series)
    ymax = nice_max(mx)
    # gridlines
    grid = ""
    for k in range(5):
        gv = ymax*k/4; gy = ymap(gv, ymax)
        grid += f'<line class="g" x1="{X0}" y1="{gy:.1f}" x2="{X1}" y2="{gy:.1f}"/>'
        grid += f'<text class="gt" x="{X0-10}" y="{gy+4:.1f}" text-anchor="end">{fmt(gv)}</text>'
    axes = (f'<line class="ax" x1="{X0}" y1="{YTOP}" x2="{X0}" y2="{YBASE}"/>'
            f'<line class="ax" x1="{X0}" y1="{YBASE}" x2="{X1}" y2="{YBASE}"/>')
    hi = XS[-1]
    band = f'<rect class="hb" x="{hi-18:.1f}" y="{YTOP}" width="36" height="{YBASE-YTOP}"/>'
    xlab = ""
    for i,w in enumerate(WEEKLAB):
        cls = "xl latest" if i==N-1 else "xl"
        xlab += f'<text class="{cls}" x="{XS[i]:.1f}" y="{YBASE+20}" text-anchor="middle">{w}</text>'
    lines = "".join(series_svg(v, ymax, cls, dashed) for (_,v,cls,dashed) in series)
    # endpoint labels with collision avoidance (min vertical gap)
    labs = sorted(((ymap(v[-1], ymax), cls, dashed, fmt(v[-1])) for (_,v,cls,dashed) in series),
                  key=lambda t: t[0])
    GAP = 12.5
    placed = []
    for y, cls, dashed, txt in labs:
        py = y if not placed else max(y, placed[-1][0] + GAP)
        placed.append((py, cls, dashed, txt))
    endlab = ""
    for py, cls, dashed, txt in placed:
        op = "" if not dashed else ' opacity="0.85"'
        endlab += f'<text class="el {cls}{" dash" if dashed else ""}" x="{X1+6}" y="{py+3:.1f}"{op}>{txt}</text>'
    return (f'<svg viewBox="0 0 {VBW} {VBH}" role="img" aria-label="{metric} trend">'
            f'{band}{grid}{axes}{xlab}{lines}{endlab}</svg>')

def chips(metric):
    def g(arr): 
        a,b = arr[0], arr[-1]
        return f"{(b-a)/a*100:+.0f}%" if a else "n/a"
    cw = g(COWORK[metric]["odsp"]); cs = g(STUDIO[metric]["odsp"])
    def cls(x): return "up" if x.startswith("+") and x!="+0%" else ("down" if x.startswith("-") else "flat")
    return (f'<div class="tc-chips">'
            f'<span class="tc-chip {cls(cw)}"><b>Cowork ODSP</b> {cw} Jul&rarr;Aug</span>'
            f'<span class="tc-chip {cls(cs)}"><b>Studio ODSP</b> {cs} Jul&rarr;Aug</span></div>')

cards = ""
for m in METRICS:
    cards += (f'<div class="trend-card"><div class="tc-title">{m}</div>'
              f'<div class="tc-sub">Agent all-up &middot; ODSP footprint within &middot; weekly Jul 5 &ndash; Aug 15</div>'
              f'<div class="tc-chart">{chart(m)}</div>{chips(m)}</div>')

LEGEND = ('<div class="trends-legend">'
          '<span class="k"><i class="lg cw"></i>Cowork all-up</span>'
          '<span class="k"><i class="lg cw dash"></i>ODSP in Cowork</span>'
          '<span class="k"><i class="lg cs"></i>Copilot Studio all-up</span>'
          '<span class="k"><i class="lg cs dash"></i>ODSP in Copilot Studio</span></div>')

PANEL = f'''  <div class="tab-panel" id="tab-trends" hidden>
    <section class="section">
      <h2>Retained weekly trends</h2>
      <p class="period">6 weeks &middot; Jul 5 &ndash; Aug 15, 2026. Solid lines = agent all-up (101 level); dashed = ODSP (OneDrive/SharePoint) footprint within each agent. Scout &amp; Spark excluded (no per-week feed &mdash; no estimated points).</p>
      {LEGEND}
      <div class="trends-grid">
        {cards}
      </div>
    </section>
  </div><!-- /tab-trends -->'''

STYLE = '''/* Trends tab */
#tab-trends .trends-legend{display:flex;flex-wrap:wrap;gap:16px;margin:2px 0 16px}
#tab-trends .trends-legend .k{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--cp-text-muted)}
#tab-trends .lg{width:20px;height:3px;border-radius:2px;display:inline-block}
#tab-trends .lg.cw{background:#2f5bd0}
#tab-trends .lg.cs{background:#7c3aed}
#tab-trends .lg.cw.dash{background:repeating-linear-gradient(90deg,#8fb0ee 0 5px,transparent 5px 9px)}
#tab-trends .lg.cs.dash{background:repeating-linear-gradient(90deg,#c3a6f4 0 5px,transparent 5px 9px)}
#tab-trends .trends-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
@media (max-width:1200px){#tab-trends .trends-grid{grid-template-columns:1fr}}
#tab-trends .trend-card{background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:12px;padding:16px 18px 12px}
#tab-trends .tc-title{font-size:15px;font-weight:700;color:var(--cp-text)}
#tab-trends .tc-sub{font-size:12px;color:var(--cp-text-muted);margin:2px 0 8px}
#tab-trends .tc-chart{overflow-x:auto}
#tab-trends .tc-chart svg{width:100%;min-width:520px;height:auto;display:block}
#tab-trends .g{stroke:var(--cp-border);stroke-width:1;opacity:.7}
#tab-trends .ax{stroke:var(--cp-border);stroke-width:1.2}
#tab-trends .gt{fill:var(--cp-text-muted);font-size:11px}
#tab-trends .xl{fill:var(--cp-text-muted);font-size:11.5px}
#tab-trends .xl.latest{fill:var(--cp-text);font-weight:700}
#tab-trends .ln{fill:none;stroke-width:2.4}
#tab-trends .ln.cw{stroke:#2f5bd0} #tab-trends .ln.cs{stroke:#7c3aed}
#tab-trends .ln.cw.dash{stroke:#8fb0ee;stroke-width:2}
#tab-trends .ln.cs.dash{stroke:#c3a6f4;stroke-width:2}
#tab-trends .d{stroke:#fff;stroke-width:1}
#tab-trends .d.cw{fill:#2f5bd0} #tab-trends .d.cs{fill:#7c3aed}
#tab-trends .d.cw.dash{fill:#8fb0ee} #tab-trends .d.cs.dash{fill:#c3a6f4}
#tab-trends .hb{fill:#7c3aed;opacity:.06}
#tab-trends .el{font-size:11px;font-weight:700}
#tab-trends .el.cw{fill:#2f5bd0} #tab-trends .el.cs{fill:#7c3aed}
#tab-trends .el.dash{font-weight:600}
#tab-trends .el.cw.dash{fill:#6f92d8} #tab-trends .el.cs.dash{fill:#a98be6}
#tab-trends .tc-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
#tab-trends .tc-chip{font-size:11.5px;padding:4px 10px;border-radius:20px;background:var(--cp-surface-soft,#f0f1f3);color:var(--cp-text-muted)}
#tab-trends .tc-chip b{font-weight:700;color:var(--cp-text)}
#tab-trends .tc-chip.up{background:#e7f6ee;color:#1a7f4b} #tab-trends .tc-chip.up b{color:#1a7f4b}
#tab-trends .tc-chip.down{background:#fdeceb;color:#c0322b} #tab-trends .tc-chip.down b{color:#c0322b}'''

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "trends-tab-panel.html"), "w", encoding="utf-8") as fh:
    fh.write(PANEL)
with open(os.path.join(here, "trends-tab-style.css"), "w", encoding="utf-8") as fh:
    fh.write(STYLE)
print("===STYLE===")
print(STYLE)
print("===PANEL===")
print(PANEL)
