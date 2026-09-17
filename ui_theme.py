"""
Shared visual design system for the Streamlit UI: a deep-space palette (void
black, violet/cyan nebula accent) with three cosmic metaphors, one for each
mode - a gravity well for DCF valuation, an orbit system for paper trading
holdings, a star cluster for mutual fund allocation - built with the
information density of a real trading terminal (TradingView-style: real
sparklines, tight KPI grids, dense tooltips), not a sparse showcase. Plus
one Plotly layout template and one CSS injection, so every tab/chart looks
like part of the same product instead of an assortment of default-styled
widgets.
"""
from __future__ import annotations

import hashlib
import math

import streamlit as st

# ---- Brand palette: deep space void + a violet/cyan nebula accent ---------
BLACK = "#06060C"        # void - base canvas
NAVY = "#0E0F1E"          # panel - card/rail surfaces
NAVY_LIGHT = "#A684FF"    # violet - primary accent
NAVY_SOFT = "#26284A"     # line/border, between void and panel

CYAN = "#6FD9EA"          # secondary accent - hover, benchmarks, information
PANEL_RAISED = "#13152B"  # nested surfaces: chips, tooltip bodies

INK = "#EEF0FB"
MUTED = "#9A9ECB"         # lavender-gray, muted text against void/panel
MUTED_2 = "#5D6191"       # a step quieter still - eyebrow labels, captions
BORDER = NAVY_SOFT
PANEL = NAVY
ACCENT = NAVY_LIGHT

# Semantic colors (valuation direction) - intentionally not part of the
# void/violet/cyan brand pair, since gain/loss here carries meaning that has
# to read correctly regardless of the rest of the palette.
BEAR = "#FF8A76"
BEAR_SOFT = "rgba(255,138,118,0.15)"
BASE_C = CYAN
BULL = "#5FE0A8"
BULL_SOFT = "rgba(95,224,168,0.15)"
WARN = "#ECC971"
WARN_SOFT = "rgba(236,201,113,0.15)"

HISTORICAL = MUTED
FORECAST = NAVY_LIGHT

SCENARIO_COLORS = {"Bear Case": BEAR, "Base Case": BASE_C, "Bull Case": BULL}

# Category -> color, reused by both the fund star cluster and any legend
# drawn next to it, so a category is always the same color everywhere.
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


def _stable_unit(*parts: str) -> float:
    """A pseudo-random float in [0, 1), stable across reruns for the same input -
    used to jitter star/planet positions without them drifting on every rerun
    the way Python's own (unseeded) random module would."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def sparkline_svg(values: list[float], width: int = 88, height: int = 28, color: str | None = None) -> str:
    """
    A minimal inline-SVG sparkline (polyline + soft fill) for a value series -
    the ticker-shape cue a dense trading terminal packs into every row and
    tooltip. Color defaults to gain/loss (bull/bear) based on the series'
    own direction; pass one explicitly to override.
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
        <polygon points="{fill_pts}" fill="{stroke}" opacity="0.14"/>
        <polyline points="{line}" fill="none" stroke="{stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
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
        <div class="kpi-value" data-countup="{value}" data-countup-key="kpi:{label}">{value}</div>
        <div class="{label_cls}"{title_attr}>{label}</div>
    </div>
    """)


def integrity_meter_html(score: int, max_score: int, band: str) -> str:
    """
    An animated fill-meter for the Model Integrity Score (Bloomberg/credit-score-gauge style)
    instead of a bare number: the bar sweeps in on render and its color tier (bull/warn/bear)
    doubles as the same verdict `band` already states in words, so the two never disagree.
    """
    frac = max(0.0, min(1.0, (score / max_score) if max_score else 0.0))
    pct_val = frac * 100
    tier = "good" if pct_val >= 80 else "mid" if pct_val >= 60 else "bad"
    return _flatten_html(f"""
    <div class="meter-card">
        <div class="meter-top">
            <div class="meter-label">Model Integrity Score</div>
            <div class="meter-band {tier}">{band}</div>
        </div>
        <div class="meter-track"><div class="meter-fill {tier}" style="--fill:{pct_val:.0f}%;width:{pct_val:.0f}%;"></div></div>
        <div class="meter-score-row">
            <span class="meter-score" data-countup="{score}" data-countup-key="integrity-score">{score}</span>
            <span class="meter-max">/ {max_score}</span>
        </div>
    </div>
    """)


def inject_css() -> None:
    st.markdown(
        """
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
        """,
        unsafe_allow_html=True,
    )
    st.markdown(
        f"""
        <style>
        .stApp {{
            font-family: 'IBM Plex Sans', -apple-system, "Segoe UI", Roboto, sans-serif;
            background:
                radial-gradient(1100px 650px at 82% -8%, rgba(166,132,255,.10), transparent 60%),
                radial-gradient(850px 550px at 4% 106%, rgba(111,217,234,.07), transparent 60%),
                radial-gradient(1.4px 1.4px at 12% 18%, #fff 100%, transparent 100%),
                radial-gradient(1.2px 1.2px at 26% 64%, #cfd3ff 100%, transparent 100%),
                radial-gradient(1.6px 1.6px at 41% 29%, #fff 100%, transparent 100%),
                radial-gradient(1.1px 1.1px at 58% 82%, #cfd3ff 100%, transparent 100%),
                radial-gradient(1.4px 1.4px at 68% 12%, #fff 100%, transparent 100%),
                radial-gradient(1.2px 1.2px at 77% 47%, #cfd3ff 100%, transparent 100%),
                radial-gradient(1.6px 1.6px at 88% 71%, #fff 100%, transparent 100%),
                radial-gradient(1.1px 1.1px at 95% 24%, #cfd3ff 100%, transparent 100%),
                radial-gradient(1.3px 1.3px at 5% 88%, #fff 100%, transparent 100%),
                radial-gradient(1.2px 1.2px at 34% 8%, #cfd3ff 100%, transparent 100%),
                {BLACK};
            background-attachment: fixed;
        }}
        h1, h2, h3, h4, h5, h6 {{
            font-family: 'Space Grotesk', 'IBM Plex Sans', sans-serif !important;
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
            border-radius: 12px;
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
            border-radius: 12px;
            padding: 1.1rem 1.2rem;
            transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }}
        .kpi-card:hover {{
            border-color: {NAVY_LIGHT}88;
            box-shadow: 0 10px 26px -8px {NAVY_LIGHT}55;
            transform: translateY(-3px);
        }}
        .kpi-top {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.9rem; }}
        .kpi-icon {{
            width: 40px; height: 40px; border-radius: 10px;
            background: {NAVY_LIGHT}22; color: {NAVY_LIGHT};
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }}
        .kpi-icon svg {{ width: 20px; height: 20px; }}
        .kpi-badge {{
            display: inline-flex; align-items: center; gap: 3px;
            font-family: 'IBM Plex Mono', monospace;
            font-size: 0.74rem; font-weight: 700;
            padding: 3px 8px; border-radius: 999px; white-space: nowrap;
        }}
        .kpi-badge svg {{ width: 12px; height: 12px; }}
        .kpi-badge.up {{ background: {BULL_SOFT}; color: {BULL}; }}
        .kpi-badge.down {{ background: {BEAR_SOFT}; color: {BEAR}; }}
        .kpi-value {{
            font-family: 'IBM Plex Mono', monospace;
            font-size: 1.6rem; font-weight: 700; color: {INK};
            margin-bottom: 0.15rem; letter-spacing: -0.01em;
            font-variant-numeric: tabular-nums;
        }}
        .kpi-label {{ font-size: 0.82rem; color: {MUTED}; font-weight: 500; }}
        .kpi-label.has-tip {{ cursor: help; width: fit-content; border-bottom: 1px dotted {MUTED_2}; }}
        .kpi-label.has-tip:hover {{ color: {INK}; border-bottom-color: {NAVY_LIGHT}; }}
        @media (prefers-reduced-motion: reduce) {{
            .kpi-card {{ transition: none; }}
            .kpi-card:hover {{ transform: none; }}
        }}

        /* ---- Header / title ---------------------------------------------- */
        h1, h2, h3, h4, p, span, label, .stMarkdown {{
            color: {INK};
        }}
        h1 {{ font-weight: 600 !important; letter-spacing: -0.01em; }}
        h2, h3 {{ font-weight: 600 !important; }}

        /* ---- Containers / cards ------------------------------------------ */
        div[data-testid="stVerticalBlockBorderWrapper"] {{
            background: {PANEL};
            border: 1px solid {BORDER} !important;
            border-radius: 12px;
            transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }}
        div[data-testid="stVerticalBlockBorderWrapper"]:hover {{
            border-color: {NAVY_LIGHT}88 !important;
            box-shadow: 0 10px 26px -8px {NAVY_LIGHT}55;
        }}
        section[data-testid="stSidebar"] div[data-testid="stVerticalBlockBorderWrapper"]:hover {{
            transform: translateX(2px);
        }}
        div[data-testid="stMainBlockContainer"] div[data-testid="stVerticalBlockBorderWrapper"]:hover {{
            transform: translateY(-3px);
        }}
        @media (prefers-reduced-motion: reduce) {{
            div[data-testid="stVerticalBlockBorderWrapper"] {{ transition: none; }}
            div[data-testid="stVerticalBlockBorderWrapper"]:hover {{ transform: none; }}
        }}

        /* ---- Tabs ---------------------------------------------------- */
        [data-testid="stTab"] {{
            font-family: 'IBM Plex Mono', monospace;
            font-weight: 500;
            font-size: 0.86rem;
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
            border-radius: 2px;
            box-shadow: 0 0 6px {NAVY_LIGHT};
        }}

        /* ---- Radio groups: a segmented-pill look instead of bare dots -------- */
        [data-testid="stRadioOption"] {{
            border-radius: 8px;
            padding: 4px 10px;
            margin: 1px 0;
            transition: background-color 0.15s ease;
        }}
        [data-testid="stRadioOption"]:hover {{
            background: rgba(255,255,255,0.06);
        }}
        [data-testid="stRadioOption"][data-selected="true"] {{
            background: {NAVY_LIGHT}2E;
        }}
        /* The Mode switcher gets a small glowing "body" beside each option - a black hole for
           DCF, a warm star for Paper Trading, a cool star for Mutual Funds - so the sidebar
           itself hints at the cosmic language before a user opens any module. */
        [data-testid="stRadioGroup"][aria-label="Choose a tool"] [data-testid="stRadioOption"] {{
            display: flex; align-items: center;
        }}
        [data-testid="stRadioGroup"][aria-label="Choose a tool"] [data-testid="stRadioOption"]::after {{
            content: ''; display: inline-block; width: 13px; height: 13px; margin-left: 9px;
            border-radius: 50%; flex-shrink: 0;
        }}
        [data-testid="stRadioGroup"][aria-label="Choose a tool"] [data-testid="stRadioOption"]:nth-of-type(1)::after {{
            background: radial-gradient(circle at 38% 32%, {NAVY_LIGHT}, #0a0918 72%);
            box-shadow: 0 0 7px {NAVY_LIGHT}aa;
        }}
        [data-testid="stRadioGroup"][aria-label="Choose a tool"] [data-testid="stRadioOption"]:nth-of-type(2)::after {{
            background: radial-gradient(circle at 35% 30%, #fff6d8, {WARN} 62%);
            box-shadow: 0 0 7px {WARN}aa;
        }}
        [data-testid="stRadioGroup"][aria-label="Choose a tool"] [data-testid="stRadioOption"]:nth-of-type(3)::after {{
            background: radial-gradient(circle at 35% 30%, #fff, {CYAN} 70%);
            box-shadow: 0 0 7px {CYAN}aa;
        }}
        /* The active module's body breathes gently - a slow, deliberate cue for "you are here",
           never fast enough to compete with the data around it. */
        [data-testid="stRadioGroup"][aria-label="Choose a tool"] [data-testid="stRadioOption"][data-selected="true"]::after {{
            animation: dcf-breathe 6s ease-in-out infinite;
        }}

        /* ---- Text / number / select inputs: a brand focus glow --------------- */
        [data-testid="stTextInputRootElement"], [data-testid="stNumberInputContainer"],
        [data-testid="stSelectbox"] [role="group"] {{
            transition: box-shadow 0.15s ease, border-color 0.15s ease;
        }}
        [data-testid="stTextInputRootElement"]:focus-within,
        [data-testid="stNumberInputContainer"]:focus-within,
        [data-testid="stSelectbox"] [role="group"]:focus-within {{
            box-shadow: 0 0 0 3px {NAVY_LIGHT}33;
            border-color: {NAVY_LIGHT} !important;
        }}

        /* ---- Alerts: a colored left edge that names the severity at a glance -- */
        [data-testid="stAlertContainer"] {{
            border-left: 3px solid transparent;
            border-radius: 8px;
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
            font-size: 0.78rem !important;
            color: {MUTED};
            text-transform: uppercase;
            letter-spacing: 0.05em;
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
            transition: transform 0.1s ease, border-color 0.15s ease, background-color 0.15s ease;
        }}
        div.stButton > button:hover, div.stDownloadButton > button:hover {{
            border-color: {NAVY_LIGHT};
        }}
        div.stButton > button:active, div.stDownloadButton > button:active {{
            transform: scale(0.97);
        }}
        @media (prefers-reduced-motion: reduce) {{
            div.stButton > button, div.stDownloadButton > button {{ transition: none; }}
            div.stButton > button:active, div.stDownloadButton > button:active {{ transform: none; }}
        }}

        /* Primary actions (Enter, Add to Portfolio, ...) get real visual weight - a solid
           brand fill that lifts and glows on hover - instead of reading the same as every
           secondary button on the page. */
        button[data-testid="stBaseButton-primary"] {{
            background: {NAVY_LIGHT} !important;
            border: 1px solid {NAVY_LIGHT} !important;
            color: #0C0A1A !important;
            box-shadow: 0 1px 2px rgba(0,0,0,0.35);
            transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        }}
        button[data-testid="stBaseButton-primary"]:hover {{
            filter: brightness(1.12);
            box-shadow: 0 6px 18px {NAVY_LIGHT}55;
            transform: translateY(-1px);
        }}
        @media (prefers-reduced-motion: reduce) {{
            button[data-testid="stBaseButton-primary"] {{ transition: none; }}
            button[data-testid="stBaseButton-primary"]:hover {{ transform: none; }}
        }}

        /* ---- Spinner: a brand-colored sweep instead of Streamlit's neutral notch ---- */
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
            color: #0C0A1A !important;
        }}

        /* ---- Watchlist rows (dense, TradingView-style) -------------------- */
        .wl-row {{
            display: grid; grid-template-columns: 1.4fr 1fr 0.8fr 0.7fr; align-items: center;
            gap: 14px; padding: 9px 4px; border-bottom: 1px solid {BORDER};
        }}
        .wl-row:last-child {{ border-bottom: none; }}
        .wl-symbol {{ font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 0.86rem; color: {INK}; }}
        .wl-subtitle {{ font-size: 0.72rem; color: {MUTED_2}; margin-top: 1px; }}
        .wl-spark {{ display: flex; align-items: center; }}
        .wl-spark-empty {{ color: {MUTED_2}; font-size: 0.8rem; }}
        .wl-price {{ font-family: 'IBM Plex Mono', monospace; font-size: 0.86rem; color: {INK}; text-align: right;
            font-variant-numeric: tabular-nums; }}
        .wl-change {{ text-align: right; }}
        .wl-chg {{ font-family: 'IBM Plex Mono', monospace; font-size: 0.78rem; font-weight: 600; padding: 2px 7px;
            border-radius: 4px; white-space: nowrap; }}
        .wl-chg.up {{ background: {BULL_SOFT}; color: {BULL}; }}
        .wl-chg.down {{ background: {BEAR_SOFT}; color: {BEAR}; }}
        .wl-chg.flat {{ color: {MUTED_2}; }}

        /* ---- Search result rows (DCF search, Paper Trading search-and-trade) ---- */
        .src-row {{ display: flex; align-items: center; gap: 12px; padding: 6px 2px; }}
        .src-avatar {{ width: 34px; height: 34px; border-radius: 50%; background: {NAVY_LIGHT}22; color: {NAVY_LIGHT};
            display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; flex-shrink: 0; }}
        .src-id {{ flex: 1; min-width: 0; }}
        .src-name {{ font-weight: 600; color: {INK}; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
        .src-meta {{ display: flex; align-items: center; gap: 8px; margin-top: 2px; }}
        .src-symbol {{ font-family: 'IBM Plex Mono', monospace; font-size: 0.72rem; color: {MUTED}; }}
        .src-exchange {{ font-size: 0.66rem; color: {MUTED_2}; background: {PANEL_RAISED}; padding: 1px 6px; border-radius: 4px; }}
        .src-price-block {{ text-align: right; flex-shrink: 0; }}
        .src-price {{ font-family: 'IBM Plex Mono', monospace; font-weight: 700; color: {INK}; font-size: 0.88rem; }}
        .src-chg-row {{ margin-top: 2px; }}

        /* ---- Key facts grid (stock detail Financials panel) -------------------- */
        .fact-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 14px 18px; }}
        .fact-tile {{ min-width: 0; }}
        .fact-label {{ font-size: 0.7rem; color: {MUTED_2}; text-transform: uppercase; letter-spacing: 0.03em; }}
        .fact-value {{ font-family: 'IBM Plex Mono', monospace; font-weight: 600; color: {INK}; font-size: 0.92rem;
            margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}

        /* ---- Cosmic component primitives (gravity well, orbit, cluster) -------- */
        @keyframes dcf-spin {{ to {{ transform: rotate(360deg); }} }}
        @keyframes dcf-breathe {{ 0%, 100% {{ opacity: .55; }} 50% {{ opacity: 1; }} }}
        @keyframes dcf-pull-in {{
            0% {{ transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))); opacity: 0; }}
            20% {{ opacity: 1; }} 100% {{ transform: translate(-50%, -50%); opacity: 0; }}
        }}
        @keyframes dcf-push-out {{
            0% {{ transform: translate(-50%, -50%); opacity: 0; }}
            20% {{ opacity: 1; }} 100% {{ transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))); opacity: 0; }}
        }}

        /* ---- Live-data feedback: a number that just changed briefly tints green/red,
           the way a real trading terminal calls out a tick - see inject_interactions()
           for the JS that toggles these classes and animates the count-up itself. ---- */
        @keyframes dcf-flash-up {{ 0% {{ background: {BULL_SOFT}; }} 100% {{ background: transparent; }} }}
        @keyframes dcf-flash-down {{ 0% {{ background: {BEAR_SOFT}; }} 100% {{ background: transparent; }} }}
        .dcf-flash-up {{ animation: dcf-flash-up 900ms ease-out; border-radius: 4px; }}
        .dcf-flash-down {{ animation: dcf-flash-down 900ms ease-out; border-radius: 4px; }}

        /* ---- Model Integrity meter: a sweeping fill-bar instead of a bare number ---- */
        @keyframes dcf-meter-fill {{ from {{ width: 0%; }} to {{ width: var(--fill); }} }}
        .meter-card {{ background: {PANEL}; border: 1px solid {BORDER}; border-radius: 12px; padding: 1.1rem 1.3rem; max-width: 420px; }}
        .meter-top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }}
        .meter-label {{ font-size: 0.82rem; color: {MUTED}; font-weight: 600; }}
        .meter-band {{ font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }}
        .meter-band.good {{ background: {BULL_SOFT}; color: {BULL}; }}
        .meter-band.mid {{ background: {WARN_SOFT}; color: {WARN}; }}
        .meter-band.bad {{ background: {BEAR_SOFT}; color: {BEAR}; }}
        .meter-track {{ height: 10px; border-radius: 999px; background: {NAVY_SOFT}; overflow: hidden; }}
        .meter-fill {{ height: 100%; border-radius: 999px; animation: dcf-meter-fill 1.1s cubic-bezier(.16,1,.3,1) both; }}
        .meter-fill.good {{ background: linear-gradient(90deg, {BULL}99, {BULL}); }}
        .meter-fill.mid {{ background: linear-gradient(90deg, {WARN}99, {WARN}); }}
        .meter-fill.bad {{ background: linear-gradient(90deg, {BEAR}99, {BEAR}); }}
        .meter-score-row {{ margin-top: 10px; }}
        .meter-score {{ font-family: 'IBM Plex Mono', monospace; font-size: 1.7rem; font-weight: 700; color: {INK}; }}
        .meter-max {{ font-family: 'IBM Plex Mono', monospace; font-size: 0.95rem; color: {MUTED_2}; margin-left: 2px; }}

        /* ---- Secondary buttons get the same hover-lift language as cards/primary buttons ---- */
        div.stButton > button:hover, div.stDownloadButton > button:hover {{
            transform: translateY(-1px);
            box-shadow: 0 6px 16px -4px rgba(0,0,0,0.4);
        }}

        /* ---- Alerts slide/fade in instead of popping into place ------------------ */
        @keyframes dcf-alert-in {{ from {{ opacity: 0; transform: translateY(6px); }} to {{ opacity: 1; transform: translateY(0); }} }}
        [data-testid="stAlertContainer"] {{ animation: dcf-alert-in 0.35s ease-out; }}

        /* ---- Expanders: a hover cue on the collapsed header ----------------------- */
        [data-testid="stExpander"] summary {{ border-radius: 8px; transition: background-color 0.15s ease; }}
        [data-testid="stExpander"] summary:hover {{ background: rgba(255,255,255,0.05); }}

        /* ---- Slider thumbs get a brand glow on hover/drag, like a physical dial --- */
        [data-testid="stSlider"] [role="slider"] {{ transition: box-shadow 0.15s ease, transform 0.1s ease; }}
        [data-testid="stSlider"] [role="slider"]:hover {{ box-shadow: 0 0 0 8px {NAVY_LIGHT}26; }}
        [data-testid="stSlider"] [role="slider"]:active {{ box-shadow: 0 0 0 10px {NAVY_LIGHT}3D; transform: scale(1.05); }}

        @media (prefers-reduced-motion: reduce) {{
            .well-ring, .orbit-ring, .osun, .pulse, .node-halo, .meter-fill,
            .dcf-flash-up, .dcf-flash-down, [data-testid="stAlertContainer"],
            [data-testid="stRadioGroup"][aria-label="Choose a tool"] [data-testid="stRadioOption"]::after {{
                animation: none !important;
            }}
            div.stButton > button:hover, div.stDownloadButton > button:hover {{ transform: none; }}
        }}

        /* ---- Indicator picker popover + active-indicator chip row ----------------- */
        [data-testid="stPopoverBody"] {{
            background: {PANEL};
            border: 1px solid {BORDER};
            box-shadow: 0 14px 34px -12px #000000aa, 0 0 0 1px {NAVY_LIGHT}14;
        }}
        [data-testid="stPopoverButton"] {{
            transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
        }}
        .ind-pop-cat {{
            font-size: 0.68rem;
            font-weight: 600;
            letter-spacing: 0.06em;
            color: {MUTED_2};
            text-transform: uppercase;
            margin: 0.7rem 0 0.1rem 0;
        }}
        .ind-pop-row {{
            font-size: 0.85rem;
            color: {INK};
            padding-top: 0.4rem;
        }}
        /* The +/Add buttons in the indicator picker rows get the same brand hover-glow as
           every other primary control, instead of Streamlit's default flat hover. */
        [data-testid="stPopoverBody"] div.stButton > button:hover {{
            border-color: {NAVY_LIGHT}aa;
            box-shadow: 0 0 0 2px {NAVY_LIGHT}2E;
        }}
        .st-key-mkt_indicator_chips [data-testid="stPopoverButton"] {{
            background: {PANEL_RAISED};
            border: 1px solid {BORDER};
            border-radius: 999px;
            padding: 0.15rem 0.9rem;
            font-size: 0.78rem;
            font-family: 'IBM Plex Mono', monospace;
            color: {INK};
        }}
        .st-key-mkt_indicator_chips [data-testid="stPopoverButton"]:hover {{
            border-color: {NAVY_LIGHT}88;
            color: {NAVY_LIGHT};
            box-shadow: 0 0 12px -3px {NAVY_LIGHT}77;
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def inject_interactions() -> None:
    """
    A small, self-contained script that gives every live figure in the app two things a static
    number can't: it counts up from zero when it first appears (or changes), and it flashes
    green/up or red/down for an instant when a value ticks - the same feedback loop a real
    trading terminal gives on every price update, applied here to KPI cards, the integrity
    meter, and every live price in Paper Trading.

    Implementation note: Streamlit's own script re-runs on every interaction re-render the
    HTML these values live in from scratch, so there's no single persistent DOM node to attach
    a "did this change" listener to. Instead this installs ONE MutationObserver (guarded so a
    rerun never installs a second one) on the parent document that watches for any element
    carrying a `data-countup` attribute, wherever and whenever it appears - which is exactly
    what a component.html iframe can do (it shares the same top-level `window.parent.document`
    Streamlit itself renders into), so this behaves identically no matter which mode
    (DCF/Paper Trading/Mutual Funds) is currently rendering.
    """
    from streamlit.components.v1 import html as _components_html

    _components_html(
        """
        <script>
        (function () {
            var doc = window.parent.document;
            if (doc.__dcfCountupInstalled) { return; }
            doc.__dcfCountupInstalled = true;

            var mem = window.parent.__dcfCountupMem || (window.parent.__dcfCountupMem = {});

            function animate(el) {
                var raw = el.getAttribute('data-countup');
                if (raw === null) { return; }
                var match = raw.match(/^([^\\d\\-]*)(-?[\\d,]+(?:\\.\\d+)?)(.*)$/);
                if (!match) { return; }
                var prefix = match[1], numStr = match[2].replace(/,/g, ''), suffix = match[3];
                var end = parseFloat(numStr);
                if (isNaN(end)) { return; }
                var decimals = (numStr.split('.')[1] || '').length;

                var key = el.getAttribute('data-countup-key');
                if (key) {
                    var prev = mem[key];
                    if (prev !== undefined && prev !== end) {
                        el.classList.remove('dcf-flash-up', 'dcf-flash-down');
                        void el.offsetWidth;
                        el.classList.add(end > prev ? 'dcf-flash-up' : 'dcf-flash-down');
                    }
                    mem[key] = end;
                }

                var duration = 650;
                var t0 = performance.now();
                function step(now) {
                    var t = Math.min((now - t0) / duration, 1);
                    var eased = 1 - Math.pow(1 - t, 3);
                    var val = end * eased;
                    el.textContent = prefix + val.toLocaleString('en-IN', {
                        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
                    }) + suffix;
                    if (t < 1) { requestAnimationFrame(step); } else { el.textContent = raw; }
                }
                requestAnimationFrame(step);
            }

            function scan(node) {
                if (node.nodeType !== 1) { return; }
                if (node.matches && node.matches('[data-countup]')) { animate(node); }
                if (node.querySelectorAll) {
                    node.querySelectorAll('[data-countup]').forEach(animate);
                }
            }

            scan(doc.body);
            var observer = new MutationObserver(function (mutations) {
                mutations.forEach(function (m) {
                    if (m.type === 'childList') {
                        m.addedNodes.forEach(scan);
                    } else if (m.type === 'attributes') {
                        animate(m.target);
                    }
                });
            });
            observer.observe(doc.body, {
                childList: true, subtree: true, attributes: true, attributeFilter: ['data-countup'],
            });
        })();
        </script>
        """,
        height=0,
        width=0,
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
    Builds the "Intrinsic Value vs. Price" comparison as a gravity well: the
    model's fair value sits at the center like a black hole's core, and the
    current price is a marker whose distance from that center encodes the
    size of the mispricing - pulled inward (green) when undervalued, flung
    outward (red) when overvalued. The literal numbers sit beside it; the
    well is a second, faster read of the same comparison, never the only one.
    """
    initial = (ticker or company_name or "?")[:1].upper()
    title = f"{ticker or company_name} Intrinsic Value"
    avatar = _avatar_html(website, initial)

    if intrinsic_value is None or current_price is None or current_price == 0:
        return _flatten_html(f"""
        <div class="well-card">
            <div class="well-top"><div class="well-top-left">{avatar}<div class="well-title">{title}</div></div></div>
            <div class="well-empty">Not enough data to compare intrinsic value to market price for this scenario.</div>
        </div>
        <style>
        .well-card {{ background: {BLACK}; border: 1px solid {BORDER}; border-radius: 16px; padding: 20px 22px; }}
        .well-top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }}
        .well-top-left {{ display: flex; align-items: center; gap: 10px; }}
        .well-title {{ font-size: 0.92rem; font-weight: 600; color: {MUTED}; }}
        .well-empty {{ font-size: 0.85rem; color: {MUTED}; }}
        </style>
        """)

    pct = intrinsic_value / current_price - 1
    undervalued = pct >= 0
    badge_class = "under" if undervalued else "over"
    badge_text = f"{'UNDERVALUATION' if undervalued else 'OVERVALUATION'} {abs(pct):.0%}"
    marker_class = "gain" if undervalued else "loss"

    # Marker distance from center = magnitude of the mispricing (capped so an extreme
    # scenario still lands inside the outer ring); angle is fixed, matching the design
    # system's reference gravity well.
    magnitude = min(abs(pct), 1.0)
    radius_frac = 0.20 + magnitude * 0.64
    cx = cy = 150
    radius = 128
    angle = math.radians(-50)
    mx = round(cx + radius * radius_frac * math.cos(angle))
    my = round(cy + radius * radius_frac * math.sin(angle))
    tx, ty = mx - cx, my - cy

    return _flatten_html(f"""
    <div class="well-card">
        <div class="well-top">
            <div class="well-top-left">{avatar}<div class="well-title">{title}</div></div>
            <div class="well-badge {badge_class}">{badge_text}</div>
        </div>
        <div class="well-body">
            <div class="well">
                <div class="well-ring r1"></div><div class="well-ring r2"></div><div class="well-ring r3"></div>
                <div class="well-marker {marker_class}" style="left:{mx}px;top:{my}px;" title="The current market price. Its distance from center is the mispricing."></div>
                <div class="well-marker-tag" style="left:{mx}px;top:{my}px;">{currency_symbol}{current_price:,.2f} now</div>
                <div class="well-pulse {marker_class}" style="left:{cx}px;top:{cy}px;--tx:{tx}px;--ty:{ty}px;"></div>
                <div class="well-core" title="What this DCF model computes as fair value. Everything else is measured against this point.">
                    <div class="well-core-cv">Intrinsic Value</div>
                    <div class="well-core-val">{currency_symbol}{intrinsic_value:,.2f}</div>
                </div>
            </div>
            <div class="well-side">
                <div class="well-verdict">
                    A model value of <b>{currency_symbol}{intrinsic_value:,.2f}</b> against a
                    <b>{currency_symbol}{current_price:,.2f}</b> market price is a
                    <b class="{marker_class}">{abs(pct):.1%}</b> {'undervaluation' if undervalued else 'overvaluation'} -
                    the marker's distance from center is that gap; color and pull direction show which way it resolves.
                </div>
            </div>
        </div>
    </div>
    <style>
    .well-card {{ background: {BLACK}; border: 1px solid {BORDER}; border-radius: 16px; padding: 22px 24px 20px; }}
    .well-top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }}
    .well-top-left {{ display: flex; align-items: center; gap: 10px; }}
    .well-title {{ font-size: 0.92rem; font-weight: 600; color: {MUTED}; }}
    .well-badge {{ padding: 5px 11px; border-radius: 6px; font-family: 'IBM Plex Mono', monospace;
        font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }}
    .well-badge.under {{ background: {BULL}; color: #04170A; }}
    .well-badge.over {{ background: {BEAR}; color: #2A0805; }}
    .well-body {{ display: flex; gap: 26px; align-items: center; }}
    .well {{ position: relative; width: 300px; height: 300px; flex-shrink: 0; }}
    .well-ring {{ position: absolute; border-radius: 50%; border: 1px solid {BORDER}; }}
    .well-ring.r1 {{ inset: 0; }} .well-ring.r2 {{ inset: 14%; }} .well-ring.r3 {{ inset: 28%; border-color: {NAVY_SOFT}; }}
    .well-core {{ position: absolute; inset: 42%; border-radius: 50%; cursor: help;
        background: radial-gradient(circle at 38% 32%, #241f42, #0a0918 68%);
        box-shadow: 0 0 0 1px {NAVY_LIGHT}55, 0 0 30px 7px {NAVY_LIGHT}40, inset 0 0 16px rgba(0,0,0,.7);
        display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
        transition: box-shadow 0.2s ease; }}
    .well-core:hover {{ box-shadow: 0 0 0 1px {NAVY_LIGHT}88, 0 0 38px 10px {NAVY_LIGHT}60, inset 0 0 16px rgba(0,0,0,.7); }}
    .well-core-cv {{ font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: {MUTED};
        letter-spacing: 0.06em; text-transform: uppercase; }}
    .well-core-val {{ font-family: 'IBM Plex Mono', monospace; font-weight: 700; font-size: 16px; margin-top: 3px; color: {INK}; }}
    .well-marker {{ position: absolute; width: 15px; height: 15px; border-radius: 50%; transform: translate(-50%, -50%); z-index: 3; cursor: help; }}
    .well-marker.gain {{ background: {BULL}; box-shadow: 0 0 10px {BULL}; }}
    .well-marker.loss {{ background: {BEAR}; box-shadow: 0 0 10px {BEAR}; }}
    .well-marker-tag {{ position: absolute; transform: translate(-50%, -140%); white-space: nowrap;
        font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; padding: 3px 7px; border-radius: 6px;
        background: {PANEL_RAISED}; border: 1px solid {BORDER}; color: {MUTED}; z-index: 3; }}
    .well-pulse {{ position: absolute; width: 8px; height: 8px; border-radius: 50%; transform: translate(-50%, -50%); z-index: 2; }}
    .well-pulse.gain {{ background: {BULL}; box-shadow: 0 0 8px {BULL}; animation: dcf-pull-in 2.6s ease-in-out infinite; }}
    .well-pulse.loss {{ background: {BEAR}; box-shadow: 0 0 8px {BEAR}; animation: dcf-push-out 2.6s ease-in-out infinite; }}
    .well-side {{ flex: 1; }}
    .well-verdict {{ padding: 14px 16px; border-radius: 10px; background: {PANEL_RAISED}; border: 1px solid {BORDER};
        font-size: 0.85rem; color: {MUTED}; line-height: 1.6; }}
    .well-verdict b {{ font-family: 'IBM Plex Mono', monospace; color: {INK}; }}
    .well-verdict b.gain {{ color: {BULL}; }} .well-verdict b.loss {{ color: {BEAR}; }}
    </style>
    """)


def orbit_holdings_html(items: list[dict], center_label: str, center_value: str) -> str:
    """
    Renders a portfolio's holdings as planets orbiting a center body (cash, or
    the account itself): each item is one orbit, sized by weight, colored and
    hover-tooltipped with its own return - and, where a price series is
    available, a live sparkline right inside that tooltip for a
    trading-terminal level of density. `items` is a list of dicts with keys
    `label`, `sublabel`, `weight_pct` (0-100), `return_pct` (signed; drives
    color), and optional `spark_values` (a price series for the tooltip).

    Purely a second, faster read of the same holdings a table already lists
    in full below it - nothing here is the only place a number appears.
    """
    if not items:
        return _flatten_html(f"""
        <div class="orbit-card"><div class="orbit-empty">No positions yet - once you hold something,
        it shows up here in orbit.</div></div>
        <style>.orbit-card {{ background: {NAVY}; border: 1px solid {BORDER}; border-radius: 16px; padding: 22px 24px; }}
        .orbit-empty {{ font-size: 0.85rem; color: {MUTED}; }}</style>
        """)

    rings = [96, 180, 266]
    ring_duration = [9, 15, 24]
    by_ring: list[list[dict]] = [[], [], []]
    for i, item in enumerate(items):
        by_ring[i % 3].append(item)

    max_weight = max((it["weight_pct"] for it in items), default=1.0) or 1.0
    planet_html = []
    for ring_idx, ring_items in enumerate(by_ring):
        count = len(ring_items)
        for j, item in enumerate(ring_items):
            phase = _stable_unit("orbit", item["label"]) * 360
            angle_deg = phase + (360 / count) * j if count else phase
            size = 9 + round((item["weight_pct"] / max_weight) * 13)
            gain = item["return_pct"] >= 0
            color_cls = "gain" if gain else "loss"
            duration = ring_duration[ring_idx]
            delay = -(_stable_unit("delay", item["label"]) * duration)
            spark = item.get("spark_values")
            spark_html = (
                f'<div class="planet-tip-spark">{sparkline_svg(spark, width=76, height=22)}</div>' if spark else ""
            )
            planet_html.append(_flatten_html(f"""
            <div class="orbit-ring o{ring_idx} spin" style="width:{rings[ring_idx]}px;height:{rings[ring_idx]}px;
                animation-duration:{duration}s; animation-delay:{delay:.2f}s; transform:translate(-50%,-50%) rotate({angle_deg:.0f}deg);">
                <div class="planet {color_cls}" style="width:{size}px;height:{size}px;margin-left:-{size/2:.0f}px;margin-top:-{size/2:.0f}px;">
                    <div class="planet-tip">
                        <div class="planet-tip-name">{item['label']}</div>
                        <div class="planet-tip-sub">{item['sublabel']}</div>
                        {spark_html}
                        <span class="planet-tip-return {color_cls}">{'+' if gain else ''}{item['return_pct']:.1f}%</span>
                    </div>
                </div>
            </div>
            """))

    return _flatten_html(f"""
    <div class="orbit-card">
        <div class="orbit-zone">
            <div class="orbit-ring static" style="width:{rings[0]}px;height:{rings[0]}px;"></div>
            <div class="orbit-ring static" style="width:{rings[1]}px;height:{rings[1]}px;"></div>
            <div class="orbit-ring static" style="width:{rings[2]}px;height:{rings[2]}px;"></div>
            <div class="orbit-sun" title="{center_label}, the gravity every position here orbits.">{center_label}<br>{center_value}</div>
            {"".join(planet_html)}
        </div>
    </div>
    <style>
    .orbit-card {{ background: {NAVY}; border: 1px solid {BORDER}; border-radius: 16px; padding: 20px; }}
    .orbit-zone {{ position: relative; width: 100%; height: 300px; }}
    .orbit-ring {{ position: absolute; top: 50%; left: 50%; border-radius: 50%; border: 1px solid {BORDER}; }}
    .orbit-ring.static {{ transform: translate(-50%, -50%); }}
    .orbit-ring.spin {{ border-color: transparent; animation-name: dcf-spin; animation-timing-function: linear;
        animation-iteration-count: infinite; }}
    .orbit-sun {{ position: absolute; top: 50%; left: 50%; width: 52px; height: 52px; border-radius: 50%;
        transform: translate(-50%, -50%); background: radial-gradient(circle at 38% 32%, #fff6d8, {WARN} 62%);
        box-shadow: 0 0 26px 6px {WARN}88; display: flex; align-items: center; justify-content: center;
        font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: #231a02; font-weight: 700;
        text-align: center; line-height: 1.15; cursor: help; }}
    .planet {{ position: absolute; top: 0; left: 50%; border-radius: 50%; cursor: default; }}
    .planet.gain {{ background: {BULL}; box-shadow: 0 0 10px {BULL}; }}
    .planet.loss {{ background: {BEAR}; box-shadow: 0 0 10px {BEAR}; }}
    .planet-tip {{ position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%) scale(.92);
        white-space: nowrap; padding: 8px 11px; border-radius: 8px; background: {PANEL_RAISED};
        border: 1px solid {BORDER}; font-size: 10.5px; opacity: 0; pointer-events: none; text-align: left;
        transition: opacity .18s ease, transform .18s ease; z-index: 10; }}
    .planet:hover .planet-tip {{ opacity: 1; transform: translateX(-50%) scale(1) translateY(-4px); }}
    .planet-tip-name {{ font-family: 'IBM Plex Mono', monospace; font-weight: 600; color: {INK}; }}
    .planet-tip-sub {{ color: {MUTED}; margin: 2px 0; }}
    .planet-tip-spark {{ margin: 4px 0; }}
    .planet-tip-return {{ font-family: 'IBM Plex Mono', monospace; }}
    .planet-tip-return.gain {{ color: {BULL}; }} .planet-tip-return.loss {{ color: {BEAR}; }}
    </style>
    """)


def fund_cluster_html(items: list[dict]) -> str:
    """
    Renders mutual fund holdings as a star cluster: each fund is one star,
    sized by portfolio weight and positioned in a loose group with other
    funds of the same asset class. `items` is a list of dicts with keys
    `label`, `category` (one of CATEGORY_COLORS), and `weight_pct` (0-100).

    A precise legend/table sits beside or below this everywhere it's used -
    the cluster is for pattern-spotting at a glance, never the only place
    the exact weight is written down.
    """
    if not items:
        return _flatten_html(f"""
        <div class="sky-card"><div class="sky-empty">Add a fund to see your allocation
        as a sky map.</div></div>
        <style>.sky-card {{ background: {NAVY}; border: 1px solid {BORDER}; border-radius: 16px; padding: 22px 24px; }}
        .sky-empty {{ font-size: 0.85rem; color: {MUTED}; }}</style>
        """)

    # Fixed anchor points (as % of the field) per category, so a category's
    # cluster always forms in the same corner regardless of which funds
    # populate it.
    anchors = {
        "Equity": (26, 30), "Debt": (72, 68), "Hybrid": (50, 46),
        "Index/ETF": (78, 24), "Other": (22, 74),
    }
    max_weight = max((it["weight_pct"] for it in items), default=1.0) or 1.0
    by_category: dict[str, list[dict]] = {}
    for item in items:
        by_category.setdefault(item["category"], []).append(item)

    star_html = []
    for category, group in by_category.items():
        ax, ay = anchors.get(category, anchors["Other"])
        color = CATEGORY_COLORS.get(category, MUTED)
        for i, item in enumerate(group):
            jitter_x = (_stable_unit("cx", item["label"]) - 0.5) * 22
            jitter_y = (_stable_unit("cy", item["label"]) - 0.5) * 22
            spiral = i * 7
            px = min(max(ax + jitter_x + spiral * 0.4, 6), 94)
            py = min(max(ay + jitter_y - spiral * 0.3, 8), 90)
            size = 8 + round((item["weight_pct"] / max_weight) * 20)
            glow = round(size * 0.7)
            star_html.append(_flatten_html(f"""
            <div class="star" style="top:{py:.1f}%;left:{px:.1f}%;width:{size}px;height:{size}px;
                background:radial-gradient(circle at 35% 30%, #fff, {color} 70%);
                box-shadow:0 0 {glow}px {color}99;">
                <div class="star-tip">
                    <span class="star-tip-name">{item['label']}</span> - {category} -
                    <span class="star-tip-pct">{item['weight_pct']:.1f}%</span>
                </div>
            </div>
            """))

    label_html = []
    for category in by_category:
        color = CATEGORY_COLORS.get(category, MUTED)
        pos = anchors.get(category, anchors["Other"])
        corner_top = "top:8px;" if pos[1] < 50 else "bottom:8px;"
        corner_side = "left:14px;" if pos[0] < 50 else "right:14px;"
        label_html.append(f'<div class="sky-label" style="{corner_top}{corner_side}">{category}</div>')

    return _flatten_html(f"""
    <div class="sky-card">
        <div class="sky-field">
            {"".join(label_html)}
            {"".join(star_html)}
        </div>
    </div>
    <style>
    .sky-card {{ background: {NAVY}; border: 1px solid {BORDER}; border-radius: 16px; padding: 18px; }}
    .sky-field {{ position: relative; width: 100%; height: 280px; border-radius: 10px; overflow: hidden;
        background: radial-gradient(220px 160px at 22% 30%, rgba(255,255,255,.04), transparent 70%),
                    radial-gradient(200px 150px at 78% 74%, {CYAN}0D, transparent 70%); }}
    .sky-label {{ position: absolute; font-family: 'IBM Plex Mono', monospace; font-size: 9px;
        letter-spacing: 0.05em; text-transform: uppercase; color: {MUTED_2}; }}
    .star {{ position: absolute; border-radius: 50%; transform: translate(-50%, -50%); cursor: default;
        transition: filter .15s ease; }}
    .star:hover {{ filter: brightness(1.35); }}
    .star-tip {{ position: absolute; bottom: 130%; left: 50%; transform: translateX(-50%) scale(.92);
        white-space: nowrap; padding: 7px 10px; border-radius: 8px; background: {PANEL_RAISED};
        border: 1px solid {BORDER}; font-size: 10.5px; color: {MUTED}; opacity: 0; pointer-events: none;
        transition: opacity .18s ease, transform .18s ease; z-index: 5; }}
    .star:hover .star-tip {{ opacity: 1; transform: translateX(-50%) scale(1) translateY(-4px); }}
    .star-tip-name {{ font-weight: 600; color: {INK}; }}
    .star-tip-pct {{ font-family: 'IBM Plex Mono', monospace; color: {CYAN}; }}
    </style>
    """)


def watchlist_row_html(
    symbol: str, subtitle: str, price: str, change_pct: float | None, spark_values: list[float] | None = None,
) -> str:
    """A dense ticker row - symbol, subtitle, sparkline, price, colored change - for anywhere
    a compact list reads better than the orbit/cluster (e.g. a long holdings list)."""
    if change_pct is None:
        chg_html = '<span class="wl-chg flat">-</span>'
    else:
        cls = "up" if change_pct >= 0 else "down"
        chg_html = f'<span class="wl-chg {cls}">{"+" if change_pct >= 0 else ""}{change_pct:.2f}%</span>'
    spark_html = sparkline_svg(spark_values, width=88, height=28) if spark_values else '<span class="wl-spark-empty">-</span>'
    return _flatten_html(f"""
    <div class="wl-row">
        <div class="wl-id"><div class="wl-symbol">{symbol}</div><div class="wl-subtitle">{subtitle}</div></div>
        <div class="wl-spark">{spark_html}</div>
        <div class="wl-price">{price}</div>
        <div class="wl-change">{chg_html}</div>
    </div>
    """)


def search_result_row_html(
    name: str, symbol: str, exchange: str, price: str | None = None, change_pct: float | None = None,
) -> str:
    """
    A single company-search result: letter avatar, name + ticker + exchange badge, and
    (when known) a live price and colored change - the same row styling wherever a search box
    turns free text into a specific company, so the DCF search and the Paper Trading
    search-and-trade panel read as one design language instead of two different search UIs.

    The action buttons themselves (Buy/Sell/Chart/Select) are real Streamlit widgets placed by
    the caller next to this row's markdown, since this module only ever returns static HTML.
    """
    initial = (symbol or name or "?")[:1].upper()
    price_html = ""
    if price is not None:
        if change_pct is None:
            chg_html = ""
        else:
            cls = "up" if change_pct >= 0 else "down"
            chg_html = f'<span class="wl-chg {cls}">{"+" if change_pct >= 0 else ""}{change_pct:.2f}%</span>'
        price_html = f'<div class="src-price">{price}</div><div class="src-chg-row">{chg_html}</div>'
    return _flatten_html(f"""
    <div class="src-row">
        <div class="src-avatar">{initial}</div>
        <div class="src-id">
            <div class="src-name">{name}</div>
            <div class="src-meta"><span class="src-symbol">{symbol}</span><span class="src-exchange">{exchange}</span></div>
        </div>
        <div class="src-price-block">{price_html}</div>
    </div>
    """)


def key_facts_grid_html(facts: list[tuple[str, str]]) -> str:
    """
    A dense label/value stat grid - market cap, P/E, 52-week range, sector, ... - for a stock
    detail page's Financials panel, modeled on TradingView's own symbol-page "Key facts" block
    (label above, value below, muted/plain rather than the bigger kpi_card treatment which is
    meant for a handful of headline numbers, not a dozen small ones side by side).
    """
    tiles = "".join(
        f'<div class="fact-tile"><div class="fact-label">{label}</div><div class="fact-value">{value}</div></div>'
        for label, value in facts
    )
    return _flatten_html(f'<div class="fact-grid">{tiles}</div>')


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
