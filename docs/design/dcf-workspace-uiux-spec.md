# DCF Analyst Workstation — UI/UX Direction & Spec

**Route:** Web App  
**System:** Greenfield product UI; inherit export brand (navy `#160D70`) so Excel/PDF and the app are one product  
**Platform:** Web, desktop-first, usable at 768px  
**Motion budget:** Local feedback under 100ms; no load-on-enter animation; reduced-motion = instant state  
**Signature mode:** Provisional — dense audit desk, not a marketing dashboard  
**Date:** 2026-09-18  
**Prepared for:** DCF platform rewrite v1

---

## 1. Brief

| Field | |
|---|---|
| Subject | A saved **valuation model** for one non-financial company |
| Audience | Analysts who already think in WACC, FCFF, and terminal growth |
| Primary job | Form a view: implied value vs market, then defend it |
| Secondary jobs | Stress drivers; audit sources; export workbook/report |
| Success metric | Ticker or statements → verdict + integrity without fighting navigation |
| Platform | Web app; keyboard through forms; no iOS chrome |
| Constraints | Keep engine math; no trading/MF; no Streamlit tabs; WCAG 2.2 AA |
| Assets | Engine, Damodaran refs, Excel/PDF navy palette |
| Content shape | Dense tables, KPI strip, one heatmap, long assumption list |

**Sliders:** Density high. Hierarchy strong (verdict first). Ornament near-zero. Motion low.

**Assumptions (open questions resolved for v1):** models private to owner; password auth only; Gordon is headline EV; blunt scenario WACC deltas; Method B+ out; preferred stock is a manual claim; size premium visible in the driver drawer (default 0).

**Load-bearing break:** 10 equal tabs → **verdict bar + driver drawer + 6 working surfaces**.

---

## 2. Audit (Streamlit)

**Root-cause layer:** Structural (IA), then Interaction (rerun), then Surface (HTML costume).

| Finding | Layer | Why it matters |
|---|---|---|
| Ten peer tabs | Structural | Equal weight on “Financials” and “the view” |
| Full recalc every widget tick | Interaction | Latency and lost place |
| Generate then download | Interaction | Fake two-step for Streamlit files |
| Guest `?uid=` | Structural | Not team auth |
| Cosmic HTML cards | Surface | Density yes; costume no |

---

## 3. Direction

**Chosen: Audit desk**

- Thesis: The screen is a working model, not a stock-picker landing page.
- Axis: structure — verdict sticky, drivers always at hand, detail on demand.
- Rooted in: sell-side Excel (yellow inputs, computed rest) + existing navy exports.
- Risk: too dense on mobile — collapse drawer; stack surfaces.
- Not chosen: “fintech gradient dashboard”; “iOS card gallery”; Streamlit reskin.

**Tokens**

- Ink `#0B0B12`, paper `#F7F5FF`, surface `#FFFFFF`, navy `#160D70`, navy-light `#2A1FB0`
- Bull `#0F7B4A`, bear `#B42318`, input yellow `#FEF9C3` (editable), computed lavender `#F1EFFC`
- Type: system UI / IBM Plex Sans if available; tabular nums for money
- Radius 6px; space 4/8/12/16/24; focus ring 2px navy

---

## 4. Information architecture

```
/login  /register
/models                 list + New
/models/new             search Yahoo OR paste statements
/models/:id             workspace
  Overview
  Statements
  Build                 forecast + DCF + equity bridge
  Scenarios             bear/base/bull + WACC×g + drivers
  Sources               assumptions + integrity
  Export
```

**Workspace chrome**

- Left (collapsible): model name, ticker, last saved
- Center: **verdict bar** (always visible) then one surface
- Right drawer: drivers — horizon, long-term growth, target EBITDA margin, Rf, beta, ERP, pretax Kd, size premium, terminal g, exit multiple, preferred stock, private equity weight

**Verdict bar fields:** Enterprise value, equity value, implied/share, market/share, upside, WACC, TV% of EV, integrity band.

**Blocking states in the bar (do not show a fake price):** WACC ≤ g; ingest failed; loading.

---

## 5. States

| State | Behavior |
|---|---|
| Empty list | One job: New model |
| Ingest loading | Spinner on new-model; do not navigate until payload exists |
| Yahoo failure | Error with message (banks refused, ticker missing); stay on new |
| WACC ≤ g | Error in bar + Build; hide implied price |
| Negative equity | Show numbers + error; integrity will flag |
| Auth denied | Redirect login |
| Save conflict | Last-write-wins on PATCH; toast updated_at |
| Permission | 404-style “not found” (no IDOR leak) |

---

## 6. Interaction

- Driver changes debounce 300ms then `PATCH /v1/models/{id}/assumptions`. Optimistic UI only for slider positions; numbers come from the server.
- Per-year overrides live on Build; same PATCH.
- Export is one click → file download (no generate-then-download).
- Search: type ≥2 chars, pick match, Create model.
- Keyboard: drawer sliders, tab through surfaces, Escape closes drawer on small screens.

---

## 7. Component inventory (v1)

App shell, auth form, model list row, search results, statement grid (manual), verdict bar, driver drawer, data table, heatmap, integrity list, export actions, toast, empty/error/loading.

Meaning in the tree: `h1` = company/model name; surfaces as `nav`; tables as tables; drivers as labeled inputs.

---

## 8. Handoff

Frontend: Next.js App Router. Workspace is a client island. Match this spec; do not port Streamlit widgets.
