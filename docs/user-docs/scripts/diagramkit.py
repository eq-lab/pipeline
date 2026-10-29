"""
Small SVG kit for the Pipeline docs diagrams. One visual system for every diagram:
palette from assets/css/main.css, one type scale, one box and arrow style.

Text is measured with Helvetica Neue (the renderer's face) so boxes are sized to their
labels and overflow is caught at build time, not by eye.
"""

import re
from html import escape
from PIL import ImageFont

FONT_FILE = "/System/Library/Fonts/HelveticaNeue.ttc"
FAMILY = "Graphik LC, Inter, Helvetica Neue, Helvetica, Arial, sans-serif"

# Palette (assets/css/main.css)
INK = "#262524"        # --content-primary
INK2 = "#5c5a57"       # secondary text, 6.6:1 on white
LINE = "#4a4845"       # arrows
HAIR = "#d5d4d3"       # --border-strong
NAVY = "#000080"       # --content-brand
NAVY_T = "#eef0f8"     # on-chain fill
NAVY_R = "#f6f7fb"     # on-chain region
NAVY_S = "#9a9ccc"     # on-chain region stroke
WARM_T = "#f4f3f1"     # off-chain fill
WARM_R = "#f9f8f7"     # off-chain region
WARM_S = "#c9c7c4"     # off-chain stroke
SAGE = "#2f6b3a"
SAGE_T = "#eef4ef"
AMBER = "#8a6407"      # --color-amber darkened for text contrast
AMBER_L = "#b9870a"    # --color-amber
AMBER_T = "#faf4e4"
ROSE = "#b1334b"
ROSE_T = "#f9eef0"
WHITE = "#ffffff"

# Type scale
T_TITLE = 15.5   # box title, bold
T_SUB = 13       # box body
T_LABEL = 13     # arrow label
T_REGION = 12    # region label, bold caps
T_NOTE = 13      # footnote

KINDS = {
    # fill, stroke, title colour, stroke width, dash
    "chain":   (NAVY_T, NAVY, NAVY, 1.25, None),
    "off":     (WARM_T, WARM_S, INK, 1.25, None),
    "actor":   (WHITE, "#8f8c88", INK, 1.25, None),
    "role":    (WHITE, "#8f8c88", INK, 1.25, None),
    "ok":      (SAGE_T, SAGE, SAGE, 1.25, None),
    "warn":    (AMBER_T, AMBER_L, AMBER, 1.25, None),
    "risk":    (ROSE_T, ROSE, ROSE, 1.25, None),
    "plain":   (WHITE, HAIR, INK, 1.25, None),
    "ghost":   (WHITE, WARM_S, INK, 1.25, "4 3"),
}

_fonts = {}


def tw(s, size, bold=False, spacing=0.0):
    """Rendered width of s, with 3 % slack for fallback faces."""
    k = (bold,)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype(FONT_FILE, 200, index=1 if bold else 0)
    return _fonts[k].getlength(s) * size / 200 * 1.03 + spacing * size * max(len(s) - 1, 0)


def wrap(s, size, maxw, bold=False):
    s = re.sub(r"(\d) (h|%|USDC|hours|days)(?!\w)", "\\1\u00a0\\2", s)
    s = re.sub(r"(>|<|≤|≥|=|×|÷) (\d)", "\\1\u00a0\\2", s)
    out = []
    for para in s.split("\n"):
        words, line = para.split(" "), ""
        for w in words:
            cand = (line + " " + w).strip()
            if tw(cand, size, bold) <= maxw or not line:
                line = cand
            else:
                out.append(line)
                line = w
        out.append(line)
    for l in out:
        if tw(l, size, bold) > maxw + 0.5:
            raise ValueError(f"word too long for {maxw:.0f}px: {l!r}")
    return out


class Diagram:
    def __init__(self, name, w, h, label):
        self.name, self.w, self.h, self.label = name, w, h, label
        self.body = []
        self.texts = []       # (x0, y0, x1, y1, s) for overlap checks
        self.markers = set()
        self.problems = []

    # ---------- primitives ----------
    def raw(self, s):
        self.body.append(s)

    def text(self, x, y, s, size=T_SUB, bold=False, color=INK, anchor="start",
             spacing=0.0, halo=False, italic=False, check=True):
        w = tw(s, size, bold, spacing)
        x0 = {"start": x, "middle": x - w / 2, "end": x - w}[anchor]
        if check:
            self.texts.append((x0, y - size * 0.74, x0 + w, y + size * 0.22, s))
        attrs = [f'x="{x:.1f}"', f'y="{y:.1f}"', f'font-size="{size}"', f'fill="{color}"']
        if bold:
            attrs.append('font-weight="600"')
        if italic:
            attrs.append('font-style="italic"')
        if anchor != "start":
            attrs.append(f'text-anchor="{anchor}"')
        if spacing:
            attrs.append(f'letter-spacing="{spacing * size:.2f}"')
        if halo:
            attrs.append('stroke="#ffffff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"')
        self.raw(f'<text {" ".join(attrs)}>{escape(s)}</text>')
        return w

    def lines(self, x, y, lines, size=T_SUB, lh=None, **kw):
        lh = lh or round(size * 1.38, 1)
        for i, l in enumerate(lines):
            self.text(x, y + i * lh, l, size=size, **kw)
        return y + (len(lines) - 1) * lh

    def para(self, x, y, s, maxw, size=T_NOTE, color=INK2, anchor="start", **kw):
        ls = wrap(s, size, maxw, kw.get("bold", False))
        return self.lines(x, y, ls, size=size, color=color, anchor=anchor, **kw), len(ls)

    def rect(self, x, y, w, h, fill=WHITE, stroke=HAIR, sw=1.25, rx=6, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.raw(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" '
                 f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    # ---------- components ----------
    def region(self, x, y, w, h, label, kind="chain", sub=None, right=False):
        fill, stroke, col = {
            "chain": (NAVY_R, NAVY_S, NAVY),
            "off": (WARM_R, WARM_S, INK2),
            "risk": ("#fdf8f9", "#dfb3bc", ROSE),
            "warn": ("#fdfaf2", "#e3cf9c", AMBER),
            "ok": ("#f7faf7", "#b5cdb9", SAGE),
        }[kind]
        self.rect(x, y, w, h, fill=fill, stroke=stroke, sw=1, rx=10)
        if right:
            self.text(x + w - 16, y + 24, label.upper(), size=T_REGION, bold=True, color=col, spacing=0.07,
                      anchor="end")
            if sub:
                self.text(x + w - 16, y + 42, sub, size=12.5, color=INK2, anchor="end")
        else:
            self.text(x + 16, y + 24, label.upper(), size=T_REGION, bold=True, color=col, spacing=0.07)
            if sub:
                self.text(x + 16, y + 42, sub, size=12.5, color=INK2)

    def box(self, x, y, w, h, title, sub=None, kind="chain", align="left", badge=None,
            title_size=T_TITLE, sub_size=T_SUB, pad=12, tag=None, valign="middle", inline=False):
        fill, stroke, tcol, sw, dash = KINDS[kind]
        self.rect(x, y, w, h, fill=fill, stroke=stroke, sw=sw, dash=dash)
        if inline:
            bl = y + h / 2 + title_size * 0.36
            tw_ = self.text(x + pad, bl, title, size=title_size, bold=True, color=tcol)
            if sub:
                if tw_ + 12 + tw(sub, sub_size) > w - 2 * pad:
                    self.problems.append(f"inline box '{title}' too narrow")
                self.text(x + pad + tw_ + 12, bl, sub, size=sub_size, color=INK2)
            return dict(x=x, y=y, w=w, h=h, cx=x + w / 2, cy=y + h / 2, r=x + w, b=y + h)
        inner_x = x + pad
        inner_w = w - 2 * pad
        if badge is not None:
            bcol = {"chain": NAVY, "risk": ROSE, "ok": SAGE, "warn": AMBER_L}.get(kind, INK)
            self.badge(x + pad + 11, y + h / 2 if valign == "middle" else y + pad + 11, badge, bcol)
            inner_x += 30
            inner_w -= 30
        tl = wrap(title, title_size, inner_w, bold=True)
        sl = wrap(sub, sub_size, inner_w) if sub else []
        tlh, slh = round(title_size * 1.25, 1), round(sub_size * 1.38, 1)
        block = len(tl) * tlh + (6 if sl else 0) + len(sl) * slh
        tag_h = 0
        if tag:
            tag_h = 26
            block += tag_h
        if block > h - 2 * pad + 6:
            self.problems.append(f"box '{title}' needs {block:.0f}px, has {h - 2 * pad}")
        top = y + (h - block) / 2 if valign == "middle" else y + pad
        cx = x + w / 2
        tx = cx if align == "center" else inner_x
        anchor = "middle" if align == "center" else "start"
        yy = top + title_size * 0.9
        for l in tl:
            self.text(tx, yy, l, size=title_size, bold=True, color=tcol, anchor=anchor)
            yy += tlh
        yy += (6 if sl else 0) - tlh + slh
        for l in sl:
            self.text(tx, yy, l, size=sub_size, color=INK2, anchor=anchor)
            yy += slh
        if tag:
            ty = y + h - pad - 18 if valign == "middle" else yy - slh + 10
            self.chip(tx, ty, tag, anchor=anchor)
        return dict(x=x, y=y, w=w, h=h, cx=cx, cy=y + h / 2, r=x + w, b=y + h)

    @staticmethod
    def need_h(w, title, sub=None, title_size=T_TITLE, sub_size=T_SUB, pad=12, badge=False):
        inner = w - 2 * pad - (30 if badge else 0)
        tl = wrap(title, title_size, inner, bold=True)
        sl = wrap(sub, sub_size, inner) if sub else []
        return round(len(tl) * title_size * 1.25 + (6 if sl else 0) + len(sl) * sub_size * 1.38 + 2 * pad - 4)

    def chip(self, x, y, s, anchor="start", kind="role", size=12):
        fill, col = {"role": ("#ebeae9", INK), "chain": ("#dfe2f2", NAVY), "risk": ("#f3dde1", ROSE),
                     "ok": ("#dcebdf", SAGE), "warn": ("#f5e8c4", AMBER)}[kind]
        w = tw(s, size, True) + 16
        x0 = {"start": x, "middle": x - w / 2, "end": x - w}[anchor]
        self.rect(x0, y, w, 20, fill=fill, stroke=fill, sw=0, rx=10)
        self.text(x0 + w / 2, y + 14, s, size=size, bold=True, color=col, anchor="middle")
        return w

    def badge(self, cx, cy, n, color=INK, r=11):
        self.raw(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{color}"/>')
        self.text(cx, cy + 4.3, str(n), size=12, bold=True, color=WHITE, anchor="middle", check=False)

    def _marker(self, color):
        mid = "m" + color.lstrip("#")
        self.markers.add((mid, color))
        return mid

    def arrow(self, pts, style="flow", color=None, label=None, lx=None, ly=None, lanchor="middle",
              start=False, end=True, lsize=T_LABEL, lcolor=None, lbold=False, sw=None):
        color = color or (LINE if style == "flow" else "#77746f")
        dash = ' stroke-dasharray="5 4"' if style == "signal" else ""
        sw = sw or (1.5 if style == "flow" else 1.3)
        mid = self._marker(color)
        d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts)
        me = f' marker-end="url(#{mid})"' if end else ""
        ms = f' marker-start="url(#{mid})"' if start else ""
        self.raw(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}"{dash}{me}{ms} '
                 f'stroke-linejoin="round"/>')
        if label:
            if lx is None:
                (x1, y1), (x2, y2) = pts[0], pts[-1]
                lx, ly = (x1 + x2) / 2, (y1 + y2) / 2 - 7
            ls = label.split("\n")
            for i, l in enumerate(ls):
                self.text(lx, ly + i * lsize * 1.3, l, size=lsize, color=lcolor or INK2, anchor=lanchor,
                          halo=True, bold=lbold)

    # ---------- output ----------
    def check(self):
        problems = list(self.problems)
        for i, a in enumerate(self.texts):
            if a[0] < 2 or a[2] > self.w - 2 or a[1] < 2 or a[3] > self.h - 2:
                problems.append(f"outside canvas: {a[4]!r}")
            for b in self.texts[i + 1:]:
                if a[0] < b[2] - 1 and b[0] < a[2] - 1 and a[1] < b[3] - 1 and b[1] < a[3] - 1:
                    problems.append(f"overlap: {a[4]!r} / {b[4]!r}")
        return problems

    def svg(self):
        defs = "".join(
            f'<marker id="{mid}" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="9" markerHeight="9" '
            f'markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0.8 L10 5 L0 9.2 z" fill="{c}"/></marker>'
            for mid, c in sorted(self.markers))
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
                f'viewBox="0 0 {self.w} {self.h}" role="img" aria-label="{escape(self.label)}" '
                f'font-family="{FAMILY}">\n<title>{escape(self.label)}</title>\n'
                f'<defs>{defs}</defs>\n<rect width="{self.w}" height="{self.h}" fill="#ffffff"/>\n'
                + "\n".join(self.body) + "\n</svg>\n")
