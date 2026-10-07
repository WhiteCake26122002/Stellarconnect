# Connect

Chart-first **paper trading workstation** with a secondary DCF valuation desk.

The **UI is Next.js (React)** at port 3000. Python is the FastAPI engine and market feed only — do not build screens in Streamlit or other Python UI.

## Local development

```bash
# API (from repo root)
venv\Scripts\python.exe -m pip install -r requirements.txt
venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8000

# UI
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 — register, then choose **DCF** or **Paper trading**. You can switch from either desk. Direct routes: `/terminal`, `/models`.

The terminal pulls Yahoo Finance OHLC and last prices (the same feed as the DCF engine) every 20 seconds. If Yahoo is unreachable, the chart keeps a simulated series so the desk still works.

SQLite is the default API database (`backend/data/app.db`). For Postgres, set `DATABASE_URL` (see `.env.example`).

## Putting it online

See [DEPLOY.md](DEPLOY.md): the website on Vercel, the API on Render, the database on Neon, all redeploying from `main`.

## Tests

```bash
venv\Scripts\python.exe -m pytest
cd frontend && npx playwright install chromium && npm run test:e2e
```

## Docker

```bash
docker compose up --build
```

## What v1 is not

Live brokerage, guaranteed real-time NSE/BSE quotes, or investment advice. Guest Account IDs are not used in the new app.
