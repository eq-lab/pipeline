"""
Generate illustrative static charts for the Pipeline user docs.
Outputs SVGs to docs/user-docs/assets/charts/.

Every printed number traces back to design-spec § "Numbers to quote"
(docs/superpowers/specs/2026-04-23-user-docs-design.md).

Run:
    python3 docs/user-docs/scripts/build_charts.py
"""

from pathlib import Path
import math

import matplotlib as mpl
import matplotlib.pyplot as plt

OUT = Path(__file__).resolve().parent.parent / "assets" / "charts"
OUT.mkdir(parents=True, exist_ok=True)

# Palette (must match assets/css/main.css)
BG = "#0f1419"
SURFACE = "#161b22"
TEXT = "#e6edf3"
MUTED = "#8b949e"
BORDER = "#2a313c"
SLATE = "#7aa2f7"
SAGE = "#9ece6a"
AMBER = "#e0af68"
ROSE = "#f7768e"
LAVENDER = "#bb9af7"

mpl.rcParams.update({
    "figure.facecolor": BG,
    "axes.facecolor": SURFACE,
    "axes.edgecolor": BORDER,
    "axes.labelcolor": TEXT,
    "axes.titlecolor": TEXT,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "text.color": TEXT,
    "font.family": "sans-serif",
    "font.size": 11,
    "axes.titleweight": "bold",
    "axes.titlesize": 13,
    "axes.grid": True,
    "grid.color": BORDER,
    "grid.linestyle": "-",
    "grid.linewidth": 0.5,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "savefig.facecolor": BG,
    "savefig.edgecolor": BG,
})


def c1_reserve_composition():
    """
    C1 · Reserve composition at the 15% USDC-buffer target.

    Numbers derive from design-spec § "Numbers to quote":
    - 15% USDC buffer target (10-20% band)
    - 70/30 T-bill yield split (implies USYC is a meaningful reserve line)

    The 15 / 60 / 22 / 3 split is illustrative of a mid-deployment state:
    15% USDC kept liquid (target), bulk of idle reserves held as USYC,
    remainder deployed to loans or in transit on disbursement/repayment.
    """
    labels = [
        "USDC in Capital Wallet (buffer, target 15%)",
        "USYC holdings (T-bill position)",
        "USDC on active loans",
        "USDC in transit",
    ]
    sizes = [15, 60, 22, 3]
    colors = [SAGE, AMBER, LAVENDER, SLATE]

    fig, ax = plt.subplots(figsize=(8, 5.5))
    ax.set_facecolor(BG)
    ax.axis("equal")

    wedges, _ = ax.pie(
        sizes,
        colors=colors,
        startangle=90,
        counterclock=False,
        wedgeprops=dict(width=0.42, edgecolor=BG, linewidth=2.5),
    )

    # Custom labelling — anchor outside each wedge.
    for w, size, label in zip(wedges, sizes, labels):
        ang_deg = (w.theta1 + w.theta2) / 2.0
        ang = math.radians(ang_deg)
        r_in = 1.02
        r_out = 1.35
        x_in = r_in * math.cos(ang)
        y_in = r_in * math.sin(ang)
        x_out = r_out * math.cos(ang)
        y_out = r_out * math.sin(ang)
        ha = "left" if x_out >= 0 else "right"
        ax.annotate(
            f"{label}\n{size}%",
            xy=(x_in, y_in),
            xytext=(x_out, y_out),
            ha=ha,
            va="center",
            fontsize=10,
            color=TEXT,
            arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.6),
        )

    ax.set_title("Reserve composition — illustrative mid-deployment state", pad=18)
    fig.text(
        0.5,
        0.02,
        "Illustrative reserve composition at the 15% USDC-buffer target (band 10–20%).\n"
        "Not live protocol data.",
        ha="center",
        fontsize=9,
        color=MUTED,
    )
    fig.savefig(OUT / "c1-reserve-composition.svg", bbox_inches="tight", facecolor=BG)
    plt.close(fig)


def c2_yield_attribution():
    """
    C2 · Yield attribution stack for a representative senior-tranche loan,
    reported in basis points per year.

    Inputs derive from design-spec § "Numbers to quote":
    - Senior coupon: shown net of fees below.
    - Management fee: 0.5-1.5% (50-150 bps); midpoint 100 bps.
    - Performance fee: 10-20% of senior net interest; shown at mid-range 15%
      applied to a representative 800 bps senior gross → 120 bps.
    - OET allocation: 0.05-0.10% (5-10 bps); midpoint 8 bps.
    - T-bill accrual reaches the vault at 70% of USYC NAV delta — value shown
      illustratively at ~350 bps (half of a representative 5% annualised
      T-bill accrual applied to the ~15% USDC / ~60% USYC mix × 70% share).
    - Senior coupon net = senior gross - management fee - performance fee
      (e.g. 800 - 100 - 120 = 580 bps). Shown at 600 bps illustratively.

    Bar values are representative, NOT promises.
    """
    categories = [
        "Senior coupon (net of fees)",
        "T-bill accrual (70% vault share)",
        "Management fee (routed to Treasury)",
        "Performance fee (routed to Treasury)",
        "OET allocation (routed to Treasury)",
    ]
    values_bps = [600, 350, 100, 120, 8]
    colors = [SAGE, AMBER, ROSE, ROSE, ROSE]

    fig, ax = plt.subplots(figsize=(9, 4.8))
    ax.set_facecolor(SURFACE)

    bars = ax.barh(categories, values_bps, color=colors, edgecolor=BG, linewidth=1.5)
    ax.set_xlabel("Basis points per year (bps)")
    ax.set_title("Yield attribution — illustrative representative loan", pad=14)
    ax.set_xlim(0, max(values_bps) * 1.25)

    for bar, v in zip(bars, values_bps):
        ax.text(
            v + max(values_bps) * 0.02,
            bar.get_y() + bar.get_height() / 2,
            f"{v} bps",
            va="center",
            fontsize=10,
            color=TEXT,
        )

    ax.invert_yaxis()
    fig.text(
        0.5,
        -0.02,
        "Illustrative attribution for a single representative senior-tranche loan and the T-bill engine.\n"
        "Fee ranges: management 0.5–1.5%, performance 10–20% of senior net, OET 0.05–0.10%. Not live returns.",
        ha="center",
        fontsize=9,
        color=MUTED,
    )
    fig.savefig(OUT / "c2-yield-attribution.svg", bbox_inches="tight", facecolor=BG)
    plt.close(fig)


def c3_ccr_ladder():
    """
    C3 · CCR threshold ladder.

    Thresholds fixed by the credit framework (design-spec § "Numbers to quote"):
    - Watchlist trigger: CCR < 130%
    - Maintenance margin call: CCR < 120%
    - Margin call: CCR < 110%

    Displayed as a horizontal banded strip over CCR in %.
    """
    fig, ax = plt.subplots(figsize=(9, 3.6))
    ax.set_facecolor(SURFACE)

    # (low, high, colour, label)
    bands = [
        (100, 110, ROSE,   "Margin call · CCR < 110%"),
        (110, 120, AMBER,  "Maintenance margin call · CCR < 120%"),
        (120, 130, AMBER,  "Watchlist · CCR < 130%"),
        (130, 180, SAGE,   "Healthy · CCR ≥ 130%"),
    ]
    for low, high, color, label in bands:
        ax.barh([0], [high - low], left=low, color=color, alpha=0.85,
                edgecolor=BG, linewidth=2)
        ax.text((low + high) / 2, 0, label, ha="center", va="center",
                fontsize=10, color=BG, fontweight="bold")

    for t in [110, 120, 130]:
        ax.axvline(t, color=TEXT, linestyle="--", linewidth=0.7, alpha=0.45)
        ax.text(t, 0.58, f"{t}%", ha="center", va="bottom",
                fontsize=9, color=MUTED)

    ax.set_xlim(100, 180)
    ax.set_ylim(-0.6, 0.8)
    ax.set_yticks([])
    ax.set_xlabel("CCR · collateral value ÷ outstanding senior principal (%)")
    ax.set_title("Collateral coverage ratio — notification thresholds", pad=12)
    ax.grid(False)

    fig.text(
        0.5,
        -0.04,
        "CCR = collateral commodity value ÷ outstanding senior principal, as a percentage.\n"
        "Thresholds are fixed by the credit framework — not live protocol data.\n"
        "Payment-delay amber/red: >7 days / >21 days late.",
        ha="center",
        fontsize=9,
        color=MUTED,
    )
    fig.savefig(OUT / "c3-ccr-ladder.svg", bbox_inches="tight", facecolor=BG)
    plt.close(fig)


def main():
    c1_reserve_composition()
    c2_yield_attribution()
    c3_ccr_ladder()
    print(f"Charts written to {OUT}")
    for f in sorted(OUT.glob("c*.svg")):
        print(f"  - {f.name} ({f.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
