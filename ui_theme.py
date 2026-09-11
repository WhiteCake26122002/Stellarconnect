"""
Shared visual design system for the Streamlit UI: a conventional dark
financial-platform palette (charcoal base, single blue accent) in the
tradition of Bloomberg/Yahoo Finance/Investing.com - dense data, clean
typography, no decorative metaphor - plus one Plotly layout template and
one CSS injection, so every tab/chart looks like part of the same product
instead of an assortment of default-styled widgets.
"""
from __future__ import annotations

import streamlit as st

# ---- Brand palette: charcoal base + a single blue accent ------------------
BLACK = "#0A0C10"         # base canvas
NAVY = "#12151B"          # panel - card/rail surfaces
NAVY_LIGHT = "#3B82F6"    # primary accent - links, active states, primary actions
NAVY_SOFT = "#262B33"     # line/border, between base and panel

CYAN = "#60A5FA"          # secondary accent - hover, benchmark lines, informational
PANEL_RAISED = "#1A1E26"  # nested surfaces: chips, tooltip bodies

INK = "#E8EAED"
MUTED = "#8A919C"         # muted text against the dark surfaces
MUTED_2 = "#5B6270"       # a step quieter still - eyebrow labels, captions
BORDER = NAVY_SOFT
PANEL = NAVY
ACCENT = NAVY_LIGHT

# Semantic colors (valuation direction) - standard finance-site conventions.
BEAR = "#EF4444"
BEAR_SOFT = "rgba(239,68,68,0.15)"
BASE_C = CYAN
BULL = "#22C55E"
BULL_SOFT = "rgba(34,197,94,0.15)"
WARN = "#F59E0B"
WARN_SOFT = "rgba(245,158,11,0.15)"

HISTORICAL = MUTED
FORECAST = NAVY_LIGHT

SCENARIO_COLORS = {"Bear Case": BEAR, "Base Case": BASE_C, "Bull Case": BULL}

CATEGORY_COLORS = {
    "Equity": NAVY_LIGHT, "Debt": WARN, "Hybrid": "#FFFFFF",
    "Index/ETF": CYAN, "Other": MUTED,
}


def _flatten_html(html: str) -> str:
    """
    Strips leading whitespace from every line of a multi-line HTML string.
    Required before handing raw HTML to st.markdown(unsafe_allow_html=True):
    Streamlit's markdown parser treats any line indented 4+ spaces as an
    indented code block, so a "nicely indented" triple-quoted HTML literal
    renders as literal text (e.g. a stray "</div>") instead of markup.
    """
    return "\n".join(line.strip() for line in html.strip().split("\n"))


def sparkline_svg(values: list[float], width: int = 100, height: int = 32, color: str | None = None) -> str:
    """
    A minimal inline-SVG sparkline (polyline + soft fill) for a value series -
    the ticker-row shape cue every finance site uses. No axes, no labels: on
    its own it only ever supplements a real price/change figure next to it.
    Color defaults to gain/loss green or red based on the series' own
    direction; pass one explicitly to override.
    """
    vals = [v for v in values if v is not None]
    if len(vals) < 2:
        return f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}"></svg>'
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1.0
    n = len(vals)
    pad = 2
    usable_h = height - pad * 2
    points = [
        (i / (n - 1) * width, pad + usable_h - (v - lo) / span * usable_h)
        for i, v in enumerate(vals)
    ]
    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    fill_pts = f"0,{height} " + line + f" {width},{height}"
    stroke = color or (BULL if vals[-1] >= vals[0] else BEAR)
    return _flatten_html(f"""
    <svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" preserveAspectRatio="none">
        <polygon points="{fill_pts}" fill="{stroke}" opacity="0.12"/>
        <polyline points="{line}" fill="none" stroke="{stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    """)


def watchlist_row_html(
    symbol: str, subtitle: str, price: str, change_pct: float | None, spark_values: list[float] | None = None,
) -> str:
    """
    One dense ticker row - symbol, a short subtitle (qty/name), an optional
    sparkline, price, and a colored change badge - the anatomy every
    watchlist on Bloomberg/Yahoo Finance/Investing.com shares.
    """
    if change_pct is None:
        chg_html = '<span class="wl-chg flat">-</span>'
    else:
        cls = "up" if change_pct >= 0 else "down"
        chg_html = f'<span class="wl-chg {cls}">{"+" if change_pct >= 0 else ""}{change_pct:.2f}%</span>'
    spark_html = sparkline_svg(spark_values, width=88, height=30) if spark_values else '<span class="wl-spark-empty">-</span>'
    return _flatten_html(f"""
    <div class="wl-row">
        <div class="wl-id"><div class="wl-symbol">{symbol}</div><div class="wl-subtitle">{subtitle}</div></div>
        <div class="wl-spark">{spark_html}</div>
        <div class="wl-price">{price}</div>
        <div class="wl-change">{chg_html}</div>
    </div>
    """)


# Small, hand-picked Lucide-style icon set (MIT licensed, stroke-based, 24x24 viewBox) for KPI
# cards - inline SVG rather than emoji or an icon-font CDN, so it never depends on font coverage
# or an external request that could fail.
_KPI_ICONS = {
    "wallet": '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
    "trending-up": '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    "trending-down": '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
    "bar-chart": '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
    "percent": '<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    "layers": '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    "target": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.35 8.95a1 1 0 0 1-1.3 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.79 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/>',
}


def kpi_card(
    label: str, value: str, icon: str = "bar-chart", change_pct: float | None = None, tooltip: str | None = None,
) -> str:
    """
    A KPI/metric card: an icon in a soft-tinted circle, an optional up/down trend badge, a large
    value, and a label - used everywhere a plain st.metric() needs more visual weight (portfolio
    value, enterprise value, cash left, etc). Pure HTML + inline SVG, no components.html and no
    fixed height, so unlike an iframe-based card it can never clip wrapped text.

    Pass `change_pct=None` (the default) for a point-in-time figure with no real trend to show
    (e.g. WACC, a valuation multiple) - the badge is only rendered when there's an actual change
    to disclose, never faked for visual symmetry.

    Pass `tooltip` for jargon-heavy metrics (WACC, terminal growth, ...) to get a native
    hover tooltip explaining the term - skip it where the label is already self-explanatory.
    """
    title_attr = f' title="{tooltip}"' if tooltip else ""
    icon_path = _KPI_ICONS.get(icon, _KPI_ICONS["bar-chart"])
    icon_html = (
        '<div class="kpi-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{icon_path}</svg></div>'
    )
    badge_html = ""
    if change_pct is not None:
        cls = "up" if change_pct >= 0 else "down"
        arrow = "M12 19V5M5 12l7-7 7 7" if change_pct >= 0 else "M12 5v14M19 12l-7 7-7-7"
        badge_html = (
            f'<div class="kpi-badge {cls}">'
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" '
            f'stroke-linecap="round" stroke-linejoin="round"><path d="{arrow}"/></svg>'
            f"{abs(change_pct):.1f}%</div>"
        )
    label_cls = "kpi-label has-tip" if tooltip else "kpi-label"
    return _flatten_html(f"""
    <div class="kpi-card">
        <div class="kpi-top">{icon_html}{badge_html}</div>
        <div class="kpi-value">{value}</div>
        <div class="{label_cls}"{title_attr}>{label}</div>
    </div>
    """)


def inject_css() -> None:
    st.markdown(
        """
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
        """,
        unsafe_allow_html=True,
    )
    st.markdown(
        f"""
        <style>
        .stApp {{
            font-family: 'IBM Plex Sans', -apple-system, "Segoe UI", Roboto, sans-serif;
            background: {BLACK};
        }}
        h1, h2, h3, h4, h5, h6 {{
            font-family: 'IBM Plex Sans', sans-serif !important;
        }}

        /* Financial figures (metrics, tables) hold a fixed digit width so a refreshing
           number never jitters or reflows its neighbors. */
        div[data-testid="stMetricValue"], div[data-testid="stDataFrame"] {{
            font-variant-numeric: tabular-nums;
            font-family: 'IBM Plex Mono', monospace;
        }}

        /* A visible, on-brand focus ring for keyboard navigation - browsers otherwise fall
           back to a default outline that doesn't match the rest of the theme. */
        button:focus-visible, input:focus-visible, textarea:focus-visible, a:focus-visible,
        [role="tab"]:focus-visible, [role="radio"]:focus-visible {{
            outline: 2px solid {NAVY_LIGHT} !important;
            outline-offset: 2px !important;
        }}

        /* ---- Metric cards ---------------------------------------------- */
        div[data-testid="stMetric"] {{
            background: {PANEL};
            border: 1px solid {BORDER};
            border-radius: 8px;
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

        /* ---- KPI cards (icon + optional trend badge + big value) --------- */
        .kpi-card {{
            background: {PANEL};
            border: 1px solid {BORDER};
            border-radius: 8px;
            padding: 1.1rem 1.2rem;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }}
        .kpi-card:hover {{
            border-color: {NAVY_LIGHT}77;
            box-shadow: 0 4px 14px -4px rgba(0,0,0,0.5);
        }}
        .kpi-top {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.9rem; }}
        .kpi-icon {{
            width: 36px; height: 36px; border-radius: 8px;
            background: {NAVY_LIGHT}1E; color: {NAVY_LIGHT};
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }}
        .kpi-icon svg {{ width: 18px; height: 18px; }}
        .kpi-badge {{
            display: inline-flex; align-items: center; gap: 3px;
            font-family: 'IBM Plex Mono', monospace;
            font-size: 0.74rem; font-weight: 700;
            padding: 3px 8px; border-radius: 4px; white-space: nowrap;
        }}
        .kpi-badge svg {{ width: 12px; height: 12px; }}
        .kpi-badge.up {{ background: {BULL_SOFT}; color: {BULL}; }}
        .kpi-badge.down {{ background: {BEAR_SOFT}; color: {BEAR}; }}
        .kpi-value {{
            font-family: 'IBM Plex Mono', monospace;
            font-size: 1.55rem; font-weight: 700; color: {INK};
            margin-bottom: 0.15rem; letter-spacing: -0.01em;
            font-variant-numeric: tabular-nums;
        }}
        .kpi-label {{ font-size: 0.8rem; color: {MUTED}; font-weight: 500; }}
        .kpi-label.has-tip {{ cursor: help; width: fit-content; border-bottom: 1px dotted {MUTED_2}; }}
        .kpi-label.has-tip:hover {{ color: {INK}; border-bottom-color: {NAVY_LIGHT}; }}

        /* ---- Header / title ---------------------------------------------- */
        h1, h2, h3, h4, p, span, label, .stMarkdown {{
            color: {INK};
        }}
        h1 {{ font-weight: 700 !important; letter-spacing: -0.01em; }}
        h2, h3 {{ font-weight: 600 !important; }}

        /* ---- Containers / cards ------------------------------------------ */
        div[data-testid="stVerticalBlockBorderWrapper"] {{
            background: {PANEL};
            border: 1px solid {BORDER} !important;
            border-radius: 8px;
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }}
        div[data-testid="stVerticalBlockBorderWrapper"]:hover {{
            border-color: {NAVY_LIGHT}77 !important;
            box-shadow: 0 4px 14px -4px rgba(0,0,0,0.5);
        }}

        /* ---- Tabs ---------------------------------------------------- */
        [data-testid="stTab"] {{
            font-family: 'IBM Plex Mono', monospace;
            font-weight: 500;
            font-size: 0.85rem;
            color: {MUTED} !important;
            transition: color 0.15s ease;
        }}
        [data-testid="stTab"]:hover {{ color: {INK} !important; }}
        [data-testid="stTab"][aria-selected="true"] {{ color: {INK} !important; }}
        /* React Aria's own selection-indicator class (not Streamlit's, so it isn't a
           data-testid) - the moving underline beneath the active tab. */
        .react-aria-SelectionIndicator {{
            background-color: {NAVY_LIGHT} !important;
            height: 2px !important;
        }}

        /* ---- Radio groups: a segmented-pill look instead of bare dots -------- */
        [data-testid="stRadioOption"] {{
            border-radius: 6px;
            padding: 4px 10px;
            margin: 1px 0;
            transition: background-color 0.15s ease;
        }}
        [data-testid="stRadioOption"]:hover {{ background: rgba(255,255,255,0.05); }}
        [data-testid="stRadioOption"][data-selected="true"] {{ background: {NAVY_LIGHT}22; }}

        /* ---- Text / number / select inputs: a brand focus glow --------------- */
        [data-testid="stTextInputRootElement"], [data-testid="stNumberInputContainer"],
        [data-testid="stSelectbox"] [role="group"] {{
            transition: box-shadow 0.15s ease, border-color 0.15s ease;
        }}
        [data-testid="stTextInputRootElement"]:focus-within,
        [data-testid="stNumberInputContainer"]:focus-within,
        [data-testid="stSelectbox"] [role="group"]:focus-within {{
            box-shadow: 0 0 0 3px {NAVY_LIGHT}2E;
            border-color: {NAVY_LIGHT} !important;
        }}

        /* ---- Alerts: a colored left edge that names the severity at a glance -- */
        [data-testid="stAlertContainer"] {{
            border-left: 3px solid transparent;
            border-radius: 6px;
        }}
        [data-testid="stAlertContainer"]:has([data-testid="stAlertContentSuccess"]) {{ border-left-color: {BULL}; }}
        [data-testid="stAlertContainer"]:has([data-testid="stAlertContentInfo"]) {{ border-left-color: {NAVY_LIGHT}; }}
        [data-testid="stAlertContainer"]:has([data-testid="stAlertContentWarning"]) {{ border-left-color: {WARN}; }}
        [data-testid="stAlertContainer"]:has([data-testid="stAlertContentError"]) {{ border-left-color: {BEAR}; }}

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
            font-family: 'IBM Plex Mono', monospace !important;
            font-size: 0.76rem !important;
            color: {MUTED};
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-top: 1.1rem;
        }}

        /* ---- Dataframes / tables ---------------------------------------- */
        div[data-testid="stDataFrame"] {{
            border: 1px solid {BORDER};
            border-radius: 6px;
            overflow: hidden;
        }}

        /* ---- Buttons / segmented control ---------------------------------- */
        div.stButton > button, div.stDownloadButton > button {{
            border-radius: 6px;
            font-weight: 600;
            background: {PANEL_RAISED};
            border: 1px solid {BORDER};
            color: {INK};
            transition: border-color 0.15s ease, background-color 0.15s ease;
        }}
        div.stButton > button:hover, div.stDownloadButton > button:hover {{ border-color: {NAVY_LIGHT}; }}
        div.stButton > button:active, div.stDownloadButton > button:active {{ transform: scale(0.98); }}
        @media (prefers-reduced-motion: reduce) {{
            div.stButton > button:active, div.stDownloadButton > button:active {{ transform: none; }}
        }}

        /* Primary actions (Enter, Add to Portfolio, ...) get real visual weight - a solid
           brand fill - instead of reading the same as every secondary button on the page. */
        button[data-testid="stBaseButton-primary"] {{
            background: {NAVY_LIGHT} !important;
            border: 1px solid {NAVY_LIGHT} !important;
            color: #071022 !important;
            transition: filter 0.15s ease;
        }}
        button[data-testid="stBaseButton-primary"]:hover {{ filter: brightness(1.1); }}

        /* ---- Spinner ------------------------------------------------------ */
        [data-testid="stSpinnerIcon"] {{
            border-top-color: {NAVY_LIGHT} !important;
            border-right-color: {NAVY_LIGHT}66 !important;
        }}
        [data-testid="stButtonGroup"] button[data-variant="segmented_control"] {{
            background: {BLACK} !important;
            border-color: {BORDER} !important;
            color: {MUTED} !important;
            font-family: 'IBM Plex Mono', monospace;
            transition: background-color 0.15s ease, color 0.15s ease;
        }}
        [data-testid="stButtonGroup"] button[data-variant="segmented_control"][aria-checked="true"] {{
            background: {NAVY_LIGHT} !important;
            color: #071022 !important;
        }}

        /* ---- Watchlist rows (holdings, popular stocks) -------------------- */
        .wl-row {{
            display: grid; grid-template-columns: 1.4fr 1fr 0.8fr 0.7fr; align-items: center;
            gap: 14px; padding: 10px 4px; border-bottom: 1px solid {BORDER};
        }}
        .wl-row:last-child {{ border-bottom: none; }}
        .wl-symbol {{ font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 0.88rem; color: {INK}; }}
        .wl-subtitle {{ font-size: 0.74rem; color: {MUTED_2}; margin-top: 1px; }}
        .wl-spark {{ display: flex; align-items: center; }}
        .wl-spark-empty {{ color: {MUTED_2}; font-size: 0.8rem; }}
        .wl-price {{ font-family: 'IBM Plex Mono', monospace; font-size: 0.88rem; color: {INK}; text-align: right;
            font-variant-numeric: tabular-nums; }}
        .wl-change {{ text-align: right; }}
        .wl-chg {{ font-family: 'IBM Plex Mono', monospace; font-size: 0.8rem; font-weight: 600; padding: 2px 7px;
            border-radius: 4px; white-space: nowrap; }}
        .wl-chg.up {{ background: {BULL_SOFT}; color: {BULL}; }}
        .wl-chg.down {{ background: {BEAR_SOFT}; color: {BEAR}; }}
        .wl-chg.flat {{ color: {MUTED_2}; }}
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
    Builds the "Intrinsic Value vs. Price" comparison card: a big headline
    number, an over/under-valuation badge, and two bars (Intrinsic Value /
    Price) where the gap between them is hatched in green (undervalued,
    intrinsic > price) or red (overvalued, intrinsic < price) - the same
    fair-value-vs-market-price comparison a conventional valuation tool
    shows, without any decorative metaphor.
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
    .iv-card {{ background: {BLACK}; border: 1px solid {BORDER}; border-radius: 8px; padding: 18px 20px; }}
    .iv-top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }}
    .iv-top-left {{ display: flex; align-items: center; gap: 10px; }}
    .iv-avatar {{ width: 30px; height: 30px; border-radius: 50%; background: {PANEL}; border: 1px solid {BORDER};
                  display: flex; align-items: center; justify-content: center; font-weight: 700; color: {INK}; font-size: 0.82rem;
                  overflow: hidden; flex-shrink: 0; }}
    .iv-avatar-logo {{ background: #FFFFFF; padding: 5px; box-sizing: border-box; }}
    .iv-avatar-logo img {{ width: 100%; height: 100%; object-fit: contain; }}
    .iv-title {{ font-size: 0.9rem; font-weight: 600; color: {MUTED}; }}
    .iv-badge {{ padding: 5px 11px; border-radius: 4px; font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem;
                 font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }}
    .iv-badge.under {{ background: {BULL}; color: #04170A; }}
    .iv-badge.over {{ background: {BEAR}; color: #240404; }}
    .iv-bignum {{ font-family: 'IBM Plex Mono', monospace; font-size: 2rem; font-weight: 700; color: {INK}; margin-bottom: 16px; }}
    .iv-bar-row {{ margin-bottom: 10px; }}
    .iv-bar-track {{ position: relative; height: 34px; border-radius: 6px; background: rgba(255,255,255,0.04); overflow: hidden; }}
    .iv-bar-fill {{ position: absolute; top: 0; left: 0; height: 100%; border-radius: 6px; display: flex; align-items: center; padding-left: 12px; }}
    .iv-bar-fill span {{ font-size: 0.76rem; font-weight: 600; color: {INK}; white-space: nowrap; }}
    .iv-bar-fill.navy {{ background: {NAVY_LIGHT}; }}
    .iv-bar-fill.gray {{ background: #4B5563; }}
    .iv-hatch {{ position: absolute; top: 0; height: 100%; opacity: 0.85; }}
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
        font=dict(family="IBM Plex Mono, -apple-system, Segoe UI, Roboto, sans-serif", color=INK, size=13),
        legend=dict(orientation="h", yanchor="bottom", y=1.01, xanchor="left", x=0, bgcolor="rgba(0,0,0,0)", font=dict(color=INK)),
        hoverlabel=dict(bgcolor=NAVY, bordercolor=BORDER, font_color=INK),
        **kwargs,
    )
    fig.update_xaxes(gridcolor=BORDER, zerolinecolor=BORDER, linecolor=BORDER, color=MUTED)
    fig.update_yaxes(gridcolor=BORDER, zerolinecolor=BORDER, linecolor=BORDER, color=MUTED)
