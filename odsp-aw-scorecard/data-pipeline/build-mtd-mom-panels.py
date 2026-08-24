#!/usr/bin/env python3
# Build MoM (July vs August MTD) grouped-bar panels for the MTD tab, replacing the
# weekly line trend panels. Values match the MTD scorecard cards. No fabrication.
import os, math

# geometry (same panel frame as weekly trend panels)
X0, X1 = 48, 360
YTOP, YBASE = 20, 196
G1C, G2C = 126, 282
BW, GAP = 46, 10

def nice_max(m):
    if m <= 0: return 1.0
    exp = math.floor(math.log10(m)); base = 10**exp
    for mult in (1,1.25,1.5,2,2.5,3,4,5,10):
        if base*mult >= m: return base*mult
    return base*10

def fmt_grid(v, unit):
    if unit == "pct": return f"{v:.0f}%"
    if v >= 1_000_000: return f"{v/1_000_000:.1f}M"
    if v >= 1_000: return f"{v/1_000:.0f}K"
    return f"{v:.0f}"

def fmt_val(v, unit):
    if unit == "pct": return f"{v:.0f}%"
    if v >= 1_000_000: return f"{v/1_000_000:.2f}M"
    if v >= 1_000: return f"{v/1_000:.1f}K"
    return f"{v:.0f}"

def ymap(v, ymax): return YBASE - (v/ymax)*(YBASE-YTOP)

def panel(title, sub, unit, cw, cs, chips, aria):
    # cw/cs = (jul, aug)
    mx = max(cw[1], cw[0], cs[1], cs[0])
    ymax = 50.0 if unit == "pct" else nice_max(mx)
    # gridlines
    grid = ""
    for k in range(5):
        gv = ymax*k/4; gy = ymap(gv, ymax)
        grid += f'<line class="g" x1="{X0}" y1="{gy:.1f}" x2="{X1}" y2="{gy:.1f}"/>'
        grid += f'<text class="gt" x="42" y="{gy+3:.1f}" text-anchor="end">{fmt_grid(gv,unit)}</text>'
    axes = (f'<line class="ax" x1="{X0}" y1="{YTOP}" x2="{X0}" y2="{YBASE}"/>'
            f'<line class="ax" x1="{X0}" y1="{YBASE}" x2="{X1}" y2="{YBASE}"/>')
    def group(center, agent, jul, aug):
        jx = center - (BW + GAP/2); ax = center + GAP/2
        out = ""
        for x, v, mo in ((jx, jul, "jul"), (ax, aug, "aug")):
            top = ymap(v, ymax); h = YBASE - top
            cls = f"{agent} jul" if mo == "jul" else agent
            out += f'<rect class="bar {cls}" x="{x:.1f}" y="{top:.1f}" width="{BW}" height="{h:.1f}" rx="3"/>'
            out += f'<text class="blab {agent}" x="{x+BW/2:.1f}" y="{top-4:.1f}" text-anchor="middle">{fmt_val(v,unit)}</text>'
        out += f'<text class="mlab" x="{jx+BW/2:.1f}" y="209" text-anchor="middle">July</text>'
        out += f'<text class="mlab" x="{ax+BW/2:.1f}" y="209" text-anchor="middle">Aug MTD</text>'
        name = "Cowork" if agent == "cw" else "Copilot Studio"
        out += f'<text class="glab" x="{center:.1f}" y="228" text-anchor="middle">{name}</text>'
        return out
    bars = group(G1C, "cw", cw[0], cw[1]) + group(G2C, "cs", cs[0], cs[1])
    svg = (f'<svg viewBox="0 0 400 262" role="img" aria-label="{aria}">'
           f'{grid}{axes}{bars}</svg>')
    legend = ('<div class="tp-legend"><span class="k"><i class="sw cw"></i>Cowork</span>'
              '<span class="k"><i class="sw cs"></i>Copilot Studio</span>'
              '<span class="k"><i class="sw mo-jul"></i>July</span>'
              '<span class="k"><i class="sw mo-aug"></i>Aug MTD</span></div>')
    chipshtml = '<div class="tp-chips">' + "".join(
        f'<span class="tp-chip {c[2]}"><b>{c[0]}</b> {c[1]}</span>' for c in chips) + '</div>'
    return (f'<aside class="trend-panel"><div class="tp-title">{title}</div>'
            f'<div class="tp-sub">{sub}</div>{legend}'
            f'<div class="tp-chart">{svg}</div>{chipshtml}</aside>')

# Panel 1: ODSP-active users MoM (matches 2P Scorecard cards)
p_users = panel(
    "ODSP-active users",
    "2P footprint &middot; July vs August MTD",
    "count",
    cw=(92400, 113870), cs=(17000, 61500),
    chips=[("Cowork","+23% Jul&rarr;Aug","up"), ("Copilot Studio","+261% Jul&rarr;Aug","up")],
    aria="ODSP-active users July vs August MTD")

# Panel 2: ODSP share of M365 active users MoM (matches M365 share donuts)
p_share = panel(
    "ODSP share of M365 active users",
    "ODSP-active &divide; agent all-up &middot; July vs August MTD",
    "pct",
    cw=(43, 48), cs=(30, 32),
    chips=[("Cowork","+5.7 pp Jul&rarr;Aug","up"), ("Copilot Studio","+1.9 pp Jul&rarr;Aug","up")],
    aria="ODSP share of M365 active users July vs August MTD")

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "mtd-mom-panels.html"), "w", encoding="utf-8") as fh:
    fh.write("===USERS===\n"+p_users+"\n===SHARE===\n"+p_share)
print("===USERS===")
print(p_users)
print("===SHARE===")
print(p_share)
