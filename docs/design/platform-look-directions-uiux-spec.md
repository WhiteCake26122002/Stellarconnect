# DCF Workstation - Look Directions

**Route:** Web App  
**System:** Constrained (engine, IA, and export navy already exist; look is still open)  
**Platform:** Web, desktop-first, usable at 768px  
**Motion budget:** Local feedback under 100ms; no load-on-enter animation; reduced-motion = instant state  
**Signature mode:** Signature log unavailable; running static Attractor Check (Provisional Hypothesis Mode)  
**Date:** 2026-09-18  
**Prepared for:** Visual direction of the analyst workstation

---

## 1. Brief

| Field | |
|---|---|
| Subject | A saved **valuation model** for one non-financial company |
| Audience | Analysts who already think in WACC, FCFF, and terminal growth |
| Primary job | Form a view: implied value vs market, then defend it |
| Secondary jobs | Stress drivers; audit sources; export workbook/report |
| Success metric | Ticker or statements to verdict + integrity without fighting navigation |
| Platform | Web app; keyboard through forms; no iOS chrome |
| Constraints | Keep engine math; inherit export navy `#160D70`; WCAG 2.2 AA; no trading/MF in v1 |
| Assets | Engine, Damodaran refs, Excel/PDF navy, existing workspace IA |
| Content shape | Dense tables, KPI strip, one heatmap, long assumption list |

**Dimensional sliders (targets):**

| Slider | Band | Why |
|---|---|---|
| Density | High | Content is a model, not a landing page |
| Hierarchy | Sharp | Verdict first, drivers always at hand |
| Ornament | Near-zero | Trust comes from numbers, not chrome |
| Motion | Still / functional | Recalc must not animate the price |

**Assumptions:** Models private to owner; password auth only; Gordon is headline EV.

**Signature Gate:**

- Log path status: missing at start of this pass
- Attractor hits: 0/8 (type is IBM Plex already in the app, not Inter-as-restraint; colour is brand navy, not cream+stern-accent; layout is a work surface; nav is opinionated; interaction is cited debounce+PATCH; motion is still not a hero reveal; density is high; imagery is the table itself)
- Declared load-bearing break: equal Streamlit tabs become **sticky verdict + driver drawer + one working surface**

---

## 2. Audit

**Root-cause layer:** Structural (then Interaction, then Surface).

The Streamlit shell treated Financials, WACC, DCF, Scenarios, and Export as ten equal tabs. The Next.js v1 already collapsed that into six surfaces, but the visual language is still a first-pass form: cards, a KPI grid, and a drawer. The look question is: what should that desk *feel* like while doing the same job.

---

## 3. Directions considered

**Direction A - Audit desk**

- Thesis: The screen is a working model, not a stock-picker landing page.
- Axis: structure
- Rooted in: sell-side Excel (yellow inputs, computed rest) + existing navy exports
- Signature: sticky verdict bar, yellow editable cells, lavender computed cells, driver drawer always open on desktop
- Risk: too dense on a phone - collapse the drawer
- Slider stance: density high / hierarchy sharp / ornament none / motion still

**Direction B - Investment memo**

- Thesis: The workspace reads like an IC note you would send a partner.
- Axis: metaphor
- Rooted in: printed investment committee memos, not Excel
- Signature: one thesis sentence ("Implied $142 vs market $118, +21% at 9.4% WACC"), numbered assumptions in the margin, surfaces as memo sections
- Risk: slower for people who live in grids; scanning a heatmap inside prose is awkward
- Slider stance: density medium-high / hierarchy very sharp (the sentence) / ornament low (rules, not decoration) / motion still

**Direction C - Night terminal**

- Thesis: All six working surfaces visible at once, like a market terminal.
- Axis: structure (tiled panes instead of one surface at a time)
- Rooted in: Bloomberg / sell-side multi-monitor, long sessions
- Signature: dark panels, hairlines, tabular mono numbers, keyboard strip, heatmap always on screen
- Risk: hostile to first-time users; contrast and mobile reflow are expensive; dark-as-only-mode is an anti-default
- Slider stance: density very high / hierarchy flatter (panes compete) / ornament none / motion still

**Recognition test:** Desk is Excel-coded colour. Memo is a document. Terminal is tiled dark panes. Costume-only colour swaps would fail this test; these do not.

**Anti-default check:** No purple mesh, no Inter, no glass cards, no three feature tiles. Memo uses stone paper + Georgia because the object is a memo, not because "editorial is premium." Terminal uses dark because of session length, and must keep a light theme as a second skin.

**Brief citations for non-standard choices:**

- Yellow input cells: audience already reads Excel this way (content shape + familiarity)
- Sticky verdict: primary job is implied vs market
- Tiled terminal: secondary job "stress drivers" wants heatmap always visible (cited; higher risk)

---

## 4. Recommendation

**Chosen:** Direction A - Audit desk (already specified in `docs/design/dcf-workspace-uiux-spec.md` and implemented in the Next.js workspace).

**Why vs brief:** Analysts form a view by editing drivers and watching implied vs market. Excel colour-coding is the native language of that job. Export navy keeps the app and the PDF/Excel one product.

**What we give up:** The memo's rhetorical punch; the terminal's always-on heatmap.

**Hierarchy of emphasis:** primary = implied vs market in the verdict bar; secondary = drivers; quiet = historical tables and sources.

**Intuition:** A valuation tool that looks like a SaaS dashboard will be distrusted. One that looks like a sheet the analyst already knows will be used.

**User pick wins:** If the preference is Memo or Terminal, restyle tokens and workspace chrome only; do not change the engine or the six-surface IA except Terminal's tile layout.

---

## 5. Tokens (chosen: Audit desk)

Inherit `dcf-workspace-uiux-spec.md`. Summary:

| Name | Hex | Role | Contrast notes |
|---|---|---|---|
| Ink | `#0B0B12` | Text | Estimated 16:1 on paper |
| Paper | `#F7F5FF` | Page | - |
| Surface | `#FFFFFF` | Cards, inputs | - |
| Navy | `#160D70` | Brand, primary actions | Estimated 10:1 on white |
| Bull | `#0F7B4A` | Upside | Estimated 4.6:1 on white - verify |
| Bear | `#B42318` | Downside | Estimated 5.5:1 on white - verify |
| Input yellow | `#FEF9C3` | Editable | Not a text colour |
| Computed | `#F1EFFC` | Engine output | Not a text colour |

**Type:** IBM Plex Sans + IBM Plex Mono (tabular nums). Fallback: Segoe UI / system-ui / ui-monospace.

**Shape:** radius 6px. Space 4/8/12/16/24. Focus ring 2px navy.

Memo and Terminal palettes stay in the look preview until picked; do not mix them into the shipping CSS.

---

## 6. Structure

Unchanged from the workspace spec:

```
/login  /register
/models                 list + New
/models/new             search Yahoo OR paste statements
/models/:id             workspace
  Overview / Statements / Build / Scenarios / Sources / Export
```

Workspace chrome (Audit desk): left identity, center verdict then one surface, right driver drawer.

---

## 7-9. Components, motion, copy

Skipping full restatement because: already specified in `dcf-workspace-uiux-spec.md`. This document only opens the look decision.

---

## 10. Critique

| Lens | Finding |
|---|---|
| Commercial | Desk ships now; Memo/Terminal are restyles, not new products |
| Developer | One token file + workspace chrome; Terminal's tile layout is the expensive pick |
| Designer | Three strategies are structurally distinct |
| End user | Desk is the one that matches how they already work |
| Accessibility | Yellow is a cell fill, not the only input cue; labels stay on every driver |
| Motion | Recalc spinner/text only; prices do not count up |
| Currency | Excel yellow is convention, not fashion |
| Signature verify | Break landed: verdict + drawer, not ten equal tabs |

**Removed accessory:** Marketing hero, guest account IDs, Streamlit tab chrome.

**Testable hypotheses:** Analysts find implied vs market in under 3 seconds on a saved model; they can name whether a cell is input or computed without a legend.

---

## 11. Open questions

- User decisions: stay with Audit desk, or restyle to Memo / Terminal
- Verify: IBM Plex license on the web; bull/bear contrast on yellow and lavender cells
