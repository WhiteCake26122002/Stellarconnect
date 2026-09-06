"""
Shared visual design system for the Streamlit UI: one dark color palette
(black + deep indigo, per the brand colors requested), one Plotly layout
template, one CSS injection - so every tab/chart looks like part of the same
product instead of an assortment of default-styled widgets.
"""
from __future__ import annotations

import streamlit as st

# ---- Brand palette: black + deep indigo, as specified ------------------
BLACK = "#000000"
NAVY = "#160D70"
NAVY_LIGHT = "#2A1FB0"  # a lighter tint of NAVY, used only where a fill needs to read against a NAVY/BLACK backdrop
NAVY_SOFT = "#221867"   # muted panel/border tint between BLACK and NAVY

INK = "#FFFFFF"
MUTED = "#9C97D6"        # light lavender-gray, muted text against black/navy
BORDER = NAVY_SOFT
PANEL = NAVY
ACCENT = NAVY_LIGHT

# Semantic colors (valuation direction) - intentionally NOT part of the 2-color
# brand palette, since red/green here carries meaning (over/under-valued) that
# the requested reference design itself uses regardless of brand colors.
BEAR = "#EF4444"
BEAR_SOFT = "rgba(239,68,68,0.15)"
BASE_C = "#8B85E8"
BULL = "#22C55E"
BULL_SOFT = "rgba(34,197,94,0.15)"
WARN = "#F59E0B"
WARN_SOFT = "rgba(245,158,11,0.15)"

HISTORICAL = MUTED
FORECAST = NAVY_LIGHT

SCENARIO_COLORS = {"Bear Case": BEAR, "Base Case": BASE_C, "Bull Case": BULL}


def _flatten_html(html: str) -> str:
    """
    Strips leading whitespace from every line of a multi-line HTML string.
    Required before handing raw HTML to st.markdown(unsafe_allow_html=True):
    Streamlit's markdown parser treats any line indented 4+ spaces as an
    indented code block, so a "nicely indented" triple-quoted HTML literal
    renders as literal text (e.g. a stray "</div>") instead of markup.
    """
    return "\n".join(line.strip() for line in html.strip().split("\n"))


def inject_css() -> None:
    st.markdown(
        f"""
        <style>
        .stApp {{
            font-family: -apple-system, "Segoe UI", Inter, Roboto, sans-serif;
            background: {BLACK};
        }}

        /* ---- Metric cards ---------------------------------------------- */
        div[data-testid="stMetric"] {{
            background: {PANEL};
            border: 1px solid {BORDER};
            border-left: 3px solid {NAVY_LIGHT};
            border-radius: 10px;
            padding: 0.9rem 1rem 0.7rem 1rem;
        }}
        div[data-testid="stMetricLabel"] {{
            font-size: 0.72rem;
            font-weight: 600;
            letter-spacing: 0.03em;
            text-transform: uppercase;
            color: {MUTED};
        }}
        div[data-testid="stMetricValue"] {{
            font-size: 1.5rem;
            color: {INK};
        }}
        /* ---- Header / title ---------------------------------------------- */
        h1, h2, h3, h4, p, span, label, .stMarkdown {{
            color: {INK};
        }}
        h1 {{ font-weight: 700 !important; letter-spacing: -0.01em; }}
        h2, h3 {{ font-weight: 650 !important; }}

        /* ---- Containers / cards ------------------------------------------ */
        div[data-testid="stVerticalBlockBorderWrapper"] {{
            background: {PANEL};
            border: 1px solid {BORDER} !important;
            border-radius: 12px;
        }}

        /* ---- Tabs ---------------------------------------------------- */
        button[data-baseweb="tab"] {{
            font-weight: 600;
            font-size: 0.92rem;
            color: {MUTED} !important;
        }}
        button[data-baseweb="tab"][aria-selected="true"] {{
            color: {INK} !important;
        }}
        div[data-baseweb="tab-highlight"] {{
            background-color: {NAVY_LIGHT} !important;
            height: 3px !important;
        }}
        div[data-baseweb="tab-border"] {{ background-color: {BORDER} !important; }}

        /* ---- Sidebar ---------------------------------------------------- */
        section[data-testid="stSidebar"] {{
            background: {BLACK};
            border-right: 1px solid {BORDER};
        }}
        section[data-testid="stSidebar"] h1 {{
            font-size: 1.05rem !important;
            margin-top: 0.6rem;
        }}
        section[data-testid="stSidebar"] h3 {{
            font-size: 0.85rem !important;
            color: {MUTED};
            text-transform: uppercase;
            letter-spacing: 0.03em;
            margin-top: 1.1rem;
        }}

        /* ---- Dataframes / tables ---------------------------------------- */
        div[data-testid="stDataFrame"] {{
            border: 1px solid {BORDER};
            border-radius: 8px;
            overflow: hidden;
        }}

        /* ---- Buttons / segmented control ---------------------------------- */
        div.stButton > button, div.stDownloadButton > button {{
            border-radius: 8px;
            font-weight: 600;
            background: {NAVY};
            border: 1px solid {BORDER};
            color: {INK};
        }}
        div[data-testid="stSegmentedControl"] label {{
            background: {BLACK} !important;
            border-color: {BORDER} !important;
            color: {MUTED} !important;
        }}
        div[data-testid="stSegmentedControl"] label[aria-checked="true"] {{
            background: {NAVY_LIGHT} !important;
            color: {INK} !important;
        }}

        /* ---- Alerts ---------------------------------------------------- */
        div[data-testid="stAlert"] {{
            border-radius: 10px;
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def _extract_domain(website: str) -> str:
    if not website:
        return ""
    domain = website.split("//")[-1].split("/")[0].strip().lower()
    return domain[4:] if domain.startswith("www.") else domain


def _avatar_html(website: str, initial: str) -> str:
    """
    Renders the card's avatar as the company's real favicon/logo (via Google's
    favicon service, keyed off the company's own website domain) when one is
    known, falling back to a plain letter circle - both if no website is on
    record, and live (via onerror) if the favicon request itself fails.
    """
    domain = _extract_domain(website)
    if not domain:
        return f'<div class="iv-avatar">{initial}</div>'
    logo_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=64"
    return (
        f'<div class="iv-avatar iv-avatar-logo">'
        f'<img src="{logo_url}" alt="{initial}" '
        f"onerror=\"this.onerror=null;this.parentElement.classList.remove('iv-avatar-logo');"
        f"this.parentElement.textContent='{initial}';\" />"
        f"</div>"
    )


def intrinsic_value_card(
    ticker: str,
    company_name: str,
    intrinsic_value: float | None,
    current_price: float | None,
    currency_symbol: str,
    website: str = "",
) -> str:
    """
    Builds the "Intrinsic Value vs. Price" comparison card as raw HTML: a big
    headline number, an over/under-valuation badge, and two bars (Intrinsic
    Value / Price) where the gap between them is hatched in green (undervalued,
    intrinsic > price) or red (overvalued, intrinsic < price).
    """
    initial = (ticker or company_name or "?")[:1].upper()
    title = f"{ticker or company_name} Intrinsic Value"
    avatar = _avatar_html(website, initial)

    if intrinsic_value is None or current_price is None or current_price == 0:
        return _flatten_html(
            f'<div class="iv-card"><div class="iv-top">'
            f'{avatar}<div class="iv-title">{title}</div></div>'
            f'<div class="iv-bignum">n/a</div>'
            f'<div class="iv-note">Not enough data to compare intrinsic value to market price for this scenario.</div>'
            f"</div>"
        )

    pct = intrinsic_value / current_price - 1
    undervalued = pct >= 0
    badge_class = "under" if undervalued else "over"
    badge_text = f"{'UNDERVALUATION' if undervalued else 'OVERVALUATION'} {abs(pct):.0%}"

    max_val = max(intrinsic_value, current_price, 1e-9)
    min_val = min(intrinsic_value, current_price)
    iv_pct = max(intrinsic_value, 0) / max_val * 100
    price_pct = max(current_price, 0) / max_val * 100
    gap_lo_pct = max(min_val, 0) / max_val * 100
    hatch_color = "green" if undervalued else "red"

    iv_hatch = f'<div class="iv-hatch {hatch_color}" style="left:{gap_lo_pct:.2f}%; width:{max(iv_pct - gap_lo_pct, 0):.2f}%;"></div>' if undervalued else ""
    price_hatch = f'<div class="iv-hatch {hatch_color}" style="left:{gap_lo_pct:.2f}%; width:{max(price_pct - gap_lo_pct, 0):.2f}%;"></div>' if not undervalued else ""

    return _flatten_html(f"""
    <div class="iv-card">
        <div class="iv-top">
            <div class="iv-top-left">
                {avatar}
                <div class="iv-title">{title}</div>
            </div>
            <div class="iv-badge {badge_class}">{badge_text}</div>
        </div>
        <div class="iv-bignum">{currency_symbol}{intrinsic_value:,.2f}</div>
        <div class="iv-bar-row">
            <div class="iv-bar-track">
                <div class="iv-bar-fill navy" style="width:{iv_pct:.2f}%;"><span>Intrinsic Value</span></div>
                {iv_hatch}
            </div>
        </div>
        <div class="iv-bar-row">
            <div class="iv-bar-track">
                <div class="iv-bar-fill gray" style="width:{price_pct:.2f}%;"><span>Price&nbsp;&nbsp;{currency_symbol}{current_price:,.2f}</span></div>
                {price_hatch}
            </div>
        </div>
    </div>
    <style>
    .iv-card {{ background: {BLACK}; border: 1px solid {BORDER}; border-radius: 14px; padding: 18px 20px; }}
    .iv-top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }}
    .iv-top-left {{ display: flex; align-items: center; gap: 10px; }}
    .iv-avatar {{ width: 30px; height: 30px; border-radius: 50%; background: {NAVY}; border: 1px solid {NAVY_LIGHT};
                  display: flex; align-items: center; justify-content: center; font-weight: 700; color: {INK}; font-size: 0.82rem;
                  overflow: hidden; flex-shrink: 0; }}
    .iv-avatar-logo {{ background: #FFFFFF; padding: 5px; box-sizing: border-box; }}
    .iv-avatar-logo img {{ width: 100%; height: 100%; object-fit: contain; }}
    .iv-title {{ font-size: 0.92rem; font-weight: 600; color: {MUTED}; }}
    .iv-badge {{ padding: 5px 11px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }}
    .iv-badge.under {{ background: {BULL}; color: #04170A; }}
    .iv-badge.over {{ background: {BEAR}; color: #240404; }}
    .iv-bignum {{ font-size: 2.1rem; font-weight: 800; color: {INK}; margin-bottom: 16px; }}
    .iv-bar-row {{ margin-bottom: 10px; }}
    .iv-bar-track {{ position: relative; height: 36px; border-radius: 8px; background: rgba(255,255,255,0.05); overflow: hidden; }}
    .iv-bar-fill {{ position: absolute; top: 0; left: 0; height: 100%; border-radius: 8px; display: flex; align-items: center; padding-left: 12px; }}
    .iv-bar-fill span {{ font-size: 0.76rem; font-weight: 600; color: {INK}; white-space: nowrap; }}
    .iv-bar-fill.navy {{ background: {NAVY_LIGHT}; }}
    .iv-bar-fill.gray {{ background: #4B5563; }}
    .iv-hatch {{ position: absolute; top: 0; height: 100%; opacity: 0.9; }}
    .iv-hatch.green {{ background-image: repeating-linear-gradient(45deg, {BULL} 0px, {BULL} 3px, transparent 3px, transparent 8px); }}
    .iv-hatch.red {{ background-image: repeating-linear-gradient(45deg, {BEAR} 0px, {BEAR} 3px, transparent 3px, transparent 8px); }}
    .iv-note {{ font-size: 0.82rem; color: {MUTED}; }}
    </style>
    """)


def base_layout(fig, height: int = 340, **kwargs) -> None:
    """Applies the shared chart chrome (fonts, transparent bg, muted gridlines) in place."""
    fig.update_layout(
        height=height,
        margin=dict(t=28, b=10, l=10, r=10),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family="-apple-system, Segoe UI, Roboto, sans-serif", color=INK, size=13),
        legend=dict(orientation="h", yanchor="bottom", y=1.01, xanchor="left", x=0, bgcolor="rgba(0,0,0,0)", font=dict(color=INK)),
        hoverlabel=dict(bgcolor=NAVY, bordercolor=BORDER, font_color=INK),
        **kwargs,
    )
    fig.update_xaxes(gridcolor=BORDER, zerolinecolor=BORDER, linecolor=BORDER, color=MUTED)
    fig.update_yaxes(gridcolor=BORDER, zerolinecolor=BORDER, linecolor=BORDER, color=MUTED)
