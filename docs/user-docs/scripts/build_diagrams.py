"""
Build the Pipeline docs diagrams.

Writes SVG sources to assets/diagrams/src/ and renders each to the file the pages embed
(assets/diagrams/<name>.png|.jpeg at 2x, or .svg copied as is). Every label is sourced from
the page that embeds the diagram; technology-neutral wording only.

Run:
    python3 docs/user-docs/scripts/build_diagrams.py [name ...]
Needs: rsvg-convert (librsvg), sips (macOS) for JPEG, Pillow for text metrics.
"""

import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagramkit import *  # noqa: E402,F401,F403

ROOT = Path(__file__).resolve().parent.parent / "assets" / "diagrams"
SRC = ROOT / "src"
SRC.mkdir(parents=True, exist_ok=True)

BUILDERS = {}


def diagram(name, ext):
    def deco(fn):
        BUILDERS[name] = (fn, ext)
        return fn
    return deco


def legend(d, x, y, items):
    """items: list of (style, text). Draws short sample strokes."""
    for style, label in items:
        d.arrow([(x, y), (x + 34, y)], style=style)
        w = d.text(x + 44, y + 4.5, label, size=12.5, color=INK2)
        x += 44 + w + 26


# ---------------------------------------------------------------- architecture
@diagram("boss-system-architecture", "png")
def system_architecture():
    W, H = 960, 752
    d = Diagram("boss-system-architecture", W, H,
                "Pipeline architecture: origination layer and relayer off-chain, protocol layer on-chain, "
                "capital layer of custody accounts and a USD bank account; every privileged call goes "
                "through the access manager.")
    LX, LW = 20, 190
    PX, PW = 274, 370
    CX, CW = 710, 230
    px, pw = PX + 14, PW - 28
    cx, cw = CX + 14, CW - 28
    Y0 = 116  # top of the three columns

    legend(d, LX, 34, [("flow", "money or tokens move")])
    legend(d, LX, 60, [("signal", "records, signs or approves")])

    # role holders on top
    d.box(PX, 14, PW, 84, "Role holders",
          "Admin, Risk Council, Guardian, Pauser, Upgrader, Trustee, cash reporter, Security Agent",
          kind="role", pad=10)

    rows = {}
    y = Y0 + 36
    for k, h in [("access", 58), ("tokens", 78), ("loan", 58), ("sec", 58),
                 ("dm", 58), ("wq", 58), ("minter", 58), ("pocket", 78)]:
        rows[k] = (y, h, y + h / 2)
        y += h + 10
    bottom = y - 10 + 14
    d.region(PX, Y0, PW, bottom - Y0, "Protocol layer")

    ya, ha, ca = rows["access"]
    d.box(px, ya, pw, ha, "Access manager", "maps every privileged call to a role", pad=8)
    ax = PX + PW - 90
    d.arrow([(ax, 98), (ax, ya)], style="signal")
    d.text(ax - 8, Y0 + 24, "every privileged call", size=12.5, color=INK2, anchor="end")

    yt, ht, ct = rows["tokens"]
    t3 = (pw - 20) / 3
    d.box(px, yt, t3, ht, "PLUSD", "dollar token", pad=10, valign="top")
    d.box(px + t3 + 10, yt, t3, ht, "Debt token", "one per loan", pad=10, valign="top")
    d.box(px + 2 * (t3 + 10), yt, t3, ht, "sPLUSD", "staking vault share", pad=10, valign="top")

    yl, hl, cl = rows["loan"]
    d.box(px, yl, pw, hl, "Loan registry", "one non-transferable record per loan", pad=8)
    ys, hs, cs = rows["sec"]
    d.box(px, ys, pw, hs, "Security registry", "security records, prices, LTV, margin calls", pad=8)
    yd, hd, cd = rows["dm"]
    d.box(px, yd, pw, hd, "Deposit manager", "USDC request, voucher, PLUSD minted 1:1", pad=8)
    yw, hw, cw_ = rows["wq"]
    d.box(px, yw, pw, hw, "Withdrawal queue", "first in, first out; pays USDC, burns PLUSD", pad=8)
    ym, hm, cm = rows["minter"]
    d.box(px, ym, pw, hm, "Minter", "cash book; mints for wires, interest and fees", pad=8)
    yp, hp, cp = rows["pocket"]
    h2 = (pw - 10) / 2
    d.box(px, yp, h2, hp, "Pocket", "a defaulted loan, for holders at default", pad=10, valign="top")
    d.box(px + h2 + 10, yp, h2, hp, "Debt token factory", "supply follows principal", pad=10, valign="top")

    # capital layer
    cap_bottom = ym + hm + 14
    d.region(CX, Y0, CW, cap_bottom - Y0, "Capital layer", kind="off")
    d.box(cx, yt, cw, yl + hl - yt, "Capital wallet", "holds loan records and debt tokens; receives protocol fees",
          kind="off", pad=12)
    d.box(cx, yd, cw, hd, "Deposit account", "receives lender USDC", kind="off", pad=8)
    d.box(cx, yw, cw, hw, "Withdrawal account", "pays lender withdrawals", kind="off", pad=8)
    d.box(cx, ym, cw, hm, "USD bank account", "managed by the Trustee", kind="off", pad=8)
    ey = cap_bottom + 28
    d.box(cx, ey, cw, bottom - ey, "Borrowers, offtakers and lenders", kind="actor", pad=9)
    d.arrow([(cx + 40, ym + hm), (cx + 40, ey)], start=True)
    d.text(cx + 50, cap_bottom + 19, "USD wires", size=T_LABEL, color=INK2, halo=True)

    gl, gr = px + pw, cx
    mid = (gl + gr) / 2
    d.arrow([(gl, ct), (gr, ct)], label="fees", lx=mid, ly=ct - 7)
    d.arrow([(gr, cl), (gl, cl)], style="signal", label="holds", lx=mid, ly=cl - 7)
    d.arrow([(gl, cd), (gr, cd)], label="USDC", lx=mid, ly=cd - 7)
    d.arrow([(gr, cw_), (gl, cw_)], label="USDC", lx=mid, ly=cw_ - 7)
    d.arrow([(gr, cm), (gl, cm)], style="signal", label="booked", lx=mid, ly=cm - 7)

    # origination layer
    bx, bw = LX + 12, LW - 24
    d.region(LX, Y0, LW, ys + hs + 12 - Y0, "Origination layer", kind="off")
    d.box(bx, Y0 + 36, bw, 66, "Originators", "submit loan applications", kind="off", pad=9)
    d.box(bx, Y0 + 112, bw, yl - 10 - (Y0 + 112), "KYB and KYT", "every counterparty", kind="off", pad=9)
    d.box(bx, yl, bw, hl, "Trustee", "records approved loans", kind="off", pad=8)
    d.box(bx, ys, bw, hs, "Price feed", "market prices of goods", kind="off", pad=8)
    g1, g2 = bx + bw, px
    d.arrow([(g1, cl), (g2, cl)], style="signal", label="loans", lx=(g1 + g2) / 2, ly=cl - 7)
    d.arrow([(g1, cs), (g2, cs)], style="signal", label="prices", lx=(g1 + g2) / 2, ly=cs - 7)

    # relayer
    rtop = ys + hs + 24
    d.region(LX, rtop, LW, bottom - rtop, "Relayer", kind="off")
    vy, vh = rtop + 36, 80
    d.box(bx, vy, bw, vh, "Signs vouchers", "for deposit and withdrawal claims", kind="off", pad=9)
    d.box(bx, ym, bw, hm, "Matches wires", "bank wire to cash book", kind="off", pad=8)
    d.box(bx, yp, bw, hp, "Screens lenders", "KYT; approves PLUSD holders", kind="off", pad=9)
    fx = g2 - 18
    vc = vy + vh / 2
    d.arrow([(g1, vc), (fx, vc), (fx, cd), (g2, cd)], style="signal")
    d.arrow([(fx, vc), (fx, cw_), (g2, cw_)], style="signal")
    d.text(g1 + 7, vc - 7, "vouchers", size=T_LABEL, color=INK2, halo=True)
    d.arrow([(g1, cm), (g2, cm)], style="signal", label="matches", lx=(g1 + g2) / 2, ly=cm - 7)
    return d


# ---------------------------------------------------------------- capital layer
@diagram("boss-capital-layer", "png")
def capital_layer():
    W, H = 960, 572
    d = Diagram("boss-capital-layer", W, H,
                "Capital layer: deposit, withdrawal and capital custody accounts and the USD bank "
                "account; USDC enters through the deposit account and leaves through the withdrawal account; "
                "every bank movement is recorded on-chain.")
    bw, gap, x0 = 205, 18, 42
    xs = [x0 + i * (bw + gap) for i in range(4)]
    legend(d, xs[2], 38, [("flow", "money moves")])
    legend(d, xs[2], 64, [("signal", "recorded on-chain")])

    ly, lh = 20, 50
    d.box(xs[0], ly, xs[1] + bw - xs[0], lh, "Lenders", kind="actor", align="center", pad=8)

    ry = 130
    d.region(24, ry, 912, 158, "Custody accounts", kind="off", right=True,
             sub="each controlled by a multisig")
    by, bh = ry + 52, 86
    dep = d.box(xs[0], by, bw, bh, "Deposit account", "receives lender USDC at request", kind="off")
    wd = d.box(xs[1], by, bw, bh, "Withdrawal account", "pays claims up to the queue's allowance",
               kind="off")
    d.box(xs[2], by, xs[3] + bw - xs[2], bh, "Capital wallet",
          "holds loan records and debt tokens; receives fees as sPLUSD shares", kind="off")

    d.arrow([(dep["cx"], ly + lh), (dep["cx"], by)], label="USDC, via the deposit manager",
            lx=dep["cx"] + 8, ly=106, lanchor="start")
    d.arrow([(wd["cx"] + 40, by), (wd["cx"] + 40, ly + lh)], label="USDC, via the withdrawal queue",
            lx=wd["cx"] + 48, ly=106, lanchor="start")

    # bank
    bank_y, bank_h = 360, 74
    bank = d.box(42, bank_y, 588, bank_h, "USD bank account",
                 "managed by the Trustee: lender wires, disbursements, repayments, bank interest and charges",
                 kind="off", pad=10)
    d.arrow([(dep["cx"], by + bh), (dep["cx"], bank_y)], label="USDC to USD",
            lx=dep["cx"] + 8, ly=328, lanchor="start")
    d.arrow([(wd["cx"] + 40, bank_y), (wd["cx"] + 40, by + bh)], label="USD to USDC",
            lx=wd["cx"] + 48, ly=328, lanchor="start")

    # cash book
    cb = d.box(xs[3] - 10, bank_y - 4, bw + 10, 82, "Cash book", "on-chain record of each bank movement")
    d.arrow([(bank["r"], bank_y + bank_h / 2), (cb["x"], bank_y + bank_h / 2)], style="signal",
            label="booked", lx=(bank["r"] + cb["x"]) / 2, ly=bank_y + bank_h / 2 - 8)
    d.para(cb["x"], cb["b"] + 24, "Booked by the Trustee or the cash reporter. Each bank reference is used once.",
           bw + 10, size=12.5)

    # outside world
    oy, oh = 500, 50
    ow = 150
    ox = [42, 261, 480]
    bb = bank_y + bank_h
    for x, title, lab, mode in [(ox[0], "Lenders", "wire in, wire out", "both"),
                                (ox[1], "Borrowers", "disbursement", "down"),
                                (ox[2], "Offtakers", "repayment", "up")]:
        d.box(x, oy, ow, oh, title, kind="actor", align="center")
        c = x + ow / 2
        if mode == "both":
            d.arrow([(c, oy), (c, bb)], start=True)
        elif mode == "up":
            d.arrow([(c, oy), (c, bb)])
        else:
            d.arrow([(c, bb), (c, oy)])
        d.text(c + 8, 472, lab, size=T_LABEL, color=INK2, halo=True)
    return d


# ---------------------------------------------------------------- sequence helper
class Seq:
    """Lanes with header boxes and lifelines. A cursor runs down the page; messages carry step badges
    that match the numbered walkthrough on the page."""

    def __init__(self, d, lanes, x0, x1, top, hh, gap=14):
        self.d = d
        n = len(lanes)
        self.bw = (x1 - x0 - gap * (n - 1)) / n
        self.x0, self.x1 = x0, x1
        self.cx = [x0 + i * (self.bw + gap) + self.bw / 2 for i in range(n)]
        for i, (t, s, k) in enumerate(lanes):
            d.box(x0 + i * (self.bw + gap), top, self.bw, hh, t, s, kind=k, align="center", pad=9)
        self.top = top + hh
        self.y = self.top
        self.lines_at = len(d.body)   # lifelines are inserted here, under everything else

    def finish(self, extra=14):
        bottom = self.y + extra
        ll = [f'<line x1="{c:.1f}" y1="{self.top:.1f}" x2="{c:.1f}" y2="{bottom:.1f}" '
              f'stroke="#c9c7c4" stroke-width="1.25" stroke-dasharray="2 4"/>' for c in self.cx]
        self.d.body[self.lines_at:self.lines_at] = ll
        return bottom

    def msg(self, a, b, label, n=None, style="flow", lcolor=None, space=38):
        self.y += space
        y = self.y
        xa, xb = self.cx[a], self.cx[b]
        sgn = 1 if xb > xa else -1
        start = xa + sgn * (13 if n is not None else 0)
        self.d.arrow([(start, y), (xb - sgn * 1, y)], style=style)
        if n is not None:
            self.d.badge(xa, y, n, INK)
        self.d.text((xa + xb) / 2, y - 8, label, size=T_LABEL, color=lcolor or INK, anchor="middle", halo=True)

    def act(self, lane, title, sub=None, n=None, kind="plain", w=None, space=22):
        w = w or self.bw - 4
        h = Diagram.need_h(w, title, sub, pad=9)
        self.y += space
        x = self.cx[lane] - w / 2
        self.d.box(x, self.y, w, h, title, sub, kind=kind, align="center", pad=9)
        if n is not None:
            self.d.badge(x, self.y, n, INK)
        self.y += h

    def phase(self, label, space=34):
        self.y += space
        y = self.y
        self.d.raw(f'<line x1="{self.x0}" y1="{y}" x2="{self.x1}" y2="{y}" stroke="{HAIR}" stroke-width="1"/>')
        w = tw(label.upper(), T_REGION, True, 0.07)
        self.d.rect(self.x0 - 2, y - 11, w + 18, 22, fill=WHITE, stroke=WHITE, sw=0, rx=0)
        self.d.text(self.x0, y + 4.5, label.upper(), size=T_REGION, bold=True, color=INK2, spacing=0.07)


def footnote(d, x, y, s, w):
    return d.para(x, y, s, w, size=T_NOTE)[0]


def fit(d, bottom):
    """Shrink the canvas to the content."""
    d.h = int(bottom + 20)


# ---------------------------------------------------------------- deposit
@diagram("d2-deposit-mint", "png")
def deposit_mint():
    d = Diagram("d2-deposit-mint", 960, 1000,
                "Two-step deposit: USDC goes to the deposit custody account at request; Pipeline screens it, "
                "authorises the address and signs a voucher; the claim mints PLUSD 1:1.")
    s = Seq(d, [("Lender", "your wallet", "actor"),
                ("Deposit manager", "contract", "chain"),
                ("Deposit custody account", "multisig account", "off"),
                ("PLUSD", "dollar token", "chain"),
                ("Pipeline backend", "screening and vouchers", "off")], 20, 940, 20, 80)
    s.phase("Request", space=30)
    s.msg(0, 1, "request deposit", n=1)
    s.act(1, "Checks limits", "min 1,000 USDC; 5M per deposit; 10M per 24 h", n=2, kind="chain")
    s.msg(1, 2, "USDC, same transaction", n=3, space=40)
    s.msg(1, 0, "request number", style="signal", lcolor=INK2)
    s.phase("Screening · off-chain")
    s.act(4, "Screens", "address and deposit (KYT)", n=4, kind="off")
    s.msg(4, 3, "authorises the address", n=5, style="signal", space=40)
    s.msg(4, 0, "voucher, valid 24 hours", style="signal")
    s.phase("Claim")
    s.msg(0, 1, "claim with the voucher", n=6)
    s.act(1, "Checks voucher", "and deadline; marks it claimed", kind="chain")
    s.msg(1, 3, "mint 1:1", space=40)
    s.msg(3, 0, "PLUSD to the lender")
    b = s.finish()
    b = footnote(d, 20, b + 26, "Not clean: no voucher is issued. The USDC stays in the deposit custody account and "
                 "no PLUSD is minted.", 920)
    fit(d, b)
    return d


# ---------------------------------------------------------------- stake / unstake
@diagram("d3-stake-unstake", "png")
def stake_unstake():
    d = Diagram("d3-stake-unstake", 960, 800,
                "Stake: PLUSD from an authorised holder goes into the vault and shares go to the receiver. "
                "Unstake: shares are burned and PLUSD goes to a receiver that must be authorised.")
    panels = [(20, "Stake", ("Receiver", "not checked by the vault", "actor"),
               "PLUSD", "Issues shares", "pro rata, rounded down", "sPLUSD shares",
               "Only authorised addresses hold PLUSD, so only they can stake."),
              (500, "Unstake", ("Receiver", "must be authorised", "risk"),
               "sPLUSD shares", "Burns the shares", "PLUSD = shares × share price", "PLUSD",
               "If the receiver is not authorised, the redemption fails.")]
    pw = 440
    ends = []
    for x, title, recv, m1, actt, acts, m2, note in panels:
        d.text(x, 36, title, size=20, bold=True, color=INK)
        s = Seq(d, [("Lender", "authorised holder", "actor"), ("sPLUSD vault", "staking vault", "chain"), recv],
                x, x + pw, 56, 80, gap=12)
        s.msg(0, 1, m1, n=1, space=40)
        s.act(1, actt, acts, kind="chain", w=s.bw + 20)
        s.msg(1, 2, m2, n=2, space=40)
        b = s.finish(16)
        ends.append(footnote(d, x, b + 26, note, pw))
    d.raw(f'<line x1="480" y1="20" x2="480" y2="{max(ends) + 6}" stroke="{HAIR}" stroke-width="1"/>')
    y = max(ends) + 30
    h = Diagram.need_h(920, "Share price = PLUSD in the vault ÷ shares",
                       "Interest minted into the vault raises it; your share count stays the same. No lock-up, "
                       "no queue at the vault. For USDC, continue to Withdraw.", pad=14)
    d.box(20, y, 920, h, "Share price = PLUSD in the vault ÷ shares",
          "Interest minted into the vault raises it; your share count stays the same. No lock-up, "
          "no queue at the vault. For USDC, continue to Withdraw.", kind="chain", pad=14)
    fit(d, y + h)
    return d


# ---------------------------------------------------------------- withdraw
@diagram("d5-withdraw-settle", "png")
def withdraw_settle():
    d = Diagram("d5-withdraw-settle", 960, 1000,
                "Withdraw: PLUSD is escrowed in the queue; Pipeline screens the request and signs a voucher; "
                "the claim pays USDC from the withdrawal custody account and burns the PLUSD in one transaction.")
    s = Seq(d, [("Lender", "your wallet", "actor"),
                ("sPLUSD vault", "staking vault", "chain"),
                ("Withdrawal queue", "first in, first out", "chain"),
                ("Pipeline backend", "screening and vouchers", "off"),
                ("Withdrawal custody account", "multisig account", "off")], 20, 940, 20, 80)
    s.phase("Unstake · skip if you hold PLUSD", space=30)
    s.msg(0, 1, "redeem sPLUSD", n=1)
    s.msg(1, 0, "PLUSD at the share price")
    s.phase("Request")
    s.msg(0, 2, "request withdrawal: PLUSD into escrow", n=2)
    s.act(2, "Records position", "total PLUSD queued so far", kind="chain")
    s.phase("Screening · off-chain")
    s.act(3, "Screens", "the request", n=3, kind="off")
    s.msg(3, 0, "voucher, valid 24 hours", style="signal", space=40)
    s.phase("Claim · one transaction")
    s.msg(0, 2, "claim with the voucher", n=4)
    s.act(2, "Checks", "voucher, deadline; USDC covers the queue up to this request", kind="chain")
    s.msg(4, 0, "USDC, pulled within the allowance", space=40)
    s.act(2, "Burns the PLUSD", kind="chain", space=20)
    b = s.finish()
    b = footnote(d, 20, b + 26, "Too early: the claim is refused and the PLUSD stays in the queue. A request "
                 "cannot be cancelled.", 920)
    fit(d, b)
    return d


# ---------------------------------------------------------------- incident response
@diagram("d9-incident-response", "png")
def incident_response():
    W, H = 960, 484
    d = Diagram("d9-incident-response", W, H,
                "Incident response: the Pauser pauses each affected contract, the Guardian or Admin cancels "
                "scheduled calls, the Admin revokes and re-grants roles, replaces the voucher signer and unpauses.")
    cw, gap = 168, 15
    xs = [30 + i * (cw + gap) for i in range(5)]
    d.region(10, 14, 940, 222, "Contain · every action is instant", kind="risk")
    steps = [("Detect", "unexpected approvals, mints near limits, queue or cash-book mismatch", "Monitoring"),
             ("Pause", "each affected contract, one by one", "Pauser"),
             ("Cancel", "pending scheduled calls that look wrong", "Guardian or Admin"),
             ("Revoke", "the role of the suspected holder", "Admin"),
             ("Cut allowance", "if the queue is the vector; no governance action", "Withdrawal account")]
    cy, ch = 50, 168
    for i, (t, sub, who) in enumerate(steps):
        d.box(xs[i] + 0, cy, cw, ch, t, sub, kind="plain", badge=i + 1, valign="top", pad=12)
        d.chip(xs[i] + 12, cy + ch - 32, who, kind="role")
        if i < 4:
            d.arrow([(xs[i] + cw, cy + 23), (xs[i + 1], cy + 23)])
    d.region(10, 254, 940, 190, "Recover", kind="ok")
    rs = [("Replace signer", "the compromised voucher signer key", "Admin"),
          ("Re-grant", "the role to a new holder", "Admin"),
          ("Unpause", "each contract", "Admin")]
    ry, rh = 290, 138
    for i, (t, sub, who) in enumerate(rs):
        d.box(xs[i], ry, cw, rh, t, sub, kind="plain", badge=i + 6, valign="top", pad=12)
        d.chip(xs[i] + 12, ry + rh - 32, who, kind="role")
        if i < 2:
            d.arrow([(xs[i] + cw, ry + 23), (xs[i + 1], ry + 23)])
    d.box(xs[3], ry, 2 * cw + gap, rh, "The Guardian only cancels",
          "It cannot grant, revoke, pause, unpause, upgrade or move funds. No single call stops the whole "
          "protocol. Default handling still runs while the vault is paused.", kind="off", valign="top", pad=14)
    d.text(xs[0], 470, "Every action names its target and is recorded on-chain.", size=T_NOTE, color=INK2)
    return d


# ---------------------------------------------------------------- governance
@diagram("boss-governance-detail", "png")
def governance_detail():
    d = Diagram("boss-governance-detail", 960, 600,
                "Governance: every role holder calls through the access manager; it checks the role, runs the "
                "call at once or schedules it for the role's delay, and the Guardian or Admin can cancel a "
                "scheduled call.")
    gw = 190
    gx, ox = 24, 24 + gw + 12
    gov = [("Admin", "multisig · no delay"), ("Risk Council", "multisig · 24 h delay"),
           ("Guardian", "multisig · cancels"), ("Pauser", "multisig · pauses"), ("Upgrader", "multisig · upgrades")]
    ops = [("Trustee", "loans and cash operations"), ("Cash reporter", "2-of-2 multisig"),
           ("Whitelist admin", "platform backend"), ("Security Agent", "security records"),
           ("Inspection operator", "a second one approves")]
    y0, bh, g = 78, 64, 10
    bottom = y0 + 5 * bh + 4 * g
    d.region(12, 14, ox + gw + 12 - 12, bottom + 12 - 14, "Role holders", kind="off")
    d.text(gx, 64, "Governance", size=T_SUB, bold=True, color=INK2)
    d.text(ox, 64, "Operators", size=T_SUB, bold=True, color=INK2)
    for i, (t, s_) in enumerate(gov):
        d.box(gx, y0 + i * (bh + g), gw, bh, t, s_, kind="role", pad=8)
    for i, (t, s_) in enumerate(ops):
        d.box(ox, y0 + i * (bh + g), gw, bh, t, s_, kind="role", pad=8)
    rr = ox + gw + 12
    # access manager
    AX, AW = 456, 282
    d.region(AX, 14, AW, bottom + 12 - 14, "Access manager")
    ix, iw = AX + 14, AW - 28
    hw = (iw - 12) / 2
    chk = d.box(ix, 50, iw, 60, "Checks the caller's role", "one role per action", pad=9)
    now = d.box(ix, 150, hw, 80, "No delay", "runs at once", pad=10)
    sch = d.box(ix + hw + 12, 150, hw, 80, "Role delay", "Risk Council: 24\u00a0h", pad=10)
    can = d.box(sch["x"] + 26, 286, sch["w"] - 26, 34, "Cancelled", kind="risk", align="center", pad=5,
                title_size=14)
    run = d.box(ix, bottom - 56, iw, 52, "Runs on the target contract", pad=10, align="center")
    d.arrow([(now["cx"], chk["b"]), (now["cx"], now["y"])])
    d.arrow([(sch["cx"], chk["b"]), (sch["cx"], sch["y"])])
    d.arrow([(now["cx"], now["b"]), (now["cx"], run["y"])])
    d.arrow([(sch["x"] + 13, sch["b"]), (sch["x"] + 13, run["y"])])
    d.text((now["cx"] + sch["x"] + 13) / 2, 296, "after", size=12.5, color=INK2, anchor="middle")
    d.text((now["cx"] + sch["x"] + 13) / 2, 312, "the delay", size=12.5, color=INK2, anchor="middle")
    d.arrow([(can["cx"], sch["b"]), (can["cx"], can["y"])], style="signal", color=ROSE)
    d.arrow([(rr, chk["cy"]), (ix, chk["cy"])], label="calls", lx=(rr + ix) / 2, ly=chk["cy"] - 8)
    # contracts
    CX, CW = 760, 180
    d.region(CX, 14, CW, bottom + 12 - 14, "Contracts")
    names = ["Loan registry", "Security registry", "Minter", "Deposit manager", "Withdrawal queue",
             "sPLUSD vault", "Pocket", "PLUSD", "Debt token factory"]
    cy0, ch = 50, 30
    cg = (bottom - 4 - cy0 - 9 * ch) / 8
    for i, n in enumerate(names):
        d.box(CX + 12, cy0 + i * (ch + cg), CW - 24, ch, n, title_size=13.5, pad=4, align="center")
    d.arrow([(ix + iw, run["cy"]), (CX, run["cy"])])
    # notes
    y = bottom + 40
    y = d.para(20, y, "Declaring a default and reversing a repayment run at once; the Risk Council's other calls "
               "wait 24 hours. The Guardian, the Admin or the scheduler can cancel a scheduled call during "
               "the delay.", 920, size=T_NOTE)[0]
    y = d.para(20, y + 22, "The Admin grants and revokes every role and cannot hold a delay. The mint role on "
               "PLUSD is held by two contracts, the deposit manager and the minter; no person holds it.",
               920, size=T_NOTE)[0]
    d.h = int(y + 18)
    return d


# ---------------------------------------------------------------- reference loan lifecycle
@diagram("boss-loan-lifecycle", "jpeg")
def loan_lifecycle():
    d = Diagram("boss-loan-lifecycle", 960, 700,
                "Reference transaction lifecycle: origination, funding, transit and storage under the Security "
                "Agent, repayment by priority of payments with interest minted into the vault, and closure.")
    phases = [
        ("Origination", [("Sourcing", "the Originator identifies the deal"),
                         ("KYB and KYT", "on every party to the deal"),
                         ("Underwriting", "term sheet, prices, corridor, offtaker"),
                         ("Approval", "Risk Council approves; the Trustee records the loan")]),
        ("Funding", [("Equity tranche", "Originator accedes and funds $3M, first loss"),
                     ("Legal opinion", "security ranks first"),
                     ("Senior tranche", "lending vehicle wires $17M; debt token issued")]),
        ("Cargo", [("Loading", "B/L endorsed to the Security Agent; inspectors verify"),
                                 ("Bonded storage", "Security Agent hands over to the warehouse pledge"),
                                 ("Daily monitoring", "LTV above 85 % opens a margin call; cure to 80 %"),
                                 ("Offtake", "the distributor takes delivery")]),
        ("Repayment", [("Offtaker pays", "into the collection account co-signed by the Security Agent"),
                       ("Priority of payments", "senior principal, senior interest, fees, equity"),
                       ("Interest minted", "into the vault; sPLUSD price rises; fees to the capital wallet")]),
        ("Closure", [("Security released", "by the Security Agent"),
                     ("Equity paid out", "equity principal and residual to the Originator"),
                     ("Loan closed", "by the Trustee, nothing outstanding")]),
    ]
    n = len(phases)
    gap = 18
    cw = (920 - gap * (n - 1)) / n
    xs = [20 + i * (cw + gap) for i in range(n)]
    # one box height for the whole grid: the tallest content decides
    bh = max(Diagram.need_h(cw, t, s, pad=10, title_size=14.5, sub_size=12.5)
             for _, steps in phases for t, s in steps)
    vg = 22
    top = 72
    for i, (name, steps) in enumerate(phases):
        x = xs[i]
        d.badge(x + 11, 34, i + 1, NAVY)
        d.text(x + 30, 39, name, size=T_TITLE, bold=True, color=NAVY)
        if i < n - 1:
            d.arrow([(x + cw + 3, 34), (xs[i + 1] - 3, 34)], color=NAVY_S)
        d.raw(f'<line x1="{x}" y1="54" x2="{x + cw}" y2="54" stroke="{NAVY}" stroke-width="2"/>')
        for j, (t, s_) in enumerate(steps):
            y = top + j * (bh + vg)
            d.box(x, y, cw, bh, t, s_, kind="off" if i in (0, 2) else "plain", pad=10,
                  title_size=14.5, sub_size=12.5, valign="top")
            if j < len(steps) - 1:
                d.arrow([(x + cw / 2, y + bh), (x + cw / 2, y + bh + vg)])
    rows = max(len(s) for _, s in phases)
    grid_b = top + rows * (bh + vg) - vg
    # loan status rail
    ry = grid_b + 44
    d.text(20, ry - 22, "LOAN STATUS", size=T_REGION, bold=True, color=INK2, spacing=0.07)
    # anchors: Approved at the approval step, Performing at the senior tranche, Closed at closure
    a_x = xs[0] + cw / 2
    p_x = xs[1] + cw / 2
    c_x = xs[4] + cw / 2
    d.raw(f'<line x1="{a_x}" y1="{ry + 10}" x2="{c_x}" y2="{ry + 10}" stroke="{HAIR}" stroke-width="3"/>')
    d.raw(f'<line x1="{p_x}" y1="{ry + 10}" x2="{c_x}" y2="{ry + 10}" stroke="{SAGE}" stroke-width="3"/>')
    d.chip(a_x, ry, "Approved", anchor="middle", kind="role")
    d.chip(p_x, ry, "Performing: interest accrues", anchor="middle", kind="ok")
    d.chip(c_x, ry, "Closed", anchor="middle", kind="chain")
    y = ry + 52
    y = d.para(20, y, "$20M facility: $17M senior from Pipeline lenders, $3M equity from the Originator. 90 days. "
               "Figures are illustrative.", 920, size=T_NOTE)[0]
    d.h = int(y + 18)
    return d


# ---------------------------------------------------------------- LTV thresholds
@diagram("boss-ccr-thresholds", "png")
def ltv_thresholds():
    d = Diagram("boss-ccr-thresholds", 960, 360,
                "Loan-to-value thresholds: drawn up to 80 %; a margin call opens above 85 % and must bring LTV "
                "back to 80 % within the cure period. No haircut.")
    x0, x1 = 40, 920
    lo, hi = 60, 100

    def X(v):
        return x0 + (v - lo) / (hi - lo) * (x1 - x0)

    by, bh = 120, 34
    zones = [(lo, 80, SAGE_T, SAGE), (80, 85, AMBER_T, AMBER_L), (85, hi, ROSE_T, ROSE)]
    for a, b, f, s_ in zones:
        d.rect(X(a), by, X(b) - X(a), bh, fill=f, stroke=f, sw=0, rx=0)
    d.rect(x0, by, x1 - x0, bh, fill="none", stroke=HAIR, sw=1, rx=0)
    # labels inside zones
    d.text((X(lo) + X(80)) / 2, by + 22, "Within the advance ratio", size=T_SUB, bold=True, color=SAGE,
           anchor="middle")
    d.text((X(85) + X(hi)) / 2, by + 22, "Margin call open", size=T_SUB, bold=True, color=ROSE, anchor="middle")
    # ticks
    for v in (60, 70, 80, 85, 90, 100):
        d.raw(f'<line x1="{X(v):.1f}" y1="{by + bh}" x2="{X(v):.1f}" y2="{by + bh + 6}" stroke="{INK2}" '
              f'stroke-width="1"/>')
        d.text(X(v), by + bh + 22, f"{v} %", size=T_SUB, color=INK2, anchor="middle")
    for v, col in ((80, SAGE), (85, ROSE)):
        d.raw(f'<line x1="{X(v):.1f}" y1="{by - 30}" x2="{X(v):.1f}" y2="{by + bh}" stroke="{col}" '
              f'stroke-width="2"/>')
    d.text(X(80) - 8, by - 36, "Advance ratio 80 %", size=T_SUB, bold=True, color=SAGE, anchor="end")
    d.text(X(80) - 8, by - 18, "highest LTV at drawdown", size=12.5, color=INK2, anchor="end")
    d.text(X(85) + 8, by - 36, "Margin-call ratio 85 %", size=T_SUB, bold=True, color=ROSE)
    d.text(X(85) + 8, by - 18, "above it, a margin call opens", size=12.5, color=INK2)
    # direction of travel
    d.arrow([(X(62), 40), (X(75), 40)], color=INK2)
    d.text(X(75) + 8, 44.5, "goods price falls or interest accrues: LTV rises", size=12.5, color=INK2)
    # cure arrow: from margin-call zone back to 80 %
    cy = by + bh + 46
    d.arrow([(X(92), by + bh + 30), (X(92), cy), (X(80), cy), (X(80), by + bh + 30)], color=SAGE)
    d.text((X(80) + X(92)) / 2, cy + 20, "cure: cash or goods restore 80 % within the cure period",
           size=12.5, color=SAGE, anchor="middle", bold=True)
    y = cy + 58
    y = d.para(x0, y, "LTV = (principal outstanding + accrued interest) ÷ security value. Goods count at counted "
               "quantity × market price; cash cover, receivables, LC proceeds and prepayments at face; insurance "
               "never. No haircut. Ratios are set per loan.", x1 - x0, size=T_NOTE)[0]
    y = d.para(x0, y + 22, "A stale price does not open a margin call. The end of the cure period does not "
               "default the loan by itself; the Risk Council decides.", x1 - x0, size=T_NOTE)[0]
    d.h = int(y + 18)
    return d


# ---------------------------------------------------------------- loss defense
@diagram("boss-loss-defense", "jpeg")
def loss_defense():
    d = Diagram("boss-loss-defense", 900, 800,
                "Layered protection: a credit loss meets the advance ratio, security enforcement, the equity "
                "tranche and the default pocket; a contract incident meets custody outside the contracts, "
                "vouchers and mint limits, role separation and pause.")
    cw, gx = 410, 20
    xs = [20, 20 + cw + 40]
    cols = [
        ("Credit loss", "default, fraud, shortfall", [
            ("Advance ratio", "drawn up to 80 % of security value; above 85 %, a margin call restores 80 %"),
            ("Security enforcement", "the Security Agent enforces; goods sold through pre-onboarded liquidators"),
            ("Equity tranche", "the Originator's capital takes the first loss; recorded, not enforced on-chain"),
            ("Default pocket", "confines the loss to vault holders at default; recoveries go back to them"),
        ]),
        ("Contract incident", "bug, key compromise, attack", [
            ("Custody outside the contracts", "contracts hold no USDC; the queue reaches only its allowance"),
            ("Vouchers and mint limits", "signed voucher per claim; per-transaction and 24-hour mint limits"),
            ("Role separation", "every privileged call through the access manager; the Admin revokes"),
            ("Pause", "the Pauser stops each contract at once"),
        ]),
    ]
    bh = max(Diagram.need_h(cw, t, s, pad=12, badge=True) for _, _, ls in cols for t, s in ls)
    th = Diagram.need_h(cw, "Credit loss", "default, fraud, shortfall", pad=12)
    vg = 26
    ends = []
    for ci, (title, sub, layers) in enumerate(cols):
        x = xs[ci]
        y = 20
        d.box(x, y, cw, th, title, sub, kind="risk", pad=12)
        y += th
        for li, (t, s_) in enumerate(layers):
            d.arrow([(x + cw / 2, y), (x + cw / 2, y + vg)], color=ROSE if li == 0 else LINE)
            y += vg
            d.box(x, y, cw, bh, t, s_, kind="ok", badge=("1234" if ci == 0 else "ABCD")[li], pad=12)
            y += bh
        ends.append(y)
    yb = max(ends)
    ly = yb + 46
    for ci in range(2):
        cx = xs[ci] + cw / 2
        d.arrow([(cx, ends[ci]), (cx, ly)], label="what gets through", lx=cx + 8, ly=yb + 28, lanchor="start")
    lh = 62
    d.box(20, ly, 860, lh, "Lender capital", "PLUSD staked in the sPLUSD vault", kind="chain", pad=12,
          align="center")
    y = d.para(20, ly + lh + 30, "Terminal mode: the Admin can set one recovery rate below 1 on the withdrawal "
               "queue, once. Every claim then pays that fraction of face value.", 860, size=T_NOTE)[0]
    d.h = int(y + 18)
    return d


# ---------------------------------------------------------------- loan states
@diagram("d6-loan-lifecycle", "svg")
def loan_states():
    d = Diagram("d6-loan-lifecycle", 960, 420,
                "Loan states: Approved, Performing, WatchList, Default, Closed. The Trustee moves a loan through "
                "the normal states and closes it; only the Risk Council declares default, cures it, or closes a "
                "defaulted loan.")
    sw, sh, y = 160, 56, 100
    spec = [("Approved", "recorded", "role", 20), ("Performing", "interest accrues", "ok", 282),
            ("WatchList", "closer review", "warn", 520), ("Default", "declared", "risk", 780)]
    B = {k: d.box(x, y, sw, sh, k, s_, kind=kd, align="center", pad=8) for k, s_, kd, x in spec}
    A, P, Wl, D = B["Approved"], B["Performing"], B["WatchList"], B["Default"]
    cl = d.box(282, 300, 398, 56, "Closed", "closure reason recorded", kind="chain", align="center", pad=8)
    mid = y + sh / 2
    # Approved -> Performing
    d.arrow([(A["r"], mid), (P["x"], mid)])
    d.text((A["r"] + P["x"]) / 2, mid - 26, "first", size=T_LABEL, color=INK2, anchor="middle")
    d.text((A["r"] + P["x"]) / 2, mid - 9, "disbursement", size=T_LABEL, color=INK2, anchor="middle")
    # Performing <-> WatchList
    d.arrow([(P["r"], mid - 9), (Wl["x"], mid - 9)])
    d.arrow([(Wl["x"], mid + 9), (P["r"], mid + 9)])
    d.chip((P["r"] + Wl["x"]) / 2, y - 32, "Trustee", anchor="middle")
    # default: bus over the top from Performing and WatchList
    bus = 44
    d.raw(f'<path d="M {P["cx"]} {y} L {P["cx"]} {bus} L {D["cx"]} {bus}" fill="none" stroke="{ROSE}" '
          f'stroke-width="1.5" stroke-linejoin="round"/>')
    d.raw(f'<path d="M {Wl["cx"]} {y} L {Wl["cx"]} {bus}" fill="none" stroke="{ROSE}" stroke-width="1.5"/>')
    d.arrow([(D["cx"], bus), (D["cx"], y)], color=ROSE)
    d.text((Wl["cx"] + D["cx"]) / 2, bus - 10, "declare default", size=T_LABEL, bold=True, color=ROSE,
           anchor="middle")
    d.chip((Wl["cx"] + D["cx"]) / 2, bus + 10, "Risk Council · no delay", anchor="middle", kind="risk")
    # cure: under, back to WatchList
    cure = y + sh + 44
    d.arrow([(D["cx"] - 30, D["b"]), (D["cx"] - 30, cure), (Wl["cx"] + 30, cure), (Wl["cx"] + 30, Wl["b"])],
            color=AMBER_L)
    d.text((Wl["cx"] + D["cx"]) / 2, cure - 10, "cure", size=T_LABEL, bold=True, color=AMBER, anchor="middle")
    d.chip((Wl["cx"] + D["cx"]) / 2, cure + 8, "Risk Council · 24 h", anchor="middle", kind="warn")
    # closures by the Trustee
    d.arrow([(A["cx"], A["b"]), (A["cx"], cl["cy"]), (cl["x"], cl["cy"])])
    d.text(A["cx"] + 10, 232, "cancelled:", size=T_LABEL, color=INK2)
    d.text(A["cx"] + 10, 249, "nothing disbursed", size=T_LABEL, color=INK2)
    d.chip(A["cx"] + 10, 260, "Trustee")
    d.arrow([(P["cx"], P["b"]), (P["cx"], cl["y"])])
    d.arrow([(Wl["cx"] - 30, Wl["b"]), (Wl["cx"] - 30, cl["y"])])
    lx = (P["cx"] + Wl["cx"] - 30) / 2
    d.text(lx, 218, "maturity or", size=T_LABEL, color=INK2, anchor="middle")
    d.text(lx, 235, "early repayment:", size=T_LABEL, color=INK2, anchor="middle")
    d.text(lx, 252, "nothing outstanding", size=T_LABEL, color=INK2, anchor="middle")
    d.chip(lx, 262, "Trustee", anchor="middle")
    # closure of a defaulted loan
    dx = D["cx"] + 30
    d.arrow([(dx, D["b"]), (dx, cl["cy"]), (cl["r"], cl["cy"])], color=ROSE)
    d.text(dx - 12, 248, "default or write-down:", size=T_LABEL, color=INK2, anchor="end")
    d.text(dx - 12, 265, "outstanding is zero", size=T_LABEL, color=INK2, anchor="end")
    d.chip(dx - 12, 276, "Risk Council · 24 h", anchor="end", kind="risk")
    d.h = int(cl["b"] + 20)
    return d


# ---------------------------------------------------------------- yield
@diagram("d4-yield-accretion", "svg")
def yield_accretion():
    d = Diagram("d4-yield-accretion", 960, 470,
                "How yield reaches sPLUSD: a borrower's repayment is booked on-chain and split; senior interest "
                "is minted as PLUSD into the vault and the share price steps up; fees go to the capital wallet as "
                "shares.")
    # flow on the left
    x, w = 20, 250
    b1 = d.box(x, 20, w, 66, "Borrower pays", "interest is invoiced monthly", kind="actor", pad=10)
    b2 = d.box(x, 120, w, 66, "USD bank account", "the payment arrives", kind="off", pad=10)
    b3 = d.box(x, 220, w, 66, "Repayment booked", "by the cash reporter, on-chain", kind="chain", pad=10)
    d.arrow([(b1["cx"], b1["b"]), (b1["cx"], b2["y"])])
    d.arrow([(b2["cx"], b2["b"]), (b2["cx"], b3["y"])], style="signal")
    # split
    sx = 340
    sw_ = 270
    outs = [("Principal", "outstanding falls", "plain", 156),
            ("Senior interest", "minted as PLUSD into the vault", "chain", 236),
            ("Fees", "to the capital wallet as sPLUSD shares", "plain", 316)]
    jx = b3["r"] + 34
    d.raw(f'<line x1="{b3["r"]}" y1="{b3["cy"]}" x2="{jx}" y2="{b3["cy"]}" stroke="{LINE}" stroke-width="1.5"/>')
    d.raw(f'<line x1="{jx}" y1="{156 + 28}" x2="{jx}" y2="{316 + 28}" stroke="{LINE}" stroke-width="1.5"/>')
    for t, s_, k, yy in outs:
        bb = d.box(sx, yy, sw_, 56, t, s_, kind=k, pad=8)
        d.arrow([(jx, yy + 28), (sx, yy + 28)])
    d.text(sx, 136, "SPLIT ON-CHAIN", size=T_REGION, bold=True, color=INK2, spacing=0.07)
    # chart on the right
    cx0, cx1, cy0, cy1 = 680, 930, 70, 330
    d.text(cx0 - 20, 36, "sPLUSD share price", size=T_TITLE, bold=True, color=INK)
    d.raw(f'<line x1="{cx0}" y1="{cy1}" x2="{cx1}" y2="{cy1}" stroke="{INK2}" stroke-width="1"/>')
    d.raw(f'<line x1="{cx0}" y1="{cy0}" x2="{cx0}" y2="{cy1}" stroke="{INK2}" stroke-width="1"/>')
    steps = [(cx0, 280), (cx0 + 70, 280), (cx0 + 70, 230), (cx0 + 160, 230), (cx0 + 160, 170), (cx1, 170)]
    d.raw('<path d="M ' + " L ".join(f"{a:.0f} {b:.0f}" for a, b in steps) +
          f'" fill="none" stroke="{NAVY}" stroke-width="2.5" stroke-linejoin="round"/>')
    for sx_, sy in ((cx0 + 70, 230), (cx0 + 160, 170)):
        d.raw(f'<circle cx="{sx_}" cy="{sy}" r="4" fill="{NAVY}"/>')
    d.text(cx0 + 70 + 8, 252, "repayment", size=12.5, color=INK2)
    d.text(cx0 + 160 + 8, 192, "repayment", size=12.5, color=INK2)
    d.text(cx1, cy1 + 20, "time", size=12.5, color=INK2, anchor="end")
    d.arrow([(sx + sw_, 264), (cx0 - 8, 264)], color=NAVY, label="steps up", lx=(sx + sw_ + cx0) / 2, ly=256,
            lcolor=NAVY)
    y = 400
    y = d.para(20, y, "No daily accrual in the share price: interest lands in one amount when the borrower pays. "
               "Fees do not change the share price. Bank income booked on the bank account is minted into the "
               "vault; bank charges and conversion shortfalls are burned from it.", 920, size=T_NOTE)[0]
    d.h = int(y + 18)
    return d


# ---------------------------------------------------------------- render
def render(name):
    fn, ext = BUILDERS[name]
    d = fn()
    probs = d.check()
    src = SRC / f"{name}.svg"
    src.write_text(d.svg())
    out = ROOT / f"{name}.{ext}"
    if ext == "svg":
        shutil.copyfile(src, out)
    elif ext == "png":
        subprocess.run(["rsvg-convert", "-z", "2", "-o", str(out), str(src)], check=True)
    elif ext == "jpeg":
        tmp = SRC / f".{name}.png"
        subprocess.run(["rsvg-convert", "-z", "2", "-o", str(tmp), str(src)], check=True)
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "92", str(tmp), "--out", str(out)],
                       check=True, capture_output=True)
        tmp.unlink()
    print(f"{name}.{ext}: {'OK' if not probs else ''}")
    for p in probs:
        print("   ", p)


if __name__ == "__main__":
    for n in sys.argv[1:] or BUILDERS:
        render(n)
