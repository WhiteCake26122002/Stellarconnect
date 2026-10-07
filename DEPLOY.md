# Putting Connect online

Connect is two programs, so it is hosted in two places, and both redeploy by themselves whenever `main` changes on GitHub:

| Part | What it is | Where | Config |
| --- | --- | --- | --- |
| Website | Next.js app in `frontend/` | Vercel | Root Directory `frontend` |
| API | FastAPI app in `backend/` | Render | `render.yaml` (Blueprint) |
| Database | Postgres | Neon | one connection string |

(Streamlit Community Cloud can only run Streamlit apps, so it cannot host this site. The old Streamlit app, `ui_app.py`, is a separate thing.)

The website talks to the API through its own address: `/v1/...` on the Vercel domain is forwarded to Render (see `frontend/next.config.ts`), so the sign-in cookie belongs to one site and there are no cross-site cookie problems.

## 1. Database (Neon, free)

1. Sign in at https://neon.tech with GitHub and create a project.
2. Copy the **connection string** (it starts with `postgresql://`). Keep it private.

Why not the database Render offers? Render's free Postgres is deleted after 30 days. Neon's free database stays.

## 2. API (Render, free)

1. Sign in at https://render.com with GitHub.
2. **New → Blueprint**, pick this repository, and apply. Render reads `render.yaml`.
3. When it asks, set:
   - `DATABASE_URL` = the Neon connection string
   - `CORS_ORIGINS` = `https://placeholder.vercel.app` for now (you set the real address in step 4)
4. Wait for the first deploy, then open `https://<your-service>.onrender.com/health`. It should show `{"ok":true}`. Copy that service address.

`SESSION_SECRET` is generated for you. `COOKIE_SECURE` is already on.

## 3. Website (Vercel, free)

1. Sign in at https://vercel.com with GitHub and **Add New → Project**, pick this repository.
2. Set **Root Directory** to `frontend`. The framework is detected as Next.js.
3. Add one environment variable: `API_PROXY_TARGET` = the Render service address from step 2 (no trailing slash).
4. Deploy. Vercel gives you the site address, for example `https://stellarconnect.vercel.app`.
5. Back in Render, change `CORS_ORIGINS` to that address and save.

## 4. Updating

Push to `main` (`git push`). Vercel rebuilds the website and Render rebuilds the API on their own. Nothing else to do.

## Things to know

- Render's free API goes to sleep after 15 minutes without a visit, and the first request afterwards takes about a minute to wake it.
- Prices come from Yahoo Finance. Yahoo sometimes limits requests from cloud servers; when that happens the desks say so and fall back to sample data.
- A person's DCF models and mutual-fund book live in the database. The paper-trading portfolio lives in the visitor's own browser.
- Optional: `NEXT_PUBLIC_LOGO_TOKEN` (company logos) on Vercel, and `GROWTH_LLM_API_KEY` on Render (the optional growth-assumption helper). The site works without both.
