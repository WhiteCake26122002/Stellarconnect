# Orbit Desk — Paper Trading Terminal UI/UX Spec

**Route:** Web App  
**System:** Audit/redesign (ValuEngine DCF desk → chart-first paper workstation)  
**Platform:** Web desktop-first; tablet collapsible sidebars; mobile chart-first with bottom nav (not a shrunk desktop)  
**Motion budget:** 0 expressive. Functional popover/drawer 140–220ms (`transform`+`opacity`). Reduced-motion: instant state.  
**Signature mode:** Log-read  
**Date:** 2026-09-18  
**Prepared for:** Orbit Desk (paper trading)

Skipping Landing / Design System / Phase-4 photography because: product UI only; chart is the imagery.

---

## 1. Brief

| Field | |
|---|---|
| Subject | A full-screen **paper trading charting workstation** (candles, drawings, blotter). |
| Audience | People who already read charts. They expect TradingView-class density, not a brokerage homepage. |
| Primary job | Select a market → read the chart → add studies/drawings → place a paper order → manage SL/TP on the chart → close → review. |
| Secondary jobs | Watchlist, replay simulator, alerts, saved layouts, paper portfolio, DCF models as a side door. |
| Success metric | The 29-step terminal flow (search NIFTY → indicators → drawings → buy → drag SL/TP → close → replay → reset) without leaving the chart. |
| Platform + non-negotiables | Pointer + keyboard. Visible focus. Labels not placeholder-as-label. Color never the only signal (BUY/SELL words, LONG/SHORT text, +/− amounts). |
| Constraints | Next.js App Router, existing IBM Plex Sans/Mono, no TradingView brand/widget, simulated market if live feed unavailable. |
| Assets in hand | TradingView screenshot as **density/layout reference only**. Existing true-black + cyan tokens. |
| Content shape | Thousands of candles, compact rows, live quotes, OHLC, P&L. High variability, high density. |

**Dimensional sliders (targets):**

| Slider | Band | Why |
|---|---|---|
| Density | Very high | Brief: professional terminal, not dashboard cards. |
| Hierarchy | Chart dominates 65–75% | Brief: chart-first; chrome yields. |
| Ornament | Near-zero; cosmic optional and peripheral | Brief: cosmic is tertiary. |
| Motion | Still + functional feedback | Tools, not marketing. |

**Assumptions:**

- Simulated India-first universe (NSE/BSE indices, stocks, ETFs, futures, options, commodities, FX, crypto) until a live feed exists.
- Auth remains; post-login lands on the terminal, not `/models`.
- DCF workspace stays at `/models` as “Valuation”, never the home screen.
- Paper account starts at ₹10,00,000. Client-side engine + local persistence (per user id).

**Signature Gate:**

- Log path status: `docs/design/_signature-log.md` present.
- Overused axes: `ibm-plex-sans`, true-black+cyan, still motion, high density.
- Declared load-bearing break: **layout + interaction** — KPI-strip / surface-tabs → **left-tools + chart + watchlist + blotter**; KPI-jump → **direct chart manipulation + B/S/Ctrl+K**. Type/colour inherit (constrained product). Density stays high because the object is a terminal (integrity, not attractor inversion).

---

## 2. Audit

**Root-cause layer:** Structural

| Finding | Layer | Why it matters |
|---|---|---|
| Home redirects to a model list / KPI dashboard | Structural | First paint is inventory, not a market. |
| Chart is a small card among cards | Structural | Analysis cannot be the job. |
| Trade would be another route | Interaction | Breaks chart-to-ticket muscle memory. |
| Cosmic/brand chrome can outshout price | Surface | Trading data must win. |

---

## 3. Directions considered

Design space **closed** by the 66-section brief + screenshot. One direction: original charting terminal with TradingView *philosophy* (density, tool grouping, chart gravity), not a clone.

**Break vs last ValuEngine ship:** equal top-tabs and KPI cards removed from the primary surface. The chart is the page.

---

## 4. Chosen direction

**Orbit Desk** — a dark charting workstation. Name appears as a small star-mark + wordmark in the toolbar only.

**Object:** the active symbol’s price chart.  
**One job now:** read NIFTY and act.  
**Removed:** homepage, giant cards, marketing headings, large gradients, cosmic hero, dashboard KPIs on entry.  
**Materials:** near-black field, charcoal panels, 1px hairline borders, 4px control radius, IBM Plex Sans for chrome, IBM Plex Mono for prices.  
**Motion:** menus appear (140ms); ticks update numbers without count-up.

### ASCII structure (desktop)

```
┌────────────────────────────────────────────────────────────────────┐
│ TOP TOOLBAR  logo · symbol search · tf · type · indicators · …     │
├────────┬──────────────────────────────────────────────┬────────────┤
│ DRAW   │  chart header: NIFTY 50  1D · NSE            │ WATCHLIST  │
│ TOOLS  │  23,231.35  +112.75 (+0.49%)                 │ DETAILS    │
│        │  [EMA 20 ×] [EMA 50 ×] [VWAP ×]              │ TRADE      │
│        │                                              │            │
│        │              MAIN CHART (canvas)             │ compact    │
│        │              + position lines                │ rows       │
│        ├──────────────────────────────────────────────┤            │
│        │ VOLUME / RSI / MACD panes                    │            │
├────────┴──────────────────────────────────────────────┴────────────┤
│ POSITIONS 2 · ORDERS 3 · P&L +₹12,420   (collapsed)                │
│ or expanded blotter: Positions | Orders | History | Account        │
└────────────────────────────────────────────────────────────────────┘
```

Chart 65–75%. Right rail 20–25%. Draw tools ~40px. Bottom blotter resizable, remembered.

### Mobile

Bottom nav: Chart · Markets · Trade · Positions · Portfolio. Chart full-bleed. Trade ticket as bottom sheet. Draw/indicator as floating icon buttons.

---

## 5. Colour roles

| Token | Value | Job |
|---|---|---|
| `--term-bg` | `#07090c` | App field |
| `--term-panel` | `#101318` | Rails, blotter |
| `--term-panel-2` | `#161a21` | Raised menus |
| `--term-line` | `#1e242e` | Hairlines |
| `--term-text` | `#e8edf5` | Primary |
| `--term-muted` | `#8b93a3` | Secondary |
| `--term-up` | `#3dd68c` | Up / long (with “BUY”/“+”) |
| `--term-down` | `#f07178` | Down / short (with “SELL”/“−”) |
| `--term-accent` | `#6ea8ff` | Selection, focus, active tf |
| `--term-warn` | `#e8b84a` | Replay, pending |

Professional mode default. Cosmic mode: same chart; 2–3% star noise in chrome only; no galaxy behind candles.

Contrast: primary text on `--term-bg` estimated ≥ 12:1; muted on panel estimated ≥ 4.7:1. Verify in browser.

---

## 6. Type

- Chrome: IBM Plex Sans 11–13px. Toolbar 12px.
- Prices: IBM Plex Mono tabular. Last price 18–22px on chart header; 12px in watchlist.
- No Inter/Poppins. No 32px page titles on the terminal.

---

## 7. Components and states

| Component | Default | Empty | Error | Success |
|---|---|---|---|---|
| Chart | NIFTY 50 1D candles + volume | “Unable to load market data.” + Retry | Same | Live/sim badge |
| Symbol search | Recent + categories | “No symbols match.” | Feed error | Instant filter |
| Indicators | Favorites + categories | “No matches.” | — | Chip on chart |
| Watchlist | Compact quote rows | “Your watchlist is empty.” + Add | Stale quote muted | Click → chart |
| Trade ticket | BUY/SELL + type fields | — | Field errors (qty, SL/TP side, buying power) | Confirm → “ORDER PLACED · FILLED/PENDING” |
| Positions | Table | “No open positions.” | Close fail | Row + chart lines |
| Orders | Table | “No open orders.” | Reject reason | Cancel/Modify |
| History | Filtered table | “No trades yet.” | Export fail | CSV/XLS download |
| Account | Equity strip in blotter | — | — | Reset confirm |

**Trade ticket (must not navigate):** dock in right rail `TRADE` tab, or compact overlay beside chart. Confirm is a blocking dialog (money).

**Order types:** Market (qty) · Limit (qty, limit) · Stop (qty, trigger) · Stop Limit (qty, trigger, limit). Optional Bracket/OCO if SL+TP both set.

---

## 8. Interaction

| Action | Path |
|---|---|
| Search | Click symbol or Ctrl+K. Esc closes; focus restores. |
| Indicators | Ctrl+I. Enter adds. Delete key removes selected study. |
| Draw | Left toolbar groups (Trend, Fib, Shapes…). Delete selected. |
| Trade | B / S / Alt+T / toolbar Trade. Ticket stays on the terminal. |
| SL/TP | Drag horizontal lines on chart; ticket fields sync. |
| Replay | Space or Replay. Future candles hidden. Paper orders allowed. |
| Fullscreen | F11 on workstation root. |

Undo/redo (Ctrl+Z / Ctrl+Y) for drawings and indicator add/remove.

Context menu on chart: Reset, Auto scale, Add indicator, Add drawing, Alert, Trade, Hide, Delete selected/all drawings, Settings, Screenshot.

---

## 9. Motion table

| Trigger | Target | Props | Duration | Kind | Reduced |
|---|---|---|---|---|---|
| Open menu/ticket | Popover | opacity, translateY(4px) | 140ms ease-out | Functional | Instant |
| Bottom blotter | Height | (layout; snap) | 180ms | Navigational | Instant height |
| Order fill | Toast + marker | opacity | 160ms | Feedback | Instant text |
| Price tick | Last price | color flash 140ms | Feedback | No flash |

No load hero. No count-up P&L.

---

## 10. Architecture (engines, not pages)

Separate: Market Data · Chart · Indicators · Drawings · Paper Trading · Orders · Portfolio · Risk · Alerts · UI State.

Canvas/WebGL-ready **Canvas 2D** for candles (never DOM candles). Virtualize watchlist/indicator lists. Worker-ready indicator math (main thread first; extract if needed).

Simulated feed must badge **SIMULATED**. Execution: market at last±slippage; limit/stop on touch; SL/TP auto-close.

---

## 11. Public metadata

Terminal is authenticated app chrome (not marketing). Title: `Orbit Desk · Paper Trading`. Auth pages updated to paper trading, still “Not investment advice.”

---

## 12. Critique

| # | Pass | Note |
|---|---|---|
| 1 Object | Paper trading charting workstation | |
| 2 Primary | Chart; Trade is one compact ticket | |
| 3 Removed | Dashboard, KPI cards, homepage | |
| 4 Chrome yields | 40px tools, hairline panels | |
| 6 States | Empty blotter, invalid SL, buying power | |
| 7 Keyboard | Shortcuts + labelled dialogs | |

**Cut list:** no cosmic black hole behind candles; no neon grid.
