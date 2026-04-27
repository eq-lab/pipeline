"""
Generate illustrative static charts for the Pipeline user docs.
Outputs SVGs to docs/user-docs/assets/charts/.

Every printed number traces back to design-spec § "Numbers to quote"
(docs/superpowers/specs/2026-04-23-user-docs-design.md).

Run:
    python3 docs/user-docs/scripts/build_charts.py
"""

from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

OUT = Path(__file__).resolve().parent.parent / "assets" / "charts"
OUT.mkdir(parents=True, exist_ok=True)

# Palette (must match assets/css/main.css)
BG = "#0f1419"
SURFACE = "#161b22"
SURFACE2 = "#1a2030"
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
    "axes.grid": False,
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

    Rendered as a horizontal stacked bar with a tidy legend below — much
    cleaner than a pie with leader-line annotations, especially at
    embedded document sizes.
    """
    labels = [
        "USDC in Capital Wallet (buffer, target 15%)",
        "USYC holdings (T-bill position)",
        "USDC on active loans",
        "USDC in transit",
    ]
    sizes = [15, 60, 22, 3]
    colors = [SAGE, AMBER, LAVENDER, SLATE]

    fig, ax = plt.subplots(figsize=(10, 3.2))
    ax.set_facecolor(SURFACE)

    left = 0
    for size, color, label in zip(sizes, colors, labels):
        ax.barh([0], [size], left=left, color=color, edgecolor=BG, linewidth=2.5)
        # In-bar label only if the segment is wide enough.
        if size >= 10:
            ax.text(left + size / 2, 0, f"{size}%", ha="center", va="center",
                    fontsize=14, fontweight="bold", color=BG)
        left += size

    ax.set_xlim(0, 100)
    ax.set_ylim(-0.8, 0.8)
    ax.set_yticks([])
    ax.set_xticks([0, 25, 50, 75, 100])
    ax.set_xticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax.set_xlabel("Share of total reserves")
    ax.set_title("Reserve composition — illustrative mid-deployment state", pad=14, loc="left")

    # Legend below the bar, two columns.
    legend_handles = [
        Patch(facecolor=c, edgecolor=BG, label=f"{lab} — {s}%")
        for lab, s, c in zip(labels, sizes, colors)
    ]
    ax.legend(
        handles=legend_handles,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.35),
        ncol=2,
        frameon=False,
        fontsize=10,
        labelcolor=TEXT,
    )

    fig.text(
        0.5,
        -0.05,
        "Illustrative reserve composition at the 15% USDC-buffer target (band 10–20%). Not live protocol data.",
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
    - Management fee: 0.5-1.5% (50-150 bps); midpoint 100 bps.
    - Performance fee: 10-20% of senior net interest; shown at mid-range 15%
      applied to a representative 800 bps senior gross → 120 bps.
    - OET allocation: 0.05-0.10% (5-10 bps); midpoint 8 bps.
    - T-bill accrual reaches the vault at 70% of USYC NAV delta — shown
      illustratively at ~350 bps.
    - Senior coupon net = senior gross - management fee - performance fee
      (e.g. 800 - 100 - 120 = 580 bps). Shown at 600 bps illustratively.

    Bar values are representative, NOT promises.
    """
    categories = [
        "Senior coupon (net of fees)",
        "T-bill accrual (70% vault share)",
        "Management fee (to Treasury)",
        "Performance fee (to Treasury)",
        "OET allocation (to Treasury)",
    ]
    values_bps = [600, 350, 100, 120, 8]
    colors = [SAGE, AMBER, ROSE, ROSE, ROSE]

    fig, ax = plt.subplots(figsize=(11, 4.6))
    ax.set_facecolor(SURFACE)

    bars = ax.barh(categories, values_bps, color=colors,
                   edgecolor=BG, linewidth=1.5, height=0.66)
    ax.set_xlabel("Basis points per year (bps)")
    ax.set_title("Yield attribution — illustrative representative loan",
                 pad=14, loc="left")
    ax.set_xlim(0, max(values_bps) * 1.22)

    for bar, v in zip(bars, values_bps):
        ax.text(
            v + max(values_bps) * 0.018,
            bar.get_y() + bar.get_height() / 2,
            f"{v} bps",
            va="center",
            fontsize=11,
            fontweight="bold",
            color=TEXT,
        )

    ax.invert_yaxis()
    ax.grid(axis="x", color=BORDER, linewidth=0.5)
    ax.set_axisbelow(True)

    fig.text(
        0.5,
        -0.06,
        "Illustrative attribution for a single representative senior-tranche loan and the T-bill engine. Not live returns.\n"
        "Fee ranges: management 0.5–1.5%, performance 10–20% of senior net, OET 0.05–0.10%.",
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

    Clean layout: short band names above the strip, threshold ticks below,
    full-description legend at the bottom.
    """
    fig, ax = plt.subplots(figsize=(11, 4.8))
    fig.subplots_adjust(top=0.82, bottom=0.38)
    ax.set_facecolor(SURFACE)

    # (low, high, colour, short_label, long_label)
    bands = [
        (100, 110, ROSE,  "Margin call",            "Margin call · CCR < 110% — enforcement action"),
        (110, 120, AMBER, "Maintenance",            "Maintenance margin call · CCR < 120% — top-up request"),
        (120, 130, AMBER, "Watchlist",              "Watchlist · CCR < 130% — early warning"),
        (130, 180, SAGE,  "Healthy",                "Healthy · CCR ≥ 130%"),
    ]

    # Draw the strip
    for low, high, color, short, _ in bands:
        ax.barh([0], [high - low], left=low, color=color, alpha=0.92,
                edgecolor=BG, linewidth=2, height=0.5)
        # Short label above the band, only where band is wide enough (10%+ is fine).
        ax.text((low + high) / 2, 0.42, short, ha="center", va="bottom",
                fontsize=11, color=TEXT, fontweight="bold")

    # Threshold ticks and labels BELOW the strip.
    for t in [110, 120, 130]:
        ax.plot([t, t], [-0.28, -0.38], color=TEXT, linewidth=1)
        ax.text(t, -0.46, f"{t}%", ha="center", va="top",
                fontsize=10, color=TEXT, fontweight="bold")
    for t in [100, 180]:
        ax.text(t, -0.46, f"{t}%", ha="center", va="top",
                fontsize=10, color=MUTED)

    ax.set_xlim(97, 183)
    ax.set_ylim(-1.1, 1.0)
    ax.set_yticks([])
    ax.set_xticks([])
    ax.set_title("Collateral coverage ratio — notification thresholds",
                 pad=14, loc="left")

    # Legend (long descriptions) below.
    legend_handles = [
        Patch(facecolor=c, edgecolor=BG, label=long)
        for _, _, c, _, long in bands
    ]
    ax.legend(
        handles=legend_handles,
        loc="upper center",
        bbox_to_anchor=(0.5, -0.15),
        ncol=2,
        frameon=False,
        fontsize=10,
        labelcolor=TEXT,
    )

    # Caption well below the legend in figure coordinates.
    fig.text(
        0.5,
        0.03,
        "CCR = collateral commodity value ÷ outstanding senior principal, as a percentage.\n"
        "Thresholds are fixed by the credit framework — not live protocol data. Payment-delay amber/red: >7 days / >21 days late.",
        ha="center",
        fontsize=9,
        color=MUTED,
    )

    fig.savefig(OUT / "c3-ccr-ladder.svg", facecolor=BG)
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
