#!/usr/bin/env python3
# Build the two "Active Users - retained weekly" trend panels embedded on the MTD tab,
# one beside the 2P Scorecard section (ODSP-active users) and one beside the
# M365 ODSP-share section (M365 all-up active users).
# Data is the canonical 6-week Active Users series from build-2p-trends.py
# (source-derived from ODSP-AW-BWBR-2P-Pulse canonical odsp[]/allup[] arrays; no fabrication).
import math, os

WEEKS   = ["Jul 5-11","Jul 12-18","Jul 19-25","Jul 26-Aug 1","Aug 2-8","Aug 9-15"]
WEEKLAB = ["Jul 11","Jul 18","Jul 25","Aug 1","Aug 8","Aug 15"]

COWORK_ODSP  = [88488,84368,86811,92373,107182,107159]
STUDIO_ODSP  = [12227,13115,15585,16927,30257,24997]
COWORK_ALLUP = [218493,199330,201005,204013,220132,221960]
STUDIO_ALLUP = [40090,49392,56257,56681,76185,80378]

CW = "#2f5bd0"; CS = "#7c3aed"

VBW, VBH = 400, 262
X0, X1   = 48, 360
YTOP, YB = 20, 196
N = len(WEEKS)
XS = [X0 + i*(X1-X0)/(N-1) for i in range(N)]

def fmt(v):
    if v >= 1_000_000: return f"{v/1_000_000:.1f}M"
    if v >= 1_000:     return f"{v/1_000:.0f}K"
    return f"{v:.0f}"

def nice_max(m):
    exp = math.floor(math.log10(m)); base = 10**exp
    for mult in (1,1.25,1.5,2,2.5,3,4,5,10):
        if base*mult >= m: return base*mult
    return base*10

def ymap(v, ymax): return YB - (v/ymax)*(YB-YTOP)

def series_svg(vals, ymax, cls):
    pts = " ".join(f"{XS[i]:.1f},{ymap(vals[i],ymax):.1f}" for i in range(N))
    area = f"{X0:.1f},{YB:.1f} " + pts + f" {X1:.1f},{YB:.1f}"
    dots = "".join(f'<circle cx="{XS[i]:.1f}" cy="{ymap(vals[i],ymax):.1f}" r="3" class="d {cls}"/>' for i in range(N))
    return (f'<polygon class="ar {cls}" points="{area}"/>'
            f'<polyline class="ln {cls}" points="{pts}"/>{dots}')

def endlab(vals, ymax, cls):
    y = ymap(vals[-1], ymax)
    return f'<text class="el {cls}" x="{X1+6}" y="{y+3:.1f}">{fmt(vals[-1])}</text>'

def chart(cowork, studio):
    ymax = nice_max(max(max(cowork), max(studio)))
    grid = ""
    for k in range(5):
        gv = ymax*k/4; gy = ymap(gv, ymax)
        grid += f'<line class="g" x1="{X0}" y1="{gy:.1f}" x2="{X1}" y2="{gy:.1f}"/>'
        grid += f'<text class="gt" x="{X0-6}" y="{gy+3:.1f}" text-anchor="end">{fmt(gv)}</text>'
    band = f'<rect class="hb" x="{XS[-1]-16:.1f}" y="{YTOP}" width="32" height="{YB-YTOP}"/>'
    xlab = "".join(
        f'<text class="{"xl latest" if i==N-1 else "xl"}" x="{XS[i]:.1f}" y="{YB+16}" text-anchor="middle">{WEEKLAB[i]}</text>'
        for i in range(N))
    body = (series_svg(cowork, ymax, "cw") + series_svg(studio, ymax, "cs")
            + endlab(cowork, ymax, "cw") + endlab(studio, ymax, "cs"))
    axes = (f'<line class="ax" x1="{X0}" y1="{YTOP}" x2="{X0}" y2="{YB}"/>'
            f'<line class="ax" x1="{X0}" y1="{YB}" x2="{X1}" y2="{YB}"/>')
    return (f'<svg viewBox="0 0 {VBW} {VBH}" role="img" aria-label="Active users weekly trend">'
            f'{band}{grid}{axes}{xlab}{body}</svg>')

def growth(vals): return (vals[-1]-vals[0])/vals[0]*100

def panel(kind):
    if kind == "odsp":
        cw, cs = COWORK_ODSP, STUDIO_ODSP
        title = "ODSP-active users"
        sub   = "2P footprint &middot; retained weekly &middot; Jul 5 &ndash; Aug 15"
        cwlab, cslab = "Cowork", "Copilot Studio"
    else:
        cw, cs = COWORK_ALLUP, STUDIO_ALLUP
        title = "M365 all-up active users"
        sub   = "Agent all-up &middot; retained weekly &middot; Jul 5 &ndash; Aug 15"
        cwlab, cslab = "Cowork", "Copilot Studio"
    svg = chart(cw, cs)
    leg = (f'<div class="tp-legend"><span class="k"><i class="sw cw"></i>{cwlab}</span>'
           f'<span class="k"><i class="sw cs"></i>{cslab}</span></div>')
    def chip(lab, vals, cls):
        g = growth(vals); dirn = "up" if g >= 0 else "down"
        return f'<span class="tp-chip {dirn}"><b>{lab}</b> {g:+.0f}% Jul&rarr;Aug</span>'
    chips = f'<div class="tp-chips">{chip(cwlab, cw, "cw")}{chip(cslab, cs, "cs")}</div>'
    return (f'<aside class="trend-panel">'
            f'<div class="tp-title">{title}</div>'
            f'<div class="tp-sub">{sub}</div>'
            f'{leg}<div class="tp-chart">{svg}</div>{chips}</aside>')

out = os.path.join(os.path.dirname(__file__), "mtd-activeusers-panels.html")
with open(out, "w", encoding="utf-8") as fh:
    fh.write("<!-- ODSP panel (2P Scorecard section) -->\n")
    fh.write(panel("odsp") + "\n\n")
    fh.write("<!-- ALLUP panel (M365 share section) -->\n")
    fh.write(panel("allup") + "\n")
print("WROTE", out)
print("\n===ODSP===\n" + panel("odsp"))
print("\n===ALLUP===\n" + panel("allup"))
